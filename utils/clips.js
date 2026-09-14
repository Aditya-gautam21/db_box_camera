import path from "node:path";
import fs from "node:fs";
import { getSession } from "./cameraSession.js";

export function playbackUri({ username, password, hostname, start, end }) {
  const q = new URLSearchParams({
    channel: "1",
    starttime: start,
    endtime: end,
    localtime: "true",
  });
  return `rtsp://${username}:${password}@${hostname}:554/rtsp/playback?${q}`;
}

function durationSeconds(start, end) {
  const startMs = Date.parse(start);
  const endMs = Date.parse(end);
  if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
    return Math.max(1, (endMs - startMs) / 1000);
  }
  return 10;
}

function stamp(value) {
  if (value instanceof Date) return value.toISOString().replace(/\.\d{3}Z$/, "Z");
  return String(value);
}

/** Honeywell /download.mp4 wants local wall time as yyyyMMddhhmmss. */
function downloadStamp(value) {
  const m = stamp(value).match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  if (!m) throw Object.assign(new Error("invalid clip time"), { status: 400 });
  return `${m[1]}${m[2]}${m[3]}${m[4]}${m[5]}${m[6]}`;
}

export async function saveClip({ cam, start, end, outDir }) {
  fs.mkdirSync(outDir, { recursive: true });
  const stampLabel = String(start).replaceAll(":", "").replaceAll("T", "-");
  const outFile = path.join(outDir, `clip-${stampLabel}.mp4`);
  const seconds = durationSeconds(start, end);
  const session = await getSession(cam);
  const qs = new URLSearchParams({
    start_time: downloadStamp(start),
    end_time: downloadStamp(end),
    channel: "0",
    record_type: "1",
    stream_type: "0",
    record_id: "0",
    disk_event_id: "0",
    download_type: "1",
  });
  await session.download(`/download.mp4?${qs}`, outFile, Math.max(90, seconds + 30));
  let size = 0;
  try {
    size = fs.statSync(outFile).size;
  } catch {
    size = 0;
  }
  if (size < 1024) {
    try {
      fs.unlinkSync(outFile);
    } catch {
      /* missing */
    }
    throw Object.assign(new Error("camera returned an empty clip"), { status: 502 });
  }
  return outFile;
}
