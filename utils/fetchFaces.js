import { getSession } from "./cameraSession.js";
import { assignGroupsToFaces, groupIdsForUuids, groupMap, recentGroupStats } from "./groupData.js";

const MAX_PAGE = 40;

const GENDER = { male: 0, female: 1 };
const AGE = { under_18: 0, "18_25": 1, "26_30": 2, "31_35": 3, "36_40": 4, "41_50": 5, over_50: 6 };
const MASK = { unmasked: 0, masked: 1 };
const GLASSES = { not_wearing: 0, wearing: 1 };
const EXPRESSION = { expressionless: 0, smile: 1, laugh: 2 };

const jpegCache = new Map();
const JPEG_CACHE_MAX = 120;
const JPEG_CHUNK = 6;
const JPEG_CONCURRENCY = 2;
const simpleInfoPref = new Map();
const SIMPLE_INFO_TTL_MS = 120_000;
const groupMapCache = new Map();
const GROUP_MAP_TTL_MS = 30_000;

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

function rememberFaceJpeg(camId, uuid, b64) {
  if (!uuid || !b64) return;
  const raw = String(b64).replace(/^data:image\/\w+;base64,/, "");
  cacheJpeg(`${camId}:${uuid}`, Buffer.from(raw, "base64"));
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

async function cachedGroupMap(session) {
  const hit = groupMapCache.get(session.id);
  if (hit && Date.now() - hit.at < GROUP_MAP_TTL_MS) return hit.map;
  const map = await groupMap(session);
  groupMapCache.set(session.id, { at: Date.now(), map });
  return map;
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

async function fetchSnapPage(session, body, simple, withImage) {
  const page = await session.post("/API/AI/SnapedFaces/GetByIndex", {
    ...body,
    SimpleInfo: simple,
    WithFaceImage: withImage ? 1 : 0,
  });
  return [...(page.data?.SnapedFaceInfo ?? [])].reverse();
}

/**
 * Honeywell GetByIndex: prefer SimpleInfo=0 so Group comes on the row.
 * Pull JPEGs in the same call when cheap; fall back to GetById fill.
 */
async function getSnapRows(session, startIndex, count) {
  const body = {
    MsgId: "",
    Engine: 1,
    MatchedFaces: 0,
    StartIndex: startIndex,
    Count: count,
    WithBodyImage: 0,
    WithBackgroud: 0,
    WithFeature: 0,
    NeedTime: 1,
  };
  const camId = session.id;
  const pref = simpleInfoPref.get(camId);
  const cached = pref && Date.now() - pref.at < SIMPLE_INFO_TTL_MS ? pref.value : null;
  const order = cached == null ? [0, 1] : [cached];

  for (const simple of order) {
    const withImage = simple === 0;
    const rows = await fetchSnapPage(session, body, simple, withImage);
    if (rows.length) {
      simpleInfoPref.set(camId, { value: simple, at: Date.now() });
      return rows;
    }
  }
  if (cached != null) {
    const other = cached === 1 ? 0 : 1;
    const rows = await fetchSnapPage(session, body, other, other === 0);
    if (rows.length) {
      simpleInfoPref.set(camId, { value: other, at: Date.now() });
      return rows;
    }
  }
  return [];
}

/**
 * Honeywell name resolution:
 * 1. Group on snap row → FDGroup name
 * 2. FaceStatistics time-join
 * 3. Per-group UUID Search (only leftovers)
 * 4. Stranger
 */
async function resolveNames(session, rows) {
  const names = new Map();
  const groups = await cachedGroupMap(session);
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
      const stats = await recentGroupStats(session, timed[0].StartTime, Math.min(60, Math.max(24, timed.length * 3)));
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
  return listSnappedFacesWork(opts);
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

  const faces = await getSnapRows(session, startIndex, count);
  if (!faces.length) return { total, startIndex, count, faces: [] };

  await fillMissingJpegs(session, faces);

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
      if (row.FaceImage) rememberFaceJpeg(camId, uuid, row.FaceImage);
      return {
        uuid,
        filename: uuid,
        url: `/api/snaps/${encodeURIComponent(uuid)}?cam=${encodeURIComponent(camId)}`,
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
