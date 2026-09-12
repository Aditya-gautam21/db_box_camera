const view = document.getElementById("view");
const statusEl = document.getElementById("status");
const liveBtn = document.getElementById("btn-live");
const clipBtn = document.getElementById("btn-clip");
const facesBtn = document.getElementById("btn-faces");
const groupsBtn = document.getElementById("btn-groups");
const aiBtn = document.getElementById("btn-ai");
const clipForm = document.getElementById("clip-form");
const player = document.getElementById("player");
const livePage = document.getElementById("live-page");
const liveDash = document.getElementById("live-dash");
const livePager = document.getElementById("live-pager");
const livePageLabel = document.getElementById("live-page-label");
const btnLivePrev = document.getElementById("btn-live-prev");
const btnLiveNext = document.getElementById("btn-live-next");
const LIVE_PAGE_SIZE = 4;
let liveCameras = [];
let liveDashPage = 0;
const cameraModal = document.getElementById("camera-modal");
const cameraForm = document.getElementById("camera-form");
const facesGallery = document.getElementById("faces-gallery");
const groupsPage = document.getElementById("groups-page");
const aiPage = document.getElementById("ai-page");
const facesGrid = document.getElementById("faces-grid");
const facesEmpty = document.getElementById("faces-empty");
const facesCam = document.getElementById("faces-cam");
const facesDate = document.getElementById("faces-date");
const snapsCam = document.getElementById("snaps-cam");
const facesPageEl = document.getElementById("faces-page");
const btnFacesPrev = document.getElementById("btn-faces-prev");
const btnFacesNext = document.getElementById("btn-faces-next");
const groupsList = document.getElementById("groups-list");
const groupsEmpty = document.getElementById("groups-empty");
const btnAddGroup = document.getElementById("btn-add-group");
const btnSaveGroups = document.getElementById("btn-save-groups");
const btnRefreshGroups = document.getElementById("btn-refresh-groups");
const groupModal = document.getElementById("group-modal");
const groupModalTitle = document.getElementById("group-modal-title");
const importModal = document.getElementById("import-modal");
const snapsModal = document.getElementById("snaps-modal");
const faceFileInput = document.getElementById("face-file");
const editFaceImg = document.getElementById("edit-face-img");
const editFaceEmpty = document.getElementById("edit-face-empty");
const editFacePage = document.getElementById("edit-face-page");
const modalSnapsGrid = document.getElementById("modal-snaps-grid");
const modalSnapsEmpty = document.getElementById("modal-snaps-empty");
const snapsSameName = document.getElementById("snaps-same-name");
const snapsSharedName = document.getElementById("snaps-shared-name");
const btnAddSnaps = document.getElementById("btn-add-snaps");
const btnCloseModal = document.getElementById("btn-close-modal");
const faceFields = {
  name: document.getElementById("edit-face-name"),
  gender: document.getElementById("edit-face-gender"),
  age: document.getElementById("edit-face-age"),
  country: document.getElementById("edit-face-country"),
  nation: document.getElementById("edit-face-nation"),
  nativePlace: document.getElementById("edit-face-native"),
  idCode: document.getElementById("edit-face-idcode"),
  job: document.getElementById("edit-face-job"),
  phone: document.getElementById("edit-face-phone"),
  email: document.getElementById("edit-face-email"),
  domicile: document.getElementById("edit-face-domicile"),
  remark: document.getElementById("edit-face-remark"),
};
const startInput = document.getElementById("start");
const endInput = document.getElementById("end");
const liveDot = document.getElementById("live-dot");
const modeLabel = document.getElementById("mode-label");
const rawLink = document.getElementById("raw-link");
const transport = document.getElementById("transport");
const btnPlay = document.getElementById("btn-play");
const btnMute = document.getElementById("btn-mute");
const btnBack = document.getElementById("btn-back");
const btnFwd = document.getElementById("btn-fwd");
const seekEl = document.getElementById("seek");
const timeLabel = document.getElementById("time-label");
const btnFs = document.getElementById("btn-fs");

let endTimer;
let tickTimer;
let clipGen = 0;
let clipSeekTimer;
let clipAudioTimer;
let audioAbort;
let audioCtx;
let audioGain;
let audioNextTime = 0;
let muted = false;
let playback = null;
let clipFirstFrameHandler = null;
let seekDragging = false;
let onPlaybackEnded = null;
let facesPoll;
let editingGrpId = null;
let groupPeople = [];
let faceIndex = 0;
let faceDirty = false;
let snapPage = 0;
let snapTotal = 0;
let snapPageSize = 24;
let snapFetchId = 0;
let snapResizeTimer;
let facesPageSize = 12;
let facesPage = 0;
let facesTotal = 0;
let facesFetchId = 0;
let facesResizeTimer;
let lastCamId = "";
const snapSelected = new Set();
let aiPoll = null;
let aiBound = false;
let aiDrawMode = false;
let aiDraft = null;
let aiModel = "area_intrusion";
let aiModels = {
  area_intrusion: true,
  line_cross: true,
  fall: true,
  fire: true,
  face: false,
};
let aiZone = { a: null, b: null, cam: null };
let aiLine = { a: null, b: null, side: null, cam: null };

const AI_MODEL_LIST = [
  { id: "area_intrusion", label: "Area intrusion", draw: "box" },
  { id: "line_cross", label: "Line crossing", draw: "line" },
  { id: "fall", label: "Fall", draw: null },
  { id: "fire", label: "Fire", draw: null },
  { id: "face", label: "Face", draw: null },
];

function localInputValue(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

function fillClipRange(minutes) {
  const end = new Date();
  const start = new Date(end.getTime() - minutes * 60 * 1000);
  startInput.value = localInputValue(start);
  endInput.value = localInputValue(end);
}

function toCameraTime(localValue) {
  if (!localValue) return "";
  const withSeconds = localValue.length === 16 ? `${localValue}:00` : localValue;
  return `${withSeconds}Z`;
}

function fromCameraTime(value) {
  return String(value || "").replace(/Z$/, "");
}

function stopAudio() {
  audioAbort?.abort();
  audioAbort = null;
  audioNextTime = 0;
  audioGain = null;
  if (audioCtx) {
    audioCtx.close().catch(() => {});
    audioCtx = null;
  }
}

function setMuteUi() {
  btnMute.textContent = muted ? "Unmute" : "Mute";
  btnMute.title = muted ? "Unmute" : "Mute";
  btnMute.setAttribute("aria-pressed", muted ? "true" : "false");
  for (const btn of document.querySelectorAll(".live-tile-mute")) {
    btn.textContent = muted ? "Unmute" : "Mute";
    btn.setAttribute("aria-pressed", muted ? "true" : "false");
  }
}

function setMuted(next) {
  muted = Boolean(next);
  if (audioGain) audioGain.gain.value = muted ? 0 : 1;
  setMuteUi();
}

function toggleMute() {
  setMuted(!muted);
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function cameraStamp(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`;
}

function formatClock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

function currentPos() {
  if (!playback || playback.kind !== "clip") return 0;
  if (playback.paused || playback.startedAt == null) return playback.offsetMs;
  return Math.min(playback.durationMs, playback.offsetMs + (performance.now() - playback.startedAt));
}

function freezeFrame() {
  try {
    if (!view.naturalWidth) {
      view.removeAttribute("src");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = view.naturalWidth;
    canvas.height = view.naturalHeight;
    canvas.getContext("2d").drawImage(view, 0, 0);
    view.src = canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    view.removeAttribute("src");
  }
}

function stopTick() {
  clearInterval(tickTimer);
  tickTimer = null;
}

function updateSeekUi() {
  if (!playback || playback.kind !== "clip") return;
  const pos = currentPos();
  if (!seekDragging) seekEl.value = String(Math.floor(pos));
  timeLabel.textContent = `${formatClock(pos)} / ${formatClock(playback.durationMs)}`;
}

function startTick() {
  stopTick();
  updateSeekUi();
  tickTimer = setInterval(updateSeekUi, 250);
}

function setPausedUi(paused) {
  btnPlay.textContent = paused ? "Play" : "Pause";
}

function setTransport(kind) {
  transport.hidden = !kind;
  transport.classList.toggle("live", kind === "live");
  if (kind !== "clip") stopTick();
}

function playFeed(videoUrl) {
  stopAudio();
  view.src = videoUrl;
}

function stopView() {
  clipGen += 1;
  clearTimeout(clipSeekTimer);
  clearTimeout(clipAudioTimer);
  clearTimeout(endTimer);
  stopTick();
  stopAudio();
  if (clipFirstFrameHandler) {
    view.removeEventListener("load", clipFirstFrameHandler);
    clipFirstFrameHandler = null;
  }
  view.removeAttribute("src");
  playback = null;
  onPlaybackEnded = null;
  setTransport(null);
}

function stopLiveDash() {
  for (const img of liveDash.querySelectorAll("img")) img.removeAttribute("src");
  liveDash.replaceChildren();
}

function focusedLiveTile() {
  const fs = document.fullscreenElement || document.webkitFullscreenElement;
  return fs?.classList?.contains("live-tile") ? fs : null;
}

function syncLiveTileFs() {
  const tile = focusedLiveTile();
  for (const el of liveDash.querySelectorAll(".live-tile")) {
    el.classList.toggle("is-fs", el === tile);
  }
  return tile;
}

function openLiveTile(tile) {
  if (focusedLiveTile() === tile) {
    tile.classList.add("is-fs");
    return;
  }
  tile.classList.add("is-fs");
  const enter = tile.requestFullscreen || tile.webkitRequestFullscreen;
  enter?.call(tile);
}

function liveTileImg(tile) {
  return tile.querySelector(".live-stage > img");
}

function pauseLiveTileStream(tile, pause) {
  const img = liveTileImg(tile);
  if (!img || !tile.dataset.cam) return;
  const src = `/stream/${encodeURIComponent(tile.dataset.cam)}`;
  if (pause) {
    img.removeAttribute("src");
    return;
  }
  if (img.getAttribute("src") !== src) img.src = src;
}

function onLiveTileFullscreen() {
  const tile = syncLiveTileFs();
  if (!tile) {
    for (const el of liveDash.querySelectorAll(".live-tile")) {
      el.classList.remove("settings-open", "is-fs");
      el.querySelector(".live-tile-settings")?.classList.remove("active");
      el.querySelector(".live-tile-settings")?.setAttribute("aria-pressed", "false");
      el._closeEvents?.();
      pauseLiveTileStream(el, false);
    }
    if (document.body.dataset.page === "live") stopAudio();
    return;
  }
  for (const el of liveDash.querySelectorAll(".live-tile")) {
    pauseLiveTileStream(el, el !== tile);
  }
  const cam = tile.dataset.cam;
  const label = tile.dataset.label || cam;
  statusEl.textContent = `Live · ${label}`;
  modeLabel.textContent = `Live · ${label}`;
  startPcmAudio(`/stream-audio/${cam}`);
}

function cameraName(cam) {
  return cam.name || cam.label || cam.id;
}

function camQuery(select) {
  const id = select?.value;
  return id ? `&cam=${encodeURIComponent(id)}` : "";
}

function localDateValue(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

function facesDateValue() {
  return facesDate?.value || localDateValue();
}

function facesDateQuery() {
  const v = facesDateValue();
  return v ? `&date=${encodeURIComponent(v)}` : "";
}

function syncFacesDateUi() {
  if (!facesDate) return;
  const today = localDateValue();
  if (!facesDate.value) facesDate.value = today;
  facesDate.max = today;
  const next = document.getElementById("btn-faces-date-next");
  if (next) next.disabled = facesDate.value >= today;
}

function shiftFacesDate(days) {
  const d = new Date(`${facesDateValue()}T12:00:00`);
  d.setDate(d.getDate() + days);
  const next = localDateValue(d);
  if (next > localDateValue()) return;
  facesDate.value = next;
  syncFacesDateUi();
  facesPage = 0;
  loadFaces();
}

function facesFilterQuery() {
  const form = document.getElementById("faces-filter-form");
  if (!form) return "";
  const params = new URLSearchParams();
  for (const name of ["gender", "age", "glasses", "mask", "expression"]) {
    for (const input of form.querySelectorAll(`input[name="${name}"]:checked`)) {
      params.append(name, input.value);
    }
  }
  const q = params.toString();
  return q ? `&${q}` : "";
}

function facesFilterActive() {
  const form = document.getElementById("faces-filter-form");
  if (!form) return false;
  return ["gender", "age", "glasses", "mask", "expression"].some(
    (name) => form.querySelectorAll(`input[name="${name}"]:checked`).length > 0,
  );
}

function facesFilterSummary() {
  const form = document.getElementById("faces-filter-form");
  if (!form) return "Please Select";
  const labels = [];
  for (const name of ["gender", "age", "glasses", "mask", "expression"]) {
    const checked = [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((el) => {
      const text = el.closest("label")?.textContent?.trim();
      return text || el.value;
    });
    if (checked.length) labels.push(...checked);
  }
  if (!labels.length) return "Please Select";
  if (labels.length <= 2) return labels.join(", ");
  return `${labels.slice(0, 2).join(", ")} +${labels.length - 2}`;
}

function syncFacesFilterButton() {
  if (btnFacesFilter) btnFacesFilter.textContent = facesFilterSummary();
}

async function fillCamSelect(select, selectedId) {
  const prev = selectedId || select.value || lastCamId;
  const res = await fetch("/api/cameras");
  const cams = await res.json();
  if (!res.ok || !Array.isArray(cams)) {
    throw new Error(cams.error || "Could not load cameras");
  }
  select.replaceChildren();
  if (!cams.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No cameras";
    select.append(opt);
    return cams;
  }
  for (const cam of cams) {
    const opt = document.createElement("option");
    opt.value = cam.id;
    opt.textContent = cameraName(cam);
    select.append(opt);
  }
  if (prev && [...select.options].some((o) => o.value === prev)) select.value = prev;
  if (select.value) lastCamId = select.value;
  return cams;
}

function fillStepSelect(select, steps, preferred = 1) {
  select.replaceChildren();
  const list = Array.isArray(steps) && steps.length ? steps : [1, 5, 20];
  for (const step of list) {
    const opt = document.createElement("option");
    opt.value = String(step);
    opt.textContent = String(step);
    select.append(opt);
  }
  select.value = list.includes(preferred) ? String(preferred) : String(list[0]);
}

function applyPtzSliders(panel, pos) {
  if (!panel || !pos) return;
  const zoom = panel.querySelector("[data-ptz-zoom]");
  const focus = panel.querySelector("[data-ptz-focus]");
  if (zoom && pos.zoom_slider != null) zoom.value = String(pos.zoom_slider);
  if (focus && pos.focus_slider != null) focus.value = String(pos.focus_slider);
}

async function ptzPost(camId, action, body = {}) {
  const res = await fetch(`/api/cameras/${encodeURIComponent(camId)}/ptz/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `PTZ ${action} failed`);
  return data;
}

async function syncPtzPanel(tile) {
  const panel = tile.querySelector(".ptz-panel");
  if (!panel || panel.dataset.busy === "1") return;
  try {
    const res = await fetch(`/api/cameras/${encodeURIComponent(tile.dataset.cam)}/ptz`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not load PTZ");
    applyPtzSliders(panel, data);
  } catch (err) {
    statusEl.textContent = String(err.message || err);
  }
}

function makePtzPanel(cam, tile) {
  const panel = document.createElement("aside");
  panel.className = "ptz-panel";
  panel.hidden = true;
  panel.addEventListener("click", (event) => event.stopPropagation());
  panel.addEventListener("pointerdown", (event) => event.stopPropagation());

  const head = document.createElement("div");
  head.className = "ptz-panel-head";
  head.textContent = "PTZ";

  const body = document.createElement("div");
  body.className = "ptz-panel-body";

  function makeAxis(kind, label, min, max, steps) {
    const wrap = document.createElement("div");
    wrap.className = "ptz-axis";
    const title = document.createElement("div");
    title.className = "ptz-axis-title";
    title.textContent = label;
    const row = document.createElement("div");
    row.className = "ptz-axis-row";
    const stepLabel = document.createElement("label");
    stepLabel.className = "ptz-step";
    stepLabel.append("Step ");
    const stepSelect = document.createElement("select");
    stepSelect.dataset[`ptz${kind}Step`] = "1";
    fillStepSelect(stepSelect, steps);
    stepLabel.append(stepSelect);
    const controls = document.createElement("div");
    controls.className = "ptz-slider-row";
    const minus = document.createElement("button");
    minus.type = "button";
    minus.className = "ptz-nudge";
    minus.textContent = "−";
    minus.setAttribute("aria-label", `Decrease ${label.toLowerCase()}`);
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = String(min ?? 0);
    slider.max = String(max ?? 0);
    slider.value = String(min ?? 0);
    slider.dataset[`ptz${kind}`] = "1";
    const plus = document.createElement("button");
    plus.type = "button";
    plus.className = "ptz-nudge";
    plus.textContent = "+";
    plus.setAttribute("aria-label", `Increase ${label.toLowerCase()}`);
    const nudge = (dir, event) => {
      event?.preventDefault();
      event?.stopPropagation();
      if (busy) return;
      const step = Number(stepSelect.value) || 1;
      const cur = Number(slider.value);
      const lo = Number(slider.min);
      const hi = Number(slider.max);
      if (!(hi > lo)) return;
      const next = Math.min(hi, Math.max(lo, cur + dir * step));
      if (next === cur) return;
      slider.value = String(next);
      slider.dispatchEvent(new Event("change", { bubbles: true }));
    };
    minus.addEventListener("click", (event) => nudge(-1, event));
    plus.addEventListener("click", (event) => nudge(1, event));
    controls.append(minus, slider, plus);
    row.append(stepLabel, controls);
    wrap.append(title, row);
    return { wrap, slider, stepSelect };
  }

  const zoomAxis = makeAxis("Zoom", "ZOOM", cam.zoomMin, cam.zoomMax, cam.zoomSteps);
  const focusAxis = makeAxis("Focus", "FOCUS", cam.focusMin, cam.focusMax, cam.focusSteps);

  const actions = document.createElement("div");
  actions.className = "ptz-actions";
  const mkAction = (label, action) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ptz-action";
    btn.textContent = label;
    btn.dataset.ptzAction = action;
    return btn;
  };
  actions.append(
    mkAction("AutoFocus", "autofocus"),
    mkAction("Restore", "restore"),
    mkAction("Refresh", "refresh"),
  );

  body.append(zoomAxis.wrap, focusAxis.wrap, actions);
  panel.append(head, body);

  let busy = false;
  const setBusy = (on) => {
    busy = on;
    panel.dataset.busy = on ? "1" : "0";
    for (const el of panel.querySelectorAll("button, input, select")) el.disabled = on;
  };

  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    try {
      const pos = await fn();
      applyPtzSliders(panel, pos);
    } catch (err) {
      statusEl.textContent = String(err.message || err);
    } finally {
      setBusy(false);
    }
  };

  zoomAxis.slider.addEventListener("change", () => {
    run(() => ptzPost(cam.id, "zoom", {
      zoom: Number(zoomAxis.slider.value),
      zoomStep: Number(zoomAxis.stepSelect.value) || 1,
      focusStep: Number(focusAxis.stepSelect.value) || 1,
    }));
  });
  focusAxis.slider.addEventListener("change", () => {
    run(() => ptzPost(cam.id, "focus", {
      focus: Number(focusAxis.slider.value),
      zoomStep: Number(zoomAxis.stepSelect.value) || 1,
      focusStep: Number(focusAxis.stepSelect.value) || 1,
    }));
  });
  for (const btn of actions.querySelectorAll("[data-ptz-action]")) {
    btn.addEventListener("click", () => {
      const action = btn.dataset.ptzAction;
      run(() => ptzPost(cam.id, action, {
        zoomStep: Number(zoomAxis.stepSelect.value) || 1,
        focusStep: Number(focusAxis.stepSelect.value) || 1,
      }));
    });
  }

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "live-tile-ptz";
  toggle.textContent = "Zoom";
  toggle.setAttribute("aria-label", "Toggle zoom panel");
  toggle.setAttribute("aria-pressed", "false");
  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = panel.hidden;
    panel.hidden = !open;
    toggle.setAttribute("aria-pressed", open ? "true" : "false");
    toggle.classList.toggle("active", open);
    if (open) syncPtzPanel(tile);
  });

  return { panel, toggle };
}

