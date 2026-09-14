import { getSession } from "./cameraSession.js";
import { getCamera } from "./addCamera.js";

const PTZ_GET = "/API/PreviewChannel/PTZ/Get";
const PTZ_RANGE = "/API/PreviewChannel/PTZ/Range";
const PTZ_CONTROL = "/API/PreviewChannel/PTZ/Control";
const PTZ_PROGRESS = "/API/PreviewChannel/PTZ/Control/Progress";
const DEFAULT_SPEED = 100;
const DEFAULT_CHANNEL = "CH1";

const lastPos = new Map();

function rememberPos(camId, pos) {
  if (pos) lastPos.set(camId, pos);
  return pos;
}

function assertOk(res) {
  if (res?.result === "failed" || res?.error_code) {
    throw new Error(res.reason || res.error_code || "ptz request failed");
  }
  return res;
}

function intItems(field, fallback = [1, 5, 20]) {
  const items = field?.items;
  if (!Array.isArray(items) || !items.length) return fallback;
  return items.map(Number).filter(Number.isFinite);
}

export function supportsOpticalZoom(range) {
  if (!range) return false;
  const max = Number(range.zoom_slider?.max ?? 0);
  return Boolean(range.zoom_minus_add) && max > 0;
}

export function summarizePtzRange(range, channel = DEFAULT_CHANNEL) {
  if (!supportsOpticalZoom(range)) {
    return {
      ptz: false,
      ptzChannel: channel,
      zoomMin: 0,
      zoomMax: 0,
      focusMin: 0,
      focusMax: 0,
      zoomSteps: [1, 5, 20],
      focusSteps: [1, 5, 20],
    };
  }
  return {
    ptz: true,
    ptzChannel: range.channel || channel,
    zoomMin: Number(range.zoom_slider?.min ?? 0),
    zoomMax: Number(range.zoom_slider?.max ?? 0),
    focusMin: Number(range.focus_slider?.min ?? 0),
    focusMax: Number(range.focus_slider?.max ?? 0),
    zoomSteps: intItems(range.zoom_step),
    focusSteps: intItems(range.focus_step),
  };
}

export async function getPtzRange(camId, channel = DEFAULT_CHANNEL) {
  const session = await getSession(camId);
  const res = await session.post(PTZ_RANGE, { channel });
  if (res?.result === "failed" || res?.error_code) return null;
  return res.data ?? null;
}

export async function detectPtz(camId, channel = DEFAULT_CHANNEL) {
  try {
    const range = await getPtzRange(camId, channel);
    return summarizePtzRange(range, channel);
  } catch {
    return summarizePtzRange(null, channel);
  }
}

async function requirePtzCamera(camId) {
  const cam = await getCamera(camId);
  if (!cam) {
    const err = new Error("unknown camera");
    err.status = 404;
    throw err;
  }
  if (cam.ptz !== true) {
    const err = new Error("camera does not support PTZ");
    err.status = 400;
    throw err;
  }
  return {
    cam,
    channel: cam.ptzChannel || DEFAULT_CHANNEL,
  };
}

export async function getPtzPosition(camId, channel = DEFAULT_CHANNEL) {
  const session = await getSession(camId);
  const post = session.postNow || session.post;
  const res = assertOk(await post(PTZ_GET, { channel }));
  return rememberPos(camId, {
    channel: res.data?.channel ?? channel,
    zoom_slider: res.data?.zoom_slider,
    focus_slider: res.data?.focus_slider,
  });
}

function isCtl(value) {
  if (value === true || value === 1) return true;
  if (typeof value === "string") return /^(1|true|yes|on)$/i.test(value.trim());
  return false;
}

export async function getPtzProgress(camId) {
  const { channel } = await requirePtzCamera(camId);
  const session = await getSession(camId);
  const post = session.postNow || session.post;
  const res = assertOk(await post(PTZ_PROGRESS, { channel }));
  return {
    channel: res.data?.channel ?? channel,
    isctl: isCtl(res.data?.isctl),
  };
}

async function knownPos(camId, channel) {
  return lastPos.get(camId) || getPtzPosition(camId, channel);
}

