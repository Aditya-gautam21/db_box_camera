import { spawn } from "node:child_process";

const hubs = new Map();

const MJPEG_HEADERS = {
  "Content-Type": "multipart/x-mixed-replace; boundary=ffmpeg",
  "Cache-Control": "no-cache, no-store",
  Connection: "close",
};

const PCM_HEADERS = {
  "Content-Type": "application/octet-stream",
  "Cache-Control": "no-cache, no-store",
  Connection: "close",
};

/** Live encode — main stream in, browser MJPEG out. */
const LIVE_VF = "fps=12,scale=960:-2,format=yuv420p";
/** Clip encode. */
const CLIP_VF = "fps=12,scale=960:-2,format=yuv420p";

function pipeFfmpeg(req, res, headers, args, { retries = 0, gapMs = 400 } = {}) {
  res.set(headers);
  let ff;
  let stopped = false;
  const stop = () => {
    stopped = true;
    ff?.kill("SIGKILL");
  };
  req.on("close", stop);
  res.on("close", stop);

  const start = (attempt) => {
    if (stopped || res.writableEnded) return;
    ff = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "ignore"] });
    ff.stdout.pipe(res, { end: false });
    ff.on("exit", (code) => {
      try {
        ff.stdout.unpipe(res);
      } catch {
        /* already unpiped */
      }
      if (stopped || res.writableEnded) {
        if (!res.writableEnded) res.end();
        return;
      }
      if (attempt < retries && code) {
        setTimeout(() => start(attempt + 1), gapMs);
        return;
      }
      if (!res.writableEnded) res.end();
    });
  };
  start(0);
}

function liveVideoArgs(rtspUrl) {
  return [
    "-hide_banner",
    "-loglevel", "fatal",
    "-threads", "1",
    "-rtsp_transport", "tcp",
    "-fflags", "nobuffer",
    "-flags", "low_delay",
    "-probesize", "32768",
    "-analyzeduration", "0",
    "-i", rtspUrl,
    "-an",
    "-threads", "1",
    "-vf", LIVE_VF,
    "-f", "mpjpeg",
    "-q:v", "5",
    "pipe:1",
  ];
}

function clipVideoArgs(rtspUrl, duration) {
  const args = [
    "-hide_banner",
    "-loglevel", "fatal",
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

function audioArgs(rtspUrl, { duration, sampleRate = 48000 } = {}) {
  const args = [
    "-hide_banner",
    "-loglevel", "fatal",
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

function joinHub(key, req, res, headers, args) {
  res.set(headers);
  let hub = hubs.get(key);
  if (!hub) {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "ignore"] });
    hub = { proc, viewers: new Set() };
    hubs.set(key, hub);
    proc.stdout.on("data", (chunk) => {
      for (const client of hub.viewers) {
        try {
          client.write(chunk);
        } catch {
          hub.viewers.delete(client);
        }
      }
    });
    proc.on("exit", () => {
      for (const client of hub.viewers) {
        try {
          client.end();
        } catch {
          /* already closed */
        }
      }
      hubs.delete(key);
    });
  }

  hub.viewers.add(res);
  const leave = () => {
    if (!hub.viewers.has(res)) return;
    hub.viewers.delete(res);
    if (hub.viewers.size > 0) return;
    hub.proc.kill("SIGKILL");
    hubs.delete(key);
  };
  req.on("close", leave);
  res.on("close", leave);
}

export function sampleRateFromQuery(req) {
  const n = Number(req.query.ar);
  if (n === 8000 || n === 16000 || n === 44100 || n === 48000) return n;
  return 48000;
}

export function stream(req, res, rtspUrl, { duration } = {}) {
  if (duration) {
    pipeFfmpeg(req, res, MJPEG_HEADERS, clipVideoArgs(rtspUrl, duration), { retries: 1, gapMs: 400 });
    return;
  }
  joinHub(`v:${rtspUrl}`, req, res, MJPEG_HEADERS, liveVideoArgs(rtspUrl));
}

export function audioStream(req, res, rtspUrl, { duration, sampleRate = 48000 } = {}) {
  const args = audioArgs(rtspUrl, { duration, sampleRate });
  if (duration) {
    pipeFfmpeg(req, res, PCM_HEADERS, args, { retries: 1, gapMs: 400 });
    return;
  }
  joinHub(`a:${rtspUrl}:${sampleRate}`, req, res, PCM_HEADERS, args);
}
