import { getSession } from "./cameraSession.js";
import { assignGroupsToFaces, groupIdsForUuids, groupMap, recentGroupStats } from "./groupData.js";
import fs from "node:fs";
import path from "node:path";

const nameCache = new Map();
let nameCacheStranger = "Stranger";
const MAX_PAGE = 40;

const GENDER = { male: 0, female: 1 };
const AGE = { under_18: 0, "18_25": 1, "26_30": 2, "31_35": 3, "36_40": 4, "41_50": 5, over_50: 6 };
const MASK = { unmasked: 0, masked: 1 };
const GLASSES = { not_wearing: 0, wearing: 1 };
const EXPRESSION = { expressionless: 0, smile: 1, laugh: 2 };

function asList(value) {
  if (value == null || value === "") return [];
  return (Array.isArray(value) ? value : String(value).split(","))
    .map((item) => String(item).trim())
    .filter(Boolean);
}

function codes(value, table) {
  const out = [];
  for (const item of asList(value)) {
    if (Object.hasOwn(table, item)) out.push(table[item]);
    else {
      const n = Number(item);
      if (Number.isFinite(n)) out.push(n);
    }
  }
  return [...new Set(out)];
}

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function dayKey(value) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return today();
}

function cameraStamp(unixSec) {
  const d = new Date(Number(unixSec) * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}Z`;
}

const jpegCache = new Map();
const JPEG_CACHE_MAX = 250;
const searchCache = new Map();
const SEARCH_TTL_MS = 8000;
const pageCache = new Map();
const pageInflight = new Map();
const PAGE_CACHE_TTL_MS = 8000;
const PAGE_CACHE_MAX = 8;
let groupMapCache = { camId: "", at: 0, map: null };
const GROUP_MAP_TTL_MS = 30000;
const SIMPLE_INFO_TTL_MS = 60_000;
const simpleInfoPref = new Map();
const JPEG_CHUNK = 4;
const JPEG_CONCURRENCY = 2;
const NAME_CACHE_FILE = path.join(process.cwd(), "data", "name-cache.json");
let listSnappedSeq = 0;
let nameSaveTimer;

loadNameCache();

function loadNameCache() {
  try {
    const raw = JSON.parse(fs.readFileSync(NAME_CACHE_FILE, "utf8"));
    if (!raw || typeof raw !== "object") return;
    for (const [key, name] of Object.entries(raw)) {
      if (typeof name === "string" && name) nameCache.set(key, name);
    }
    console.log(`nameCache loaded ${nameCache.size} names from disk`);
  } catch {
    /* first run */
  }
}

function saveNameCache() {
  clearTimeout(nameSaveTimer);
  nameSaveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(NAME_CACHE_FILE), { recursive: true });
      fs.writeFileSync(NAME_CACHE_FILE, JSON.stringify(Object.fromEntries(nameCache)));
    } catch (err) {
      console.error("name cache save", err);
    }
  }, 250);
}

async function mapPool(items, limit, worker) {
  if (!items.length) return [];
  const out = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const idx = next++;
      out[idx] = await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return out;
}

function cacheJpeg(key, buf) {
  jpegCache.set(key, buf);
  if (jpegCache.size <= JPEG_CACHE_MAX) return;
  const first = jpegCache.keys().next().value;
  jpegCache.delete(first);
}

function jpegDataUrl(b64) {
  if (!b64) return null;
  const raw = String(b64);
  if (raw.startsWith("data:")) return raw;
  return `data:image/jpeg;base64,${raw}`;
}

function rememberFaceJpeg(camId, uuid, b64) {
  if (!uuid || !b64) return null;
  const raw = String(b64).replace(/^data:image\/\w+;base64,/, "");
  cacheJpeg(`${camId}:${uuid}`, Buffer.from(raw, "base64"));
  return jpegDataUrl(b64);
}

async function cachedGroupMap(session) {
  if (
    groupMapCache.map &&
    groupMapCache.camId === session.id &&
    Date.now() - groupMapCache.at < GROUP_MAP_TTL_MS
  ) {
    return groupMapCache.map;
  }
  const map = await groupMap(session);
  groupMapCache = { camId: session.id, at: Date.now(), map };
  return map;
}

function cachePage(key, result) {
  pageCache.set(key, { at: Date.now(), result });
  if (pageCache.size <= PAGE_CACHE_MAX) return;
  pageCache.delete(pageCache.keys().next().value);
}

async function searchTotal(session, body, fresh) {
  const key = `${session.id}:${JSON.stringify(body)}`;
  const hit = searchCache.get(key);
  if (!fresh && hit && Date.now() - hit.at < SEARCH_TTL_MS) return hit.total;
  const search = await session.post("/API/AI/SnapedFaces/Search", body);
  const total = search.data?.Count ?? 0;
  searchCache.set(key, { total, at: Date.now() });
  return total;
}

async function fillMissingJpegs(session, rows) {
  const missing = rows.filter((row) => row.UUId && !row.FaceImage).map((row) => row.UUId);
  const tag = `fillMissingJpegs n=${missing.length}`;
  console.time(tag);
  try {
    const chunks = [];
    for (let i = 0; i < missing.length; i += JPEG_CHUNK) {
      chunks.push(missing.slice(i, i + JPEG_CHUNK));
    }
    const post = session.postNow || session.post;
    await mapPool(chunks, JPEG_CONCURRENCY, async (uuids) => {
      const res = await post("/API/AI/SnapedFaces/GetById", {
        MsgId: "",
        Engine: 1,
        UUIds: uuids,
        WithFaceImage: 1,
        WithBodyImage: 0,
        WithBackgroud: 0,
        WithFeature: 0,
      });
      const byId = new Map();
      for (const row of res.data?.SnapedFaceInfo ?? []) {
        if (row.UUId) byId.set(row.UUId, row);
      }
      for (const row of rows) {
        const extra = byId.get(row.UUId);
        if (!extra) continue;
        if (!row.FaceImage && extra.FaceImage) row.FaceImage = extra.FaceImage;
        if (usefulGroupId(row) == null && usefulGroupId(extra) != null) {
          row.Group = extra.Group;
          row.GrpId = extra.GrpId;
          row.GroupId = extra.GroupId;
          row.AlarmGroup = extra.AlarmGroup;
        }
      }
    });
  } finally {
    console.timeEnd(tag);
  }
}

function groupIdFromRow(row) {
  if (Number.isFinite(row?.Group) && row.Group > 0) return row.Group;
  if (Number.isFinite(row?.GrpId) && row.GrpId > 0) return row.GrpId;
  if (Number.isFinite(row?.GroupId) && row.GroupId > 0) return row.GroupId;
  if (Array.isArray(row?.AlarmGroup) && Number.isFinite(row.AlarmGroup[0])) return row.AlarmGroup[0];
  return null;
}

function usefulGroupId(row) {
  const gid = groupIdFromRow(row);
  if (gid == null || gid === 4) return null;
  return gid;
}

function pageRange({ offset = 0, limit, start, end }, total) {
  let fromNewest = Math.max(0, Number(offset) || 0);
  let pageSize = Number(limit);
  if (start != null && end != null) {
    fromNewest = Math.max(0, Number(start) || 0);
    pageSize = Math.max(0, Number(end) - fromNewest);
  }
  if (!Number.isFinite(pageSize) || pageSize <= 0) pageSize = 12;
  pageSize = Math.min(MAX_PAGE, pageSize);
  const endIndex = Math.max(0, total - fromNewest);
  const startIndex = Math.max(0, endIndex - pageSize);
  return { startIndex, endIndex, count: endIndex - startIndex };
}

async function fetchSnapPage(session, body, simple) {
  const page = await session.post("/API/AI/SnapedFaces/GetByIndex", { ...body, SimpleInfo: simple });
  return [...(page.data?.SnapedFaceInfo ?? [])].reverse();
}

async function getSnapRows(session, startIndex, count) {
  const tag = `getSnapRows ${session.id} ${startIndex}+${count}`;
  console.time(tag);
  try {
    const body = {
      MsgId: "",
      Engine: 1,
      MatchedFaces: 0,
      StartIndex: startIndex,
      Count: count,
      WithFaceImage: 0,
      WithBodyImage: 0,
      WithBackgroud: 0,
      WithFeature: 0,
      NeedTime: 1,
    };
    const camId = session.id;
    const pref = simpleInfoPref.get(camId);
    const cached = pref && Date.now() - pref.at < SIMPLE_INFO_TTL_MS ? pref.value : null;
    const order = cached == null ? [1, 0] : [cached];
    for (const simple of order) {
      const rows = await fetchSnapPage(session, body, simple);
      console.log(`getSnapRows cam=${camId} SimpleInfo:${simple} rows=${rows.length}${cached == null ? "" : " (cached pref)"}`);
      if (rows.length) {
        simpleInfoPref.set(camId, { value: simple, at: Date.now() });
        return rows;
      }
    }
    if (cached != null) {
      const other = cached === 1 ? 0 : 1;
      const rows = await fetchSnapPage(session, body, other);
      console.log(`getSnapRows cam=${camId} SimpleInfo:${other} rows=${rows.length} (fallback after empty cache)`);
      if (rows.length) {
        simpleInfoPref.set(camId, { value: other, at: Date.now() });
        return rows;
      }
    }
    return [];
  } finally {
    console.timeEnd(tag);
  }
}

export async function listSnappedFaces(opts = {}) {
  const seq = ++listSnappedSeq;
  const tag = `listSnappedFaces #${seq}`;
  console.time(tag);
  try {
    return await listSnappedFacesWork(opts, seq);
  } finally {
    console.timeEnd(tag);
  }
}