async function sendPtz(camId, channel, body, pos) {
  const session = await getSession(camId);
  const post = session.postNow || session.post;
  assertOk(await post(PTZ_CONTROL, { channel, speed: DEFAULT_SPEED, ...body }));
  return rememberPos(camId, { channel, ...pos });
}

export async function setZoom(camId, zoom, {
  focusStep = 1,
  zoomStep = 1,
  speed = DEFAULT_SPEED,
  focus,
} = {}) {
  const { channel: ch } = await requirePtzCamera(camId);
  const target = Number(zoom);
  if (!Number.isFinite(target)) throw new Error("zoom required");
  const focusAt = Number.isFinite(Number(focus))
    ? Number(focus)
    : (await knownPos(camId, ch)).focus_slider;
  return sendPtz(camId, ch, {
    cmd: "Ptz_Zoom_Position",
    focus_slider: focusAt,
    focus_step: focusStep,
    speed,
    zoom_slider: target,
    zoom_step: zoomStep,
  }, { zoom_slider: target, focus_slider: focusAt });
}

export async function setFocus(camId, focus, {
  focusStep = 1,
  zoomStep = 1,
  speed = DEFAULT_SPEED,
  zoom,
} = {}) {
  const { channel: ch } = await requirePtzCamera(camId);
  const target = Number(focus);
  if (!Number.isFinite(target)) throw new Error("focus required");
  const zoomAt = Number.isFinite(Number(zoom))
    ? Number(zoom)
    : (await knownPos(camId, ch)).zoom_slider;
  return sendPtz(camId, ch, {
    cmd: "Ptz_Focus_Position",
    focus_slider: target,
    focus_step: focusStep,
    speed,
    zoom_slider: zoomAt,
    zoom_step: zoomStep,
  }, { zoom_slider: zoomAt, focus_slider: target });
}

export async function autoFocus(camId, {
  focusStep = 1,
  zoomStep = 1,
  speed = DEFAULT_SPEED,
  state = "",
} = {}) {
  const { channel: ch } = await requirePtzCamera(camId);
  const current = await knownPos(camId, ch);
  return sendPtz(camId, ch, {
    cmd: "Ptz_Btn_AutoFocus",
    focus_slider: current.focus_slider,
    focus_step: focusStep,
    speed,
    state,
    zoom_slider: current.zoom_slider,
    zoom_step: zoomStep,
  }, current);
}

export async function restorePtz(camId, {
  focusStep = 1,
  zoomStep = 1,
  speed = DEFAULT_SPEED,
} = {}) {
  const { channel: ch } = await requirePtzCamera(camId);
  const current = await knownPos(camId, ch);
  return sendPtz(camId, ch, {
    cmd: "Ptz_Btn_Default",
    focus_slider: current.focus_slider,
    focus_step: focusStep,
    speed,
    zoom_slider: current.zoom_slider,
    zoom_step: zoomStep,
  }, current);
}

export async function refreshPtz(camId, {
  focusStep = 1,
  zoomStep = 1,
  speed = DEFAULT_SPEED,
} = {}) {
  const { channel: ch } = await requirePtzCamera(camId);
  const current = await knownPos(camId, ch);
  await sendPtz(camId, ch, {
    cmd: "Ptz_Btn_Refresh",
    focus_slider: current.focus_slider,
    focus_step: focusStep,
    speed,
    zoom_slider: current.zoom_slider,
    zoom_step: zoomStep,
  }, current);
  return getPtzPosition(camId, ch);
}

export async function getPtzState(camId) {
  const { cam, channel } = await requirePtzCamera(camId);
  const pos = await getPtzPosition(camId, channel);
  return {
    id: cam.id,
    channel,
    zoom_slider: pos.zoom_slider,
    focus_slider: pos.focus_slider,
    zoomMin: cam.zoomMin ?? 0,
    zoomMax: cam.zoomMax ?? 0,
    focusMin: cam.focusMin ?? 0,
    focusMax: cam.focusMax ?? 0,
    zoomSteps: cam.zoomSteps ?? [1, 5, 20],
    focusSteps: cam.focusSteps ?? [1, 5, 20],
  };
}
