import { getSession } from "./camera_session.js";
import { assignGroupsToFaces, groupIdsForUuids, groupMap, recentGroupStats } from "./group_data.js";

const nameCache = new Map();

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

export async function listSnappedFaces({ offset = 0, limit, names } = {}) {
  const session = getSession();
  const date = today();
  const search = await session.post("/API/AI/SnapedFaces/Search", {
    MsgId: "",
    StartTime: `${date} 00:00:00`,
    EndTime: `${date} 23:59:59`,
    Chn: 0,
    AlarmGroup: [],
    Similarity: 0,
    Engine: 1,
    Count: 0,
    FaceInfo: [],
  });
  const total = search.data?.Count ?? 0;
  if (!total) return { faces: [], total: 0 };

  const paginate = Number.isFinite(Number(limit)) && Number(limit) > 0;
  const off = Math.max(0, Number(offset) || 0);
  let startIndex = 0;
  let count = total;
  if (paginate) {
    const take = Math.min(Number(limit), Math.max(0, total - off));
    if (!take) return { faces: [], total };
    startIndex = Math.max(0, total - off - take);
    count = take;
  }

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
  const wantNames = names === true || names === "1" || !paginate;
  if (wantNames) {
    try {
      await resolveNames(session, faces);
    } catch (err) {
      console.error("face names", err);
    }
  }
  return {
    total,
    faces: faces.map((row) => {
      const uuid = row.UUId;
      const start = row.StartTime ? cameraStamp(row.StartTime) : null;
      const end = row.StartTime ? cameraStamp(row.StartTime + 5 * 60) : null;
      return {
        uuid,
        filename: uuid,
        url: `/api/snaps/${encodeURIComponent(uuid)}`,
        name: nameCache.get(uuid) || "unknown",
        start,
        end,
      };
    }),
  };
}

async function resolveNames(session, rows) {
  const unnamed = rows.filter((row) => row.UUId && !nameCache.has(row.UUId));
  if (!unnamed.length) return;
  const names = await groupMap(session);
  const byUuid = new Map();
  const unix = unnamed[0].StartTime;
  if (unix) {
    const ids = unnamed.map((row) => row.UUId);
    for (const [uuid, gid] of await groupIdsForUuids(session, unix, ids, [...names.keys()])) {
      byUuid.set(uuid, gid);
    }
    const leftover = unnamed.filter((row) => row.StartTime && !byUuid.has(row.UUId)).slice(0, 20);
    if (leftover.length) {
      const stats = await recentGroupStats(session, unix);
      const timed = leftover.map((row) => ({
        UUId: row.UUId,
        StartTime: row.StartTime,
        EndTime: row.EndTime || row.StartTime + 5,
      }));
      for (const [uuid, gid] of assignGroupsToFaces(timed, stats)) byUuid.set(uuid, gid);
    }
  }
  for (const row of unnamed) {
    nameCache.set(row.UUId, names.get(byUuid.get(row.UUId)) ?? "unknown");
  }
}

export async function getSnapJpeg(uuid) {
  if (!uuid) throw new Error("uuid required");
  const hit = jpegCache.get(uuid);
  if (hit) return hit;
  const res = await getSession().post("/API/AI/SnapedFaces/GetById", {
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
  cacheJpeg(uuid, buf);
  return buf;
}
