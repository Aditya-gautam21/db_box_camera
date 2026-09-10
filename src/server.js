import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stream, audioStream, sampleRateFromQuery } from "../utils/livestream.js";
import { clipStream, clipAudio, saveClip } from "../utils/clips.js";
import { listSnappedFaces, getSnapJpeg } from "../utils/fetchFaces.js";
import { loadCameras, addCamera, updateCamera, removeCamera, getCamera, getRtspUrl, publicCameras } from "../utils/addCamera.js";
import { scanCameras } from "../utils/cameraScan.js";
import {
  detectPtz,
  getPtzState,
  setZoom,
  setFocus,
  autoFocus,
  restorePtz,
  refreshPtz,
} from "../utils/zoom.js";
import {
  getEventSettings,
  setEventSettings,
  getEventConfig,
  setEventConfig,
  getOsdSettings,
  setOsdSettings,
  getVideoCover,
  setVideoCover,
  getDiskSettings,
  setDiskSettings,
  getNetworkSettings,
  setNetworkSettings,
  testNetworkAddress,
} from "../utils/settings.js";
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
import { saveAreaZone, clearAreaZone } from "../utils/areaIntrusion.js";
import { saveLineCross, clearLineCross } from "../utils/lineCross.js";
import { getAiState, setAiModels } from "../utils/ai.js";

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

async function ensurePtzFlags(cameras) {
  const out = [];
  for (const cam of cameras) {
    if (typeof cam.ptz === "boolean") {
      out.push(cam);
      continue;
    }
    try {
      const caps = await detectPtz(cam.id, cam.ptzChannel || "CH1");
      out.push(await updateCamera(cam.id, caps));
    } catch {
      out.push(await updateCamera(cam.id, { ptz: false }));
    }
  }
  return out;
}

app.get("/api/cameras", asyncRoute(async (_req, res) => {
  res.json(publicCameras(await ensurePtzFlags(await loadCameras())));
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
  let caps;
  try {
    caps = await detectPtz(camera.id);
  } catch {
    caps = { ptz: false };
  }
  const saved = await updateCamera(camera.id, caps);
  res.json(publicCameras([saved])[0]);
}));

app.get("/api/cameras/scan", asyncRoute(async (_req, res) => {
  res.json({ hosts: await scanCameras() });
}));

app.delete("/api/cameras/:id", asyncRoute(async (req, res) => {
  res.json(await removeCamera(req.params.id));
}));

