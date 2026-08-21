export async function groupMap(session) {
  const res = await session.post("/API/AI/FDGroup/Get", {
    MsgId: null,
    TypeFlags: 1,
    DefaultVal: 0,
    WithInternal: 0,
    SimpleInfo: 0,
    GroupsId: [],
  });
  const map = new Map();
  for (const g of res.data.Group) {
    map.set(g.Id, g.Name);
  }
  return map;
}

function dayBounds(unixSec) {
  const d = new Date(unixSec * 1000);
  const p = (n) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return { start: `${date} 00:00:00`, end: `${date} 23:59:59` };
}

/** Latest FaceStatistics rows for the snap's calendar day. Tight Search windows return Count: 0. */
export async function recentGroupStats(session, unixSec, take = 80) {
  const { start, end } = dayBounds(unixSec);
  const search = await session.post("/API/AI/FaceStatistics/Search", {
    MsgId: "",
    Engine: 1,
    StartTime: start,
    EndTime: end,
    Chn: 0,
    Group: [],
  });
  const total = search.data.Count ?? 0;
  const count = Math.min(take, total);
  if (count === 0) return [];
  const stats = await session.post("/API/AI/FaceStatistics/Get", {
    MsgId: "",
    StartIndex: total - count, // 0 = oldest; new hits are at the end
    Count: count,
    Engine: 1, // without this, Statistics is always []
  });
  return stats.data.Statistics ?? [];
}

/** Camera's own per-UUID group (Capture filter). Time-join cannot tell 3 people apart. */
export async function groupIdsForUuids(session, unixSec, uuids, groupIds) {
  const want = new Set(uuids);
  const found = new Map();
  if (want.size === 0) return found;
  const { start, end } = dayBounds(unixSec);
  for (const gid of groupIds) {
    if (gid === 4) continue; // Stranger = leftover, not a unique person
    if (found.size === want.size) break;
    const search = await session.post("/API/AI/SnapedFaces/Search", {
      MsgId: "",
      StartTime: start,
      EndTime: end,
      Chn: 0,
      AlarmGroup: [gid],
      Similarity: 0,
      Engine: 1,
      Count: 0,
      FaceInfo: [],
    });
    const total = search.data.Count ?? 0;
    if (!total) continue;
    const take = Math.min(80, total);
    const page = await session.post("/API/AI/SnapedFaces/GetByIndex", {
      MsgId: "",
      Engine: 1,
      MatchedFaces: 0,
      StartIndex: total - take,
      Count: take,
      WithFaceImage: 0,
      WithBodyImage: 0,
      WithBackgroud: 0,
      SimpleInfo: 1,
      WithFeature: 0,
      NeedTime: 0,
    });
    for (const row of page.data.SnapedFaceInfo ?? []) {
      if (want.has(row.UUId) && !found.has(row.UUId)) found.set(row.UUId, gid);
    }
  }
  return found;
}

/** Each stats row used at most once so simultaneous faces do not share one name. */
export function assignGroupsToFaces(faces, stats) {
  const pairs = [];
  faces.forEach((face, fi) => {
    stats.forEach((row, si) => {
      const lo = face.StartTime - 5;
      const hi = face.EndTime + 60;
      if (row.Time < lo || row.Time > hi) return;
      const dist = Math.min(
        Math.abs(row.Time - face.StartTime),
        Math.abs(row.Time - face.EndTime),
      );
      pairs.push({ fi, si, dist, group: row.Group, uuid: face.UUId });
    });
  });
  pairs.sort((a, b) => a.dist - b.dist);
  const usedFace = new Set();
  const usedStat = new Set();
  const map = new Map();
  for (const p of pairs) {
    if (usedFace.has(p.fi) || usedStat.has(p.si)) continue;
    usedFace.add(p.fi);
    usedStat.add(p.si);
    map.set(p.uuid, p.group);
  }
  return map;
}

export function groupIdFromStats(rows, startUnix, endUnix) {
  const assigned = assignGroupsToFaces(
    [{ UUId: "_", StartTime: startUnix, EndTime: endUnix }],
    rows,
  );
  return assigned.get("_") ?? null;
}

export async function groupIdAtTime(session, startUnix, endUnix) {
  const rows = await recentGroupStats(session, startUnix);
  return groupIdFromStats(rows, startUnix, endUnix);
}
