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

function pipeFfmpeg(req, res, headers, args) {
  res.set(headers);
  const ff = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "inherit"] });
  ff.stdout.pipe(res);
  const stop = () => ff.kill("SIGKILL");
  req.on("close", stop);
  ff.on("exit", () => res.end());
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
  const args = ["-rtsp_transport", "tcp", "-timeout", "3000000", "-i", rtspUrl, "-an", "-f", "mpjpeg", "-q:v", "5"];
  if (duration) args.push("-t", String(duration));
  args.push("pipe:1");
  return args;
}

function audioArgs(rtspUrl, { duration, sampleRate = 48000 } = {}) {
  const args = [
    "-hide_banner",
    "-loglevel", "fatal",
    "-rtsp_transport", "tcp",
    "-fflags", "nobuffer",
    "-flags", "low_delay",
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
    pipeFfmpeg(req, res, MJPEG_HEADERS, clipVideoArgs(rtspUrl, duration));
    return;
  }
  joinHub(`v:${rtspUrl}`, req, res, MJPEG_HEADERS, liveVideoArgs(rtspUrl));
}

export function audioStream(req, res, rtspUrl, { duration, sampleRate = 48000 } = {}) {
  const args = audioArgs(rtspUrl, { duration, sampleRate });
  if (duration) {
    pipeFfmpeg(req, res, PCM_HEADERS, args);
    return;
  }
  joinHub(`a:${rtspUrl}:${sampleRate}`, req, res, PCM_HEADERS, args);
}
