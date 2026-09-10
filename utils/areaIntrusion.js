import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pythonDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "python");
const zoneFile = path.join(pythonDir, "area_intrusion.json");
const statsFile = path.join(pythonDir, "area_intrusion_stats.json");

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

function emptyZone(cam = null) {
  return { a: null, b: null, cam };
}

function emptyStats() {
  return { inside: 0, total: 0, recent: [], updated: 0, live: false };
}

function zoneFrom(entry, cam) {
  const a = pair(entry?.a);
  const b = pair(entry?.b);
  if (!a || !b) return emptyZone(cam);
  return { a, b, cam };
}

function parseCameras(data) {
  const cameras = {};
  if (data?.cameras && typeof data.cameras === "object" && !Array.isArray(data.cameras)) {
    for (const [id, entry] of Object.entries(data.cameras)) {
      const cam = camId(id);
      const zone = zoneFrom(entry, cam);
      if (cam && zone.a) cameras[cam] = { a: zone.a, b: zone.b };
    }
    return cameras;
  }
  const cam = camId(data?.cam);
  const zone = zoneFrom(data, cam);
  if (cam && zone.a) cameras[cam] = { a: zone.a, b: zone.b };
  return cameras;
}

async function readCameras() {
  try {
    const raw = (await readFile(zoneFile, "utf8")).trim();
    if (!raw) return {};
    return parseCameras(JSON.parse(raw));
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
}

async function writeCameras(cameras) {
  if (!Object.keys(cameras).length) {
    try {
      await unlink(zoneFile);
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
    return;
  }
  await mkdir(path.dirname(zoneFile), { recursive: true });
  await writeFile(zoneFile, `${JSON.stringify({ cameras }, null, 2)}\n`);
}

export async function getAreaZone(cam) {
  const id = camId(cam);
  const cameras = await readCameras();
  if (!id) return emptyZone(null);
  return zoneFrom(cameras[id], id);
}

export async function saveAreaZone(body) {
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
  cameras[id] = { a, b };
  await writeCameras(cameras);
  return { a, b, cam: id };
}

export async function clearAreaZone(cam) {
  const id = camId(cam);
  if (!id) {
    const err = new Error("cam is required");
    err.status = 400;
    throw err;
  }
  const cameras = await readCameras();
  delete cameras[id];
  await writeCameras(cameras);
  return emptyZone(id);
}

function liveFlag(updated) {
  return updated > 0 && Date.now() / 1000 - updated < 5;
}

function parseCamStats(entry) {
  const updated = Number(entry?.updated) || 0;
  return {
    inside: Number(entry?.inside) || 0,
    total: Number(entry?.total) || 0,
    recent: Array.isArray(entry?.recent) ? entry.recent : [],
    updated,
    live: liveFlag(updated),
  };
}

export async function getAreaStats(cam) {
  const id = camId(cam);
  try {
    const raw = (await readFile(statsFile, "utf8")).trim();
    if (!raw) return emptyStats();
    const data = JSON.parse(raw);
    if (data?.cameras && typeof data.cameras === "object") {
      return id ? parseCamStats(data.cameras[id]) : emptyStats();
    }
    return emptyStats();
  } catch (err) {
    if (err.code === "ENOENT" || err instanceof SyntaxError) return emptyStats();
    throw err;
  }
}

export async function getAreaState(cam) {
  const id = camId(cam);
  const [zone, stats] = await Promise.all([getAreaZone(id), getAreaStats(id)]);
  return { zone, stats };
}
