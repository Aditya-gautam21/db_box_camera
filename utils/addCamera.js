import { readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const cameraFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "camera_info.json");
const REACH_MS = 10_000;

export function normalizeHost(host) {
  let h = String(host || "").trim().toLowerCase();
  h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  h = h.split("/")[0];
  h = h.replace(/^\[|\]$/g, "");
  const colon = h.lastIndexOf(":");
  if (colon > 0 && /^\d+$/.test(h.slice(colon + 1))) h = h.slice(0, colon);
  return h;
}

function httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function portOpen(host, port, ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(false);
    const sock = net.connect({ host, port });
    let finished = false;
    const done = (ok) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      sock.removeAllListeners();
      sock.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), ms);
    signal?.addEventListener("abort", () => done(false), { once: true });
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
  });
}

export async function assertCameraReachable(host, timeoutMs = REACH_MS) {
  const h = normalizeHost(host);
  if (!h) throw httpError("No camera found", 404);
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    await Promise.any(
      [554, 443].map((port) =>
        portOpen(h, port, timeoutMs, ac.signal).then((open) => {
          if (!open) throw new Error("closed");
          return true;
        }),
      ),
    );
  } catch {
    throw httpError("No camera found", 404);
  } finally {
    clearTimeout(timer);
    ac.abort();
  }
}

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
  const hostNorm = normalizeHost(host);
  if (cameras.some((cam) => normalizeHost(cam.host) === hostNorm)) {
    throw httpError("Camera already added", 409);
  }
  await assertCameraReachable(hostNorm);
  const camera = {
    id: randomBytes(4).toString("hex"),
    name,
    host: hostNorm,
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
