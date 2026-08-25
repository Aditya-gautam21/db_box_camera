import { getSession } from "./cameraSession.js";
import { assignGroupsToFaces, groupIdsForUuids, groupMap, recentGroupStats } from "./groupData.js";

const nameCache = new Map();
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

function cameraStamp(unixSec) {
  const d = new Date(Number(unixSec) * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}Z`;
}

const jpegCache = new Map();
const JPEG_CACHE_MAX = 250;

function cacheJpeg(uuid, buf) {
  jpegCache.set(uuid, buf);
  if (jpegCache.size <= JPEG_CACHE_MAX) return;
  const first = jpegCache.keys().next().value;
  jpegCache.delete(first);
}

function groupIdFromRow(row) {
  if (Number.isFinite(row?.Group) && row.Group > 0) return row.Group;
  if (Number.isFinite(row?.GrpId) && row.GrpId > 0) return row.GrpId;
  if (Number.isFinite(row?.GroupId) && row.GroupId > 0) return row.GroupId;
  if (Array.isArray(row?.AlarmGroup) && Number.isFinite(row.AlarmGroup[0])) return row.AlarmGroup[0];
  return null;
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

export async function listSnappedFaces({
  cam,
  offset = 0,
  limit,
  start,
  end,
  names,
  gender,
  age,
  glasses,
  mask,
  expression,
} = {}) {
  const session = await getSession(cam);
  const camId = session.id;
  const date = today();
  const search = await session.post("/API/AI/SnapedFaces/Search", {
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
  });
  const total = search.data?.Count ?? 0;
  if (!total) return { faces: [], total: 0 };

  const { startIndex, count } = pageRange({ offset, limit, start, end }, total);
  if (!count) return { faces: [], total };

  const page = await session.post("/API/AI/SnapedFaces/GetByIndex", {
    MsgId: "",
    Engine: 1,
    MatchedFaces: 0,
    StartIndex: startIndex,
    Count: count,
    WithFaceImage: 0,
    WithBodyImage: 0,
    WithBackgroud: 0,
    SimpleInfo: 1,
    WithFeature: 0,
    NeedTime: 1,
  });
  const faces = [...(page.data?.SnapedFaceInfo ?? [])].reverse();
  const wantNames = names === true || names === "1";
  if (wantNames) {
    try {
      await resolveNames(session, faces, camId);
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
      return {
        uuid,
        filename: uuid,
        url: `/api/snaps/${encodeURIComponent(uuid)}?cam=${encodeURIComponent(camId)}`,
        name: nameCache.get(`${camId}:${uuid}`) || "unknown",
        start: startTime,
        end: row.StartTime ? cameraStamp(row.StartTime + 5 * 60) : null,
      };
    }),
  };
}

async function resolveNames(session, rows, camId) {
  const keyOf = (uuid) => `${camId}:${uuid}`;
  const unnamed = rows.filter((row) => row.UUId && !nameCache.has(keyOf(row.UUId)));
  if (!unnamed.length) return;
  const names = await groupMap(session);
  for (const row of unnamed) {
    const gid = groupIdFromRow(row);
    if (gid != null && names.has(gid)) nameCache.set(keyOf(row.UUId), names.get(gid));
  }
  const leftover = unnamed.filter((row) => !nameCache.has(keyOf(row.UUId)));
  const unixSec = leftover.find((row) => row.StartTime)?.StartTime;
  if (leftover.length && unixSec) {
    const byUuid = await groupIdsForUuids(
      session,
      unixSec,
      leftover.map((row) => row.UUId),
      [...names.keys()],
    );
    for (const [uuid, gid] of byUuid) {
      nameCache.set(keyOf(uuid), names.get(gid) ?? "unknown");
    }
    const still = leftover.filter((row) => !nameCache.has(keyOf(row.UUId)) && row.StartTime);
    if (still.length) {
      const stats = await recentGroupStats(session, still[0].StartTime, still.length + 8);
      const timed = still.map((row) => ({
        UUId: row.UUId,
        StartTime: row.StartTime,
        EndTime: row.EndTime || row.StartTime + 5,
      }));
      for (const [uuid, gid] of assignGroupsToFaces(timed, stats)) {
        if (!nameCache.has(keyOf(uuid))) nameCache.set(keyOf(uuid), names.get(gid) ?? "unknown");
      }
    }
  }
  const stranger = names.get(4) || "unknown";
  for (const row of unnamed) {
    if (!nameCache.has(keyOf(row.UUId))) nameCache.set(keyOf(row.UUId), stranger);
  }
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