const EVENT_LABELS = {
  FaceDetection: "Face Detection",
  HumanVehicle: "Pedestrian and Vehicle",
  LicensePlate: "License Plate",
  LineCrossing: "Line Crossing",
  Intrusion: "Intrusion",
  EnterRegion: "Enter Region",
  ExitRegion: "Exit Region",
  ObjectDetection: "Object Detection",
  CrossCounting: "Cross Counting",
  HeatMap: "Heat Map",
  QueueLength: "Queue Length",
  CrowdDensity: "Crowd Density",
  RareSound: "Rare Sound",
  MotionDetection: "Motion Detection",
  VideoTampering: "Video Tampering",
};

const EVENT_PARAM_LABELS = {
  time_threshold: "Loitering Duration",
  target_validity: "Target Validity",
  min_pixel: "Min Pixels",
  max_pixel: "Max Pixels",
  sensitivity: "Sensitivity",
  detection_type: "Detection Target",
  detection_mode: "Detection Mode",
  detection_range: "Detection Area",
  snap_mode: "Capture Mode",
  snap_num: "Snapshot Qty",
  snap_frequency: "Capture Interval",
  face_angle: "Face Angle",
  face_attribute: "Face Attributes",
  face_enhance: "Face Enhance",
  lpd_enhance: "LPD Enhance",
  plate_draw_rule: "License Plate Detect Rule",
  mix_rule: "Mix Rule",
  picture_quality: "Picture Quality",
  roll_range: "Roll Angle",
  pitch_range: "Pitch Angle",
  yaw_range: "Yaw Angle",
  day_level: "Day Level",
  night_level: "Night Level",
  alarm_num: "Alarm Number",
  reset_count: "Reset Count",
  auto_reset_switch: "Auto Reset",
  auto_reset_time: "Reset Time",
  max_detection_num: "Max Detection",
  max_pro_time: "Max Staying Time",
  smart_motion_detection: "Smart Motion",
  target_type: "Detection Target",
  rule_type: "Direction",
  trigger_mode: "Trigger Mode",
};

const EVENT_VALUE_LABELS = {
  OptimalMode: "Optimal Mode",
  RealTimeMode: "Realtime Mode",
  IntervalMode: "Interval Mode",
  Default: "Default",
  FrontalView: "Frontal View",
  Multiangle: "Multi-angle",
  UserDefined: "User-defined",
  HybridMode: "Always",
  MotionMode: "Moving Only",
  StaticMode: "Static Mode",
  EU_Plate: "European license plate",
  US_Plate: "American license plate",
  normal: "Normal Detect",
  counting: "Counting Detect",
  FullScreen: "Full Screen",
  Customize: "User-defined",
  Area: "Polygon",
  Line: "Line",
  Unlimited: "Unlimited",
  "A->B": "A → B",
  "B->A": "B → A",
  "A<-->B": "A ↔ B",
  Legacy: "Legacy",
  Lost: "Lost",
  "Lost & Legacy": "Lost & Legacy",
  Pedestrian: "Pedestrian",
  "Motor Vehicle": "Motor Vehicle",
  "Non-motorized Vehicle": "Non-motorized Vehicle",
  Vehicle: "Vehicle",
  Motion: "Motion",
  12: "12-hour",
  24: "24-hour",
  "Baby Crying Sound": "Baby Crying Sound",
  "Dog Barking": "Dog Barking",
  Gunshot: "Gunshot",
};

const EVENT_FIELD_ORDER = [
  "snap_mode",
  "face_angle",
  "plate_draw_rule",
  "detection_type",
  "target_type",
  "detection_mode",
  "detection_range",
  "min_pixel",
  "max_pixel",
  "sensitivity",
  "time_threshold",
  "target_validity",
  "face_enhance",
  "face_attribute",
  "lpd_enhance",
  "mix_rule",
  "snap_num",
  "snap_frequency",
  "roll_range",
  "pitch_range",
  "yaw_range",
  "picture_quality",
  "day_level",
  "night_level",
  "alarm_num",
  "reset_count",
  "auto_reset_switch",
  "auto_reset_time",
  "max_detection_num",
  "max_pro_time",
  "smart_motion_detection",
  "rule_type",
  "trigger_mode",
];

const EVENT_SKIP_FIELDS = new Set([
  "switch",
  "rule_info",
  "draw_add_btn",
  "drawline_ABRegion_rule",
  "mutual_exclusion",
  "btn_get_default_data",
  "rule_draw_number",
  "dragline_rectFlip",
  "region_setting",
  "mbrow",
  "mbcol",
  "target_type_lg",
  "alarm_out",
  "rule_switch",
  "start_time",
  "end_time",
]);

function eventLabel(name) {
  return EVENT_LABELS[name] || String(name).replace(/([a-z])([A-Z])/g, "$1 $2");
}

function eventParamLabel(name) {
  return EVENT_PARAM_LABELS[name] || String(name).replaceAll("_", " ");
}

function eventValueLabel(value) {
  const key = String(value);
  return EVENT_VALUE_LABELS[key] || key;
}

function ruleKeys(config) {
  return Object.keys(config?.rule_info || {}).sort((a, b) => {
    return Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, ""));
  });
}

function emptyWorldPoint(pt) {
  return !pt || (Number(pt[0]) === 0 && Number(pt[1]) === 0);
}

function rectPoints(rect) {
  if (!rect) return [];
  const pts = [];
  for (let i = 1; i <= 8; i += 1) {
    const x = Number(rect[`x${i}`]);
    const y = Number(rect[`y${i}`]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) break;
    if (pts.length && pts[pts.length - 1][0] === x && pts[pts.length - 1][1] === y) break;
    pts.push([x, y]);
  }
  if (pts.length < 2 || pts.every(emptyWorldPoint)) return [];
  return pts;
}

function linePoints(line) {
  if (!line) return [];
  const pts = [
    [Number(line.x1), Number(line.y1)],
    [Number(line.x2), Number(line.y2)],
  ];
  if (pts.some((pt) => !Number.isFinite(pt[0]) || !Number.isFinite(pt[1]))) return [];
  if (pts.every(emptyWorldPoint)) return [];
  return pts;
}

function ruleShape(rule) {
  if (!rule) return { kind: "polygon", points: [] };
  const line = linePoints(rule.rule_line);
  if (line.length) return { kind: "line", points: line, type: rule.rule_type };
  return { kind: "polygon", points: rectPoints(rule.rule_rect) };
}

function pointsToRect(points) {
  const last = points[points.length - 1] || [0, 0];
  const rect = {};
  for (let i = 1; i <= 8; i += 1) {
    const pt = points[i - 1] || last;
    rect[`x${i}`] = Math.round(pt[0]);
    rect[`y${i}`] = Math.round(pt[1]);
  }
  return rect;
}

