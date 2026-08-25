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

export async function addCamera(name, host, username, password) {
  const cameras = await loadCameras();
  const camera = {
    id: randomBytes(4).toString("hex"),
    name,
    host,
    username,
    password,
  };
  cameras.push(camera);
  await writeFile(cameraFile, `${JSON.stringify(cameras, null, 2)}\n`);
  return camera;
}

export function getRtspUrl(cam, subtype = 0) {
  const user = encodeURIComponent(cam.username);
  const pass = encodeURIComponent(cam.password);
  return `rtsp://${user}:${pass}@${cam.host}:554/rtsp/streaming?channel=01&subtype=${subtype}`;
}

export function publicCameras(cameras) {
  return cameras.map(({ id, name }) => ({ id, name }));
}
