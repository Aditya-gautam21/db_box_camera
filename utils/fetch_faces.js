import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSession } from "./camera_session.js";
import { groupMap, recentGroupStats, groupIdsForUuids, assignGroupsToFaces } from "./group_data.js";

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "face_data");
fs.mkdirSync(outDir, { recursive: true });

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fileToken(s) {
  // Camera UUIDs are base64-like and can contain `/`, which path.join treats as a folder.
  return String(s).replaceAll(/[/\\?%*:|"<>]/g, "_");
}

const savedIds = new Set();
for (const name of fs.readdirSync(outDir)) {
  const m = name.match(/-([^.]+)\.jpe?g$/i);
  if (m) savedIds.add(m[1]);
}

function alreadySaved(uuid) {
  return savedIds.has(fileToken(uuid));
}

async function saveJpeg(session, uuid, name) {
  if (alreadySaved(uuid)) return null;
  const res = await session.post("/API/AI/SnapedFaces/GetById", {
    MsgId: "",
    Engine: 1,
    UUIds: [uuid], // array
    WithFaceImage: 1,
    WithBodyImage: 0,
    WithBackgroud: 0,
    WithFeature: 0,
  });
  const face = res.data.SnapedFaceInfo[0];
  const bytes = Buffer.from(face.FaceImage, "base64");
  const file = path.join(outDir, `${fileToken(name)}-${fileToken(uuid)}.jpg`);
  fs.writeFileSync(file, bytes);
  savedIds.add(fileToken(uuid));
  return file;
}

let lastTotal = 0;
let busy = false;

async function fetchFace(session, names) {
  if (busy) return;
  busy = true;
  try {
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
    const total = search.data.Count;
    if (total <= lastTotal) return;

    const page = await session.post("/API/AI/SnapedFaces/GetByIndex", {
      MsgId: "",
      Engine: 1,
      MatchedFaces: 0,
      StartIndex: lastTotal,
      Count: Math.min(20, total - lastTotal),
      WithFaceImage: 0,
      WithBodyImage: 0,
      WithBackgroud: 0,
      SimpleInfo: 1,
      WithFeature: 0,
      NeedTime: 1,
    });

    const faces = page.data.SnapedFaceInfo ?? [];
    if (faces.length === 0) return;

    const pending = faces.filter((row) => !alreadySaved(row.UUId));
    const byUuid = new Map();
    if (pending.length > 0) {
      const groupIds = [...names.keys()];
      const ids = pending.map((row) => row.UUId);
      const unnamed = () => pending.filter((row) => !byUuid.has(row.UUId));
      for (const [uuid, gid] of await groupIdsForUuids(session, pending[0].StartTime, ids, groupIds)) {
        byUuid.set(uuid, gid);
      }
      for (let attempt = 0; unnamed().length > 0 && attempt < 2; attempt++) {
        await new Promise((r) => setTimeout(r, 1000));
        const extra = await groupIdsForUuids(
          session,
          pending[0].StartTime,
          unnamed().map((row) => row.UUId),
          groupIds,
        );
        for (const [uuid, gid] of extra) byUuid.set(uuid, gid);
      }
      const still = unnamed();
      if (still.length > 0) {
        const stats = await recentGroupStats(session, pending[0].StartTime);
        for (const [uuid, gid] of assignGroupsToFaces(still, stats)) byUuid.set(uuid, gid);
      }
    }

    for (const row of pending) {
      const gid = byUuid.get(row.UUId) ?? null;
      const name = names.get(gid) ?? "unknown";
      try {
        const file = await saveJpeg(session, row.UUId, name);
        if (file) console.log("saved", file, "group", gid, name);
      } catch (err) {
        console.error("skip", row.UUId, err.message);
      }
    }
    lastTotal += faces.length;
  } finally {
    busy = false;
  }
}

const session = createSession();
await session.login();
const names = await groupMap(session);
lastTotal = (
  await session.post("/API/AI/SnapedFaces/Search", {
    MsgId: "",
    StartTime: `${today()} 00:00:00`,
    EndTime: `${today()} 23:59:59`,
    Chn: 0,
    AlarmGroup: [],
    Similarity: 0,
    Engine: 1,
    Count: 0,
    FaceInfo: [],
  })
).data.Count; // skip history

setInterval(() => session.heartbeat(), 20_000);
setInterval(() => fetchFace(session, names).catch(console.error), 3000);