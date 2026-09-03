import { getSession } from "./cameraSession.js";
import { assignGroupsToFaces, groupIdsForUuids, groupMap, recentGroupStats } from "./groupData.js";

const MAX_PAGE = 40;

const GENDER = { male: 0, female: 1 };
const AGE = { under_18: 0, "18_25": 1, "26_30": 2, "31_35": 3, "36_40": 4, "41_50": 5, over_50: 6 };
const MASK = { unmasked: 0, masked: 1 };
const GLASSES = { not_wearing: 0, wearing: 1 };
const EXPRESSION = { expressionless: 0, smile: 1, laugh: 2 };

const jpegCache = new Map();
const JPEG_CACHE_MAX = 250;
const JPEG_CHUNK = 4;
const JPEG_CONCURRENCY = 2;
const simpleInfoPref = new Map();
const SIMPLE_INFO_TTL_MS = 60_000;
let listSnappedSeq = 0;

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
  jpegCache.delete(jpegCache.keys().next().value);
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

async function fillMissingJpegs(session, rows) {
  const missing = rows.filter((row) => row.UUId && !row.FaceImage).map((row) => row.UUId);
  if (!missing.length) return;
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
}

async function fetchSnapPage(session, body, simple) {
  const page = await session.post("/API/AI/SnapedFaces/GetByIndex", { ...body, SimpleInfo: simple });
  return [...(page.data?.SnapedFaceInfo ?? [])].reverse();
}

async function getSnapRows(session, startIndex, count) {
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
    if (rows.length) {
      simpleInfoPref.set(camId, { value: simple, at: Date.now() });
      return rows;
    }
  }
  if (cached != null) {
    const other = cached === 1 ? 0 : 1;
    const rows = await fetchSnapPage(session, body, other);
    if (rows.length) {
      simpleInfoPref.set(camId, { value: other, at: Date.now() });
      return rows;
    }
  }
  return [];
}

/**
 * Honeywell name resolution for a page of snaps:
 * 1. Group id on the snap row → FDGroup name
 * 2. FaceStatistics time-join for the day
 * 3. Per-group SnapedFaces Search + GetByIndex UUID match
 * 4. leftover → Stranger
 */
async function resolveNames(session, rows) {
  const names = new Map();
  const groups = await groupMap(session);
  const stranger = groups.get(4) || "Stranger";
  const unnamed = rows.filter((row) => row.UUId);

  for (const row of unnamed) {
    const gid = usefulGroupId(row);
    if (gid != null && groups.has(gid)) names.set(row.UUId, groups.get(gid));
  }

  let leftover = unnamed.filter((row) => !names.has(row.UUId));
  if (!leftover.length) return names;

  const unixSec = leftover.find((row) => row.StartTime)?.StartTime;
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
        if (gid && gid !== 4 && groups.has(gid)) names.set(uuid, groups.get(gid));
      }
    }
    leftover = leftover.filter((row) => !names.has(row.UUId));
  }

  if (leftover.length && unixSec) {
    const byUuid = await groupIdsForUuids(
      session,
      unixSec,
      leftover.map((row) => row.UUId),
      [...groups.keys()],
    );
    for (const [uuid, gid] of byUuid) {
      if (gid && gid !== 4) names.set(uuid, groups.get(gid) ?? stranger);
    }
    leftover = leftover.filter((row) => !names.has(row.UUId));
  }

  for (const row of leftover) names.set(row.UUId, stranger);
  return names;
}

export async function listSnappedFaces(opts = {}) {
  const seq = ++listSnappedSeq;
  const tag = `listSnappedFaces #${seq}`;
  console.time(tag);
  try {
    return await listSnappedFacesWork(opts);
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
  date: day,
  gender,
  age,
  glasses,
  mask,
  expression,
}) {
  const session = await getSession(cam);
  const camId = session.id;
  const date = dayKey(day);

  // 1) Search — same filters Honeywell uses for Capture / Face Search
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
  const search = await session.post("/API/AI/SnapedFaces/Search", searchBody);
  const total = search.data?.Count ?? 0;
  if (!total) return { faces: [], total: 0 };

  const { startIndex, count } = pageRange({ offset, limit, start, end }, total);
  if (!count) return { faces: [], total };

  // 2) Page rows (newest-first UI → reverse GetByIndex order)
  const faces = await getSnapRows(session, startIndex, count);
  if (!faces.length) return { total, startIndex, count, faces: [] };

  // 3) JPEG fill
  await fillMissingJpegs(session, faces);

  // 4) Name match (fresh each request; expect ~1–2s)
  const wantNames = names === true || names === "1";
  let nameByUuid = new Map();
  if (wantNames) {
    try {
      nameByUuid = await resolveNames(session, faces);
    } catch (err) {
      console.error("face names", err);
    }
  }

  return {
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
        name: nameByUuid.get(uuid) || (wantNames ? "Stranger" : "unknown"),
        start: startTime,
        end: row.StartTime ? cameraStamp(row.StartTime + 5 * 60) : null,
      };
    }),
  };
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