async function listSnappedFacesWork({
  cam,
  offset = 0,
  limit,
  start,
  end,
  names,
  fresh,
  date: day,
  gender,
  age,
  glasses,
  mask,
  expression,
}, seq) {
  const session = await getSession(cam);
  const camId = session.id;
  const date = dayKey(day);
  const searchBody = {
    MsgId: "",
    StartTime: `${date} 00:00:00`,
    EndTime: `${date} 23:59:59`,
    Chn: 0,
    AlarmGroup: [],
    Expression: codes(expression, EXPRESSION),
    FaceInfo: [],
    fAttrAge: codes(age, AGE),
    Gender: codes(gender, GENDER),
    GlassesType: codes(glasses, GLASSES),
    MouthMask: codes(mask, MASK),
    Similarity: 0,
    Engine: 1,
    Count: 0,
  };
  const total = await searchTotal(session, searchBody, fresh === true || fresh === "1");
  if (!total) return { faces: [], total: 0 };

  const { startIndex, count } = pageRange({ offset, limit, start, end }, total);
  if (!count) return { faces: [], total };

  const wantNames = names === true || names === "1";
  const pageKey = `${camId}:${startIndex}:${count}:${wantNames ? 1 : 0}:${JSON.stringify(searchBody)}`;
  const bypass = fresh === true || fresh === "1";
  if (!bypass) {
    const hit = pageCache.get(pageKey);
    if (hit && Date.now() - hit.at < PAGE_CACHE_TTL_MS) return hit.result;
    const pending = pageInflight.get(pageKey);
    if (pending) return pending;
  }

  const loading = (async () => {
    const faces = await getSnapRows(session, startIndex, count);
    if (!faces.length) return { total, startIndex, count, faces: [] };
    await fillMissingJpegs(session, faces);
    if (wantNames) {
      try {
        await resolveNames(session, faces, camId, seq);
      } catch (err) {
        console.error("face names", err);
      }
    }
    const result = {
      total,
      startIndex,
      count,
      faces: faces.map((row) => {
        const uuid = row.UUId;
        const startTime = row.StartTime ? cameraStamp(row.StartTime) : null;
        const cached = jpegCache.get(`${camId}:${uuid}`);
        const url =
          rememberFaceJpeg(camId, uuid, row.FaceImage) ||
          (cached ? `data:image/jpeg;base64,${cached.toString("base64")}` : `/api/snaps/${encodeURIComponent(uuid)}?cam=${encodeURIComponent(camId)}`);
        return {
          uuid,
          filename: uuid,
          url,
          name: nameCache.get(`${camId}:${uuid}`) || "unknown",
          start: startTime,
          end: row.StartTime ? cameraStamp(row.StartTime + 5 * 60) : null,
        };
      }),
    };
    if (result.faces.length) cachePage(pageKey, result);
    return result;
  })();
  if (!bypass) pageInflight.set(pageKey, loading);
  try {
    return await loading;
  } finally {
    pageInflight.delete(pageKey);
  }
}

