import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { loadCameras, addCamera, updateCamera, removeCamera, getCamera, getRtspUrl, publicCameras } from "../utils/addCamera.js";
import { saveAreaZone, clearAreaZone } from "../utils/areaIntrusion.js";
import { getAiState, setAiModels } from "../utils/ai.js";
import { scanCameras } from "../utils/cameraScan.js";
import { playbackUri, saveClip } from "../utils/clips.js";
import { listSnappedFaces, getSnapJpeg } from "../utils/fetchFaces.js";
import { saveLineCross, clearLineCross } from "../utils/lineCross.js";
import { liveDecodeMode } from "../utils/hevcHw.js";
import { audioArgs, clipVideoArgs, liveVideoArgs } from "../utils/livestream.js";
import {
  listGroups,
  addGroup,
  modifyGroup,
  removeGroup,
  listGroupFaces,
  getFaceJpeg,
  addImportedFaces,
  addCapturedFaces,
  modifyFace,
  removeFace,
} from "../utils/addFace.js";
import {
  getEventSettings,
  setEventSettings,
  getEventConfig,
  setEventConfig,
  getOsdSettings,
  setOsdSettings,
  getVideoCover,
  setVideoCover,
  getDiskSettings,
  setDiskSettings,
  getNetworkSettings,
  setNetworkSettings,
  testNetworkAddress,
} from "../utils/settings.js";
import {
  detectPtz,
  getPtzState,
  setZoom,
  setFocus,
  autoFocus,
  restorePtz,
  refreshPtz,
} from "../utils/zoom.js";

const MJPEG = "multipart/x-mixed-replace; boundary=ffmpeg";
const PCM = "application/octet-stream";
const PAGES = new Set(["/", "/live", "/clip", "/faces", "/groups", "/ai"]);
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".mp4": "video/mp4",
  ".ico": "image/x-icon",
};

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(ROOT, "public");
const clipsDir = path.join(ROOT, "data", "clips");

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function fail(err) {
  const status = err?.status || 500;
  return json({ error: String(err?.message || err) }, status);
}

function text(body, status = 200, type = "text/plain; charset=utf-8") {
  return new Response(body, { status, headers: { "content-type": type } });
}

function bytes(buf, type, headers = {}) {
  return new Response(buf, { status: 200, headers: { "content-type": type, ...headers } });
}

async function bodyJson(request) {
  const raw = await request.text();
  if (!raw) return {};
  return JSON.parse(raw);
}

function qnum(url, key) {
  const v = url.searchParams.get(key);
  if (v == null || v === "") return undefined;
  return Number(v);
}

function match(pathname, pattern) {
  const want = pattern.split("/").filter(Boolean);
  const got = pathname.split("/").filter(Boolean);
  if (want.length !== got.length) return null;
  const params = {};
  for (let i = 0; i < want.length; i += 1) {
    if (want[i].startsWith(":")) params[want[i].slice(1)] = decodeURIComponent(got[i]);
    else if (want[i] !== got[i]) return null;
  }
  return params;
}

function sampleRate(url) {
  const n = Number(url.searchParams.get("ar"));
  if (n === 8000 || n === 16000 || n === 44100 || n === 48000) return n;
  return 48000;
}

function clipSeconds(start, end) {
  const a = Date.parse(start);
  const b = Date.parse(end);
  if (Number.isFinite(a) && Number.isFinite(b) && b > a) return Math.max(1, (b - a) / 1000);
  return 10;
}

function ffmpegResponse(args, mimeType, request) {
  const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "ignore"] });
  const stop = () => {
    if (!proc.killed) proc.kill("SIGKILL");
  };
  request.signal.addEventListener("abort", stop, { once: true });
  proc.once("error", stop);
  if (!proc.stdout) {
    stop();
    return text("ffmpeg failed", 500);
  }
  return new Response(Readable.toWeb(proc.stdout), {
    headers: {
      "content-type": mimeType,
      "cache-control": "no-cache, no-store",
    },
  });
}