function pointsToLine(points) {
  const a = points[0] || [0, 0];
  const b = points[1] || a;
  return {
    x1: Math.round(a[0]),
    y1: Math.round(a[1]),
    x2: Math.round(b[0]),
    y2: Math.round(b[1]),
  };
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function overlayMetrics(img, canvas, world) {
  const cr = canvas.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const nw = img.naturalWidth || 16;
  const nh = img.naturalHeight || 9;
  const scale = Math.min(ir.width / nw, ir.height / nh);
  const dw = nw * scale;
  const dh = nh * scale;
  const left = ir.left - cr.left + (ir.width - dw) / 2;
  const top = ir.top - cr.top + (ir.height - dh) / 2;
  return {
    left,
    top,
    width: dw,
    height: dh,
    toWorld(clientX, clientY) {
      const x = ((clientX - cr.left - left) / dw) * world.width;
      const y = ((clientY - cr.top - top) / dh) * world.height;
      return [clamp(x, 0, world.width), clamp(y, 0, world.height)];
    },
    toScreen(x, y) {
      return [left + (x / world.width) * dw, top + (y / world.height) * dh];
    },
  };
}

function hitPoint(points, x, y, r = 10) {
  for (let i = 0; i < points.length; i += 1) {
    const dx = points[i][0] - x;
    const dy = points[i][1] - y;
    if (dx * dx + dy * dy <= r * r) return i;
  }
  return -1;
}

async function eventApi(camId, path, body) {
  const res = await fetch(`/api/cameras/${encodeURIComponent(camId)}/events${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

async function camSettingApi(camId, path, body) {
  const res = await fetch(`/api/cameras/${encodeURIComponent(camId)}${path}`, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

const SETTING_NAV = [
  { group: "Channel", pages: [{ id: "osd", label: "Live" }, { id: "cover", label: "Video Cover" }] },
  { group: "Storage", pages: [{ id: "disk", label: "Disk" }] },
  { group: "Network", pages: [{ id: "network", label: "General" }] },
  { group: "Event", pages: [{ id: "events", label: "Event Settings" }] },
];

function coverRectPoints(rect) {
  const left = Number(rect?.left) || 0;
  const top = Number(rect?.top) || 0;
  const width = Number(rect?.width) || 0;
  const height = Number(rect?.height) || 0;
  if (width <= 0 || height <= 0) return [];
  return [
    [left, top],
    [left + width, top],
    [left + width, top + height],
    [left, top + height],
  ];
}

function pointsToCoverRect(points) {
  const xs = points.map((pt) => pt[0]);
  const ys = points.map((pt) => pt[1]);
  const left = Math.round(Math.min(...xs));
  const top = Math.round(Math.min(...ys));
  return {
    left,
    top,
    width: Math.max(1, Math.round(Math.max(...xs) - left)),
    height: Math.max(1, Math.round(Math.max(...ys) - top)),
  };
}

function formatDiskMb(mb) {
  const n = Number(mb) || 0;
  if (n >= 1024) return `${(n / 1024).toFixed(2)} GB`;
  return `${n} MB`;
}

function formatDiskTime(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

function diskValueLabel(value) {
  return ({
    Sd: "SD Card",
    Usb: "USB",
    Esata: "eSATA",
    Network: "NAS",
    ReadAndWriteDisk: "Read/Write",
    NoHdd: "No disk",
    Unformat: "Unformatted",
    HddError: "Error",
    Auto: "Overwrite",
    Off: "Stop when full",
  }[value] || eventValueLabel(value));
}

function initEventStudio(tile, cam, ui) {
  const state = {
    loaded: false,
    page: "events",
    groups: [],
    abilities: {},
    ability: "Intrusion",
    config: null,
    range: {},
    osd: null,
    osdRange: {},
    cover: null,
    coverRev: 0,
    disk: null,
    network: null,
    canvas: { width: 704, height: 576 },
    selectedRule: 0,
    selectedZone: 0,
    drawMode: false,
    draft: [],
    drag: null,
    saveTimer: 0,
  };
  tile._eventState = state;

  function setStatus(text) {
    if (focusedLiveTile() === tile) statusEl.textContent = text;
  }

  function currentRule() {
    const key = ruleKeys(state.config)[state.selectedRule];
    return key ? state.config.rule_info[key] : null;
  }

  function ruleKind(rule = currentRule() || state.config?.rule_info?.[ruleKeys(state.config)[0]]) {
    if (!rule) return "polygon";
    if (rule.trigger_mode === "Line") return "line";
    if (rule.trigger_mode === "Area") return "polygon";
    if (rule.rule_line && !rule.rule_rect) return "line";
    return "polygon";
  }

  function detectionRange() {
    const rule = currentRule() || state.config?.rule_info?.[ruleKeys(state.config)[0]];
    return rule?.detection_range || "";
  }

  function setDetectionRange(value) {
    for (const key of ruleKeys(state.config)) {
      const rule = state.config.rule_info[key];
      if ("detection_range" in rule || ruleItemSpec().detection_range) {
        rule.detection_range = value;
      }
    }
  }

  function canDraw() {
    if (!state.config?.rule_info || !ruleKeys(state.config).length) return false;
    const range = detectionRange();
    return !range || range === "UserDefined";
  }

  function ruleItemSpec() {
    return state.range?.rule_info?.items?.rule_number1?.items || {};
  }

  function drawOverlay() {
    if (!tile.classList.contains("settings-open")) return;
    const { canvas, img } = ui;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (state.page === "osd") {
      drawOsdOverlay(ctx, img, canvas);
      return;
    }
    if (state.page === "cover") {
      drawCoverOverlay(ctx, img, canvas);
      return;
    }
    if (state.page !== "events" || !state.config || !canDraw()) return;
    const m = overlayMetrics(img, canvas, state.canvas);
    const keys = ruleKeys(state.config);
    keys.forEach((key, index) => {
      const rule = state.config.rule_info[key];
      const shape = index === state.selectedRule && state.drawMode
        ? { kind: ruleKind(), points: state.draft }
        : ruleShape(rule);
      if (!rule.rule_switch && !(index === state.selectedRule && state.drawMode)) return;
      if (!shape.points.length) return;
      const screen = shape.points.map(([x, y]) => m.toScreen(x, y));
      ctx.lineWidth = 2;
      ctx.strokeStyle = index === state.selectedRule ? "#1e4d8c" : "#f5d24a";
      ctx.fillStyle = "rgba(30, 77, 140, 0.12)";
      ctx.beginPath();
      ctx.moveTo(screen[0][0], screen[0][1]);
      for (const [x, y] of screen.slice(1)) ctx.lineTo(x, y);
      if (shape.kind === "polygon" && screen.length > 2) ctx.closePath();
      ctx.stroke();
      if (shape.kind === "polygon" && screen.length > 2) ctx.fill();
      screen.forEach(([x, y], i) => {
        ctx.fillStyle = i === 0 ? "#ef4444" : "#fff";
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#111";
        ctx.stroke();
      });
      const labelAt = screen[0];
      ctx.fillStyle = "#ef4444";
      ctx.fillRect(labelAt[0] - 8, labelAt[1] - 22, 16, 16);
      ctx.fillStyle = "#fff";
      ctx.font = "11px Outfit, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(String(index + 1), labelAt[0], labelAt[1] - 11);
    });
  }

  function drawOsdOverlay(ctx, img, canvas) {
    if (!state.osd) return;
    const m = overlayMetrics(img, canvas, state.canvas);
    const items = [
      { key: "name", label: state.osd.name?.text || "Camera" },
      { key: "datetime", label: "Time" },
      { key: "alarm", label: state.osd.alarm?.text || "Alarm" },
    ];
    ctx.font = "12px Outfit, sans-serif";
    for (const item of items) {
      if (!state.osd[item.key]?.show) continue;
      const [x, y] = m.toScreen(state.osd[item.key].pos?.x || 0, state.osd[item.key].pos?.y || 0);
      const width = Math.max(72, ctx.measureText(item.label).width + 16);
      ctx.fillStyle = "rgba(8, 8, 8, 0.7)";
      ctx.fillRect(x, y, width, 22);
      ctx.strokeStyle = state.drag?.key === item.key ? "#1e4d8c" : "#e8e4dc";
      ctx.strokeRect(x, y, width, 22);
      ctx.fillStyle = "#fff";
      ctx.textAlign = "left";
      ctx.fillText(item.label, x + 8, y + 15);
    }
  }

  function drawCoverOverlay(ctx, img, canvas) {
    if (!state.cover) return;
    const m = overlayMetrics(img, canvas, state.canvas);
    const zones = state.cover.zone_info || [];
    zones.forEach((zone, index) => {
      if (!zone.zone_enable) return;
      if (index === state.selectedZone && state.drawMode) return;
      const points = coverRectPoints(zone.rect);
      if (points.length < 2) return;
      const screen = points.map(([x, y]) => m.toScreen(x, y));
      ctx.fillStyle = "rgba(12, 12, 12, 0.72)";
      ctx.strokeStyle = index === state.selectedZone ? "#1e4d8c" : "#8a8680";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(screen[0][0], screen[0][1]);
      for (const [x, y] of screen.slice(1)) ctx.lineTo(x, y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      screen.forEach(([x, y]) => {
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.fillStyle = "#fff";
      ctx.font = "11px Outfit, sans-serif";
      ctx.fillText(String(index + 1), screen[0][0] + 6, screen[0][1] + 14);
    });
    if (state.drawMode && state.draft.length === 2) {
      const a = m.toScreen(state.draft[0][0], state.draft[0][1]);
      const b = m.toScreen(state.draft[1][0], state.draft[1][1]);
      const x = Math.min(a[0], b[0]);
      const y = Math.min(a[1], b[1]);
      const w = Math.abs(b[0] - a[0]);
      const h = Math.abs(b[1] - a[1]);
      ctx.fillStyle = "rgba(12, 12, 12, 0.55)";
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = "#1e4d8c";
      ctx.strokeRect(x, y, w, h);
    }
  }

  function renderTypes() {
    ui.types.replaceChildren();
    for (const group of SETTING_NAV) {
      const title = document.createElement("p");
      title.className = "event-group-title";
      title.textContent = group.group;
      ui.types.append(title);
      for (const page of group.pages) {
        const card = document.createElement("div");
        card.className = "event-card";
        if (page.id === state.page) card.classList.add("active");
        const head = document.createElement("div");
        head.className = "event-card-head";
        head.append(Object.assign(document.createElement("span"), { textContent: page.label }));
        card.append(head);
        card.addEventListener("click", () => selectPage(page.id));
        ui.types.append(card);
      }
    }
    if (state.page !== "events") return;
    for (const group of state.groups) {
      const title = document.createElement("p");
      title.className = "event-group-title event-sub-title";
      title.textContent = group.title;
      ui.types.append(title);
      for (const item of group.abilities) {
        const card = document.createElement("div");
        card.className = "event-card event-sub-card";
        card.dataset.ability = item.ability;
        if (item.ability === state.ability) card.classList.add("active");
        if (item.state === "On") card.classList.add("on");
        const head = document.createElement("div");
        head.className = "event-card-head";
        const name = document.createElement("span");
        name.textContent = eventLabel(item.ability);
        const sw = document.createElement("input");
        sw.type = "checkbox";
        sw.className = "event-switch";
        sw.checked = item.state === "On";
        sw.addEventListener("click", (event) => event.stopPropagation());
        sw.addEventListener("change", () => {
          const on = sw.checked;
          sw.checked = item.state === "On";
          toggleAbility(item.ability, on);
        });
        head.append(name, sw);
        card.append(head);
        card.addEventListener("click", (event) => {
          if (event.target.closest("input")) return;
          selectAbility(item.ability);
        });
        ui.types.append(card);
      }
    }
  }

  function appendSlider(field, spec, getter, setter) {
    const wrap = document.createElement("label");
    wrap.className = "event-field";
    wrap.append(eventParamLabel(field));
    const row = document.createElement("div");
    row.className = "event-slider-row";
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = String(spec.min);
    slider.max = String(spec.max);
    slider.value = String(getter() ?? spec.min);
    const num = document.createElement("input");
    num.type = "number";
    num.min = slider.min;
    num.max = slider.max;
    num.value = slider.value;
    const sync = (value) => {
      const n = clamp(Number(value), spec.min, spec.max);
      slider.value = String(n);
      num.value = String(n);
      setter(n);
      queueSave();
    };
    slider.addEventListener("input", () => sync(slider.value));
    num.addEventListener("change", () => sync(num.value));
    row.append(slider, num);
    wrap.append(row);
    return wrap;
  }

  function appendSelect(field, items, getter, setter, numeric = false) {
    const wrap = document.createElement("label");
    wrap.className = "event-field";
    wrap.append(eventParamLabel(field));
    const select = document.createElement("select");
    const current = getter();
    for (const item of items) {
      const opt = document.createElement("option");
      opt.value = String(item);
      opt.textContent = eventValueLabel(item);
      if (String(current) === String(item)) opt.selected = true;
      select.append(opt);
    }
    select.addEventListener("change", () => {
      setter(numeric ? Number(select.value) : select.value);
      queueSave();
      if (field === "detection_range" || field === "trigger_mode") renderParams();
    });
    wrap.append(select);
    return wrap;
  }

  function appendRadios(field, items, getter, setter) {
    const wrap = document.createElement("div");
    wrap.className = "event-field";
    wrap.append(eventParamLabel(field));
    const list = document.createElement("div");
    list.className = "event-radios";
    const current = String(getter() ?? "");
    for (const item of items) {
      const lab = document.createElement("label");
      lab.className = "event-check";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = `event-${field}`;
      radio.value = String(item);
      radio.checked = current === String(item);
      radio.addEventListener("change", () => {
        if (radio.checked) {
          setter(item);
          queueSave();
        }
      });
      lab.append(radio, document.createTextNode(` ${eventValueLabel(item)}`));
      list.append(lab);
    }
    wrap.append(list);
    return wrap;
  }

  function appendChecks(field, items, getter, setter) {
    const wrap = document.createElement("div");
    wrap.className = "event-field";
    wrap.append(eventParamLabel(field));
    const list = document.createElement("div");
    list.className = "event-checks";
    const selected = new Set(getter() || []);
    for (const item of items) {
      const lab = document.createElement("label");
      lab.className = "event-check";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = selected.has(item);
      box.addEventListener("change", () => {
        const next = new Set(getter() || []);
        if (box.checked) next.add(item);
        else next.delete(item);
        setter([...next]);
        queueSave();
      });
      lab.append(box, document.createTextNode(` ${eventValueLabel(item)}`));
      list.append(lab);
    }
    wrap.append(list);
    return wrap;
  }

  function appendToggle(field, getter, setter) {
    const wrap = document.createElement("label");
    wrap.className = "event-field event-field-toggle";
    wrap.append(eventParamLabel(field));
    const sw = document.createElement("input");
    sw.type = "checkbox";
    sw.className = "event-switch";
    sw.checked = Boolean(getter());
    sw.addEventListener("change", () => {
      setter(sw.checked);
      queueSave();
    });
    wrap.append(sw);
    return wrap;
  }

  function appendField(field, spec, getter, setter) {
    if (!spec || typeof spec !== "object") return null;
    if (spec.type === "bool") return appendToggle(field, getter, setter);
    if (spec.type === "int32" && spec.min != null && spec.max != null) {
      return appendSlider(field, spec, getter, setter);
    }
    if (spec.type === "int32" && Array.isArray(spec.items)) {
      return appendSelect(field, spec.items, getter, setter, true);
    }
    if (spec.type === "string" && Array.isArray(spec.items) && spec.items.length === 2 && field === "plate_draw_rule") {
      return appendRadios(field, spec.items, getter, setter);
    }
    if (spec.type === "string" && Array.isArray(spec.items)) {
      return appendSelect(field, spec.items, getter, setter);
    }
    if (spec.type === "string") {
      const wrap = document.createElement("label");
      wrap.className = "event-field";
      wrap.append(eventParamLabel(field));
      const input = document.createElement("input");
      input.type = "text";
      input.value = String(getter() ?? "");
      input.addEventListener("change", () => {
        setter(input.value);
        queueSave();
      });
      wrap.append(input);
      return wrap;
    }
    if (spec.type === "array" && spec.items?.items) {
      return appendChecks(field, spec.items.items, getter, setter);
    }
    return null;
  }

  function orderedFields(range) {
    const keys = Object.keys(range || {}).filter((key) => !EVENT_SKIP_FIELDS.has(key) && range[key] && typeof range[key] === "object");
    const seen = new Set();
    const out = [];
    for (const key of EVENT_FIELD_ORDER) {
      if (keys.includes(key)) {
        out.push(key);
        seen.add(key);
      }
    }
    for (const key of keys) {
      if (!seen.has(key) && state.config[key] !== undefined) out.push(key);
    }
    return out;
  }

  function renderParams() {
    if (state.page === "osd") {
      renderOsdParams();
      return;
    }
    if (state.page === "cover") {
      renderCoverParams();
      return;
    }
    if (state.page === "disk") {
      renderDiskParams();
      return;
    }
    if (state.page === "network") {
      renderNetworkParams();
      return;
    }
    ui.params.replaceChildren();
    if (!state.config) {
      ui.params.append(Object.assign(document.createElement("p"), {
        className: "muted",
        textContent: "Select an event",
      }));
      return;
    }
    const tabs = document.createElement("div");
    tabs.className = "event-tabs";
    const tab = document.createElement("span");
    tab.className = "active";
    tab.textContent = "Settings";
    tabs.append(tab);
    ui.params.append(tabs);
    const fields = document.createElement("div");
    fields.className = "event-fields";
    for (const field of orderedFields(state.range)) {
      const spec = state.range[field];
      if (state.config[field] === undefined) continue;
      const el = appendField(
        field,
        spec,
        () => state.config[field],
        (value) => { state.config[field] = value; },
      );
      if (el) fields.append(el);
    }
    const ruleSpec = ruleItemSpec();
    if (ruleSpec.detection_range) {
      fields.append(appendField(
        "detection_range",
        ruleSpec.detection_range,
        () => detectionRange() || "FullScreen",
        (value) => setDetectionRange(value),
      ));
    }
    const rule = currentRule();
    if (rule && ruleSpec.rule_type && rule.rule_type != null) {
      fields.append(appendField(
        "rule_type",
        ruleSpec.rule_type,
        () => rule.rule_type,
        (value) => { rule.rule_type = value; },
      ));
    }
    if (rule && ruleSpec.trigger_mode && rule.trigger_mode != null) {
      fields.append(appendField(
        "trigger_mode",
        ruleSpec.trigger_mode,
        () => rule.trigger_mode,
        (value) => { rule.trigger_mode = value; },
      ));
    }
    ui.params.append(fields);
    renderTools();
  }

  function renderTools() {
    ui.tools.replaceChildren();
    if (state.page === "cover") {
      renderCoverTools();
      return;
    }
    if (state.page !== "events" || !canDraw()) return;
    const add = document.createElement("button");
    add.type = "button";
    add.className = "event-draw-btn add";
    add.textContent = "Add";
    const draw = document.createElement("button");
    draw.type = "button";
    draw.className = "event-draw-btn";
    draw.textContent = state.drawMode ? "Finish" : "Draw";
    draw.classList.toggle("active", state.drawMode);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "event-draw-btn";
    remove.textContent = "Remove";
    const removeAll = document.createElement("button");
    removeAll.type = "button";
    removeAll.className = "event-draw-btn danger";
    removeAll.textContent = "Remove All";
    add.addEventListener("click", (event) => {
      event.stopPropagation();
      addRule();
    });
    draw.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleDraw();
    });
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      removeRule(state.selectedRule);
    });
    removeAll.addEventListener("click", (event) => {
      event.stopPropagation();
      removeRule(-1);
    });
    ui.tools.append(add, draw, remove, removeAll);
  }

  function queueSave() {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(() => savePage(), 400);
    drawOverlay();
  }

  async function savePage() {
    if (state.page === "osd") return saveOsd();
    if (state.page === "cover") return saveCover();
    if (state.page === "disk") return saveDisk();
    if (state.page === "network") return saveNetwork();
    return saveConfig();
  }

  async function saveConfig() {
    if (!state.config) return;
    try {
      const saved = await eventApi(cam.id, `/${encodeURIComponent(state.ability)}`, {
        channel: "CH1",
        config: state.config,
      });
      state.config = saved.config;
      state.range = saved.range;
      state.canvas = saved.canvas;
      drawOverlay();
    } catch (err) {
      setStatus(err.message);
    }
  }

  function osdFieldLabel(field) {
    return ({
      "name.show": "Channel Name",
      "datetime.show": "Time",
      "datetime.date_format": "Date Format",
      "datetime.time_format": "Time Format",
      "alarm.show": "Alarm",
      refresh_rate: "Refresh Rate",
      privacy_protection: "Privacy Protection",
      water_mark: "Watermark",
    }[field] || eventParamLabel(field));
  }

  function renderOsdParams() {
    ui.params.replaceChildren();
    const tabs = document.createElement("div");
    tabs.className = "event-tabs";
    tabs.append(Object.assign(document.createElement("span"), { className: "active", textContent: "Live" }));
    ui.params.append(tabs);
    if (!state.osd) {
      ui.params.append(Object.assign(document.createElement("p"), { className: "muted", textContent: "Loading…" }));
      renderTools();
      return;
    }
    const fields = document.createElement("div");
    fields.className = "event-fields";
    const rows = [
      ["name.show", { type: "bool" }, () => Boolean(state.osd.name?.show), (value) => { state.osd.name.show = value; }],
      ["datetime.show", { type: "bool" }, () => Boolean(state.osd.datetime?.show), (value) => { state.osd.datetime.show = value; }],
      ["datetime.date_format", state.osdRange.datetime?.items?.date_format, () => state.osd.datetime?.date_format, (value) => { state.osd.datetime.date_format = value; }],
      ["datetime.time_format", state.osdRange.datetime?.items?.time_format, () => state.osd.datetime?.time_format, (value) => { state.osd.datetime.time_format = Number(value); }],
      ["alarm.show", { type: "bool" }, () => Boolean(state.osd.alarm?.show), (value) => { state.osd.alarm.show = value; }],
      ["refresh_rate", state.osdRange.refresh_rate, () => state.osd.refresh_rate, (value) => { state.osd.refresh_rate = value; }],
      ["privacy_protection", { type: "bool" }, () => Boolean(state.osd.privacy_protection), (value) => { state.osd.privacy_protection = value; }],
      ["water_mark", { type: "bool" }, () => Boolean(state.osd.water_mark), (value) => { state.osd.water_mark = value; }],
    ];
    for (const [field, spec, getter, setter] of rows) {
      if (!spec) continue;
      const el = appendField(field, spec, getter, setter);
      if (!el) continue;
      if (el.childNodes[0]) el.childNodes[0].textContent = osdFieldLabel(field);
      fields.append(el);
    }
    ui.params.append(fields);
    renderTools();
  }

  async function saveOsd() {
    if (!state.osd) return;
    try {
      const saved = await camSettingApi(cam.id, "/osd", { channel: "CH1", config: state.osd });
      state.osd = saved.config;
      state.osdRange = saved.range || state.osdRange;
      state.canvas = saved.canvas || state.canvas;
      drawOverlay();
    } catch (err) {
      setStatus(err.message);
    }
  }

  function renderCoverParams() {
    ui.params.replaceChildren();
    const tabs = document.createElement("div");
    tabs.className = "event-tabs";
    tabs.append(Object.assign(document.createElement("span"), { className: "active", textContent: "Settings" }));
    ui.params.append(tabs);
    if (!state.cover) {
      ui.params.append(Object.assign(document.createElement("p"), { className: "muted", textContent: "Loading…" }));
      renderTools();
      return;
    }
    const fields = document.createElement("div");
    fields.className = "event-fields";
    fields.append(appendToggle(
      "privacy_zone_enable",
      () => Boolean(state.cover.privacy_zone_enable),
      (value) => {
        state.cover.privacy_zone_enable = value;
        state.coverRev = (state.coverRev || 0) + 1;
      },
    ));
    const label = fields.querySelector(".event-field");
    if (label?.childNodes[0]) label.childNodes[0].textContent = "Privacy Zone";
    ui.params.append(fields);
    renderTools();
  }

  function renderCoverTools() {
    const add = document.createElement("button");
    add.type = "button";
    add.className = "event-draw-btn add";
    add.textContent = "Add";
    const draw = document.createElement("button");
    draw.type = "button";
    draw.className = "event-draw-btn";
    draw.textContent = state.drawMode ? "Cancel" : "Draw";
    draw.classList.toggle("active", state.drawMode);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "event-draw-btn";
    remove.textContent = "Remove";
    const removeAll = document.createElement("button");
    removeAll.type = "button";
    removeAll.className = "event-draw-btn danger";
    removeAll.textContent = "Remove All";
    add.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      addCoverZone();
    });
    draw.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleCoverDraw();
    });
    remove.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      removeCoverZone(state.selectedZone);
    });
    removeAll.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      removeCoverZone(-1);
    });
    ui.tools.append(add, draw, remove, removeAll);
  }

  function emptyCoverIndex() {
    return (state.cover?.zone_info || []).findIndex((zone) => !zone.zone_enable);
  }

  function beginCoverDraw(index) {
    const zones = state.cover?.zone_info || [];
    if (!zones[index]) return;
    state.selectedZone = index;
    state.drawMode = true;
    state.draft = [];
    renderTools();
    drawOverlay();
  }

  function addCoverZone() {
    const empty = emptyCoverIndex();
    if (empty < 0) {
      setStatus("Zone limit reached");
      return;
    }
    beginCoverDraw(empty);
  }

  function clearCoverZone(zone) {
    zone.zone_enable = false;
    zone.rect = { left: 0, top: 0, width: 0, height: 0 };
  }

  function removeCoverZone(index) {
    const zones = state.cover?.zone_info || [];
    if (index < 0) zones.forEach(clearCoverZone);
    else if (zones[index]) clearCoverZone(zones[index]);
    state.drawMode = false;
    state.draft = [];
    state.coverRev = (state.coverRev || 0) + 1;
    renderTools();
    drawOverlay();
    saveCover();
  }

  function toggleCoverDraw() {
    if (state.drawMode) {
      cancelCoverDraw();
      return;
    }
    const zones = state.cover?.zone_info || [];
    let index = state.selectedZone;
    if (!zones[index]?.zone_enable) {
      index = emptyCoverIndex();
      if (index < 0) {
        setStatus("Zone limit reached");
        return;
      }
    }
    beginCoverDraw(index);
  }

  function cancelCoverDraw() {
    state.drawMode = false;
    state.draft = [];
    renderTools();
    drawOverlay();
  }

  function finishCoverDraw() {
    const zone = state.cover?.zone_info?.[state.selectedZone];
    const rect = state.draft.length >= 2 ? pointsToCoverRect(state.draft) : null;
    state.drawMode = false;
    state.draft = [];
    if (zone && rect && rect.width >= 8 && rect.height >= 8) {
      zone.rect = rect;
      zone.zone_enable = true;
      state.coverRev = (state.coverRev || 0) + 1;
      queueSave();
    }
    renderTools();
    drawOverlay();
  }

  async function saveCover() {
    if (!state.cover) return;
    const run = async () => {
      if (!state.cover) return;
      const rev = state.coverRev || 0;
      const payload = {
        channel: "CH1",
        privacy_zone_enable: state.cover.privacy_zone_enable,
        zone_info: (state.cover.zone_info || []).map((zone) => ({
          ...zone,
          rect: { ...zone.rect },
        })),
      };
      try {
        const saved = await camSettingApi(cam.id, "/video-cover", payload);
        if ((state.coverRev || 0) !== rev) return;
        state.cover = saved;
        state.canvas = saved.canvas || state.canvas;
        drawOverlay();
      } catch (err) {
        setStatus(err.message);
      }
    };
    state.coverSave = (state.coverSave || Promise.resolve()).then(run, run);
    return state.coverSave;
  }

  function renderDiskParams() {
    ui.params.replaceChildren();
    const tabs = document.createElement("div");
    tabs.className = "event-tabs";
    tabs.append(Object.assign(document.createElement("span"), { className: "active", textContent: "Disk" }));
    ui.params.append(tabs);
    if (!state.disk) {
      ui.params.append(Object.assign(document.createElement("p"), { className: "muted", textContent: "Loading…" }));
      renderTools();
      return;
    }
    const fields = document.createElement("div");
    fields.className = "event-fields";
    const overwrite = state.disk.range?.over_write;
    if (overwrite?.items) {
      const el = appendSelect(
        "over_write",
        overwrite.items,
        () => state.disk.over_write,
        (value) => { state.disk.over_write = value; },
      );
      if (el.childNodes[0]) el.childNodes[0].textContent = "When disk is full";
      const select = el.querySelector("select");
      if (select) {
        for (const opt of select.options) opt.textContent = diskValueLabel(opt.value);
      }
      fields.append(el);
    }
    const tableWrap = document.createElement("div");
    tableWrap.className = "disk-table-wrap";
    const table = document.createElement("table");
    table.className = "disk-table";
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const label of ["No", "Type", "Status", "Capacity", "Free", "Record", "Name"]) {
      headRow.append(Object.assign(document.createElement("th"), { textContent: label }));
    }
    head.append(headRow);
    const body = document.createElement("tbody");
    for (const disk of state.disk.disk_info || []) {
      const row = document.createElement("tr");
      for (const cell of [
        disk.col_no ?? disk.id ?? "",
        diskValueLabel(disk.device_type),
        diskValueLabel(disk.status),
        formatDiskMb(disk.total_size),
        formatDiskMb(disk.free_size),
        formatDiskTime(disk.total_time),
        disk.serial_no || "",
      ]) {
        row.append(Object.assign(document.createElement("td"), { textContent: String(cell) }));
      }
      body.append(row);
    }
    if (!body.childNodes.length) {
      const row = document.createElement("tr");
      const empty = document.createElement("td");
      empty.colSpan = 7;
      empty.textContent = "No disk";
      row.append(empty);
      body.append(row);
    }
    table.append(head, body);
    tableWrap.append(table);
    fields.append(tableWrap);
    ui.params.append(fields);
    renderTools();
  }

  async function saveDisk() {
    if (!state.disk) return;
    try {
      state.disk = await camSettingApi(cam.id, "/disk", { over_write: state.disk.over_write });
      renderDiskParams();
    } catch (err) {
      setStatus(err.message);
    }
  }

  function netField(label, input, extra) {
    const wrap = document.createElement("label");
    wrap.className = "event-field";
    wrap.append(label);
    if (!extra) {
      wrap.append(input);
      return wrap;
    }
    const row = document.createElement("div");
    row.className = "net-field-row";
    row.append(input, extra);
    wrap.append(row);
    return wrap;
  }

  function netText(disabled = false) {
    const input = document.createElement("input");
    input.type = "text";
    input.disabled = disabled;
    input.spellcheck = false;
    return input;
  }

  function renderNetworkParams() {
    ui.params.replaceChildren();
    const tabs = document.createElement("div");
    tabs.className = "event-tabs";
    tabs.append(Object.assign(document.createElement("span"), { className: "active", textContent: "General" }));
    ui.params.append(tabs);
    if (!state.network?.wan) {
      ui.params.append(Object.assign(document.createElement("p"), { className: "muted", textContent: "Loading…" }));
      renderTools();
      return;
    }
    const wan = state.network.wan;
    const dhcp = Boolean(wan.dhcp);
    const dhcpv6 = Boolean(wan.dhcpv6);
    const fields = document.createElement("div");
    fields.className = "event-fields";

    const dhcpToggle = document.createElement("label");
    dhcpToggle.className = "event-field event-field-toggle";
    dhcpToggle.append("DHCP");
    const dhcpSw = document.createElement("input");
    dhcpSw.type = "checkbox";
    dhcpSw.className = "event-switch";
    dhcpSw.checked = dhcp;
    dhcpSw.addEventListener("change", () => {
      wan.dhcp = dhcpSw.checked;
      renderNetworkParams();
    });
    dhcpToggle.append(dhcpSw);
    fields.append(dhcpToggle);

    const ip = netText(dhcp);
    ip.value = wan.ip_address || "";
    ip.addEventListener("input", () => { wan.ip_address = ip.value.trim(); });
    const test = document.createElement("button");
    test.type = "button";
    test.className = "event-draw-btn";
    test.textContent = "Test";
    test.disabled = dhcp;
    test.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      testNetwork();
    });
    fields.append(netField("IP Address", ip, test));

    const mask = netText(dhcp);
    mask.value = wan.subnet_mask || "";
    mask.addEventListener("input", () => { wan.subnet_mask = mask.value.trim(); });
    fields.append(netField("Subnet Mask", mask));

    const gateway = netText(dhcp);
    gateway.value = wan.gateway || "";
    gateway.addEventListener("input", () => { wan.gateway = gateway.value.trim(); });
    fields.append(netField("Gateway", gateway));

    const dhcpv6Toggle = document.createElement("label");
    dhcpv6Toggle.className = "event-field event-field-toggle";
    dhcpv6Toggle.append("IPv6 DHCP");
    const dhcpv6Sw = document.createElement("input");
    dhcpv6Sw.type = "checkbox";
    dhcpv6Sw.className = "event-switch";
    dhcpv6Sw.checked = dhcpv6;
    dhcpv6Sw.addEventListener("change", () => {
      wan.dhcpv6 = dhcpv6Sw.checked;
      renderNetworkParams();
    });
    dhcpv6Toggle.append(dhcpv6Sw);
    fields.append(dhcpv6Toggle);

    const ipv6 = netText(dhcpv6);
    ipv6.value = wan.ipv6_address || "";
    ipv6.addEventListener("input", () => { wan.ipv6_address = ipv6.value.trim(); });
    fields.append(netField("IPv6 Address", ipv6));

    const prefix = document.createElement("input");
    prefix.type = "number";
    prefix.min = "1";
    prefix.max = "128";
    prefix.value = String(wan.ipv6_prefixlen ?? 64);
    prefix.disabled = dhcpv6;
    prefix.addEventListener("change", () => {
      wan.ipv6_prefixlen = clamp(Number(prefix.value), 1, 128);
      prefix.value = String(wan.ipv6_prefixlen);
    });
    fields.append(netField("Subnet Prefix Length", prefix));

    const actions = document.createElement("div");
    actions.className = "net-actions";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "event-draw-btn add";
    save.textContent = "Save";
    save.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      saveNetwork();
    });
    const refresh = document.createElement("button");
    refresh.type = "button";
    refresh.className = "event-draw-btn";
    refresh.textContent = "Refresh";
    refresh.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      loadNetwork(true);
    });
    actions.append(save, refresh);
    fields.append(actions);
    ui.params.append(fields);
    renderTools();
  }

  async function loadNetwork(force = false) {
    const data = await camSettingApi(cam.id, "/network");
    state.network = data;
    if (force) renderNetworkParams();
    return data;
  }

  async function saveNetwork() {
    if (!state.network?.wan) return;
    try {
      setStatus("Saving network…");
      state.network = await camSettingApi(cam.id, "/network", { wan: state.network.wan });
      renderNetworkParams();
      setStatus("Network settings saved");
    } catch (err) {
      setStatus(err.message);
    }
  }

  async function testNetwork() {
    if (!state.network?.wan) return;
    try {
      setStatus("Testing IP…");
      await camSettingApi(cam.id, "/network/test", { ip_address: state.network.wan.ip_address });
      setStatus("IP address is available");
    } catch (err) {
      setStatus(err.message);
    }
  }

  async function selectPage(page) {
    if (page === state.page && (
      (page === "events" && state.config)
      || (page === "osd" && state.osd)
      || (page === "cover" && state.cover)
      || (page === "disk" && state.disk)
      || (page === "network" && state.network)
    )) {
      renderTypes();
      renderParams();
      drawOverlay();
      return;
    }
    state.page = page;
    state.drawMode = false;
    state.draft = [];
    state.drag = null;
    tile.classList.toggle("settings-form", page === "disk" || page === "network");
    tile.classList.toggle("settings-disk", page === "disk" || page === "network");
    renderTypes();
    try {
      if (page === "osd") {
        const data = await camSettingApi(cam.id, "/osd");
        state.osd = data.config;
        state.osdRange = data.range || {};
        state.canvas = data.canvas || state.canvas;
      } else if (page === "cover") {
        const data = await camSettingApi(cam.id, "/video-cover");
        state.cover = data;
        state.canvas = data.canvas || state.canvas;
        const onIdx = (data.zone_info || []).findIndex((zone) => zone.zone_enable);
        state.selectedZone = Math.max(0, onIdx);
      } else if (page === "disk") {
        state.disk = await camSettingApi(cam.id, "/disk");
      } else if (page === "network") {
        await loadNetwork();
      } else if (page === "events" && !state.loaded) {
        await openEvents();
        return;
      }
      renderParams();
      drawOverlay();
    } catch (err) {
      setStatus(err.message);
      ui.params.replaceChildren(Object.assign(document.createElement("p"), {
        className: "muted",
        textContent: err.message,
      }));
    }
  }

  function conflictNames(ability) {
    for (const group of state.groups) {
      for (const item of group.abilities) {
        if (item.ability !== ability) continue;
        return (item.mutual_ability || [])
          .flatMap((mutual) => mutual.ability || [])
          .filter((name) => name && name !== ability && state.abilities[name] === "On");
      }
    }
    return [];
  }

  function askConfirm(message) {
    return new Promise((resolve) => {
      tile.querySelector(".event-confirm")?.remove();
      const overlay = document.createElement("div");
      overlay.className = "event-confirm";
      const box = document.createElement("div");
      box.className = "event-confirm-box";
      const title = document.createElement("p");
      title.className = "event-confirm-title";
      title.textContent = "Notice";
      const body = document.createElement("p");
      body.textContent = message;
      const actions = document.createElement("div");
      actions.className = "event-confirm-actions";
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = "Cancel";
      const ok = document.createElement("button");
      ok.type = "button";
      ok.className = "event-draw-btn add";
      ok.textContent = "Confirm";
      const finish = (value) => {
        overlay.remove();
        resolve(value);
      };
      cancel.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        finish(false);
      });
      ok.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        finish(true);
      });
      overlay.addEventListener("pointerdown", (event) => event.stopPropagation());
      overlay.addEventListener("click", (event) => event.stopPropagation());
      actions.append(cancel, ok);
      box.append(title, body, actions);
      overlay.append(box);
      tile.append(overlay);
    });
  }

  async function toggleAbility(ability, on) {
    if (on) {
      const conflicts = conflictNames(ability);
      if (conflicts.length) {
        const ok = await askConfirm(
          `Activating ${eventLabel(ability)} will deactivate ${conflicts.map(eventLabel).join(", ")}. Please confirm to proceed.`,
        );
        if (!ok) {
          renderTypes();
          return;
        }
      }
    }
    try {
      const next = await eventApi(cam.id, "", { [ability]: on });
      state.groups = next.groups || [];
      state.abilities = next.abilities || {};
      renderTypes();
      if (ability === state.ability) await selectAbility(ability, true);
    } catch (err) {
      setStatus(err.message);
      renderTypes();
    }
  }

  function defaultShape(index) {
    const tpl = state.config.draw_add_btn || {};
    if (Array.isArray(tpl.rule_line) && tpl.rule_line[index]) return { line: tpl.rule_line[index] };
    if (Array.isArray(tpl.rule_rect) && tpl.rule_rect[index]) return { rect: tpl.rule_rect[index] };
    const w = state.canvas.width;
    const h = state.canvas.height;
    const pad = 40 + index * 24;
    return {
      rect: pointsToRect([
        [pad, pad],
        [w - pad, pad],
        [w - pad, h - pad],
        [pad, h - pad],
      ]),
      line: { x1: pad, y1: 30, x2: pad, y2: h - 30 },
    };
  }

  function addRule() {
    const keys = ruleKeys(state.config);
    const empty = keys.findIndex((key) => !state.config.rule_info[key].rule_switch);
    if (empty < 0) {
      setStatus("Zone limit reached");
      return;
    }
    const key = keys[empty];
    const rule = state.config.rule_info[key];
    const shape = defaultShape(empty);
    rule.rule_switch = true;
    if (rule.rule_line) rule.rule_line = shape.line;
    if (rule.rule_rect) rule.rule_rect = shape.rect;
    state.selectedRule = empty;
    state.drawMode = false;
    queueSave();
    renderTools();
  }

  function clearRule(rule) {
    rule.rule_switch = false;
    if (rule.rule_rect) rule.rule_rect = pointsToRect([[0, 0]]);
    if (rule.rule_line) rule.rule_line = { x1: 0, y1: 0, x2: 0, y2: 0 };
  }

  function removeRule(index) {
    const keys = ruleKeys(state.config);
    if (index < 0) keys.forEach((key) => clearRule(state.config.rule_info[key]));
    else if (keys[index]) clearRule(state.config.rule_info[keys[index]]);
    state.drawMode = false;
    state.draft = [];
    queueSave();
    renderTools();
  }

  function toggleDraw() {
    if (state.drawMode) {
      finishDraw();
      return;
    }
    const keys = ruleKeys(state.config);
    if (!keys.length) return;
    let index = state.selectedRule;
    if (!currentRule()?.rule_switch) {
      const empty = keys.findIndex((key) => !state.config.rule_info[key].rule_switch);
      if (empty < 0) {
        setStatus("Zone limit reached");
        return;
      }
      index = empty;
      state.config.rule_info[keys[index]].rule_switch = true;
    }
    state.selectedRule = index;
    state.drawMode = true;
    state.draft = [];
    renderTools();
    drawOverlay();
  }

  function finishDraw() {
    const rule = currentRule();
    const minPts = ruleKind() === "line" ? 2 : Number(rule?.point_num?.[0] || 3);
    if (!rule || state.draft.length < minPts) {
      state.drawMode = false;
      state.draft = [];
      renderTools();
      drawOverlay();
      return;
    }
    if (rule.rule_line) rule.rule_line = pointsToLine(state.draft);
    if (rule.rule_rect) rule.rule_rect = pointsToRect(state.draft);
    rule.rule_switch = true;
    state.drawMode = false;
    state.draft = [];
    queueSave();
    renderTools();
  }

  function onCanvasPointer(event) {
    if (focusedLiveTile() !== tile) return;
    if (state.page === "osd") {
      onOsdPointer(event);
      return;
    }
    if (state.page === "cover") {
      onCoverPointer(event);
      return;
    }
    if (state.page !== "events" || !state.config) return;
    event.preventDefault();
    event.stopPropagation();
    const m = overlayMetrics(ui.img, ui.canvas, state.canvas);
    const [wx, wy] = m.toWorld(event.clientX, event.clientY);
    const [sx, sy] = m.toScreen(wx, wy);
    if (state.drawMode) {
      if (event.type !== "pointerdown") return;
      state.draft.push([wx, wy]);
      const maxPts = ruleKind() === "line" ? 2 : Number(currentRule()?.point_num?.[1] || 8);
      if (state.draft.length >= maxPts) finishDraw();
      else drawOverlay();
      return;
    }
    if (event.type === "pointerdown") {
      const keys = ruleKeys(state.config);
      for (let i = 0; i < keys.length; i += 1) {
        const shape = ruleShape(state.config.rule_info[keys[i]]);
        const screen = shape.points.map(([x, y]) => m.toScreen(x, y));
        const hit = hitPoint(screen, sx, sy, 12);
        if (hit >= 0) {
          state.selectedRule = i;
          state.drag = { index: i, point: hit };
          ui.canvas.setPointerCapture(event.pointerId);
          drawOverlay();
          return;
        }
      }
    }
    if (event.type === "pointermove" && state.drag) {
      const rule = state.config.rule_info[ruleKeys(state.config)[state.drag.index]];
      const shape = ruleShape(rule);
      shape.points[state.drag.point] = [wx, wy];
      if (rule.rule_line) rule.rule_line = pointsToLine(shape.points);
      if (rule.rule_rect) rule.rule_rect = pointsToRect(shape.points);
      drawOverlay();
    }
    if (event.type === "pointerup" || event.type === "pointercancel") {
      if (state.drag) {
        state.drag = null;
        queueSave();
      }
    }
  }

  function onOsdPointer(event) {
    if (!state.osd) return;
    event.preventDefault();
    event.stopPropagation();
    const m = overlayMetrics(ui.img, ui.canvas, state.canvas);
    const [wx, wy] = m.toWorld(event.clientX, event.clientY);
    if (event.type === "pointerdown") {
      const items = ["name", "datetime", "alarm"];
      for (const key of items) {
        if (!state.osd[key]?.show) continue;
        const [sx, sy] = m.toScreen(state.osd[key].pos?.x || 0, state.osd[key].pos?.y || 0);
        const dx = event.clientX - (ui.canvas.getBoundingClientRect().left + sx);
        const dy = event.clientY - (ui.canvas.getBoundingClientRect().top + sy);
        if (dx >= 0 && dy >= 0 && dx <= 120 && dy <= 24) {
          state.drag = { key, dx: wx - (state.osd[key].pos.x || 0), dy: wy - (state.osd[key].pos.y || 0) };
          ui.canvas.setPointerCapture(event.pointerId);
          drawOverlay();
          return;
        }
      }
    }
    if (event.type === "pointermove" && state.drag?.key) {
      state.osd[state.drag.key].pos = {
        x: Math.round(wx - state.drag.dx),
        y: Math.round(wy - state.drag.dy),
      };
      drawOverlay();
    }
    if (event.type === "pointerup" || event.type === "pointercancel") {
      if (state.drag) {
        state.drag = null;
        queueSave();
      }
    }
  }

  function onCoverPointer(event) {
    if (!state.cover) return;
    event.preventDefault();
    event.stopPropagation();
    const m = overlayMetrics(ui.img, ui.canvas, state.canvas);
    const [wx, wy] = m.toWorld(event.clientX, event.clientY);
    const [sx, sy] = m.toScreen(wx, wy);
    if (state.drawMode) {
      if (event.type === "pointerdown") {
        state.draft = [[wx, wy], [wx, wy]];
        ui.canvas.setPointerCapture(event.pointerId);
        drawOverlay();
      } else if (event.type === "pointermove" && state.draft.length === 2) {
        state.draft[1] = [wx, wy];
        drawOverlay();
      } else if (event.type === "pointerup") {
        finishCoverDraw();
      } else if (event.type === "pointercancel") {
        cancelCoverDraw();
      }
      return;
    }
    if (event.type === "pointerdown") {
      const zones = state.cover.zone_info || [];
      for (let i = 0; i < zones.length; i += 1) {
        if (!zones[i].zone_enable) continue;
        const pts = coverRectPoints(zones[i].rect).map(([x, y]) => m.toScreen(x, y));
        if (pts.length < 4) continue;
        const hit = hitPoint(pts, sx, sy, 12);
        const inside = sx >= Math.min(pts[0][0], pts[2][0]) && sx <= Math.max(pts[0][0], pts[2][0])
          && sy >= Math.min(pts[0][1], pts[2][1]) && sy <= Math.max(pts[0][1], pts[2][1]);
        if (hit < 0 && !inside) continue;
        state.selectedZone = i;
        state.drag = { index: i, point: hit >= 0 ? hit : -1, start: [wx, wy], rect: { ...zones[i].rect } };
        ui.canvas.setPointerCapture(event.pointerId);
        drawOverlay();
        return;
      }
    }
    if (event.type === "pointermove" && state.drag && state.drag.index != null) {
      const zone = state.cover.zone_info[state.drag.index];
      const start = state.drag.rect;
      if (state.drag.point === -1) {
        zone.rect = {
          ...start,
          left: Math.round(start.left + (wx - state.drag.start[0])),
          top: Math.round(start.top + (wy - state.drag.start[1])),
        };
      } else {
        const pts = coverRectPoints(start);
        pts[state.drag.point] = [wx, wy];
        if (state.drag.point === 0) {
          pts[1][1] = wy;
          pts[3][0] = wx;
        } else if (state.drag.point === 1) {
          pts[0][1] = wy;
          pts[2][0] = wx;
        } else if (state.drag.point === 2) {
          pts[1][0] = wx;
          pts[3][1] = wy;
        } else if (state.drag.point === 3) {
          pts[0][0] = wx;
          pts[2][1] = wy;
        }
        zone.rect = pointsToCoverRect(pts);
      }
      drawOverlay();
    }
    if (event.type === "pointerup" || event.type === "pointercancel") {
      if (state.drag) {
        state.drag = null;
        state.coverRev = (state.coverRev || 0) + 1;
        queueSave();
      }
    }
  }

  async function selectAbility(ability, force = false) {
    state.page = "events";
    if (!force && ability === state.ability && state.config) {
      renderTypes();
      return;
    }
    state.ability = ability;
    state.drawMode = false;
    state.draft = [];
    state.selectedRule = 0;
    renderTypes();
    try {
      const data = await eventApi(cam.id, `/${encodeURIComponent(ability)}`);
      state.config = data.config;
      state.range = data.range || {};
      state.canvas = data.canvas || state.canvas;
      const keys = ruleKeys(state.config);
      const onIdx = keys.findIndex((key) => state.config.rule_info[key].rule_switch);
      state.selectedRule = Math.max(0, onIdx);
      renderParams();
      drawOverlay();
    } catch (err) {
      state.config = null;
      renderParams();
      setStatus(err.message);
    }
  }

  async function openEvents() {
    const list = await eventApi(cam.id, "");
    state.groups = list.groups || [];
    state.abilities = list.abilities || {};
    const on = Object.entries(state.abilities).find(([, v]) => v === "On");
    state.ability = on?.[0] || state.ability || "Intrusion";
    state.loaded = true;
    renderTypes();
    await selectAbility(state.ability, true);
  }

  async function openStudio() {
    try {
      await selectPage(state.page);
    } catch (err) {
      ui.types.replaceChildren(Object.assign(document.createElement("p"), {
        className: "muted",
        textContent: err.message,
      }));
    }
  }

  function closeStudio() {
    state.drawMode = false;
    clearTimeout(state.saveTimer);
  }

  ui.canvas.addEventListener("pointerdown", onCanvasPointer);
  ui.canvas.addEventListener("pointermove", onCanvasPointer);
  ui.canvas.addEventListener("pointerup", onCanvasPointer);
  ui.canvas.addEventListener("pointercancel", onCanvasPointer);
  ui.tools.addEventListener("pointerdown", (event) => event.stopPropagation());
  ui.tools.addEventListener("click", (event) => event.stopPropagation());
  ui.img.addEventListener("load", () => drawOverlay());
  const ro = new ResizeObserver(() => drawOverlay());
  ro.observe(ui.stage);
  tile._openEvents = openStudio;
  tile._closeEvents = closeStudio;
}

function makeLiveTile(cam) {
  const label = cameraName(cam);
  const tile = document.createElement("article");
  tile.className = "live-tile";
  tile.dataset.cam = cam.id;
  tile.dataset.label = label;
  if (cam.ptz) tile.dataset.ptz = "1";
  tile.tabIndex = 0;
  tile.setAttribute("role", "button");
  tile.setAttribute("aria-label", `${label} live view`);
  const stage = document.createElement("div");
  stage.className = "live-stage";
  const img = document.createElement("img");
  img.alt = label;
  img.decoding = "async";
  img.dataset.stream = `/stream/${encodeURIComponent(cam.id)}`;
  const overlay = document.createElement("canvas");
  overlay.className = "event-overlay";
  stage.append(img, overlay);
  const types = document.createElement("aside");
  types.className = "event-types";
  const main = document.createElement("div");
  main.className = "event-main";
  const tools = document.createElement("div");
  tools.className = "event-tools";
  const params = document.createElement("div");
  params.className = "event-params";
  main.append(stage, tools, params);
  const bar = document.createElement("div");
  bar.className = "live-tile-bar";
  const name = document.createElement("span");
  name.textContent = label;
  const muteBtn = document.createElement("button");
  muteBtn.type = "button";
  muteBtn.className = "live-tile-mute";
  muteBtn.textContent = muted ? "Unmute" : "Mute";
  muteBtn.setAttribute("aria-pressed", muted ? "true" : "false");
  muteBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleMute();
  });
  const settingsBtn = document.createElement("button");
  settingsBtn.type = "button";
  settingsBtn.className = "live-tile-settings";
  settingsBtn.textContent = "Settings";
  settingsBtn.setAttribute("aria-label", "Camera settings");
  settingsBtn.setAttribute("aria-pressed", "false");
  settingsBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = !tile.classList.contains("settings-open");
    if (open) openLiveTile(tile);
    tile.classList.toggle("settings-open", open);
    settingsBtn.classList.toggle("active", open);
    settingsBtn.setAttribute("aria-pressed", open ? "true" : "false");
    if (open) tile._openEvents?.();
    else tile._closeEvents?.();
  });
  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "live-tile-remove";
  removeBtn.textContent = "Remove";
  removeBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    removeLiveCamera(cam);
  });
  bar.append(name, muteBtn, settingsBtn, removeBtn);
  if (cam.ptz) {
    const { panel, toggle } = makePtzPanel(cam, tile);
    removeBtn.before(toggle);
    stage.append(panel);
  }
  tile.append(types, main, bar);
  initEventStudio(tile, cam, { types, tools, params, canvas: overlay, img, stage });
  tile.addEventListener("click", () => {
    openLiveTile(tile);
  });
  tile.addEventListener("keydown", (event) => {
    if (event.code !== "Enter" && event.code !== "Space") return;
    event.preventDefault();
    openLiveTile(tile);
  });
  return tile;
}

function livePageCount() {
  return Math.max(1, Math.ceil(liveCameras.length / LIVE_PAGE_SIZE));
}

function setLivePager() {
  const pages = liveCameras.length ? livePageCount() : 0;
  if (pages && liveDashPage >= pages) liveDashPage = pages - 1;
  livePager.hidden = pages <= 1;
  livePageLabel.textContent = `${pages ? liveDashPage + 1 : 0} / ${pages}`;
  btnLivePrev.disabled = liveDashPage <= 0;
  btnLiveNext.disabled = !pages || liveDashPage >= pages - 1;
}

function drawLiveWindows() {
  for (const img of liveDash.querySelectorAll("img")) img.removeAttribute("src");
  setLivePager();
  const pageCams = liveCameras.slice(liveDashPage * LIVE_PAGE_SIZE, liveDashPage * LIVE_PAGE_SIZE + LIVE_PAGE_SIZE);
  const numWindows = pageCams.length;
  liveDash.dataset.count = String(numWindows);
  const cols = Math.min(2, Math.max(1, numWindows));
  liveDash.style.setProperty("--live-count", String(cols));
  if (numWindows === 0) {
    liveDash.replaceChildren();
    return;
  }
  const frag = document.createDocumentFragment();
  for (const cam of pageCams) frag.append(makeLiveTile(cam));
  liveDash.replaceChildren(frag);
  const imgs = liveDash.querySelectorAll(".live-stage > img");
  for (const img of imgs) img.src = img.dataset.stream;
}

async function loadLiveDash({ goToLast = false } = {}) {
  livePage.hidden = false;
  try {
    const res = await fetch("/api/cameras");
    const cams = await res.json();
    if (!res.ok || !Array.isArray(cams)) {
      statusEl.textContent = cams.error || "Could not load cameras";
      return;
    }
    liveCameras = cams;
    try {
      stopView();
    } catch {
      /* ignore */
    }
    try {
      stopLiveDash();
    } catch {
      /* ignore */
    }
    if (goToLast && cams.length) liveDashPage = livePageCount() - 1;
    else if (liveDashPage >= livePageCount()) liveDashPage = Math.max(0, livePageCount() - 1);
    drawLiveWindows();
    if (cams.length === 0) {
      statusEl.textContent = "No cameras yet — add one to start";
      return;
    }
    statusEl.textContent = cams.length === 1 ? `Live · ${cameraName(cams[0])}` : `Live dashboard · ${cams.length} cameras`;
  } catch (err) {
    statusEl.textContent = String(err.message || err);
  }
}

async function removeLiveCamera(cam) {
  const label = cameraName(cam);
  if (!confirm(`Remove camera "${label}"?`)) return;
  try {
    const res = await fetch(`/api/cameras/${encodeURIComponent(cam.id)}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not remove camera");
    statusEl.textContent = `Removed ${label}`;
    await loadLiveDash();
  } catch (err) {
    statusEl.textContent = String(err.message || err);
  }
}

function clipCamId(explicit) {
  return explicit || facesCam?.value || lastCamId || "";
}

function clipCamQuery(cam) {
  const id = clipCamId(cam);
  return id ? `&cam=${encodeURIComponent(id)}` : "";
}

function startClipFeed(rangeStart, rangeEnd, offsetMs = 0, cam) {
  const durationMs = Date.parse(rangeEnd) - Date.parse(rangeStart);
  const pos = Math.min(Math.max(0, offsetMs), Math.max(0, durationMs - 500));
  const playStart = cameraStamp(Date.parse(rangeStart) + pos);
  const remaining = Date.parse(rangeEnd) - Date.parse(playStart);
  const gen = ++clipGen;
  const camId = clipCamId(cam);
  clearTimeout(endTimer);
  clearTimeout(clipAudioTimer);
  stopTick();
  freezeFrame();
  stopAudio();
  if (clipFirstFrameHandler) {
    view.removeEventListener("load", clipFirstFrameHandler);
    clipFirstFrameHandler = null;
  }
  playback = {
    kind: "clip",
    cam: camId,
    rangeStart,
    rangeEnd,
    durationMs,
    offsetMs: pos,
    startedAt: null,
    paused: false,
  };
  seekEl.max = String(Math.floor(durationMs));
  setTransport("clip");
  setPausedUi(false);
  updateSeekUi();
  const camQ = clipCamQuery(camId);
  const feedUrl = `/clip-stream?start=${encodeURIComponent(playStart)}&end=${encodeURIComponent(rangeEnd)}${camQ}&_=${gen}`;
  const audioUrl = `/clip-audio?start=${encodeURIComponent(playStart)}&end=${encodeURIComponent(rangeEnd)}${camQ}`;
  rawLink.href = feedUrl;
  rawLink.textContent = "Open /clip-stream";

  clipFirstFrameHandler = () => {
    if (gen !== clipGen) return;
    if (!String(view.src || "").includes("/clip-stream")) return;
    if (!playback || playback.kind !== "clip" || playback.paused) return;
    if (playback.startedAt != null) return;
    playback.startedAt = performance.now();
    startTick();
    updateSeekUi();
    clearTimeout(endTimer);
    endTimer = window.setTimeout(() => {
      if (gen !== clipGen) return;
      freezeFrame();
      stopAudio();
      stopTick();
      if (clipFirstFrameHandler) {
        view.removeEventListener("load", clipFirstFrameHandler);
        clipFirstFrameHandler = null;
      }
      if (playback) {
        playback.paused = true;
        playback.offsetMs = playback.durationMs;
        playback.startedAt = null;
      }
      setPausedUi(true);
      updateSeekUi();
      if (onPlaybackEnded) onPlaybackEnded();
      else statusEl.textContent = "Clip finished";
    }, remaining + 500);
  };

  window.setTimeout(() => {
    if (gen !== clipGen) return;
    view.addEventListener("load", clipFirstFrameHandler);
    playFeed(feedUrl);
    clipAudioTimer = window.setTimeout(() => {
      if (gen !== clipGen || playback?.paused) return;
      startPcmAudio(audioUrl);
    }, 900);
  }, 450);
}

function seekTo(offsetMs) {
  if (!playback || playback.kind !== "clip") return;
  const { rangeStart, rangeEnd, cam } = playback;
  const pos = offsetMs;
  clearTimeout(clipSeekTimer);
  clipSeekTimer = window.setTimeout(() => startClipFeed(rangeStart, rangeEnd, pos, cam), 180);
}

function pausePlayback() {
  if (!playback || playback.paused) return;
  if (playback.kind === "clip") playback.offsetMs = currentPos();
  playback.paused = true;
  if (playback.kind === "clip") playback.startedAt = null;
  freezeFrame();
  stopAudio();
  clearTimeout(endTimer);
  stopTick();
  setPausedUi(true);
  updateSeekUi();
}

function resumePlayback() {
  if (!playback || !playback.paused) return;
  const pos = playback.offsetMs >= playback.durationMs ? 0 : playback.offsetMs;
  startClipFeed(playback.rangeStart, playback.rangeEnd, pos, playback.cam);
}

function togglePlayback() {
  if (!playback) return;
  if (playback.paused) resumePlayback();
  else pausePlayback();
}

function skipBy(ms) {
  seekTo(currentPos() + ms);
}

function snapStampFromFilename(filename) {
  const m = String(filename || "").match(/(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return `${m[1]}T${m[2]}:${m[3]}:${m[4]}Z`;
}

function facePlayWindow(filename, fallbackStart, fallbackEnd) {
  const snap = snapStampFromFilename(filename) || fallbackStart;
  const snapMs = Date.parse(snap);
  if (!Number.isFinite(snapMs)) return { start: fallbackStart, end: fallbackEnd };
  const startMs = snapMs - 10_000;
  return {
    start: cameraStamp(startMs),
    end: cameraStamp(startMs + 5 * 60 * 1000),
  };
}

function concatBytes(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

async function startPcmAudio(pathAndQuery) {
  stopAudio();
  audioAbort = new AbortController();
  audioCtx = new AudioContext();
  audioGain = audioCtx.createGain();
  audioGain.gain.value = muted ? 0 : 1;
  audioGain.connect(audioCtx.destination);
  const rate = audioCtx.sampleRate;
  await audioCtx.resume();
  audioNextTime = audioCtx.currentTime + 0.7;

  const url = new URL(pathAndQuery, location.origin);
  url.searchParams.set("ar", String(rate));

  try {
    const res = await fetch(url.pathname + url.search, { signal: audioAbort.signal });
    if (!res.ok || !res.body) return;
    const reader = res.body.getReader();
    let leftover = new Uint8Array(0);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const buf = concatBytes(leftover, value);
      const usable = buf.byteLength - (buf.byteLength % 2);
      leftover = buf.slice(usable);
      if (usable < 2) continue;

      const samples = new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + usable));
      const float = new Float32Array(samples.length);
      for (let i = 0; i < samples.length; i++) float[i] = samples[i] / 32768;

      const audioBuf = audioCtx.createBuffer(1, float.length, rate);
      audioBuf.copyToChannel(float, 0);
      const ahead = audioNextTime - audioCtx.currentTime;
      if (ahead > 0.45) continue;
      if (!audioGain) break;

      const src = audioCtx.createBufferSource();
      src.buffer = audioBuf;
      src.connect(audioGain);
      const startAt = Math.max(audioCtx.currentTime + 0.05, audioNextTime);
      src.start(startAt);
      audioNextTime = startAt + audioBuf.duration;
    }
  } catch (err) {
    if (err.name !== "AbortError") console.error("audio", err);
  }
}

function isPlayerFullscreen() {
  return document.fullscreenElement === player || document.webkitFullscreenElement === player;
}

function syncFullscreenLabel() {
  const on = isPlayerFullscreen();
  btnFs.textContent = on ? "Exit" : "Fullscreen";
  btnFs.title = on ? "Exit fullscreen" : "Fullscreen";
}

function toggleFullscreen() {
  if (isPlayerFullscreen()) {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    exit?.call(document);
    return;
  }
  const enter = player.requestFullscreen || player.webkitRequestFullscreen;
  enter?.call(player);
}

function stopAiPage() {
  clearInterval(aiPoll);
  aiPoll = null;
  aiDrawMode = false;
  aiDraft = null;
  const img = document.getElementById("ai-view");
  if (img) img.removeAttribute("src");
}

function selectedAiCam() {
  return document.getElementById("ai-cam")?.value || "";
}

function aiModelInfo(id = aiModel) {
  return AI_MODEL_LIST.find((item) => item.id === id) || AI_MODEL_LIST[0];
}

function syncAiTools() {
  const tools = document.getElementById("ai-tools");
  const draw = document.getElementById("ai-draw");
  if (!tools || !draw) return;
  const kind = aiModelInfo().draw;
  tools.hidden = !kind;
  draw.textContent = aiDrawMode ? "Cancel" : "Draw";
  draw.classList.toggle("active", aiDrawMode);
}

async function aiApi(method, body, cam = selectedAiCam(), path = "") {
  const q = cam ? `?cam=${encodeURIComponent(cam)}` : "";
  const res = await fetch(`/api/ai${path}${q}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function aiVideoMetrics(img, canvas) {
  const cr = canvas.getBoundingClientRect();
  const ir = img.getBoundingClientRect();
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (!nw || !nh || !ir.width || !ir.height) return null;
  const scale = Math.min(ir.width / nw, ir.height / nh);
  const dw = nw * scale;
  const dh = nh * scale;
  const left = ir.left - cr.left + (ir.width - dw) / 2;
  const top = ir.top - cr.top + (ir.height - dh) / 2;
  return {
    toNorm(clientX, clientY) {
      const x = (clientX - cr.left - left) / dw;
      const y = (clientY - cr.top - top) / dh;
      return [clamp(x, 0, 1), clamp(y, 0, 1)];
    },
    toScreen(nx, ny) {
      return [left + nx * dw, top + ny * dh];
    },
  };
}

function drawAiOverlay() {
  const img = document.getElementById("ai-view");
  const canvas = document.getElementById("ai-overlay");
  if (!img || !canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const kind = aiModelInfo().draw;
  const cam = selectedAiCam();
  let box = aiDraft;
  if (!box && kind === "box" && aiZone.a && aiZone.b && (!aiZone.cam || aiZone.cam === cam)) {
    box = [aiZone.a, aiZone.b];
  }
  if (!box && kind === "line" && aiLine.a && aiLine.b && (!aiLine.cam || aiLine.cam === cam)) {
    box = [aiLine.a, aiLine.b];
  }
  if (!box) return;
  const m = aiVideoMetrics(img, canvas);
  if (!m) return;
  const [x1, y1] = m.toScreen(box[0][0], box[0][1]);
  const [x2, y2] = m.toScreen(box[1][0], box[1][1]);
  ctx.strokeStyle = "#1e4d8c";
  ctx.lineWidth = 2;
  if (kind === "line") {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.fillStyle = "#fff";
    for (const [x, y] of [[x1, y1], [x2, y2]]) {
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#111";
      ctx.stroke();
      ctx.strokeStyle = "#1e4d8c";
    }
    return;
  }
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  ctx.fillStyle = "rgba(30, 77, 140, 0.16)";
  ctx.fillRect(left, top, Math.abs(x2 - x1), Math.abs(y2 - y1));
  ctx.strokeRect(left, top, Math.abs(x2 - x1), Math.abs(y2 - y1));
}

function eventLineText(event) {
  if (event.track != null) return `Track ${event.track}`;
  if (event.direction) return event.direction;
  if (event.count != null) return `${event.count} fire`;
  if (event.age != null) return `Age ${event.age}`;
  return event.type || "alarm";
}

function renderAiTypes() {
  const root = document.getElementById("ai-types");
  if (!root) return;
  root.replaceChildren();
  root.append(Object.assign(document.createElement("p"), {
    className: "event-group-title",
    textContent: "Detectors",
  }));
  for (const item of AI_MODEL_LIST) {
    const on = Boolean(aiModels[item.id]);
    const card = document.createElement("div");
    card.className = "event-card event-sub-card";
    if (item.id === aiModel) card.classList.add("active");
    if (on) card.classList.add("on");
    const head = document.createElement("div");
    head.className = "event-card-head";
    const name = document.createElement("span");
    name.textContent = item.label;
    const sw = document.createElement("input");
    sw.type = "checkbox";
    sw.className = "event-switch";
    sw.checked = on;
    sw.addEventListener("click", (event) => event.stopPropagation());
    sw.addEventListener("change", () => {
      sw.checked = on;
      toggleAiModel(item.id, !on);
    });
    head.append(name, sw);
    card.append(head);
    card.addEventListener("click", (event) => {
      if (event.target.closest("input")) return;
      selectAiModel(item.id);
    });
    root.append(card);
  }
}

function selectAiModel(id) {
  if (!AI_MODEL_LIST.some((item) => item.id === id)) return;
  aiModel = id;
  aiDrawMode = false;
  aiDraft = null;
  renderAiTypes();
  syncAiTools();
  renderAiStats();
  statusEl.textContent = `AI · ${aiModelInfo().label}`;
}

async function toggleAiModel(id, on) {
  try {
    const data = await aiApi("POST", { [id]: on }, selectedAiCam(), "/models");
    aiModels = { ...aiModels, ...data.models };
    renderAiTypes();
    renderAiStats();
    statusEl.textContent = `${aiModelInfo(id).label} ${on ? "On" : "Off"}`;
  } catch (err) {
    statusEl.textContent = String(err.message || err);
    renderAiTypes();
  }
}

function renderAiStats(state) {
  const prevModels = JSON.stringify(aiModels);
  if (state) {
    if (state.models) aiModels = { ...aiModels, ...state.models };
    if (state.zone) {
      const cam = selectedAiCam();
      const sameCam = !state.zone.cam || !cam || state.zone.cam === cam;
      aiZone = sameCam
        ? { a: state.zone.a || null, b: state.zone.b || null, cam: state.zone.cam || cam || null }
        : { a: null, b: null, cam };
    }
    if (state.line) {
      const cam = selectedAiCam();
      const sameCam = !state.line.cam || !cam || state.line.cam === cam;
      aiLine = sameCam
        ? {
          a: state.line.a || null,
          b: state.line.b || null,
          side: state.line.side || null,
          cam: state.line.cam || cam || null,
        }
        : { a: null, b: null, side: null, cam };
    }
  }
  const info = aiModelInfo();
  const modelStats = state?.stats?.[info.id] || {};
  const live = Boolean(state?.stats?.live);
  document.getElementById("ai-stat-kicker").textContent = "Python models";
  document.getElementById("ai-stat-title").textContent = info.label;
  document.getElementById("ai-stat-live").textContent = live ? "Running" : "Idle";
  document.getElementById("ai-stat-on").textContent = aiModels[info.id] ? "On" : "Off";
  const zoneRow = document.getElementById("ai-stat-zone-row");
  const insideRow = document.getElementById("ai-stat-inside-row");
  if (info.draw === "box") {
    zoneRow.hidden = false;
    document.getElementById("ai-stat-zone-label").textContent = "Zone";
    document.getElementById("ai-stat-zone").textContent = aiZone.a ? "Drawn" : "None";
  } else if (info.draw === "line") {
    zoneRow.hidden = false;
    document.getElementById("ai-stat-zone-label").textContent = "Line";
    document.getElementById("ai-stat-zone").textContent = aiLine.a ? "Drawn" : "None";
  } else {
    zoneRow.hidden = true;
  }
  insideRow.hidden = info.id !== "area_intrusion";
  document.getElementById("ai-stat-inside").textContent = String(modelStats.inside ?? 0);
  document.getElementById("ai-stat-total").textContent = String(modelStats.total ?? 0);
  const list = document.getElementById("ai-stat-recent");
  list.replaceChildren();
  const recent = [...(modelStats.recent || [])].reverse().slice(0, 12);
  for (const event of recent) {
    const li = document.createElement("li");
    const when = event.t ? new Date(event.t * 1000).toLocaleTimeString() : "";
    li.append(
      Object.assign(document.createElement("span"), { textContent: eventLineText(event) }),
      Object.assign(document.createElement("span"), { textContent: when }),
    );
    list.append(li);
  }
  if (!recent.length) {
    list.append(Object.assign(document.createElement("li"), { textContent: "No alarms yet" }));
  }
  syncAiTools();
  const typesRoot = document.getElementById("ai-types");
  if (JSON.stringify(aiModels) !== prevModels || !typesRoot?.childElementCount) {
    renderAiTypes();
  }
  drawAiOverlay();
}

async function refreshAi() {
  const cam = selectedAiCam();
  try {
    renderAiStats(await aiApi("GET", null, cam));
  } catch (err) {
    statusEl.textContent = String(err.message || err);
  }
}

function setAiStream(camId) {
  const img = document.getElementById("ai-view");
  if (!img) return;
  aiDraft = null;
  img.src = camId ? `/stream/${encodeURIComponent(camId)}` : "";
}

function onAiPointer(event) {
  const kind = aiModelInfo().draw;
  if (!aiDrawMode || !kind) return;
  const img = document.getElementById("ai-view");
  const canvas = document.getElementById("ai-overlay");
  const m = aiVideoMetrics(img, canvas);
  if (!m) return;
  const pt = m.toNorm(event.clientX, event.clientY);
  if (event.type === "pointerdown") {
    event.preventDefault();
    aiDraft = [pt, pt];
    canvas.setPointerCapture(event.pointerId);
    drawAiOverlay();
    return;
  }
  if (event.type === "pointermove" && aiDraft) {
    aiDraft[1] = pt;
    drawAiOverlay();
    return;
  }
  if ((event.type === "pointerup" || event.type === "pointercancel") && aiDraft) {
    const [a, b] = aiDraft;
    aiDraft = null;
    aiDrawMode = false;
    syncAiTools();
    const len = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (len < 0.03) {
      drawAiOverlay();
      return;
    }
    const cam = selectedAiCam();
    if (!cam) {
      statusEl.textContent = "Pick a camera first";
      drawAiOverlay();
      return;
    }
    const req = kind === "line"
      ? aiApi("POST", { a, b, cam }, cam, "/line")
      : aiApi("POST", { a, b, cam }, cam);
    req.then((saved) => {
      if (kind === "line") aiLine = saved;
      else aiZone = saved;
      statusEl.textContent = kind === "line" ? "Tripwire saved" : "Area box saved";
      drawAiOverlay();
    }).catch((err) => {
      statusEl.textContent = String(err.message || err);
    });
  }
}

async function startAiPage() {
  const cam = document.getElementById("ai-cam");
  const draw = document.getElementById("ai-draw");
  const clear = document.getElementById("ai-clear");
  const img = document.getElementById("ai-view");
  const canvas = document.getElementById("ai-overlay");
  const stage = document.querySelector(".ai-stage");
  if (!aiBound) {
    aiBound = true;
    cam.addEventListener("change", () => {
      lastCamId = cam.value;
      aiDrawMode = false;
      aiDraft = null;
      aiZone = { a: null, b: null, cam: cam.value || null };
      aiLine = { a: null, b: null, side: null, cam: cam.value || null };
      syncAiTools();
      setAiStream(cam.value);
      drawAiOverlay();
      refreshAi();
    });
    draw.addEventListener("click", () => {
      if (!aiModelInfo().draw) return;
      aiDrawMode = !aiDrawMode;
      aiDraft = null;
      syncAiTools();
      statusEl.textContent = aiDrawMode
        ? (aiModelInfo().draw === "line" ? "Drag a line on the stream" : "Drag a box on the stream")
        : `AI · ${aiModelInfo().label}`;
      drawAiOverlay();
    });
    clear.addEventListener("click", async () => {
      aiDrawMode = false;
      aiDraft = null;
      syncAiTools();
      const camId = selectedAiCam();
      const kind = aiModelInfo().draw;
      try {
        if (kind === "line") {
          aiLine = await aiApi("DELETE", null, camId, "/line");
          statusEl.textContent = "Tripwire cleared";
        } else {
          aiZone = await aiApi("DELETE", null, camId);
          statusEl.textContent = "Area box cleared";
        }
        drawAiOverlay();
        renderAiStats();
      } catch (err) {
        statusEl.textContent = String(err.message || err);
      }
    });
    canvas.addEventListener("pointerdown", onAiPointer);
    canvas.addEventListener("pointermove", onAiPointer);
    canvas.addEventListener("pointerup", onAiPointer);
    canvas.addEventListener("pointercancel", onAiPointer);
    img.addEventListener("load", () => drawAiOverlay());
    new ResizeObserver(() => drawAiOverlay()).observe(stage);
  }
  try {
    await fillCamSelect(cam, lastCamId);
    setAiStream(cam.value);
    await refreshAi();
  } catch (err) {
    statusEl.textContent = String(err.message || err);
  }
  clearInterval(aiPoll);
  aiPoll = setInterval(() => {
    if (document.hidden) return;
    refreshAi().catch(() => {});
  }, 1000);
}

function showAi({ push = true } = {}) {
  if (push) history.pushState({}, "", "/ai");
  setChrome({
    page: "ai",
    status: "AI models",
    mode: "AI",
    rawHref: "/api/ai",
    rawText: "Open /api/ai",
    showPlayer: false,
  });
  stopView();
  return startAiPage();
}

function setChrome({ page, status, mode, rawHref, rawText, showPlayer = true }) {
  document.body.dataset.page = page;
  liveBtn.classList.toggle("active", page === "live");
  clipBtn.classList.toggle("active", page === "clip");
  aiBtn.classList.toggle("active", page === "ai");
  facesBtn.classList.toggle("active", page === "faces");
  groupsBtn.classList.toggle("active", page === "groups");
  liveDot.classList.toggle("on", page === "live");
  clipForm.hidden = page !== "clip";
  facesGallery.hidden = page !== "faces";
  groupsPage.hidden = page !== "groups";
  livePage.hidden = page !== "live";
  aiPage.hidden = page !== "ai";
  player.hidden = page === "live" || page === "ai" || !showPlayer;
  if (page !== "live") {
    stopLiveDash();
    cameraModal.close();
  }
  if (page !== "ai") stopAiPage();
  if (!showPlayer && isPlayerFullscreen()) {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    exit?.call(document);
  }
  statusEl.textContent = status;
  modeLabel.textContent = mode;
  rawLink.href = rawHref;
  rawLink.textContent = rawText;
  if (page !== "faces") stopFacesPoll();
  if (page !== "groups") closeGroupModal();
}

function showLive({ push = true } = {}) {
  if (push) history.pushState({}, "", "/live");
  setChrome({
    page: "live",
    status: "Live dashboard",
    mode: "Live",
    rawHref: "/api/cameras",
    rawText: "Cameras",
    showPlayer: false,
  });
  return loadLiveDash();
}

function showClipForm({ push = true } = {}) {
  if (push) history.pushState({}, "", "/clip");
  if (!startInput.value || !endInput.value) fillClipRange(5);
  setChrome({
    page: "clip",
    status: "Pick start and end, then play",
    mode: "Clip",
    rawHref: "/clip-stream",
    rawText: "Open /clip-stream",
  });
  stopView();
}

function showGroups({ push = true } = {}) {
  if (push) history.pushState({}, "", "/groups");
  setChrome({
    page: "groups",
    status: "Face groups",
    mode: "Groups",
    rawHref: "/api/groups",
    rawText: "Open /api/groups",
    showPlayer: false,
  });
  stopView();
  return loadGroups();
}

function clipRange() {
  const start = toCameraTime(startInput.value);
  const end = toCameraTime(endInput.value);
  const ms = Date.parse(end) - Date.parse(start);
  if (!(ms > 0)) {
    statusEl.textContent = "End must be after start";
    return null;
  }
  return { start, end, ms };
}

function playClip({ push = true } = {}) {
  const range = clipRange();
  if (!range) return;
  const cam = clipCamId();
  const camQ = clipCamQuery(cam);

  const pageUrl = `/clip?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}${cam ? `&cam=${encodeURIComponent(cam)}` : ""}`;
  const feedUrl = `/clip-stream?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}${camQ}`;
  if (push) history.pushState({}, "", pageUrl);

  setChrome({
    page: "clip",
    status: "Playing archive",
    mode: "Clip · /clip-stream",
    rawHref: feedUrl,
    rawText: "Open /clip-stream",
  });
  onPlaybackEnded = () => showLive({ push: true });
  startClipFeed(range.start, range.end, 0, cam);
}

async function saveClipToDisk() {
  const range = clipRange();
  if (!range) return;
  statusEl.textContent = "Saving clip…";
  const camQ = clipCamQuery();
  const url = `/save-clip?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}${camQ}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) {
      statusEl.textContent = data.error || "Save failed";
      return;
    }
    statusEl.replaceChildren("Saved ");
    const link = document.createElement("a");
    link.href = data.file;
    link.textContent = data.file;
    link.target = "_blank";
    statusEl.append(link);
  } catch (err) {
    statusEl.textContent = String(err.message || err);
  }
}

