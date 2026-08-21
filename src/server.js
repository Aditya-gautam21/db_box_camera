import express from "express";
import { stream, audioStream, sampleRateFromQuery } from "../utils/livestream.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clipStream, clipAudio, saveClip } from "../utils/clips.js";

const PORT = 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");
const dataDir = path.join(__dirname, "..", "data");
const clipsDir = path.join(dataDir, "clips");
const rtspUrl = process.env.CAMERA_RTSP_URL;

/* For face detection clip saving
function isFaceAlarm(evt) {
  if (String(evt.type) !== "tns1:RuleEngine/Recognition/Face") return false;
  const item = evt.raw?.simpleItem;
  const items = Array.isArray(item) ? item : item ? [item] : [];
  const fd = items.find((i) => i?.$?.Name === "IsFDAlarm");
  return fd?.$?.Value === true || fd?.$?.Value === "true";
} */

if (!rtspUrl) {
  console.error("Missing CAMERA_RTSP_URL");
  process.exit(1);
}

const app = express();

app.get("/api/health", (_req, res) => res.json({ message: "Node is up" }));

app.get("/stream", (req, res) => {
  stream(req, res, rtspUrl);
});

app.get("/stream-audio", (req, res) => {
  audioStream(req, res, rtspUrl, { sampleRate: sampleRateFromQuery(req) });
});

app.use("/clips", express.static(clipsDir));
app.use(express.static(publicDir));

app.get(["/live", "/clip"], (_req, res) => {
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

app.listen(PORT, () => {
  console.log(`Open http://localhost:${PORT}`);
});