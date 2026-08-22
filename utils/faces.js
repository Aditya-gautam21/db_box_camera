import fs from "node:fs";
import path from "node:path";

const STAMP = /^(.*)-(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})(?:-[^.]+)?\.jpe?g$/i;

function pad(n) {
  return String(n).padStart(2, "0");
}

function cameraStamp(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}Z`;
}

export function parseFaceFilename(filename) {
  const m = String(filename).match(STAMP);
  if (!m) {
    return {
      name: String(filename).replace(/\.jpe?g$/i, ""),
      start: null,
      end: null,
    };
  }
  const snap = Date.parse(`${m[2]}T${m[3]}:${m[4]}:${m[5]}Z`);
  const start = cameraStamp(new Date(snap));
  const end = cameraStamp(new Date(snap + 5 * 60 * 1000));
  return { name: m[1], start, end };
}

export function listFaces(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => /\.jpe?g$/i.test(name))
    .map((filename) => {
      const parsed = parseFaceFilename(filename);
      return {
        filename,
        url: `/face-data/${encodeURIComponent(filename)}`,
        name: parsed.name,
        start: parsed.start,
        end: parsed.end,
      };
    })
    .sort((a, b) => (b.start || "").localeCompare(a.start || "") || b.filename.localeCompare(a.filename));
}
