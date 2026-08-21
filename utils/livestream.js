import { spawn } from "node:child_process";

function pipeFfmpeg(req, res, headers, args) {
  res.set(headers);
  const ff = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "inherit"] });
  ff.stdout.pipe(res);
  const stop = () => ff.kill("SIGKILL");
  req.on("close", stop);
  ff.on("exit", () => res.end());
}

export function sampleRateFromQuery(req) {
  const n = Number(req.query.ar);
  if (n === 8000 || n === 16000 || n === 44100 || n === 48000) return n;
  return 48000;
}

export function stream(req, res, rtspUrl, { duration } = {}) {
  const args = ["-rtsp_transport", "tcp"];
  if (duration) args.push("-timeout", "3000000");
  args.push("-i", rtspUrl, "-an", "-f", "mpjpeg", "-q:v", "5");
  if (duration) args.push("-t", String(duration));
  args.push("pipe:1");

  pipeFfmpeg(
    req,
    res,
    {
      "Content-Type": "multipart/x-mixed-replace; boundary=ffmpeg",
      "Cache-Control": "no-cache, no-store",
      Connection: "close",
    },
    args
  );
}

export function audioStream(req, res, rtspUrl, { duration, sampleRate = 48000 } = {}) {
  const args = [
    "-rtsp_transport", "tcp",
    "-fflags", "nobuffer",
    "-flags", "low_delay",
  ];
  if (duration) args.push("-timeout", "3000000");
  args.push(
    "-i", rtspUrl,
    "-vn",
    "-ac", "1",
    "-ar", String(sampleRate),
    "-c:a", "pcm_s16le",
    "-f", "s16le"
  );
  if (duration) args.push("-t", String(duration));
  args.push("pipe:1");

  pipeFfmpeg(
    req,
    res,
    {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-cache, no-store",
      Connection: "close",
    },
    args
  );
}
