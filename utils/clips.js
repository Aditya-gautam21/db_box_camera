import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { stream, audioStream } from "./livestream.js";
import { getCamera } from "./addCamera.js";

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

async function playbackUrl(camId, start, end) {
  const cam = await getCamera(camId);
  if (!cam?.host) throw Object.assign(new Error("unknown camera"), { status: 404 });
  return playbackUri({
    username: cam.username,
    password: cam.password,
    hostname: cam.host,
    start: stamp(start),
    end: stamp(end),
  });
}

export async function clipStream(req, res, { cam, start, end }) {
  const url = await playbackUrl(cam, start, end);
  stream(req, res, url, {
    duration: durationSeconds(start, end),
  });
}

export async function clipAudio(req, res, { cam, start, end, sampleRate }) {
  const url = await playbackUrl(cam, start, end);
  audioStream(req, res, url, {
    duration: durationSeconds(start, end),
    sampleRate,
  });
}

export async function saveClip({ cam, start, end, outDir }) {
  fs.mkdirSync(outDir, { recursive: true });
  const stampLabel = String(start).replaceAll(":", "").replaceAll("T", "-");
  const outFile = path.join(outDir, `clip-${stampLabel}.mp4`);
  const clipUrl = await playbackUrl(cam, start, end);
  const seconds = durationSeconds(start, end);

  return new Promise((resolve, reject) => {
    const ff = spawn(
      "ffmpeg",
      [
        "-y",
        "-rtsp_transport", "tcp",
        "-timeout", "3000000",
        "-i", clipUrl,
        "-t", String(seconds),
        "-c:v", "copy",
        "-c:a", "aac",
        "-ac", "1",
        "-ar", "8000",
        "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
        outFile,
      ],
      { stdio: ["ignore", "inherit", "inherit"] },
    );

    const watchdog = setTimeout(
      () => ff.kill("SIGKILL"),
      (seconds + 15) * 1000,
    );

    ff.on("exit", (code) => {
      clearTimeout(watchdog);
      if (code === 0) resolve(outFile);
      else reject(new Error("ffmpeg " + code));
    });
  });
}
