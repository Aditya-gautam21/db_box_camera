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
    const device = /\bdrm\b/.test(acc) ? await rpiHevcNode() : "";
    if (device) list.push({ kind: "drm", device });
    return list;
  }
  if (/hevc_v4l2m2m/.test(dec)) list.push({ kind: "v4l2m2m" });
  if (/\bvaapi\b/.test(acc)) {
    for (const device of RENDER_NODES) {
      if (await readable(device)) {
        list.push({ kind: "vaapi", device });
        break;
      }
    }
  }
  if (!list.length && /\bcuda\b/.test(acc) && /hevc_cuvid/.test(dec)) list.push({ kind: "cuda" });
  return list;
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

export function liveHwArgs(hw) {
  if (!hw) return [];
  if (hw.kind === "drm") return ["-hwaccel", "drm"];
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

export function liveHwFilter(hw) {
  const fps = "fps=12";
  if (hw?.kind === "vaapi") return `scale_vaapi=w=1280:h=-2,hwdownload,format=nv12,${fps}`;
  if (hw?.kind === "cuda") return `scale_cuda=1280:-2,hwdownload,format=nv12,${fps}`;
  return `${fps},scale=1280:-2:flags=fast_bilinear`;
}
