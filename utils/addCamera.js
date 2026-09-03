import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const cameraFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "camera_info.json");

export async function loadCameras() {
  try {
    const raw = await readFile(cameraFile, "utf8");
    if (!raw.trim()) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function saveCameras(cameras) {
  await writeFile(cameraFile, `${JSON.stringify(cameras, null, 2)}\n`);
}

export async function getCamera(id) {
  const cameras = await loadCameras();
  if (id) {
    for (const cam of cameras) {
      if (cam.id === id) return cam;
    }
    return null;
  }
  return cameras[0] ?? null;
}

export async function addCamera(name, host, username, password, ptzInfo = {}) {
  const cameras = await loadCameras();
  const camera = {
    id: randomBytes(4).toString("hex"),
    name,
    host,
    username,
    password,
    ptz: ptzInfo.ptz === true,
    ptzChannel: ptzInfo.ptzChannel || "CH1",
    zoomMin: ptzInfo.zoomMin ?? 0,
    zoomMax: ptzInfo.zoomMax ?? 0,
    focusMin: ptzInfo.focusMin ?? 0,
    focusMax: ptzInfo.focusMax ?? 0,
    zoomSteps: ptzInfo.zoomSteps ?? [1, 5, 20],
    focusSteps: ptzInfo.focusSteps ?? [1, 5, 20],
  };
  cameras.push(camera);
  await saveCameras(cameras);
  return camera;
}

export async function updateCamera(id, fields = {}) {
  const cameras = await loadCameras();
  const idx = cameras.findIndex((cam) => cam.id === id);
  if (idx < 0) throw new Error("unknown camera");
  cameras[idx] = { ...cameras[idx], ...fields };
  await saveCameras(cameras);
  return cameras[idx];
}

export async function removeCamera(id) {
  if (!id) throw new Error("camera id required");
  const cameras = await loadCameras();
  const next = cameras.filter((cam) => cam.id !== id);
  if (next.length === cameras.length) throw new Error("unknown camera");
  await saveCameras(next);
  return { id };
}

export function getRtspUrl(cam, subtype = 0) {
  const user = encodeURIComponent(cam.username);
  const pass = encodeURIComponent(cam.password);
  return `rtsp://${user}:${pass}@${cam.host}:554/rtsp/streaming?channel=01&subtype=${subtype}`;
}

export function publicCameras(cameras) {
  return cameras.map((cam) => ({
    id: cam.id,
    name: cam.name,
    ptz: cam.ptz === true,
    ptzChannel: cam.ptzChannel || "CH1",
    zoomMin: cam.zoomMin ?? 0,
    zoomMax: cam.zoomMax ?? 0,
    focusMin: cam.focusMin ?? 0,
    focusMax: cam.focusMax ?? 0,
    zoomSteps: cam.zoomSteps ?? [1, 5, 20],
    focusSteps: cam.focusSteps ?? [1, 5, 20],
  }));
}