async function loadGroups() {
  groupsEmpty.hidden = false;
  groupsEmpty.textContent = "Loading groups…";
  groupsList.replaceChildren();
  try {
    const res = await fetch("/api/groups");
    const groups = await res.json();
    if (!res.ok || !Array.isArray(groups)) {
      groupsEmpty.textContent = groups.error || "Could not load groups";
      return;
    }
    if (groups.length === 0) {
      groupsEmpty.textContent = "No groups yet";
      return;
    }
    groupsEmpty.hidden = true;
    const frag = document.createDocumentFragment();
    for (const group of groups) frag.append(makeGroupRow(group));
    groupsList.replaceChildren(frag);
    const camCount = groups.reduce((n, g) => Math.max(n, (g.cameras || []).length), 0);
    statusEl.textContent =
      camCount > 1
        ? `${groups.length} groups · synced across ${camCount} face-DB cameras`
        : `${groups.length} group${groups.length === 1 ? "" : "s"}`;
  } catch (err) {
    groupsEmpty.textContent = String(err.message || err);
  }
}

function policyClass(policy) {
  if (Number(policy) === 1) return "deny";
  if (Number(policy) === 2) return "stranger";
  return "allow";
}

function iconButton(label, svg) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "icon-btn";
  btn.title = label;
  btn.setAttribute("aria-label", label);
  btn.innerHTML = svg;
  return btn;
}

