import { spawn } from "node:child_process";
import { liveHwArgs, liveHwFilter } from "./hevcHw.js";

const liveHubs = new Map();
const CLIP_VF = "fps=12,scale=960:-2:flags=fast_bilinear";

export function liveVideoArgs(rtspUrl, hw = null) {
  return [
    "-hide_banner",
    "-loglevel", "error",
    "-threads", "1",
    "-filter_threads", "1",
    "-fflags", "+genpts+flush_packets",
    "-flags", "low_delay",
    "-rtsp_transport", "tcp",
    "-timeout", "5000000",
    "-probesize", "65536",
    "-analyzeduration", "0",
    "-max_delay", "300000",
    ...liveHwArgs(hw),
    "-i", rtspUrl,
    "-an",
    "-sn",
    "-vf", liveHwFilter(hw),
    "-f", "mpjpeg",
    "-q:v", "5",
    "-flush_packets", "1",
    "pipe:1",
  ];
}

export function clipVideoArgs(rtspUrl, duration) {
  const args = [
    "-hide_banner",
    "-loglevel", "error",
    "-threads", "1",
    "-rtsp_transport", "tcp",
    "-timeout", "8000000",
    "-probesize", "1000000",
    "-analyzeduration", "1000000",
    "-fflags", "+genpts",
    "-i", rtspUrl,
    "-map", "0:v:0?",
    "-an",
    "-threads", "1",
    "-vf", CLIP_VF,
    "-f", "mpjpeg",
    "-q:v", "5",
  ];
  if (duration) args.push("-t", String(duration));
  args.push("pipe:1");
  return args;
}

export function audioArgs(rtspUrl, { duration, sampleRate = 48000 } = {}) {
  const args = [
    "-hide_banner",
    "-loglevel", "error",
    "-threads", "1",
    "-rtsp_transport", "tcp",
    "-timeout", "8000000",
    "-probesize", "500000",
    "-analyzeduration", "500000",
    "-i", rtspUrl,
    "-vn",
    "-ac", "1",
    "-ar", String(sampleRate),
    "-c:a", "pcm_s16le",
    "-f", "s16le",
  ];
  if (duration) args.push("-t", String(duration));
  args.push("pipe:1");
  return args;
}

function lastJpegIn(buf) {
  const start = buf.lastIndexOf(Buffer.from([0xff, 0xd8]));
  if (start < 0) return null;
  const end = buf.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
  if (end < 0) return null;
  return Buffer.from(buf.subarray(start, end + 2));
}

export function startLiveHub(key, args) {
  let hub = liveHubs.get(key);
  if (hub?.proc && hub.proc.exitCode == null) return hub;
  const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
  hub = { proc, viewers: new Set(), lastJpeg: null, tail: Buffer.alloc(0), errLines: 0 };
  liveHubs.set(key, hub);
  proc.stderr.on("data", (chunk) => {
    if (hub.errLines >= 8) return;
    const text = String(chunk).trim();
    if (!text) return;
    hub.errLines += 1;
    console.error(`ffmpeg ${key}: ${text}`);
  });
  proc.stdout.on("data", (chunk) => {
    for (const view of [...hub.viewers]) view.push(chunk);
    hub.tail = Buffer.concat([hub.tail, chunk]);
    if (hub.tail.length > 512_000) hub.tail = hub.tail.subarray(hub.tail.length - 256_000);
    const jpeg = lastJpegIn(hub.tail);
    if (jpeg) hub.lastJpeg = jpeg;
  });
  const dead = () => {
    for (const view of [...hub.viewers]) view.end();
    liveHubs.delete(key);
  };
  proc.once("exit", dead);
  proc.once("error", dead);
  return hub;
}

export function retainLiveHubs(keys) {
  const keep = new Set(keys);
  for (const [key, hub] of liveHubs) {
    if (keep.has(key)) continue;
    if (!hub.proc.killed) hub.proc.kill("SIGKILL");
    liveHubs.delete(key);
  }
}

export function liveHubResponse(key, args, mimeType, request) {
  const hub = startLiveHub(key, args);
  let view;
  const stream = new ReadableStream({
    start(controller) {
      view = {
        push(chunk) {
          try {
            const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
            controller.enqueue(bytes.slice());
          } catch {
            hub.viewers.delete(view);
          }
        },
        end() {
          hub.viewers.delete(view);
          try {
            controller.close();
          } catch {
            /* closed */
          }
        },
      };
      hub.viewers.add(view);
      if (hub.lastJpeg) view.push(hub.lastJpeg);
    },
    cancel() {
      if (!view) return;
      hub.viewers.delete(view);
    },
  });
  request.signal?.addEventListener("abort", () => {
    try {
      stream.cancel();
    } catch {
      /* already canceled */
    }
  }, { once: true });
  return new Response(stream, {
    headers: {
      "content-type": mimeType,
      "cache-control": "no-cache, no-store",
    },
  });
}
