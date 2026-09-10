import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const lineFile = path.join(root, "..", "python", "line_cross.json");
const legacyFile = path.join(root, "..", "data", "line_cross.json");

function pair(value) {
  const x = Number(Array.isArray(value) ? value[0] : value?.x);
  const y = Number(Array.isArray(value) ? value[1] : value?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null;
  return [x, y];
}

function camId(value) {
  const id = String(value ?? "").trim();
  return id || null;
}

function emptyLine(cam = null) {
  return { a: null, b: null, side: null, cam };
}

function lineFrom(entry, cam) {
  const a = pair(entry?.a);
  const b = pair(entry?.b);
  if (!a || !b) return emptyLine(cam);
  return { a, b, side: pair(entry?.side), cam };
}

function parseCameras(data) {
  const cameras = {};
  if (data?.cameras && typeof data.cameras === "object" && !Array.isArray(data.cameras)) {
    for (const [id, entry] of Object.entries(data.cameras)) {
      const cam = camId(id);
      const line = lineFrom(entry, cam);
      if (cam && line.a) cameras[cam] = { a: line.a, b: line.b, side: line.side };
    }
    return cameras;
  }
  const cam = camId(data?.cam);
  const line = lineFrom(data, cam);
  if (cam && line.a) cameras[cam] = { a: line.a, b: line.b, side: line.side };
  return cameras;
}

async function readFileCameras(file) {
  try {
    const raw = (await readFile(file, "utf8")).trim();
    if (!raw) return {};
    return parseCameras(JSON.parse(raw));
  } catch (err) {
    if (err.code === "ENOENT" || err instanceof SyntaxError) return {};
    throw err;
  }
}

async function readCameras() {
  const cameras = await readFileCameras(lineFile);
  if (Object.keys(cameras).length) return cameras;
  return readFileCameras(legacyFile);
}

async function writeCameras(cameras) {
  if (!Object.keys(cameras).length) {
    for (const file of [lineFile, legacyFile]) {
      try {
        await unlink(file);
      } catch (err) {
        if (err.code !== "ENOENT") throw err;
      }
    }
    return;
  }
  await mkdir(path.dirname(lineFile), { recursive: true });
  await writeFile(lineFile, `${JSON.stringify({ cameras }, null, 2)}\n`);
}

export async function getLineCross(cam) {
  const id = camId(cam);
  const cameras = await readCameras();
  if (!id) return emptyLine(null);
  return lineFrom(cameras[id], id);
}

export async function saveLineCross(body) {
  const id = camId(body?.cam);
  const a = pair(body?.a);
  const b = pair(body?.b);
  if (!id) {
    const err = new Error("cam is required");
    err.status = 400;
    throw err;
  }
  if (!a || !b) {
    const err = new Error("a and b required as 0–1 points");
    err.status = 400;
    throw err;
  }
  const cameras = await readCameras();
  cameras[id] = { a, b, side: pair(body?.side) };
  await writeCameras(cameras);
  return { a, b, side: cameras[id].side, cam: id };
}

export async function clearLineCross(cam) {
  const id = camId(cam);
  if (!id) {
    const err = new Error("cam is required");
    err.status = 400;
    throw err;
  }
  const cameras = await readCameras();
  delete cameras[id];
  await writeCameras(cameras);
  return emptyLine(id);
}