function toggleSwitch(checked) {
  const wrap = document.createElement("label");
  wrap.className = "switch";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = Boolean(checked);
  const knob = document.createElement("span");
  wrap.append(input, knob);
  wrap._input = input;
  return wrap;
}

function makeGroupRow(group) {
  const tr = document.createElement("tr");
  tr.dataset.id = String(group.id);
  tr.dataset.matchName = group.name || "";
  tr.dataset.canDel = String(group.canDel ?? 1);
  const locked = Number(group.canDel) === 0;

  const statusTd = document.createElement("td");
  statusTd.className = "col-status";
  const status = document.createElement("span");
  status.className = `group-status ${policyClass(group.policy)}`;
  status.title = policyClass(group.policy);
  statusTd.append(status);

  const nameTd = document.createElement("td");
  nameTd.dataset.label = "Group Name";
  const name = document.createElement("input");
  name.type = "text";
  name.value = group.name || "";
  name.dataset.field = "name";
  name.readOnly = locked;
  if (locked) name.title = "Built-in group";
  nameTd.append(name);

  const delTd = document.createElement("td");
  delTd.dataset.label = "Delete";
  const del = iconButton(
    "Delete",
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 7V5h6v2M8 7l1 12h6l1-12"/></svg>',
  );
  del.classList.add("group-del");
  del.disabled = locked;
  del.addEventListener("click", () => deleteGroupRow(tr, group));
  delTd.append(del);

  const editTd = document.createElement("td");
  editTd.dataset.label = "Edit";
  const edit = iconButton(
    "Edit faces",
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20h4l10.5-10.5-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>',
  );
  edit.addEventListener("click", () => openEditGroup(group));
  editTd.append(edit);

  const enableTd = document.createElement("td");
  enableTd.dataset.label = "Enable";
  const enable = toggleSwitch(Number(group.enabled) === 1);
  enable._input.dataset.field = "enabled";
  enableTd.append(enable);

  const alarmTd = document.createElement("td");
  alarmTd.dataset.label = "Alarm";
  const alarm = toggleSwitch(Number(group.enableAlarm) === 1);
  alarm._input.dataset.field = "enableAlarm";
  alarmTd.append(alarm);

  const policyTd = document.createElement("td");
  policyTd.dataset.label = "Policy";
  const policyLabels = { 0: "Allow", 1: "Deny", 2: "Stranger" };
  if (locked) {
    const policyText = document.createElement("span");
    policyText.className = "policy-locked";
    policyText.textContent = policyLabels[Number(group.policy)] || "Allow";
    const hidden = document.createElement("input");
    hidden.type = "hidden";
    hidden.dataset.field = "policy";
    hidden.value = String(group.policy ?? 0);
    policyTd.append(policyText, hidden);
  } else {
    const policy = document.createElement("select");
    policy.dataset.field = "policy";
    for (const [v, label] of [
      ["0", "Allow"],
      ["1", "Deny"],
      ["2", "Stranger"],
    ]) {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = label;
      policy.append(opt);
    }
    policy.value = String(group.policy ?? 0);
    policy.addEventListener("change", () => {
      status.className = `group-status ${policyClass(policy.value)}`;
      status.title = policyClass(policy.value);
    });
    policyTd.append(policy);
  }

  const simTd = document.createElement("td");
  simTd.dataset.label = "Similarity";
  const simWrap = document.createElement("div");
  simWrap.className = "similarity-cell";
  const op = document.createElement("select");
  op.dataset.field = "detectType";
  op.setAttribute("aria-label", "Similarity operator");
  for (const [v, label] of [
    ["0", "≥"],
    ["1", "<"],
  ]) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = label;
    op.append(opt);
  }
  op.value = String(group.detectType ?? 0);
  const sim = document.createElement("input");
  sim.type = "number";
  sim.min = "0";
  sim.max = "100";
  sim.dataset.field = "similarity";
  sim.setAttribute("aria-label", "Similarity percent");
  sim.value = group.similarity ?? 70;
  const pct = document.createElement("span");
  pct.textContent = "%";
  simWrap.append(op, sim, pct);
  simTd.append(simWrap);

  const gearSvg =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';

  const linkageTd = document.createElement("td");
  linkageTd.dataset.label = "Alarm Linkage";
  const linkage = iconButton("Alarm Linkage", gearSvg);
  linkage.classList.add("group-gear");
  linkage.addEventListener("click", () => {
    statusEl.textContent = `Alarm Linkage for "${group.name || "group"}" is set on the camera (IMPACT → Event → List Management)`;
  });
  linkageTd.append(linkage);

  const scheduleTd = document.createElement("td");
  scheduleTd.dataset.label = "Alarm Schedule";
  const schedule = iconButton("Alarm Schedule", gearSvg);
  schedule.classList.add("group-gear");
  schedule.addEventListener("click", () => {
    statusEl.textContent = `Alarm Schedule for "${group.name || "group"}" is set on the camera (IMPACT → Event → List Management)`;
  });
  scheduleTd.append(schedule);

  tr.append(
    statusTd,
    nameTd,
    delTd,
    editTd,
    enableTd,
    alarmTd,
    policyTd,
    simTd,
    linkageTd,
    scheduleTd,
  );
  return tr;
}

