import fs from "node:fs";
import path from "node:path";
import { createSession } from "./camera_session.js";
import { groupMap, recentGroupStats, groupIdsForUuids, assignGroupsToFaces } from "./group_data.js";

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function stamp(unixSec) {
  // Camera StartTime is local wall clock stored as unix (as if UTC). getHours() would add IST again.
  const d = new Date(unixSec * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}_${p(d.getUTCHours())}-${p(d.getUTCMinutes())}-${p(d.getUTCSeconds())}`;
}

function fileToken(s) {
  // Camera UUIDs are base64-like and can contain `/`, which path.join treats as a folder.
  return String(s).replaceAll(/[/\\?%*:|"<>]/g, "_");
}

let started = false;

export function startSavingFaces(outDir) {
  if (started) return;
  started = true;
  fs.mkdirSync(outDir, { recursive: true });

  const savedIds = new Set();
  for (const name of fs.readdirSync(outDir)) {
    const m = name.match(/-([^.]+)\.jpe?g$/i);
    if (m) savedIds.add(m[1]);
  }

  let lastTotal = 0;
  let busy = false;
  const session = createSession();
  let names = new Map();

  function alreadySaved(uuid) {
    return savedIds.has(fileToken(uuid));
  }

  async function saveJpeg(uuid, name, startUnix) {
    if (alreadySaved(uuid)) return;
    const res = await session.post("/API/AI/SnapedFaces/GetById", {
      MsgId: "",
      Engine: 1,
      UUIds: [uuid],
      WithFaceImage: 1,
      WithBodyImage: 0,
      WithBackgroud: 0,
      WithFeature: 0,
    });
    const face = res.data.SnapedFaceInfo[0];
    const bytes = Buffer.from(face.FaceImage, "base64");
    const base = `${fileToken(name)}-${stamp(startUnix ?? face.StartTime)}`;
    let file = path.join(outDir, `${base}.jpg`);
    if (fs.existsSync(file)) {
      file = path.join(outDir, `${base}-${face.SnapId ?? fileToken(uuid)}.jpg`);
    }
    fs.writeFileSync(file, bytes);
    savedIds.add(fileToken(uuid));
  }

  async function fetchFace() {
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
          await saveJpeg(row.UUId, name, row.StartTime);
        } catch (err) {
          console.error("skip", row.UUId, err.message || err);
        }
      }
      lastTotal += faces.length;
    } finally {
      busy = false;
    }
  }

  async function boot() {
    for (;;) {
      try {
        await session.login();
        names = await groupMap(session);
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
        ).data.Count;
        break;
      } catch (err) {
        console.error("face saver login failed", err.message || err);
        await new Promise((r) => setTimeout(r, 5000));
      }
    }

    setInterval(() => {
      session.post("/API/Login/Heartbeat", {}).catch((err) => {
        console.error("heartbeat failed", err.message || err);
      });
    }, 20_000);
    setInterval(() => {
      fetchFace().catch((err) => {
        console.error("face saver", err.message || err);
      });
    }, 3000);
  }

  boot().catch((err) => {
    console.error("face saver stopped", err.message || err);
  });
}
