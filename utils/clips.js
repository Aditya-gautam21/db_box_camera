import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { stream, audioStream } from "./livestream.js";

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

/* Use when we want to save a clip triggered by an event
export function fetchFaceClip(evt, outDir) {
  const t = new Date(evt.time);
  const start = new Date(t.getTime() - 5_000);
  const end = new Date(t.getTime() + 5_000);
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(
    outDir,
    `face-${t.toISOString().replaceAll(":", "")}.mp4`
  );
  const uri = playbackUri({
    username: process.env.CAMERA_USERNAME,
    password: process.env.CAMERA_PASSWORD,
    hostname: process.env.CAMERA_HOSTNAME,
    start,
    end,
  });

   return new Promise((resolve, reject) => {
    setTimeout(() => {
      const ff = spawn(
        "ffmpeg",
        [
          "-y",
          "-rtsp_transport", "tcp",
          "-timeout", "3000000",
          "-i", uri,
          "-t", "8",
          "-c:v", "copy",
          "-c:a", "aac",
          "-ac", "1",
          "-ar", "8000",
          "-movflags", "+frag_keyframe+empty_moov+default_base_moof",
          outFile,
        ],
        { stdio: ["ignore", "inherit", "inherit"] }
      );

      const watchdog = setTimeout(() => ff.kill("SIGKILL"), 20_000);

      ff.on("exit", (code) => {
        clearTimeout(watchdog);
        if (code === 0) resolve(outFile);
        else reject(new Error("ffmpeg " + code));
      });
    }, 6_000);
  });
} */ 

export function clipStream(req, res, start, end) {
  stream(req, res, playbackUrl(start, end), {
    duration: durationSeconds(start, end),
  });
}

export function clipAudio(req, res, start, end, sampleRate) {
  audioStream(req, res, playbackUrl(start, end), {
    duration: durationSeconds(start, end),
    sampleRate,
  });
}

function playbackUrl(start, end) {
  return playbackUri({
    username: process.env.CAMERA_USERNAME,
    password: process.env.CAMERA_PASSWORD,
    hostname: process.env.CAMERA_HOSTNAME,
    start,
    end,
  });
}

export function saveClip({ start, end, outDir }) {
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = String(start).replaceAll(":", "").replaceAll("T", "-");
  const outFile = path.join(outDir, `clip-${stamp}.mp4`);
  const clipUrl = playbackUri({
    username: process.env.CAMERA_USERNAME,
    password: process.env.CAMERA_PASSWORD,
    hostname: process.env.CAMERA_HOSTNAME,
    start,
    end,
  });
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
      { stdio: ["ignore", "inherit", "inherit"] }
    );

    const watchdog = setTimeout(
      () => ff.kill("SIGKILL"),
      (seconds + 15) * 1000
    );

    ff.on("exit", (code) => {
      clearTimeout(watchdog);
      if (code === 0) resolve(outFile);
      else reject(new Error("ffmpeg " + code));
    });
  });
}