function rowGroupPayload(tr) {
  const val = (field) => tr.querySelector(`[data-field="${field}"]`)?.value;
  const checked = (field) => (tr.querySelector(`[data-field="${field}"]`)?.checked ? 1 : 0);
  return {
    matchName: tr.dataset.matchName || val("name")?.trim(),
    name: val("name")?.trim(),
    enabled: checked("enabled"),
    enableAlarm: checked("enableAlarm"),
    policy: val("policy"),
    detectType: val("detectType"),
    similarity: val("similarity"),
  };
}

async function deleteGroupRow(tr, group) {
  if (Number(group.canDel) === 0) return;
  if (!confirm(`Delete group "${group.name}" on all face-DB cameras?`)) return;
  try {
    const name = encodeURIComponent(group.name || tr.dataset.matchName || "");
    const res = await fetch(`/api/groups/${encodeURIComponent(group.id)}?name=${name}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Delete failed");
    const cams = data.cameras ?? 1;
    statusEl.textContent = cams > 1 ? `Group deleted on ${cams} cameras` : "Group deleted";
    await loadGroups();
  } catch (err) {
    statusEl.textContent = String(err.message || err);
  }
}

async function saveGroupsTable() {
  const rows = [...groupsList.querySelectorAll("tr")];
  let ok = 0;
  let fail = 0;
  let camHits = 0;
  for (const tr of rows) {
    try {
      const res = await fetch(`/api/groups/${encodeURIComponent(tr.dataset.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(rowGroupPayload(tr)),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      ok += 1;
      camHits = Math.max(camHits, data.cameras || 1);
    } catch (err) {
      fail += 1;
      console.error("save group", tr.dataset.id, err);
    }
  }
  statusEl.textContent =
    fail === 0
      ? `Saved ${ok} group${ok === 1 ? "" : "s"} on ${camHits} camera${camHits === 1 ? "" : "s"}`
      : `Saved ${ok}, failed ${fail}`;
  await loadGroups();
}

function closeNestedDialogs() {
  if (importModal.open) importModal.close();
  if (snapsModal.open) snapsModal.close();
}

function closeGroupModal() {
  closeNestedDialogs();
  if (groupModal.open) groupModal.close();
  editingGrpId = null;
  groupPeople = [];
  faceIndex = 0;
  faceDirty = false;
  modalSnapsGrid.replaceChildren();
}

function readFaceForm() {
  return {
    name: faceFields.name.value.trim(),
    gender: faceFields.gender.value,
    age: faceFields.age.value,
    country: faceFields.country.value.trim(),
    nation: faceFields.nation.value.trim(),
    nativePlace: faceFields.nativePlace.value.trim(),
    idCode: faceFields.idCode.value.trim(),
    job: faceFields.job.value.trim(),
    phone: faceFields.phone.value.trim(),
    email: faceFields.email.value.trim(),
    domicile: faceFields.domicile.value.trim(),
    remark: faceFields.remark.value.trim(),
  };
}

function fillFaceForm(person) {
  faceFields.name.value = person?.name || "";
  faceFields.gender.value = person?.gender === 1 || person?.gender === 2 ? String(person.gender) : "0";
  faceFields.age.value = person?.age && Number(person.age) !== 0 ? person.age : "";
  faceFields.country.value = person?.country || "";
  faceFields.nation.value = person?.nation || "";
  faceFields.nativePlace.value = person?.nativePlace || "";
  faceFields.idCode.value = person?.idCode || "";
  faceFields.job.value = person?.job || "";
  faceFields.phone.value = person?.phone || "";
  faceFields.email.value = person?.email || "";
  faceFields.domicile.value = person?.domicile || "";
  faceFields.remark.value = person?.remark || "";
  faceDirty = false;
}

function showCurrentFace() {
  const total = groupPeople.length;
  const person = groupPeople[faceIndex];
  editFacePage.textContent = `${total ? faceIndex + 1 : 0} / ${total}`;
  fillFaceForm(person);
  if (person?.url) {
    editFaceImg.hidden = false;
    editFaceEmpty.hidden = true;
    editFaceImg.alt = person.name || "Face";
    editFaceImg.src = `${person.url}?t=${Date.now()}`;
  } else {
    editFaceImg.removeAttribute("src");
    editFaceImg.hidden = true;
    editFaceEmpty.hidden = false;
  }
}

async function saveCurrentFace() {
  const person = groupPeople[faceIndex];
  if (!person || !faceDirty) return;
  const res = await fetch(
    `/api/groups/${encodeURIComponent(editingGrpId)}/faces/${encodeURIComponent(person.id)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(readFaceForm()),
    },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Save failed");
  Object.assign(person, readFaceForm());
  faceDirty = false;
  statusEl.textContent = "Saved";
}

async function openEditGroup(group) {
  editingGrpId = group.id;
  groupModalTitle.textContent = group.name || "Group";
  groupPeople = [];
  faceIndex = 0;
  fillFaceForm(null);
  editFaceImg.removeAttribute("src");
  editFaceImg.hidden = true;
  editFaceEmpty.hidden = false;
  editFacePage.textContent = "0 / 0";
  if (!groupModal.open) groupModal.showModal();
  await loadGroupPeople();
}

async function loadGroupPeople({ keepIndex = false } = {}) {
  const grpId = editingGrpId;
  if (!grpId) return;
  const res = await fetch(`/api/groups/${encodeURIComponent(grpId)}/faces`);
  const people = await res.json();
  if (!res.ok || !Array.isArray(people)) {
    groupPeople = [];
    showCurrentFace();
    statusEl.textContent = people.error || "Could not load faces";
    return;
  }
  const prevId = keepIndex ? groupPeople[faceIndex]?.id : null;
  groupPeople = people;
  if (prevId != null) {
    const next = people.findIndex((p) => p.id === prevId);
    faceIndex = next >= 0 ? next : Math.max(0, people.length - 1);
  } else {
    faceIndex = 0;
  }
  if (faceIndex >= groupPeople.length) faceIndex = Math.max(0, groupPeople.length - 1);
  showCurrentFace();
}

async function stepFace(delta) {
  if (!groupPeople.length) return;
  try {
    await saveCurrentFace();
  } catch (err) {
    statusEl.textContent = String(err.message || err);
    return;
  }
  faceIndex = (faceIndex + delta + groupPeople.length) % groupPeople.length;
  showCurrentFace();
}

async function addFacesToGroup(jobs, extra = {}) {
  const grpId = editingGrpId;
  if (!grpId) {
    statusEl.textContent = "Open a group to add photos";
    return;
  }
  if (!jobs.length) {
    statusEl.textContent = "Choose one or more photos";
    return;
  }
  const fields = { ...readFaceForm(), ...extra };
  let ok = 0;
  let fail = 0;
  let lastId = null;
  for (let i = 0; i < jobs.length; i++) {
    statusEl.textContent = `Adding ${i + 1}/${jobs.length}…`;
    try {
      const res = await fetch(`/api/groups/${encodeURIComponent(grpId)}/faces`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...fields, ...(await jobs[i].body()) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Add face failed");
      ok += 1;
      lastId = data.id ?? lastId;
    } catch (err) {
      fail += 1;
      console.error("add face", jobs[i].label, err);
    }
  }
  await loadGroupPeople();
  if (lastId != null) {
    const idx = groupPeople.findIndex((p) => p.id === lastId);
    if (idx >= 0) {
      faceIndex = idx;
      showCurrentFace();
    }
  }
  statusEl.textContent =
    fail === 0
      ? `Added ${ok} photo${ok === 1 ? "" : "s"}`
      : `Added ${ok}, failed ${fail}`;
}

function selectedSnapUuids() {
  return [...snapSelected];
}

function syncSnapSaveUi() {
  btnAddSnaps.disabled = snapSelected.size === 0;
  snapsSharedName.hidden = !snapsSameName.checked;
  snapsSharedName.disabled = !snapsSameName.checked;
  updateSnapPager();
}

function snapCaption(face) {
  if (face.start) return fromCameraTime(face.start).replace("T", " ").slice(11, 19);
  if (face.name && face.name !== "unknown") return face.name;
  return "Snap";
}

function makeSnapPick(face) {
  const uuid = face.uuid || face.filename || "";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "snap-pick";
  btn.dataset.uuid = uuid;
  if (snapSelected.has(uuid)) btn.classList.add("selected");
  const img = document.createElement("img");
  img.src = face.image || face.url;
  img.alt = snapCaption(face);
  img.decoding = "async";
  const cap = document.createElement("span");
  cap.textContent = snapCaption(face);
  btn.append(img, cap);
  btn.addEventListener("click", () => {
    btn.classList.toggle("selected");
    if (btn.classList.contains("selected")) snapSelected.add(uuid);
    else snapSelected.delete(uuid);
    syncSnapSaveUi();
  });
  return btn;
}

function snapPageCount() {
  return Math.max(1, Math.ceil(snapTotal / snapPageSize) || 1);
}

function syncSnapPageSize() {
  const grid = modalSnapsGrid;
  const body = grid.parentElement;
  if (!body) return snapPageSize;
  const cs = getComputedStyle(grid);
  const min = parseFloat(cs.getPropertyValue("--snap-min")) || 96;
  const gap = parseFloat(cs.columnGap || cs.gap) || 8;
  const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  const w = Math.max(min, (grid.clientWidth || body.clientWidth) - padX);
  const h = Math.max(min, body.clientHeight - padY - (modalSnapsEmpty.offsetHeight || 0));
  const cols = Math.max(1, Math.floor((w + gap) / (min + gap)));
  const tile = (w - gap * (cols - 1)) / cols;
  const cap = 24;
  const rows = Math.max(1, Math.floor((h + gap) / (tile + cap + gap)));
  snapPageSize = Math.max(cols, cols * rows);
  return snapPageSize;
}

function snapFacesUrl(page, limit) {
  return `/api/faces?start=${page * limit}&end=${(page + 1) * limit}&offset=${page * limit}&limit=${limit}${camQuery(snapsCam)}${facesDateQuery()}`;
}

function updateSnapPager() {
  const pages = snapTotal ? snapPageCount() : 0;
  const snapsPageEl = document.getElementById("snaps-page");
  const sel = snapSelected.size ? ` · ${snapSelected.size} selected` : "";
  snapsPageEl.textContent = `${pages ? snapPage + 1 : 0} / ${pages}${sel}`;
  document.getElementById("btn-snaps-prev").disabled = snapPage <= 0;
  document.getElementById("btn-snaps-next").disabled = !pages || snapPage >= pages - 1;
}

async function loadCapturedSnaps() {
  const reqId = ++snapFetchId;
  const limit = syncSnapPageSize();
  if (!modalSnapsGrid.childElementCount) {
    modalSnapsEmpty.hidden = false;
    modalSnapsEmpty.textContent = "Loading snapshots…";
  }
  updateSnapPager();
  try {
    const res = await fetch(snapFacesUrl(snapPage, limit));
    const data = await res.json();
    if (reqId !== snapFetchId) return;
    const faces = Array.isArray(data) ? data : data.faces;
    snapTotal = Array.isArray(data) ? data.length : Number(data.total) || 0;
    if (!res.ok || !Array.isArray(faces)) {
      modalSnapsEmpty.hidden = false;
      modalSnapsEmpty.textContent = data.error || "Could not load snapshots";
      return;
    }
    if (snapTotal === 0) {
      modalSnapsGrid.replaceChildren();
      modalSnapsEmpty.hidden = false;
      modalSnapsEmpty.textContent = "No captured snapshots yet";
      updateSnapPager();
      syncSnapSaveUi();
      return;
    }
    modalSnapsEmpty.hidden = true;
    if (syncSnapPageSize() !== limit) return loadCapturedSnaps();
    const frag = document.createDocumentFragment();
    for (const face of faces) frag.append(makeSnapPick(face));
    modalSnapsGrid.replaceChildren(frag);
    updateSnapPager();
    syncSnapSaveUi();
  } catch (err) {
    if (reqId !== snapFetchId) return;
    modalSnapsEmpty.hidden = false;
    modalSnapsEmpty.textContent = String(err.message || err);
  }
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read image"));
    reader.readAsDataURL(file);
  });
}

function stopFacesPoll() {
  clearInterval(facesPoll);
  facesPoll = null;
}

function startFacesPoll() {
  stopFacesPoll();
  facesPoll = setInterval(() => {
    if (document.hidden) return;
    refreshFaces().catch(() => {});
  }, 3000);
}

function makeFaceCard(face) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "face-card";
  btn.dataset.start = face.start || "";
  btn.dataset.filename = face.filename || "";
  const img = document.createElement("img");
  img.src = face.image || face.url;
  img.alt = face.name;
  img.decoding = "async";
  const cap = document.createElement("span");
  cap.className = "face-cap";
  const name = document.createElement("strong");
  name.textContent = face.name;
  cap.append(name);
  if (face.start) {
    const when = document.createElement("em");
    when.textContent = fromCameraTime(face.start).replace("T", " ");
    cap.append(when);
  }
  btn.append(img, cap);
  btn.addEventListener("click", () => {
    if (!face.start || !face.end) {
      statusEl.textContent = "This snapshot has no start time";
      return;
    }
    playFaceClip(face.start, face.end, { filename: face.filename });
  });
  return btn;
}

function faceGridCount(name, fallback) {
  const raw = getComputedStyle(facesGallery).getPropertyValue(name);
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function syncFacesPageSize() {
  facesPageSize = faceGridCount("--face-cols", 6) * faceGridCount("--face-rows", 2);
  return facesPageSize;
}

function facesPageCount() {
  return Math.max(1, Math.ceil(facesTotal / facesPageSize) || 1);
}

function updateFacesPager() {
  const pages = facesTotal ? facesPageCount() : 0;
  facesPageEl.textContent = `${pages ? facesPage + 1 : 0} / ${pages}`;
  btnFacesPrev.disabled = facesPage <= 0;
  btnFacesNext.disabled = !pages || facesPage >= pages - 1;
}

function renderFaceCards(faces, selectedStart) {
  const frag = document.createDocumentFragment();
  for (const face of faces) {
    const card = makeFaceCard(face);
    if (selectedStart && face.start === selectedStart) card.classList.add("selected");
    frag.append(card);
  }
  facesGrid.replaceChildren(frag);
}

async function showFaces({ push = true } = {}) {
  if (push) history.pushState({}, "", "/faces");
  setChrome({
    page: "faces",
    status: "Camera snapshots",
    mode: "Faces",
    rawHref: "/clip-stream",
    rawText: "Open /clip-stream",
    showPlayer: false,
  });
  stopView();
  syncFacesDateUi();
  try {
    await fillCamSelect(facesCam);
  } catch (err) {
    facesEmpty.hidden = false;
    facesEmpty.textContent = String(err.message || err);
    facesGrid.replaceChildren();
    return;
  }
  return loadFaces();
}

async function fetchFacesPage({ names = true, track = true, page = facesPage } = {}) {
  const reqId = track ? ++facesFetchId : facesFetchId;
  syncFacesPageSize();
  const start = page * facesPageSize;
  const end = start + facesPageSize;
  const qs = `/api/faces?start=${start}&end=${end}&offset=${start}&limit=${facesPageSize}${names ? "&names=1" : ""}${camQuery(facesCam)}${facesDateQuery()}${facesFilterQuery()}`;
  const res = await fetch(qs, { cache: "no-store" });
  const data = await res.json();
  const faces = Array.isArray(data) ? data : data.faces;
  const total = Array.isArray(data) ? data.length : Number(data.total) || 0;
  return { reqId, res, data, faces, total, page };
}

async function loadFaces(page = facesPage) {
  stopFacesPoll();
  const from = facesPage;
  const target = Math.max(0, page);
  const limit = syncFacesPageSize();
  if (!facesGrid.childElementCount) {
    facesEmpty.hidden = false;
    facesEmpty.textContent = "Loading snapshots…";
  } else {
    facesEmpty.hidden = true;
  }
  btnFacesPrev.disabled = true;
  btnFacesNext.disabled = true;
  let poll = false;
  try {
    let { reqId, res, data, faces, total } = await fetchFacesPage({ names: true, page: target });
    if (reqId !== facesFetchId) return;
    if (!res.ok || (Array.isArray(faces) && total > 0 && !faces.length)) {
      const retry = await fetchFacesPage({ names: true, page: target });
      if (retry.reqId !== facesFetchId) return;
      ({ res, data, faces, total } = retry);
    }
    facesTotal = total;
    let shown = target;
    if (facesTotal && shown >= facesPageCount()) {
      shown = Math.max(0, facesPageCount() - 1);
      if (shown !== target) {
        const again = await fetchFacesPage({ names: true, page: shown });
        if (again.reqId !== facesFetchId) return;
        ({ res, data, faces, total } = again);
        facesTotal = total;
      }
    }
    if (!res.ok || !Array.isArray(faces) || (facesTotal > 0 && !faces.length)) {
      updateFacesPager();
      if (!facesGrid.childElementCount) {
        facesEmpty.hidden = false;
        facesEmpty.textContent = data.error || "Could not load snapshots";
      }
      return;
    }
    if (facesTotal === 0) {
      facesPage = 0;
      facesGrid.replaceChildren();
      facesEmpty.hidden = false;
      facesEmpty.textContent = facesFilterActive()
        ? "No snapshots match this filter"
        : "No snapshots yet";
      updateFacesPager();
      poll = true;
      return;
    }
    facesPage = shown;
    facesEmpty.hidden = true;
    renderFaceCards(faces);
    updateFacesPager();
    if (syncFacesPageSize() !== limit) return loadFaces(facesPage);
    poll = true;
  } catch (err) {
    facesPage = from;
    updateFacesPager();
    if (!facesGrid.childElementCount) {
      facesEmpty.hidden = false;
      facesEmpty.textContent = String(err.message || err);
    }
  }
  if (poll && !facesGallery.hidden && facesDateValue() === localDateValue()) startFacesPoll();
}

async function refreshFaces() {
  if (facesPage !== 0) return;
  if (facesDateValue() !== localDateValue()) return;
  let res, faces, total, reqId;
  try {
    ({ reqId, res, faces, total } = await fetchFacesPage({ names: false, track: false, page: 0 }));
  } catch {
    stopFacesPoll();
    return;
  }
  if (reqId !== facesFetchId) return;
  if (!res.ok || !Array.isArray(faces)) {
    stopFacesPoll();
    return;
  }
  facesTotal = total;
  updateFacesPager();
  if (facesTotal === 0) {
    facesEmpty.hidden = false;
    facesEmpty.textContent = "No snapshots yet";
    facesGrid.replaceChildren();
    return;
  }
  facesEmpty.hidden = true;
  const have = [...facesGrid.querySelectorAll(".face-card")].map((el) => el.dataset.filename).join("\0");
  const incoming = faces.map((face) => face.filename).join("\0");
  if (have === incoming) return;
  const selectedStart = facesGrid.querySelector(".face-card.selected")?.dataset.start;
  renderFaceCards(faces, selectedStart);
}

function playFaceClip(start, end, { push = true, filename } = {}) {
  const range = facePlayWindow(filename, start, end);
  const ms = Date.parse(range.end) - Date.parse(range.start);
  if (!(ms > 0)) {
    statusEl.textContent = "End must be after start";
    return;
  }
  const cam = clipCamId();
  const camQ = clipCamQuery(cam);
  const pageUrl = `/faces?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}${cam ? `&cam=${encodeURIComponent(cam)}` : ""}`;
  const feedUrl = `/clip-stream?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}${camQ}`;
  if (push) history.pushState({}, "", pageUrl);
  setChrome({
    page: "faces",
    status: "Playing archive",
    mode: "Clip · /clip-stream",
    rawHref: feedUrl,
    rawText: "Open /clip-stream",
    showPlayer: true,
  });
  for (const card of facesGrid.querySelectorAll(".face-card")) {
    card.classList.toggle("selected", card.dataset.start === start);
  }
  onPlaybackEnded = () => {
    statusEl.textContent = "Clip finished";
  };
  startClipFeed(range.start, range.end, 0, cam);
  player.scrollIntoView({ behavior: "smooth", block: "start" });
}

function applyUrl() {
  const url = new URL(location.href);
  if (url.pathname === "/faces") {
    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");
    const cam = url.searchParams.get("cam");
    if (cam) lastCamId = cam;
    showFaces({ push: false }).then(() => {
      if (cam && facesCam) facesCam.value = cam;
      if (start && end) {
        const card = [...facesGrid.querySelectorAll(".face-card")].find((el) => el.dataset.start === start);
        playFaceClip(start, end, { push: false, filename: card?.dataset.filename });
      }
    });
    return;
  }
  if (url.pathname === "/groups") {
    showGroups({ push: false });
    return;
  }
  if (url.pathname === "/ai") {
    showAi({ push: false });
    return;
  }
  if (url.pathname === "/clip") {
    startInput.value = fromCameraTime(url.searchParams.get("start"));
    endInput.value = fromCameraTime(url.searchParams.get("end"));
    if (startInput.value && endInput.value) playClip({ push: false });
    else showClipForm({ push: false });
    return;
  }
  showLive({ push: false });
  if (url.pathname !== "/live") history.replaceState({}, "", "/live");
}

btnAddGroup.addEventListener("click", async (event) => {
  event.preventDefault();
  const names = new Set(
    [...groupsList.querySelectorAll('[data-field="name"]')].map((el) => el.value.trim()),
  );
  let n = 1;
  while (names.has(`Group ${n}`)) n += 1;
  try {
    const res = await fetch("/api/groups", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `Group ${n}` }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Create group failed");
    const cams = data.cameras ?? 1;
    statusEl.textContent = cams > 1 ? `Created ${data.name} on ${cams} cameras` : `Created ${data.name}`;
    await loadGroups();
  } catch (err) {
    statusEl.textContent = String(err.message || err);
  }
});

btnSaveGroups.addEventListener("click", () => {
  saveGroupsTable().catch((err) => {
    statusEl.textContent = String(err.message || err);
  });
});
btnRefreshGroups.addEventListener("click", () => loadGroups());

btnCloseModal.addEventListener("click", async () => {
  try {
    await saveCurrentFace();
  } catch (err) {
    statusEl.textContent = String(err.message || err);
  }
  closeGroupModal();
});

groupModal.addEventListener("close", () => {
  closeNestedDialogs();
});

document.getElementById("face-info-form").addEventListener("submit", (event) => {
  event.preventDefault();
});
document.getElementById("face-info-form").addEventListener("input", () => {
  faceDirty = true;
});
document.getElementById("face-info-form").addEventListener("change", () => {
  faceDirty = true;
});

document.getElementById("btn-face-prev").addEventListener("click", () => {
  stepFace(-1).catch((err) => {
    statusEl.textContent = String(err.message || err);
  });
});
document.getElementById("btn-face-next").addEventListener("click", () => {
  stepFace(1).catch((err) => {
    statusEl.textContent = String(err.message || err);
  });
});

document.getElementById("btn-import-face").addEventListener("click", () => {
  if (!importModal.open) importModal.showModal();
});
document.getElementById("btn-import-cancel").addEventListener("click", () => importModal.close());
document.getElementById("btn-import-local").addEventListener("click", () => {
  importModal.close();
  faceFileInput.click();
});
document.getElementById("btn-import-capture").addEventListener("click", () => {
  importModal.close();
  snapPage = 0;
  snapSelected.clear();
  snapsSameName.checked = false;
  snapsSharedName.value = "";
  syncSnapSaveUi();
  if (!snapsModal.open) snapsModal.showModal();
  fillCamSelect(snapsCam, facesCam.value || lastCamId)
    .then(() => {
      requestAnimationFrame(() => loadCapturedSnaps());
    })
    .catch((err) => {
      modalSnapsEmpty.hidden = false;
      modalSnapsEmpty.textContent = String(err.message || err);
    });
});
document.getElementById("btn-close-snaps").addEventListener("click", () => snapsModal.close());
btnFacesPrev.addEventListener("click", () => {
  if (facesPage <= 0) return;
  loadFaces(facesPage - 1);
});
btnFacesNext.addEventListener("click", () => {
  if (facesPage >= facesPageCount() - 1) return;
  loadFaces(facesPage + 1);
});

facesCam.addEventListener("change", () => {
  lastCamId = facesCam.value;
  facesPage = 0;
  loadFaces();
});

facesDate.addEventListener("change", () => {
  syncFacesDateUi();
  facesPage = 0;
  facesGrid.replaceChildren();
  loadFaces();
});
document.getElementById("btn-faces-date-prev").addEventListener("click", () => shiftFacesDate(-1));
document.getElementById("btn-faces-date-next").addEventListener("click", () => shiftFacesDate(1));

const facesFilterForm = document.getElementById("faces-filter-form");
const btnFacesFilter = document.getElementById("btn-faces-filter");

function showFaceFeatureCat(cat) {
  for (const el of facesFilterForm.querySelectorAll(".face-features-cat")) {
    el.classList.toggle("active", el.dataset.cat === cat);
  }
  for (const el of facesFilterForm.querySelectorAll(".face-features-sub")) {
    el.hidden = el.dataset.sub !== cat;
  }
}

function syncFaceFeatureAll(name) {
  const boxes = [...facesFilterForm.querySelectorAll(`input[name="${name}"]`)];
  const all = facesFilterForm.querySelector(`input[data-all="${name}"]`);
  if (!all || !boxes.length) return;
  const on = boxes.filter((box) => box.checked).length;
  all.checked = on === boxes.length;
  all.indeterminate = on > 0 && on < boxes.length;
}

function closeFaceFeatures() {
  facesFilterForm.hidden = true;
}

btnFacesFilter.addEventListener("click", (event) => {
  event.stopPropagation();
  facesFilterForm.hidden = !facesFilterForm.hidden;
});

facesFilterForm.addEventListener("click", (event) => event.stopPropagation());

for (const cat of facesFilterForm.querySelectorAll(".face-features-cat")) {
  cat.addEventListener("click", (event) => {
    if (event.target.closest("input")) return;
    showFaceFeatureCat(cat.dataset.cat);
  });
}

for (const all of facesFilterForm.querySelectorAll("input[data-all]")) {
  all.addEventListener("change", () => {
    const name = all.dataset.all;
    for (const box of facesFilterForm.querySelectorAll(`input[name="${name}"]`)) {
      box.checked = all.checked;
    }
    syncFacesFilterButton();
  });
}

for (const box of facesFilterForm.querySelectorAll("input[name]")) {
  box.addEventListener("change", () => {
    syncFaceFeatureAll(box.name);
    syncFacesFilterButton();
  });
}

facesFilterForm.addEventListener("submit", (event) => {
  event.preventDefault();
  for (const all of facesFilterForm.querySelectorAll("input[data-all]")) {
    syncFaceFeatureAll(all.dataset.all);
  }
  syncFacesFilterButton();
  closeFaceFeatures();
  facesPage = 0;
  loadFaces();
});

facesFilterForm.addEventListener("pointerdown", (event) => event.stopPropagation());
document.addEventListener("click", () => {
  if (!facesFilterForm.hidden) closeFaceFeatures();
});
syncFacesFilterButton();

snapsCam.addEventListener("change", () => {
  lastCamId = snapsCam.value;
  snapPage = 0;
  snapSelected.clear();
  syncSnapSaveUi();
  loadCapturedSnaps();
});

snapsSameName.addEventListener("change", () => {
  syncSnapSaveUi();
  if (snapsSameName.checked) snapsSharedName.focus();
});

snapsSharedName.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  btnAddSnaps.click();
});

if (typeof ResizeObserver !== "undefined" && modalSnapsGrid.parentElement) {
  new ResizeObserver(() => {
    if (!snapsModal.open) return;
    clearTimeout(snapResizeTimer);
    snapResizeTimer = setTimeout(() => {
      const first = snapPage * snapPageSize;
      const prev = snapPageSize;
      syncSnapPageSize();
      if (snapPageSize === prev) return;
      snapPage = Math.floor(first / snapPageSize);
      loadCapturedSnaps();
    }, 160);
  }).observe(modalSnapsGrid.parentElement);
}

document.getElementById("btn-snaps-prev").addEventListener("click", () => {
  if (snapPage <= 0) return;
  snapPage -= 1;
  loadCapturedSnaps();
});
document.getElementById("btn-snaps-next").addEventListener("click", () => {
  if (snapPage >= snapPageCount() - 1) return;
  snapPage += 1;
  loadCapturedSnaps();
});

document.getElementById("btn-add-snaps").addEventListener("click", async () => {
  const uuids = selectedSnapUuids();
  if (!uuids.length) {
    statusEl.textContent = "Choose one or more photos";
    return;
  }
  const extra = { name: "" };
  if (snapsSameName.checked) {
    const name = snapsSharedName.value.trim();
    if (!name) {
      statusEl.textContent = "Enter a name for the selected photos";
      snapsSharedName.hidden = false;
      snapsSharedName.focus();
      return;
    }
    extra.name = name;
  }
  await addFacesToGroup(
    uuids.map((uuid) => ({
      label: uuid,
      body: async () => ({ uuid, cam: snapsCam.value }),
    })),
    extra,
  );
  snapSelected.clear();
  snapsModal.close();
});

faceFileInput.addEventListener("change", async () => {
  const files = [...(faceFileInput.files || [])];
  faceFileInput.value = "";
  await addFacesToGroup(
    files.map((file) => ({
      label: file.name,
      body: async () => ({ image: await readFileAsBase64(file) }),
    })),
  );
});

document.getElementById("btn-delete-face").addEventListener("click", async () => {
  const person = groupPeople[faceIndex];
  if (!person) {
    statusEl.textContent = "No photo to delete";
    return;
  }
  if (!confirm("Delete this photo?")) return;
  try {
    const res = await fetch(
      `/api/groups/${encodeURIComponent(editingGrpId)}/faces/${encodeURIComponent(person.id)}`,
      { method: "DELETE" },
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Delete failed");
    faceDirty = false;
    statusEl.textContent = "Photo deleted";
    await loadGroupPeople({ keepIndex: true });
    if (faceIndex >= groupPeople.length) faceIndex = Math.max(0, groupPeople.length - 1);
    showCurrentFace();
  } catch (err) {
    statusEl.textContent = String(err.message || err);
  }
});

liveBtn.addEventListener("click", (event) => {
  event.preventDefault();
  showLive();
});

btnLivePrev.addEventListener("click", () => {
  if (liveDashPage <= 0) return;
  liveDashPage -= 1;
  drawLiveWindows();
});

btnLiveNext.addEventListener("click", () => {
  if (liveDashPage >= livePageCount() - 1) return;
  liveDashPage += 1;
  drawLiveWindows();
});

const camScanList = document.getElementById("cam-scan-list");
const camScanStatus = document.getElementById("cam-scan-status");
const camHostInput = document.getElementById("cam-host");

function renderScanList(hosts) {
  camScanList.replaceChildren();
  camScanList.hidden = hosts.length === 0;
  for (const host of hosts) {
    const item = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = host;
    btn.addEventListener("click", () => {
      camHostInput.value = host;
      camHostInput.focus();
    });
    item.append(btn);
    camScanList.append(item);
  }
}

document.getElementById("btn-add-camera").addEventListener("click", () => {
  cameraForm.reset();
  renderScanList([]);
  camScanStatus.textContent = "";
  if (!cameraModal.open) cameraModal.showModal();
});

document.getElementById("btn-camera-scan").addEventListener("click", async () => {
  const btn = document.getElementById("btn-camera-scan");
  btn.disabled = true;
  camScanStatus.textContent = "Scanning…";
  renderScanList([]);
  try {
    const res = await fetch("/api/cameras/scan");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Scan failed");
    const hosts = Array.isArray(data.hosts) ? data.hosts : [];
    renderScanList(hosts);
    camScanStatus.textContent = hosts.length ? `${hosts.length} found` : "No cameras found";
  } catch (err) {
    camScanStatus.textContent = String(err.message || err);
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("btn-camera-cancel").addEventListener("click", () => {
  cameraModal.close();
});

cameraForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const saveBtn = document.getElementById("btn-camera-save");
  const body = {
    name: document.getElementById("cam-name").value.trim(),
    host: document.getElementById("cam-host").value.trim(),
    username: document.getElementById("cam-user").value.trim(),
    password: document.getElementById("cam-pass").value,
  };
  saveBtn.disabled = true;
  camScanStatus.textContent = "Checking camera…";
  try {
    const res = await fetch("/api/cameras", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Could not add camera");
    cameraModal.close();
    statusEl.textContent = data.ptz ? `Added ${data.name} · PTZ available` : `Added ${data.name}`;
    await loadLiveDash({ goToLast: true });
  } catch (err) {
    camScanStatus.textContent = String(err.message || err);
  } finally {
    saveBtn.disabled = false;
  }
});

clipBtn.addEventListener("click", (event) => {
  event.preventDefault();
  showClipForm();
});

aiBtn.addEventListener("click", (event) => {
  event.preventDefault();
  showAi();
});

facesBtn.addEventListener("click", (event) => {
  event.preventDefault();
  showFaces();
});

groupsBtn.addEventListener("click", (event) => {
  event.preventDefault();
  showGroups();
});

document.getElementById("clip-5").addEventListener("click", () => fillClipRange(5));
document.getElementById("clip-15").addEventListener("click", () => fillClipRange(15));

clipForm.addEventListener("submit", (event) => {
  event.preventDefault();
  playClip();
});

document.getElementById("btn-save").addEventListener("click", () => {
  saveClipToDisk();
});

btnPlay.addEventListener("click", () => togglePlayback());
btnMute.addEventListener("click", () => toggleMute());
btnBack.addEventListener("click", () => skipBy(-10_000));
btnFwd.addEventListener("click", () => skipBy(10_000));
btnFs.addEventListener("click", () => toggleFullscreen());
view.addEventListener("click", () => togglePlayback());
document.addEventListener("fullscreenchange", () => {
  syncFullscreenLabel();
  onLiveTileFullscreen();
});
document.addEventListener("webkitfullscreenchange", () => {
  syncFullscreenLabel();
  onLiveTileFullscreen();
});

seekEl.addEventListener("input", () => {
  seekDragging = true;
  if (playback?.kind === "clip") {
    timeLabel.textContent = `${formatClock(Number(seekEl.value))} / ${formatClock(playback.durationMs)}`;
  }
});
seekEl.addEventListener("change", () => {
  seekDragging = false;
  seekTo(Number(seekEl.value));
});

window.addEventListener("keydown", (event) => {
  if (!(event.target instanceof Element)) return;
  if (event.target.closest("input, textarea, select")) return;
  if (event.code === "Space") {
    if (event.target.closest("button, a")) return;
    if (!playback) return;
    event.preventDefault();
    togglePlayback();
    return;
  }
  if (event.code === "ArrowLeft") {
    if (!playback || playback.kind !== "clip") return;
    event.preventDefault();
    skipBy(-10_000);
  }
  if (event.code === "ArrowRight") {
    if (!playback || playback.kind !== "clip") return;
    event.preventDefault();
    skipBy(10_000);
  }
  if (event.code === "KeyM") {
    if (focusedLiveTile()) {
      event.preventDefault();
      toggleMute();
      return;
    }
    if (player.hidden || !playback) return;
    event.preventDefault();
    toggleMute();
    return;
  }
  if (event.code === "KeyF") {
    const tile = focusedLiveTile();
    if (tile) {
      event.preventDefault();
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      exit?.call(document);
      return;
    }
    if (player.hidden) return;
    event.preventDefault();
    toggleFullscreen();
  }
});

window.addEventListener("popstate", applyUrl);
window.addEventListener("resize", () => {
  if (document.body.dataset.page !== "faces" || facesGallery.hidden) return;
  clearTimeout(facesResizeTimer);
  facesResizeTimer = setTimeout(() => {
    const first = facesPage * facesPageSize;
    const prev = facesPageSize;
    syncFacesPageSize();
    if (facesPageSize === prev) return;
    facesPage = Math.floor(first / facesPageSize);
    loadFaces();
  }, 180);
});
window.addEventListener("pointerdown", () => {
  audioCtx?.resume();
});
applyUrl();
