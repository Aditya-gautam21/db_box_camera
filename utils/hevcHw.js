import { spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";

const RENDER_NODES = ["/dev/dri/renderD128", "/dev/dri/renderD129", "/dev/dri/renderD130"];

let cached;
let inflight;

function ffmpegCapture(args, timeoutMs) {
  return new Promise((resolve) => {
    const proc = spawn("ffmpeg", ["-hide_banner", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let err = "";
    proc.stdout.on("data", (chunk) => {
      err += chunk;
    });
    proc.stderr.on("data", (chunk) => {
      err += chunk;
    });
    const done = (ok) => {
      clearTimeout(timer);
      if (!proc.killed) proc.kill("SIGKILL");
      resolve({ ok, err });
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    proc.on("error", () => done(false));
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, err });
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

async function piModel() {
  try {
    return await readFile("/proc/device-tree/model", "utf8");
  } catch {
    return "";
  }
}

async function rpiHevcNode() {
  for (const n of [19, 31, 20, 18]) {
    const device = `/dev/video${n}`;
    if (await readable(device)) return device;
  }
  return "";
}

async function candidates() {
  const [acc, dec, model] = await Promise.all([
    ffmpegText(["-hwaccels"]),
    ffmpegText(["-decoders"]),
    piModel(),
  ]);
  const list = [];
  if (/Raspberry Pi/.test(model)) {
    // HEVC on Pi is stateless DRM (/dev/video19), not hevc_v4l2m2m or VAAPI.
    const device = await rpiHevcNode();
    if (device && /\bdrm\b/.test(acc)) list.push({ kind: "drm", device });
    else if (device) {
      console.log("live decode: Pi HEVC node found, but this ffmpeg has no drm hwaccel");
    }
    return list;
  }
  if (/\bvaapi\b/.test(acc)) {
    for (const device of RENDER_NODES) {
      if (await readable(device) && await vaapiWorks(device)) {
        list.push({ kind: "vaapi", device });
        break;
      }
    }
  }
  if (!list.length && /\bcuda\b/.test(acc) && /hevc_cuvid/.test(dec)) list.push({ kind: "cuda" });
  return list;
}

async function vaapiWorks(device) {
  const { ok, err } = await ffmpegCapture([
    "-init_hw_device", `vaapi=va:${device}`,
    "-f", "lavfi",
    "-i", "color=c=black:s=16x16:d=0.05",
    "-f", "null",
    "-",
  ], 3500);
  if (!ok || /vaInitialize failed|Failed to initialise VAAPI|No VA display/i.test(err)) {
    return false;
  }
  return true;
}

async function probe() {
  const list = await candidates();
  const hw = list[0] || null;
  if (hw) {
    const label = hw.device ? `${hw.kind}:${hw.device}` : hw.kind;
    console.log(`live decode: hevc hardware (${label})`);
  } else {
    console.log("live decode: software (hevc/h264)");
  }
  return { hw };
}

export async function liveDecodeMode() {
  if (cached) return cached;
  if (!inflight) inflight = probe().then((mode) => {
    cached = mode;
    inflight = null;
    return mode;
  });
  return inflight;
}

export function startLiveDecodeProbe() {
  liveDecodeMode();
}

// The Pi HEVC block can wedge (kernel hung_task in hevc_d_release) when its
// clock gets gated; ffmpeg then opens the stream and never decodes a frame.
// There is no way to detect that up front, so live falls back at runtime.
export function disableLiveHw(why) {
  if (cached && !cached.hw) return;
  console.error(`live decode: hardware disabled (${why}); using software`);
  cached = { hw: null };
  inflight = null;
}

export function liveHwArgs(hw) {
  if (!hw) return [];
  if (hw.kind === "drm") {
    // drm_prime keeps the HEVC DPB in CMA. Without it, ffmpeg copies every
    // 1080p frame into process RSS (~190MB). If prime stalls, live drops it.
    if (hw.prime === false) return ["-hwaccel", "drm"];
    return ["-hwaccel", "drm", "-hwaccel_output_format", "drm_prime", "-extra_hw_frames", "6"];
  }
  if (hw.kind === "vaapi") {
    return [
      "-hwaccel", "vaapi",
      "-hwaccel_device", hw.device,
      "-hwaccel_output_format", "vaapi",
      "-extra_hw_frames", "8",
    ];
  }
  if (hw.kind === "cuda") {
    return ["-hwaccel", "cuda", "-hwaccel_output_format", "cuda"];
  }
  return [];
}

export function liveHwFilter(hw) {
  // Decode stays 1080p. JPEG is 1280 so the CPU pool is ~0.44× a 1080p YUV frame.
  const out = "scale=1280:-2:flags=fast_bilinear,fps=12";
  if (hw?.kind === "vaapi") return `hwdownload,format=nv12,${out}`;
  if (hw?.kind === "cuda") return `hwdownload,format=nv12,${out}`;
  if (hw?.kind === "drm" && hw.prime !== false) return `hwdownload,format=yuv420p,${out}`;
  return out;
}