app.get("/api/cameras/:id/ptz", asyncRoute(async (req, res) => {
  try {
    res.json(await getPtzState(req.params.id));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}));

app.post("/api/cameras/:id/ptz/zoom", asyncRoute(async (req, res) => {
  try {
    res.json(await setZoom(req.params.id, req.body?.zoom, {
      zoomStep: req.body?.zoomStep,
      focusStep: req.body?.focusStep,
      speed: req.body?.speed,
    }));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}));

app.post("/api/cameras/:id/ptz/focus", asyncRoute(async (req, res) => {
  try {
    res.json(await setFocus(req.params.id, req.body?.focus, {
      zoomStep: req.body?.zoomStep,
      focusStep: req.body?.focusStep,
      speed: req.body?.speed,
    }));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}));

app.post("/api/cameras/:id/ptz/autofocus", asyncRoute(async (req, res) => {
  try {
    res.json(await autoFocus(req.params.id, {
      zoomStep: req.body?.zoomStep,
      focusStep: req.body?.focusStep,
      speed: req.body?.speed,
      state: req.body?.state,
    }));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}));

app.post("/api/cameras/:id/ptz/restore", asyncRoute(async (req, res) => {
  try {
    res.json(await restorePtz(req.params.id));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}));

app.post("/api/cameras/:id/ptz/refresh", asyncRoute(async (req, res) => {
  try {
    res.json(await refreshPtz(req.params.id));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}));

app.get("/api/cameras/:id/events", asyncRoute(async (req, res) => {
  try {
    res.json(await getEventSettings(req.params.id, req.query.channel));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}));

app.post("/api/cameras/:id/events", asyncRoute(async (req, res) => {
  try {
    res.json(await setEventSettings(req.params.id, req.body ?? {}));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}));

app.get("/api/cameras/:id/events/:ability", asyncRoute(async (req, res) => {
  try {
    res.json(await getEventConfig(req.params.id, req.params.ability, req.query.channel));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}));

app.post("/api/cameras/:id/events/:ability", asyncRoute(async (req, res) => {
  try {
    res.json(await setEventConfig(req.params.id, {
      ...(req.body ?? {}),
      ability: req.params.ability,
    }));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}));

app.get("/api/cameras/:id/osd", asyncRoute(async (req, res) => {
  try {
    res.json(await getOsdSettings(req.params.id, req.query.channel));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}));

app.post("/api/cameras/:id/osd", asyncRoute(async (req, res) => {
  try {
    res.json(await setOsdSettings(req.params.id, req.body ?? {}));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}));

app.get("/api/cameras/:id/video-cover", asyncRoute(async (req, res) => {
  try {
    res.json(await getVideoCover(req.params.id, req.query.channel));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}));

app.post("/api/cameras/:id/video-cover", asyncRoute(async (req, res) => {
  try {
    res.json(await setVideoCover(req.params.id, req.body ?? {}));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}));

app.get("/api/cameras/:id/disk", asyncRoute(async (req, res) => {
  try {
    res.json(await getDiskSettings(req.params.id));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}));

app.post("/api/cameras/:id/disk", asyncRoute(async (req, res) => {
  try {
    res.json(await setDiskSettings(req.params.id, req.body ?? {}));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}));

app.get("/api/cameras/:id/network", asyncRoute(async (req, res) => {
  try {
    res.json(await getNetworkSettings(req.params.id));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}));

app.post("/api/cameras/:id/network", asyncRoute(async (req, res) => {
  try {
    res.json(await setNetworkSettings(req.params.id, req.body ?? {}));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
}));

app.post("/api/cameras/:id/network/test", asyncRoute(async (req, res) => {
  try {
    res.json(await testNetworkAddress(req.params.id, req.body?.ip_address));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
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
    date: req.query.date,
    gender: req.query.gender,
    age: req.query.age,
    glasses: req.query.glasses,
    mask: req.query.mask,
    expression: req.query.expression,
  });
  res.set("Cache-Control", "no-store");
  res.json(result);
}));

app.get("/api/snaps/:uuid", asyncRoute(async (req, res) => {
  const jpeg = await getSnapJpeg(req.params.uuid, req.query.cam);
  res.set("Cache-Control", "public, max-age=86400, immutable");
  res.type("jpeg").send(jpeg);
}));

app.get("/api/ai", asyncRoute(async (req, res) => {
  res.json(await getAiState(req.query.cam));
}));

app.post("/api/ai", asyncRoute(async (req, res) => {
  res.json(await saveAreaZone(req.body ?? {}));
}));

app.delete("/api/ai", asyncRoute(async (req, res) => {
  res.json(await clearAreaZone(req.query.cam || req.body?.cam));
}));

app.post("/api/ai/models", asyncRoute(async (req, res) => {
  res.json({ models: await setAiModels(req.body ?? {}) });
}));

app.post("/api/ai/line", asyncRoute(async (req, res) => {
  res.json(await saveLineCross(req.body ?? {}));
}));

app.delete("/api/ai/line", asyncRoute(async (req, res) => {
  res.json(await clearLineCross(req.query.cam || req.body?.cam));
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
  res.json(await removeGroup(req.params.id, { name: req.query.name }));
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

app.get(["/live", "/clip", "/faces", "/groups", "/ai"], (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.get("/clip-stream", asyncRoute(async (req, res) => {
  const { start, end, cam } = req.query;
  if (!start || !end) {
    res.status(400).send("start and end query params required");
    return;
  }
  try {
    await clipStream(req, res, { cam, start, end });
  } catch (err) {
    if (err.status) {
      res.status(err.status).send(err.message);
      return;
    }
    throw err;
  }
}));

app.get("/clip-audio", asyncRoute(async (req, res) => {
  const { start, end, cam } = req.query;
  if (!start || !end) {
    res.status(400).send("start and end query params required");
    return;
  }
  try {
    await clipAudio(req, res, {
      cam,
      start,
      end,
      sampleRate: sampleRateFromQuery(req),
    });
  } catch (err) {
    if (err.status) {
      res.status(err.status).send(err.message);
      return;
    }
    throw err;
  }
}));

app.get("/save-clip", asyncRoute(async (req, res) => {
  const { start, end, cam } = req.query;
  if (!start || !end) {
    res.status(400).json({ error: "start and end query params required" });
    return;
  }
  try {
    const file = await saveClip({ cam, start, end, outDir: clipsDir });
    res.json({ file: `/clips/${path.basename(file)}` });
  } catch (err) {
    console.error("save clip failed", err);
    res.status(err.status || 500).json({ error: String(err.message || err) });
  }
}));

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
