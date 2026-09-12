import { spawn } from "node:child_process";
import { access } from "node:fs/promises";

const RENDER_NODES = ["/dev/dri/renderD128", "/dev/dri/renderD129", "/dev/dri/renderD130"];

let cached;
let inflight;

function ffmpegCapture(args, timeoutMs, { wantStdout = false } = {}) {
  return new Promise((resolve) => {
    const proc = spawn("ffmpeg", ["-hide_banner", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = Buffer.alloc(0);
    let err = "";
    proc.stdout.on("data", (chunk) => {
      if (wantStdout) {
        if (out.length < 64) out = Buffer.concat([out, chunk]);
      } else {
        err += chunk;
      }
    });
    proc.stderr.on("data", (chunk) => {
      err += chunk;
    });
    const done = (ok) => {
      clearTimeout(timer);
      if (!proc.killed) proc.kill("SIGKILL");
      resolve({ ok, out, err });
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    proc.on("error", () => done(false));
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, out, err });
    });
  });
}

async function readable(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function ffmpegText(args, timeoutMs = 4000) {
  const { err } = await ffmpegCapture(args, timeoutMs);
  return err;
}

async function vaapiOpens(device) {
  const err = await ffmpegText(
    ["-loglevel", "error", "-init_hw_device", `vaapi=va:${device}`, "-f", "lavfi", "-i", "nullsrc=s=16x16:d=0.05", "-f", "null", "-"],
    4000,
  );
  return !/failed|error/i.test(err);
}

function verifyArgs(hw, rtspUrl) {
  const head = [
    "-loglevel", "error",
    "-rtsp_transport", "tcp",
    "-timeout", "8000000",
  ];
  const tail = ["-an", "-frames:v", "1", "-f", "null", "-"];
  if (hw.kind === "vaapi") {
    return [
      ...head,
      "-hwaccel", "vaapi",
      "-hwaccel_device", hw.device,
      "-hwaccel_output_format", "vaapi",
      "-i", rtspUrl,
      "-vf", "hwdownload,format=nv12",
      ...tail,
    ];
  }
  if (hw.kind === "v4l2m2m") {
    return [...head, "-c:v", "hevc_v4l2m2m", "-i", rtspUrl, ...tail];
  }
  if (hw.kind === "cuda") {
    return [
      ...head,
      "-hwaccel", "cuda",
      "-hwaccel_output_format", "cuda",
      "-i", rtspUrl,
      "-vf", "hwdownload,format=nv12",
      ...tail,
    ];
  }
  return [...head, "-i", rtspUrl, ...tail];
}

async function candidates() {
  const [acc, dec] = await Promise.all([
    ffmpegText(["-hwaccels"]),
    ffmpegText(["-decoders"]),
  ]);
  const list = [];
  if (/hevc_v4l2m2m/.test(dec)) list.push({ kind: "v4l2m2m" });
  if (/\bvaapi\b/.test(acc)) {
    for (const device of RENDER_NODES) {
      if (await readable(device) && await vaapiOpens(device)) list.push({ kind: "vaapi", device });
    }
  }
  if (/\bcuda\b/.test(acc) && /hevc_cuvid/.test(dec)) list.push({ kind: "cuda" });
  return list;
}

async function verify(hw, rtspUrl) {
  const { ok } = await ffmpegCapture(verifyArgs(hw, rtspUrl), 8000);
  return ok;
}

async function probe(rtspUrl) {
  for (const hw of await candidates()) {
    try {
      if (await verify(hw, rtspUrl)) {
        const label = hw.device ? `${hw.kind}:${hw.device}` : hw.kind;
        console.log(`live decode: hevc hardware (${label})`);
        return { hw };
      }
    } catch {
      /* try next backend */
    }
  }
  console.log("live decode: software (hevc/h264)");
  return { hw: null };
}

export async function liveDecodeMode(rtspUrl) {
  if (cached) return cached;
  if (!inflight) inflight = probe(rtspUrl).then((mode) => {
    cached = mode;
    inflight = null;
    return mode;
  });
  return inflight;
}

export function liveHwArgs(hw) {
  if (!hw) return [];
  if (hw.kind === "vaapi") {
    return [
      "-hwaccel", "vaapi",
      "-hwaccel_device", hw.device,
      "-hwaccel_output_format", "vaapi",
    ];
  }
  if (hw.kind === "v4l2m2m") return ["-c:v", "hevc_v4l2m2m"];
  if (hw.kind === "cuda") {
    return ["-hwaccel", "cuda", "-hwaccel_output_format", "cuda"];
  }
  return [];
}

export function liveHwFilter(hw, swFilter) {
  if (hw?.kind === "vaapi" || hw?.kind === "cuda") {
    return `hwdownload,format=nv12,${swFilter}`;
  }
  return swFilter;
}
