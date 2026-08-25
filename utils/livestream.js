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

function pipeFfmpeg(req, res, headers, args, { retries = 0, gapMs = 500 } = {}) {
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
    ff = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "inherit"] });
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
    "-rtsp_transport", "tcp",
    "-fflags", "nobuffer",
    "-flags", "low_delay",
    "-probesize", "32768",
    "-analyzeduration", "0",
    "-i", rtspUrl,
    "-an",
    "-vf", "fps=12,scale=960:-2",
    "-f", "mpjpeg",
    "-q:v", "8",
    "pipe:1",
  ];
}

function clipVideoArgs(rtspUrl, duration) {
  const args = [
    "-hide_banner",
    "-loglevel", "warning",
    "-rtsp_transport", "tcp",
    "-timeout", "10000000",
    "-probesize", "5000000",
    "-analyzeduration", "5000000",
    "-fflags", "+genpts",
    "-i", rtspUrl,
    "-map", "0:v:0?",
    "-an",
    "-vf", "fps=12,scale=960:-2",
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
    "-rtsp_transport", "tcp",
    "-timeout", "10000000",
    "-probesize", "2000000",
    "-analyzeduration", "2000000",
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
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "inherit"] });
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
    enqueueClip(() => {
      if (req.destroyed || res.writableEnded) return;
      pipeFfmpeg(req, res, MJPEG_HEADERS, clipVideoArgs(rtspUrl, duration), { retries: 2, gapMs: 600 });
    });
    return;
  }
  joinHub(`v:${rtspUrl}`, req, res, MJPEG_HEADERS, liveVideoArgs(rtspUrl));
}

export function audioStream(req, res, rtspUrl, { duration, sampleRate = 48000 } = {}) {
  const args = audioArgs(rtspUrl, { duration, sampleRate });
  if (duration) {
    enqueueClip(() => {
      if (req.destroyed || res.writableEnded) return;
      pipeFfmpeg(req, res, PCM_HEADERS, args, { retries: 1, gapMs: 600 });
    });
    return;
  }
  joinHub(`a:${rtspUrl}:${sampleRate}`, req, res, PCM_HEADERS, args);
}

let clipGate = Promise.resolve();
function enqueueClip(start) {
  clipGate = clipGate
    .then(() => new Promise((resolve) => setTimeout(resolve, 400)))
    .then(start, start)
    .catch(() => {});
}
