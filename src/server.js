import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stream, audioStream, sampleRateFromQuery } from "../utils/livestream.js";
import { clipStream, clipAudio, saveClip } from "../utils/clips.js";
import { listSnappedFaces, getSnapJpeg } from "../utils/fetchFaces.js";
import { loadCameras, addCamera, removeCamera, getCamera, getRtspUrl, publicCameras } from "../utils/addCamera.js";
import { scanCameras } from "../utils/cameraScan.js";
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

const app = express();
app.use(express.json({ limit: "12mb" }));

function asyncRoute(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

app.get("/api/health", (_req, res) => res.json({ message: "Node is up" }));

app.get("/api/cameras", asyncRoute(async (_req, res) => {
  res.json(publicCameras(await loadCameras()));
}));

app.post("/api/cameras", asyncRoute(async (req, res) => {
  const name = String(req.body?.name || "").trim();
  const host = String(req.body?.host || "").trim();
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password ?? "");
  if (!name || !host || !username) {
    res.status(400).json({ error: "name, host, and username required" });
    return;
  }
  const camera = await addCamera(name, host, username, password);
  res.json({ id: camera.id, name: camera.name });
}));

app.get("/api/cameras/scan", asyncRoute(async (_req, res) => {
  res.json({ hosts: await scanCameras() });
}));

app.delete("/api/cameras/:id", asyncRoute(async (req, res) => {
  res.json(await removeCamera(req.params.id));
}));

app.get("/stream/:cam", asyncRoute(async (req, res) => {
  const cam = await getCamera(req.params.cam);
  if (!cam) {
    res.status(404).send("unknown camera");
    return;
  }
  stream(req, res, getRtspUrl(cam));
}));

app.get("/stream-audio/:cam", asyncRoute(async (req, res) => {
  const cam = await getCamera(req.params.cam);
  if (!cam) {
    res.status(404).send("unknown camera");
    return;
  }
  audioStream(req, res, getRtspUrl(cam), { sampleRate: sampleRateFromQuery(req) });
}));

app.get("/api/faces", asyncRoute(async (req, res) => {
  const start = req.query.start != null ? Number(req.query.start) : undefined;
  const end = req.query.end != null ? Number(req.query.end) : undefined;
  const limit = req.query.limit != null ? Number(req.query.limit) : undefined;
  const offset = req.query.offset != null ? Number(req.query.offset) : 0;
  const result = await listSnappedFaces({
    cam: req.query.cam,
    offset,
    limit,
    start,
    end,
    names: req.query.names,
    gender: req.query.gender,
    age: req.query.age,
    glasses: req.query.glasses,
    mask: req.query.mask,
    expression: req.query.expression,
  });
  res.json(result);
}));

app.get("/api/snaps/:uuid", asyncRoute(async (req, res) => {
  const jpeg = await getSnapJpeg(req.params.uuid, req.query.cam);
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