function stillUnnamed(name) {
  return !name || name === "unknown";
}

async function resolveNames(session, rows, camId, seq) {
  const keyOf = (uuid) => `${camId}:${uuid}`;
  const unnamed = rows.filter((row) => row.UUId && stillUnnamed(nameCache.get(keyOf(row.UUId))));
  if (!unnamed.length) {
    console.log(`resolveNames #${seq} skip (all cached)`);
    return;
  }

  const tMap = `resolveNames.cachedGroupMap #${seq}`;
  console.time(tMap);
  const names = await cachedGroupMap(session);
  nameCacheStranger = names.get(4) || "unknown";
  for (const row of unnamed) {
    const gid = usefulGroupId(row);
    if (gid != null && names.has(gid)) nameCache.set(keyOf(row.UUId), names.get(gid));
  }
  let leftover = unnamed.filter((row) => stillUnnamed(nameCache.get(keyOf(row.UUId))));
  console.timeEnd(tMap);
  console.log(`resolveNames #${seq} leftover after cachedGroupMap: ${leftover.length}/${unnamed.length}`);
  if (!leftover.length) {
    console.log(`resolveNames #${seq} early-exit after cachedGroupMap`);
    saveNameCache();
    return;
  }

  const unixSec = leftover.find((row) => row.StartTime)?.StartTime;
  const tStats = `resolveNames.recentGroupStats #${seq}`;
  console.time(tStats);
  if (unixSec) {
    const timed = leftover
      .filter((row) => row.StartTime)
      .map((row) => ({
        UUId: row.UUId,
        StartTime: row.StartTime,
        EndTime: row.EndTime || row.StartTime + 5,
      }));
    if (timed.length) {
      const stats = await recentGroupStats(session, timed[0].StartTime, Math.max(80, timed.length + 8));
      for (const [uuid, gid] of assignGroupsToFaces(timed, stats)) {
        if (gid && gid !== 4 && names.has(gid)) nameCache.set(keyOf(uuid), names.get(gid));
      }
    }
    leftover = leftover.filter((row) => stillUnnamed(nameCache.get(keyOf(row.UUId))));
  }
  console.timeEnd(tStats);
  console.log(`resolveNames #${seq} leftover after recentGroupStats: ${leftover.length}`);
  if (!leftover.length) {
    console.log(`resolveNames #${seq} early-exit after recentGroupStats`);
    saveNameCache();
    return;
  }

  const tUuid = `resolveNames.groupIdsForUuids #${seq}`;
  console.time(tUuid);
  if (unixSec) {
    const byUuid = await groupIdsForUuids(
      session,
      unixSec,
      leftover.map((row) => row.UUId),
      [...names.keys()],
    );
    for (const [uuid, gid] of byUuid) {
      if (gid && gid !== 4) nameCache.set(keyOf(uuid), names.get(gid) ?? "unknown");
    }
    leftover = leftover.filter((row) => stillUnnamed(nameCache.get(keyOf(row.UUId))));
  }
  console.timeEnd(tUuid);
  console.log(`resolveNames #${seq} leftover after groupIdsForUuids: ${leftover.length}`);

  for (const row of unnamed) {
    if (stillUnnamed(nameCache.get(keyOf(row.UUId)))) nameCache.set(keyOf(row.UUId), nameCacheStranger);
  }
  saveNameCache();
}

export async function getSnapJpeg(uuid, cam) {
  if (!uuid) throw new Error("uuid required");
  const session = await getSession(cam);
  const cacheKey = `${session.id}:${uuid}`;
  const hit = jpegCache.get(cacheKey);
  if (hit) return hit;
  const res = await session.post("/API/AI/SnapedFaces/GetById", {
    MsgId: "",
    Engine: 1,
    UUIds: [uuid],
    WithFaceImage: 1,
    WithBodyImage: 0,
    WithBackgroud: 0,
    WithFeature: 0,
  });
  const face = res.data?.SnapedFaceInfo?.[0];
  if (!face?.FaceImage) throw new Error("no FaceImage");
  const buf = Buffer.from(face.FaceImage, "base64");
  cacheJpeg(cacheKey, buf);
  return buf;
}
