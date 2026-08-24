import express from "express";
import { stream, audioStream, sampleRateFromQuery } from "../utils/livestream.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clipStream, clipAudio, saveClip } from "../utils/clips.js";
import { listSnappedFaces, getSnapJpeg } from "../utils/fetch_faces.js";
import {
  listGroups,
  addGroup,
  modifyGroup,
  removeGroup,
  listGroupFaces,
  getFaceJpeg,
  addImportedFaces,
  addCapturedFaces,
  modifyFace,
  removeFace,
} from "../utils/addFace.js";

const PORT = 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");
const dataDir = path.join(__dirname, "..", "data");
const clipsDir = path.join(dataDir, "clips");

const CAMERAS = [
  {
    id: "eng",
    label: "Engineering room",
    aliases: ["eng"],
    rtsp: process.env.ENG_CAMERA_RTSP_URL || process.env.CAMERA_RTSP_URL,
  },
  {
    id: "cast",
    label: "Casting",
    aliases: ["cast", "casting"],
    rtsp: process.env.CAST_CAMERA_RTSP_URL,
  },
].filter((cam) => cam.rtsp);

function getCamera(id) {
  const key = String(id || "").toLowerCase();
  return CAMERAS.find((cam) => cam.id === key || cam.aliases.includes(key));
}

if (!CAMERAS.length) {
  console.error("Missing ENG_CAMERA_RTSP_URL or CAST_CAMERA_RTSP_URL");
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: "12mb" }));

function asyncRoute(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

app.get("/api/health", (_req, res) => res.json({ message: "Node is up" }));

app.get("/api/cameras", (_req, res) => {
  res.json(CAMERAS.map(({ id, label }) => ({ id, label })));
});

app.get("/stream/:cam", (req, res) => {
  const cam = getCamera(req.params.cam);
  if (!cam) {
    res.status(404).send("unknown camera");
    return;
  }
  stream(req, res, cam.rtsp);
});

app.get("/stream-audio/:cam", (req, res) => {
  const cam = getCamera(req.params.cam);
  if (!cam) {
    res.status(404).send("unknown camera");
    return;
  }
  audioStream(req, res, cam.rtsp, { sampleRate: sampleRateFromQuery(req) });
});

app.get("/api/faces", asyncRoute(async (req, res) => {
  const limit = req.query.limit != null ? Number(req.query.limit) : undefined;
  const offset = req.query.offset != null ? Number(req.query.offset) : 0;
  const result = await listSnappedFaces(
    Number.isFinite(limit) && limit > 0
      ? { offset, limit, names: req.query.names }
      : { names: req.query.names },
  );
  if (Number.isFinite(limit) && limit > 0) {
    res.json(result);
    return;
  }
  res.json(result.faces);
}));

app.get("/api/snaps/:uuid", asyncRoute(async (req, res) => {
  const jpeg = await getSnapJpeg(req.params.uuid);
  res.type("jpeg").send(jpeg);
}));

app.get("/api/groups", asyncRoute(async (_req, res) => {
  res.json(await listGroups());
}));

app.post("/api/groups", asyncRoute(async (req, res) => {
  res.json(await addGroup(req.body?.name));
}));

app.patch("/api/groups/:id", asyncRoute(async (req, res) => {
  res.json(await modifyGroup(req.params.id, req.body ?? {}));
}));

app.delete("/api/groups/:id", asyncRoute(async (req, res) => {
  res.json(await removeGroup(req.params.id));
}));

app.get("/api/groups/:id/faces", asyncRoute(async (req, res) => {
  res.json(await listGroupFaces(req.params.id));
}));

app.post("/api/groups/:id/faces", asyncRoute(async (req, res) => {
  const grpId = req.params.id;
  const body = req.body ?? {};
  if (body.uuid) {
    res.json(await addCapturedFaces({ ...body, grpId }));
    return;
  }
  res.json(await addImportedFaces({ ...body, grpId }));
}));

app.get("/api/groups/:grpId/faces/:id/image", asyncRoute(async (req, res) => {
  const jpeg = await getFaceJpeg(req.params.id);
  res.type("jpeg").send(jpeg);
}));

app.patch("/api/groups/:grpId/faces/:id", asyncRoute(async (req, res) => {
  res.json(
    await modifyFace({
      ...(req.body ?? {}),
      id: req.params.id,
      grpId: req.params.grpId,
    }),
  );
}));

app.delete("/api/groups/:grpId/faces/:id", asyncRoute(async (req, res) => {
  res.json(await removeFace({ id: req.params.id, grpId: req.params.grpId }));
}));

app.use("/clips", express.static(clipsDir));
app.get("/", (_req, res) => res.redirect("/live"));
app.use(express.static(publicDir));

app.get(["/live", "/clip", "/faces", "/groups"], (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.get("/clip-stream", (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) {
    res.status(400).send("start and end query params required");
    return;
  }
  clipStream(req, res, start, end);
});

app.get("/clip-audio", (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) {
    res.status(400).send("start and end query params required");
    return;
  }
  clipAudio(req, res, start, end, sampleRateFromQuery(req));
});

app.get("/save-clip", async (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) {
    res.status(400).json({ error: "start and end query params required" });
    return;
  }
  try {
    const file = await saveClip({ start, end, outDir: clipsDir });
    res.json({ file: `/clips/${path.basename(file)}` });
  } catch (err) {
    console.error("save clip failed", err);
    res.status(500).json({ error: String(err.message || err) });
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: String(err.message || err) });
});

app.listen(PORT, (err) => {
  if (err) {
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${PORT} is already in use. Stop the other process and try again.`);
    } else {
      console.error(err);
    }
    process.exit(1);
  }
  console.log(`Open http://localhost:${PORT}`);
});