async function clipPlayback(url) {
  const start = url.searchParams.get("start");
  const end = url.searchParams.get("end");
  const cam = await getCamera(url.searchParams.get("cam"));
  if (!start || !end || !cam?.host) return null;
  return {
    rtsp: playbackUri({
      username: cam.username,
      password: cam.password,
      hostname: cam.host,
      start,
      end,
    }),
    duration: clipSeconds(start, end),
  };
}

async function ensurePtzFlags(cameras) {
  const out = [];
  for (const cam of cameras) {
    if (typeof cam.ptz === "boolean") {
      out.push(cam);
      continue;
    }
    try {
      const caps = await detectPtz(cam.id, cam.ptzChannel || "CH1");
      out.push(await updateCamera(cam.id, caps));
    } catch {
      out.push(await updateCamera(cam.id, { ptz: false }));
    }
  }
  return out;
}

function inside(root, file) {
  const rel = path.relative(root, file);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

async function sendFile(file, headers = {}) {
  const buf = await readFile(file);
  const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
  return bytes(buf, type, headers);
}

async function streamFile(file) {
  const info = await stat(file);
  const type = MIME[path.extname(file).toLowerCase()] || "application/octet-stream";
  return new Response(Readable.toWeb(createReadStream(file)), {
    headers: {
      "content-type": type,
      "content-length": String(info.size),
    },
  });
}

async function handleStatic(pathname) {
  if (PAGES.has(pathname) || pathname === "") {
    return sendFile(path.join(publicDir, "index.html"));
  }
  const rel = decodeURIComponent(pathname).replace(/^\/+/, "");
  const file = path.normalize(path.join(publicDir, rel));
  if (!inside(publicDir, file)) return text("forbidden", 403);
  try {
    return await sendFile(file);
  } catch {
    return text("not found", 404);
  }
}

async function handleMedia(request, url, pathname) {
  const streamCam = match(pathname, "/stream/:cam");
  if (streamCam) {
    const cam = await getCamera(streamCam.cam);
    if (!cam) return text("unknown camera", 404);
    const rtsp = getRtspUrl(cam, 0);
    const { hw } = await liveDecodeMode();
    return ffmpegResponse(liveVideoArgs(rtsp, hw), MJPEG, request);
  }
  const audioCam = match(pathname, "/stream-audio/:cam");
  if (audioCam) {
    const cam = await getCamera(audioCam.cam);
    if (!cam) return text("unknown camera", 404);
    return ffmpegResponse(audioArgs(getRtspUrl(cam, 1), { sampleRate: sampleRate(url) }), PCM, request);
  }
  if (pathname === "/clip-stream" || pathname === "/clip-audio") {
    const clip = await clipPlayback(url);
    if (!clip) return text("cam, start, and end required", 400);
    if (pathname === "/clip-stream") {
      return ffmpegResponse(clipVideoArgs(clip.rtsp, clip.duration), MJPEG, request);
    }
    return ffmpegResponse(
      audioArgs(clip.rtsp, { duration: clip.duration, sampleRate: sampleRate(url) }),
      PCM,
      request,
    );
  }
  if (pathname === "/save-clip") {
    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");
    if (!start || !end) return json({ error: "start and end query params required" }, 400);
    const file = await saveClip({
      cam: url.searchParams.get("cam"),
      start,
      end,
      outDir: clipsDir,
    });
    return json({ file: `/clips/${path.basename(file)}` });
  }
  const clipFile = match(pathname, "/clips/:file");
  if (clipFile) {
    const file = path.join(clipsDir, path.basename(clipFile.file));
    if (!inside(clipsDir, file)) return text("forbidden", 403);
    try {
      return await streamFile(file);
    } catch {
      return text("not found", 404);
    }
  }
  return null;
}

async function handleApi(request, url, pathname) {
  const method = request.method.toUpperCase();
  const p = (pattern) => match(pathname, pattern);

  if (method === "GET" && pathname === "/api/health") return json({ message: "Electron is up" });

  if (method === "GET" && pathname === "/api/cameras") {
    return json(publicCameras(await ensurePtzFlags(await loadCameras())));
  }
  if (method === "POST" && pathname === "/api/cameras") {
    const body = await bodyJson(request);
    const name = String(body.name || "").trim();
    const host = String(body.host || "").trim();
    const username = String(body.username || "").trim();
    const password = String(body.password ?? "");
    if (!name || !host || !username) return json({ error: "name, host, and username required" }, 400);
    const camera = await addCamera(name, host, username, password);
    let caps;
    try {
      caps = await detectPtz(camera.id);
    } catch {
      caps = { ptz: false };
    }
    return json(publicCameras([await updateCamera(camera.id, caps)])[0]);
  }
  if (method === "GET" && pathname === "/api/cameras/scan") {
    return json({ hosts: await scanCameras() });
  }
  let m = p("/api/cameras/:id");
  if (m && method === "DELETE") return json(await removeCamera(m.id));

  m = p("/api/cameras/:id/ptz");
  if (m && method === "GET") return json(await getPtzState(m.id));
  m = p("/api/cameras/:id/ptz/zoom");
  if (m && method === "POST") {
    const body = await bodyJson(request);
    return json(await setZoom(m.id, body.zoom, {
      zoomStep: body.zoomStep,
      focusStep: body.focusStep,
      speed: body.speed,
    }));
  }
  m = p("/api/cameras/:id/ptz/focus");
  if (m && method === "POST") {
    const body = await bodyJson(request);
    return json(await setFocus(m.id, body.focus, {
      zoomStep: body.zoomStep,
      focusStep: body.focusStep,
      speed: body.speed,
    }));
  }
  m = p("/api/cameras/:id/ptz/autofocus");
  if (m && method === "POST") {
    const body = await bodyJson(request);
    return json(await autoFocus(m.id, {
      zoomStep: body.zoomStep,
      focusStep: body.focusStep,
      speed: body.speed,
      state: body.state,
    }));
  }
  m = p("/api/cameras/:id/ptz/restore");
  if (m && method === "POST") return json(await restorePtz(m.id));
  m = p("/api/cameras/:id/ptz/refresh");
  if (m && method === "POST") return json(await refreshPtz(m.id));

  m = p("/api/cameras/:id/events");
  if (m && method === "GET") return json(await getEventSettings(m.id, url.searchParams.get("channel")));
  if (m && method === "POST") return json(await setEventSettings(m.id, await bodyJson(request)));
  m = p("/api/cameras/:id/events/:ability");
  if (m && method === "GET") return json(await getEventConfig(m.id, m.ability, url.searchParams.get("channel")));
  if (m && method === "POST") {
    return json(await setEventConfig(m.id, { ...(await bodyJson(request)), ability: m.ability }));
  }

  m = p("/api/cameras/:id/osd");
  if (m && method === "GET") return json(await getOsdSettings(m.id, url.searchParams.get("channel")));
  if (m && method === "POST") return json(await setOsdSettings(m.id, await bodyJson(request)));
  m = p("/api/cameras/:id/video-cover");
  if (m && method === "GET") return json(await getVideoCover(m.id, url.searchParams.get("channel")));
  if (m && method === "POST") return json(await setVideoCover(m.id, await bodyJson(request)));
  m = p("/api/cameras/:id/disk");
  if (m && method === "GET") return json(await getDiskSettings(m.id));
  if (m && method === "POST") return json(await setDiskSettings(m.id, await bodyJson(request)));
  m = p("/api/cameras/:id/network");
  if (m && method === "GET") return json(await getNetworkSettings(m.id));
  if (m && method === "POST") return json(await setNetworkSettings(m.id, await bodyJson(request)));
  m = p("/api/cameras/:id/network/test");
  if (m && method === "POST") {
    const body = await bodyJson(request);
    return json(await testNetworkAddress(m.id, body.ip_address));
  }

  if (method === "GET" && pathname === "/api/faces") {
    const result = await listSnappedFaces({
      cam: url.searchParams.get("cam"),
      offset: qnum(url, "offset") || 0,
      limit: qnum(url, "limit"),
      start: qnum(url, "start"),
      end: qnum(url, "end"),
      names: url.searchParams.get("names"),
      date: url.searchParams.get("date"),
      gender: url.searchParams.get("gender"),
      age: url.searchParams.get("age"),
      glasses: url.searchParams.get("glasses"),
      mask: url.searchParams.get("mask"),
      expression: url.searchParams.get("expression"),
    });
    return json(result, 200, { "cache-control": "no-store" });
  }
  m = p("/api/snaps/:uuid");
  if (m && method === "GET") {
    try {
      const jpeg = await getSnapJpeg(m.uuid, url.searchParams.get("cam"));
      return bytes(jpeg, "image/jpeg", { "cache-control": "public, max-age=86400, immutable" });
    } catch (err) {
      if (err.message === "no FaceImage") return text("not found", 404);
      throw err;
    }
  }

  if (pathname === "/api/ai") {
    if (method === "GET") return json(await getAiState(url.searchParams.get("cam")));
    if (method === "POST") return json(await saveAreaZone(await bodyJson(request)));
    if (method === "DELETE") {
      const body = await bodyJson(request).catch(() => ({}));
      return json(await clearAreaZone(url.searchParams.get("cam") || body.cam));
    }
  }
  if (method === "POST" && pathname === "/api/ai/models") {
    return json({ models: await setAiModels(await bodyJson(request)) });
  }
  if (pathname === "/api/ai/line") {
    if (method === "POST") return json(await saveLineCross(await bodyJson(request)));
    if (method === "DELETE") {
      const body = await bodyJson(request).catch(() => ({}));
      return json(await clearLineCross(url.searchParams.get("cam") || body.cam));
    }
  }

  if (method === "GET" && pathname === "/api/groups") return json(await listGroups());
  if (method === "POST" && pathname === "/api/groups") {
    const body = await bodyJson(request);
    return json(await addGroup(body.name));
  }
  m = p("/api/groups/:id");
  if (m && method === "PATCH") return json(await modifyGroup(m.id, await bodyJson(request)));
  if (m && method === "DELETE") {
    return json(await removeGroup(m.id, { name: url.searchParams.get("name") }));
  }
  m = p("/api/groups/:id/faces");
  if (m && method === "GET") return json(await listGroupFaces(m.id));
  if (m && method === "POST") {
    const body = await bodyJson(request);
    if (body.uuid) return json(await addCapturedFaces({ ...body, grpId: m.id }));
    return json(await addImportedFaces({ ...body, grpId: m.id }));
  }
  m = p("/api/groups/:grpId/faces/:id/image");
  if (m && method === "GET") return bytes(await getFaceJpeg(m.id), "image/jpeg");
  m = p("/api/groups/:grpId/faces/:id");
  if (m && method === "PATCH") {
    return json(await modifyFace({ ...(await bodyJson(request)), id: m.id, grpId: m.grpId }));
  }
  if (m && method === "DELETE") return json(await removeFace({ id: m.id, grpId: m.grpId }));

  return null;
}

export async function handleRequest(request) {
  const url = new URL(request.url);
  let pathname = decodeURIComponent(url.pathname || "/");
  if (url.hostname === "stream" || url.hostname === "stream-audio") {
    pathname = `/${url.hostname}${pathname === "/" ? "" : pathname}`;
  } else if (url.hostname === "clip-stream" || url.hostname === "clip-audio") {
    pathname = `/${url.hostname}`;
  }
  if (!pathname.startsWith("/")) pathname = `/${pathname}`;

  try {
    const media = await handleMedia(request, url, pathname);
    if (media) return media;
    const api = await handleApi(request, url, pathname);
    if (api) return api;
    if (pathname.startsWith("/api/") || request.method.toUpperCase() !== "GET") {
      return json({ error: "not found" }, 404);
    }
    return handleStatic(pathname);
  } catch (err) {
    console.error(err);
    if (pathname.startsWith("/api/") || pathname === "/save-clip") return fail(err);
    return text(String(err.message || err), err.status || 500);
  }
}
