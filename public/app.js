const view = document.getElementById("view");
const statusEl = document.getElementById("status");
const liveBtn = document.getElementById("btn-live");
const clipBtn = document.getElementById("btn-clip");
const facesBtn = document.getElementById("btn-faces");
const groupsBtn = document.getElementById("btn-groups");
const clipForm = document.getElementById("clip-form");
const player = document.getElementById("player");
const liveDash = document.getElementById("live-dash");
const facesGallery = document.getElementById("faces-gallery");
const groupsPage = document.getElementById("groups-page");
const facesGrid = document.getElementById("faces-grid");
const facesEmpty = document.getElementById("faces-empty");
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
let audioAbort;
let audioCtx;
let audioGain;
let audioNextTime = 0;
let muted = false;
let playback = null;
let seekDragging = false;
let onPlaybackEnded = null;
let facesPoll;
let editingGrpId = null;
let groupPeople = [];
let faceIndex = 0;
let faceDirty = false;
let snapPage = 0;
let snapTotal = 0;
const SNAP_PAGE_SIZE = 12;
let facesPageSize = 10;
let facesPage = 0;
let facesTotal = 0;
let facesResizeTimer;
const snapSelected = new Set();

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
  if (playback.paused) return playback.offsetMs;
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
  if (kind === "clip") startTick();
  else stopTick();
}

function playFeed(videoUrl, audioUrl) {
  stopAudio();
  view.src = videoUrl;
  if (audioUrl) startPcmAudio(audioUrl);
}

function stopView() {
  clearTimeout(endTimer);
  stopTick();
  stopAudio();
  view.removeAttribute("src");
  playback = null;
  onPlaybackEnded = null;
  setTransport(null);
}

function startLiveFeed(cam = "eng") {
  clearTimeout(endTimer);
  playback = { kind: "live", paused: false, cam };
  onPlaybackEnded = null;
  setTransport("live");
  setPausedUi(false);
  playFeed(`/stream/${cam}`, `/stream-audio/${cam}`);
}

function stopLiveDash() {
  for (const img of liveDash.querySelectorAll("img")) img.removeAttribute("src");
  liveDash.replaceChildren();
}

function focusedLiveTile() {
  const fs = document.fullscreenElement || document.webkitFullscreenElement;
  return fs?.classList?.contains("live-tile") ? fs : null;
}

function openLiveTile(tile) {
  if (focusedLiveTile() === tile) return;
  const enter = tile.requestFullscreen || tile.webkitRequestFullscreen;
  enter?.call(tile);
}

function onLiveTileFullscreen() {
  const tile = focusedLiveTile();
  if (!tile) {
    if (document.body.dataset.page === "live") stopAudio();
    return;
  }
  const cam = tile.dataset.cam;
  const label = tile.dataset.label || cam;
  statusEl.textContent = `Live · ${label}`;
  modeLabel.textContent = `Live · ${label}`;
  startPcmAudio(`/stream-audio/${cam}`);
}

function makeLiveTile(cam) {
  const tile = document.createElement("article");
  tile.className = "live-tile";
  tile.dataset.cam = cam.id;
  tile.dataset.label = cam.label;
  tile.tabIndex = 0;
  tile.setAttribute("role", "button");
  tile.setAttribute("aria-label", `${cam.label} live view`);
  const img = document.createElement("img");
  img.alt = cam.label;
  img.src = `/stream/${encodeURIComponent(cam.id)}`;
  const bar = document.createElement("div");
  bar.className = "live-tile-bar";
  const name = document.createElement("span");
  name.textContent = cam.label;
  const muteBtn = document.createElement("button");
  muteBtn.type = "button";
  muteBtn.className = "live-tile-mute";
  muteBtn.textContent = muted ? "Unmute" : "Mute";
  muteBtn.setAttribute("aria-pressed", muted ? "true" : "false");
  muteBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleMute();
  });
  bar.append(name, muteBtn);
  tile.append(img, bar);
  tile.addEventListener("click", () => openLiveTile(tile));
  tile.addEventListener("keydown", (event) => {
    if (event.code !== "Enter" && event.code !== "Space") return;
    event.preventDefault();
    openLiveTile(tile);
  });
  return tile;
}

async function loadLiveDash() {
  stopView();
  stopLiveDash();
  liveDash.hidden = false;
  try {
    const res = await fetch("/api/cameras");
    const cams = await res.json();
    if (!res.ok || !Array.isArray(cams) || cams.length === 0) {
      statusEl.textContent = "No live cameras configured";
      return;
    }
    liveDash.classList.toggle("one", cams.length === 1);
    const frag = document.createDocumentFragment();
    for (const cam of cams) frag.append(makeLiveTile(cam));
    liveDash.replaceChildren(frag);
    statusEl.textContent = cams.length === 1 ? `Live · ${cams[0].label}` : "Live dashboard";
  } catch (err) {
    statusEl.textContent = String(err.message || err);
  }
}

function startClipFeed(rangeStart, rangeEnd, offsetMs = 0) {
  const durationMs = Date.parse(rangeEnd) - Date.parse(rangeStart);
  const pos = Math.min(Math.max(0, offsetMs), Math.max(0, durationMs - 500));
  const playStart = cameraStamp(Date.parse(rangeStart) + pos);
  const remaining = Date.parse(rangeEnd) - Date.parse(playStart);
  const feedUrl = `/clip-stream?start=${encodeURIComponent(playStart)}&end=${encodeURIComponent(rangeEnd)}`;
  playback = {
    kind: "clip",
    rangeStart,
    rangeEnd,
    durationMs,
    offsetMs: pos,
    startedAt: performance.now(),
    paused: false,
  };
  seekEl.max = String(Math.floor(durationMs));
  setTransport("clip");
  setPausedUi(false);
  rawLink.href = feedUrl;
  rawLink.textContent = "Open /clip-stream";
  playFeed(feedUrl, `/clip-audio?start=${encodeURIComponent(playStart)}&end=${encodeURIComponent(rangeEnd)}`);
  clearTimeout(endTimer);
  endTimer = setTimeout(() => {
    freezeFrame();
    stopAudio();
    stopTick();
    if (playback) {
      playback.paused = true;
      playback.offsetMs = playback.durationMs;
    }
    setPausedUi(true);
    updateSeekUi();
    if (onPlaybackEnded) onPlaybackEnded();
    else statusEl.textContent = "Clip finished";
  }, remaining + 2000);
}

function pausePlayback() {
  if (!playback || playback.paused) return;
  if (playback.kind === "clip") playback.offsetMs = currentPos();
  playback.paused = true;
  freezeFrame();
  stopAudio();
  clearTimeout(endTimer);
  stopTick();
  setPausedUi(true);
  updateSeekUi();
}

function resumePlayback() {
  if (!playback || !playback.paused) return;
  if (playback.kind === "live") {
    startLiveFeed(playback.cam || "eng");
    return;
  }
  const pos = playback.offsetMs >= playback.durationMs ? 0 : playback.offsetMs;
  startClipFeed(playback.rangeStart, playback.rangeEnd, pos);
}

function togglePlayback() {
  if (!playback) return;
  if (playback.paused) resumePlayback();
  else pausePlayback();
}

function seekTo(offsetMs) {
  if (!playback || playback.kind !== "clip") return;
  startClipFeed(playback.rangeStart, playback.rangeEnd, offsetMs);
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

function setChrome({ page, status, mode, rawHref, rawText, showPlayer = true }) {
  document.body.dataset.page = page;
  liveBtn.classList.toggle("active", page === "live");
  clipBtn.classList.toggle("active", page === "clip");
  facesBtn.classList.toggle("active", page === "faces");
  groupsBtn.classList.toggle("active", page === "groups");
  liveDot.classList.toggle("on", page === "live");
  clipForm.hidden = page !== "clip";
  facesGallery.hidden = page !== "faces";
  groupsPage.hidden = page !== "groups";
  liveDash.hidden = page !== "live";
  player.hidden = page === "live" || !showPlayer;
  if (page !== "live") stopLiveDash();
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

  const pageUrl = `/clip?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}`;
  const feedUrl = `/clip-stream?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}`;
  if (push) history.pushState({}, "", pageUrl);

  setChrome({
    page: "clip",
    status: "Playing archive",
    mode: "Clip · /clip-stream",
    rawHref: feedUrl,
    rawText: "Open /clip-stream",
  });
  onPlaybackEnded = () => showLive({ push: true });
  startClipFeed(range.start, range.end, 0);
}

async function saveClipToDisk() {
  const range = clipRange();
  if (!range) return;
  statusEl.textContent = "Saving clip… wait about as long as the clip lasts";
  const url = `/save-clip?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}`;
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
  tr.dataset.canDel = String(group.canDel ?? 1);

  const statusTd = document.createElement("td");
  const status = document.createElement("span");
  status.className = `group-status ${policyClass(group.policy)}`;
  statusTd.append(status);

  const nameTd = document.createElement("td");
  const name = document.createElement("input");
  name.type = "text";
  name.value = group.name || "";
  name.dataset.field = "name";
  nameTd.append(name);

  const delTd = document.createElement("td");
  const del = iconButton(
    "Delete",
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 7V5h6v2M8 7l1 12h6l1-12"/></svg>',
  );
  del.disabled = Number(group.canDel) === 0;
  del.addEventListener("click", () => deleteGroupRow(tr, group));
  delTd.append(del);

  const editTd = document.createElement("td");
  const edit = iconButton(
    "Edit",
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 20h4l10.5-10.5-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>',
  );
  edit.addEventListener("click", () => openEditGroup(group));
  editTd.append(edit);

  const enableTd = document.createElement("td");
  const enable = toggleSwitch(Number(group.enabled) === 1);
  enable._input.dataset.field = "enabled";
  enableTd.append(enable);

  const alarmTd = document.createElement("td");
  const alarm = toggleSwitch(Number(group.enableAlarm) === 1);
  alarm._input.dataset.field = "enableAlarm";
  alarmTd.append(alarm);

  const policyTd = document.createElement("td");
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
  });
  policyTd.append(policy);

  const simTd = document.createElement("td");
  const simWrap = document.createElement("div");
  simWrap.className = "similarity-cell";
  const op = document.createElement("select");
  op.dataset.field = "detectType";
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
  sim.value = group.similarity ?? 70;
  const pct = document.createElement("span");
  pct.textContent = "%";
  simWrap.append(op, sim, pct);
  simTd.append(simWrap);

  tr.append(statusTd, nameTd, delTd, editTd, enableTd, alarmTd, policyTd, simTd);
  return tr;
}

function rowGroupPayload(tr) {
  const val = (field) => tr.querySelector(`[data-field="${field}"]`)?.value;
  const checked = (field) => (tr.querySelector(`[data-field="${field}"]`)?.checked ? 1 : 0);
  return {
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
  if (!confirm(`Delete group "${group.name}"?`)) return;
  try {
    const res = await fetch(`/api/groups/${encodeURIComponent(group.id)}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Delete failed");
    statusEl.textContent = "Group deleted";
    await loadGroups();
  } catch (err) {
    statusEl.textContent = String(err.message || err);
  }
}

async function saveGroupsTable() {
  const rows = [...groupsList.querySelectorAll("tr")];
  let ok = 0;
  let fail = 0;
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
    } catch (err) {
      fail += 1;
      console.error("save group", tr.dataset.id, err);
    }
  }
  statusEl.textContent =
    fail === 0 ? `Saved ${ok} group${ok === 1 ? "" : "s"}` : `Saved ${ok}, failed ${fail}`;
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

async function addFacesToGroup(jobs) {
  const grpId = editingGrpId;
  if (!grpId) {
    statusEl.textContent = "Open a group to add photos";
    return;
  }
  if (!jobs.length) {
    statusEl.textContent = "Choose one or more photos";
    return;
  }
  const fields = readFaceForm();
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
  img.src = face.url;
  img.alt = snapCaption(face);
  img.loading = "lazy";
  const cap = document.createElement("span");
  cap.textContent = snapCaption(face);
  btn.append(img, cap);
  btn.addEventListener("click", () => {
    btn.classList.toggle("selected");
    if (btn.classList.contains("selected")) snapSelected.add(uuid);
    else snapSelected.delete(uuid);
    if (snapTotal) {
      modalSnapsEmpty.textContent = `${snapSelected.size} selected · page ${snapPage + 1} of ${snapPageCount()}`;
    }
  });
  return btn;
}

function snapPageCount() {
  return Math.max(1, Math.ceil(snapTotal / SNAP_PAGE_SIZE) || 1);
}

function updateSnapPager() {
  const pages = snapTotal ? snapPageCount() : 0;
  const snapsPageEl = document.getElementById("snaps-page");
  snapsPageEl.textContent = `${pages ? snapPage + 1 : 0} / ${pages}`;
  document.getElementById("btn-snaps-prev").disabled = snapPage <= 0;
  document.getElementById("btn-snaps-next").disabled = !pages || snapPage >= pages - 1;
}

async function loadCapturedSnaps() {
  modalSnapsEmpty.hidden = false;
  modalSnapsEmpty.textContent = "Loading snapshots…";
  modalSnapsGrid.replaceChildren();
  updateSnapPager();
  try {
    const res = await fetch(`/api/faces?offset=${snapPage * SNAP_PAGE_SIZE}&limit=${SNAP_PAGE_SIZE}`);
    const data = await res.json();
    const faces = Array.isArray(data) ? data : data.faces;
    snapTotal = Array.isArray(data) ? data.length : Number(data.total) || 0;
    if (!res.ok || !Array.isArray(faces)) {
      modalSnapsEmpty.textContent = data.error || "Could not load snapshots";
      return;
    }
    if (snapTotal === 0) {
      modalSnapsEmpty.textContent = "No captured snapshots yet";
      updateSnapPager();
      return;
    }
    modalSnapsEmpty.textContent = `${snapSelected.size} selected · page ${snapPage + 1} of ${snapPageCount()}`;
    const frag = document.createDocumentFragment();
    for (const face of faces) frag.append(makeSnapPick(face));
    modalSnapsGrid.replaceChildren(frag);
    updateSnapPager();
  } catch (err) {
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
  img.src = face.url;
  img.alt = face.name;
  img.loading = "lazy";
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

function faceColumnCount() {
  const raw = getComputedStyle(facesGallery).getPropertyValue("--face-cols");
  const cols = Number.parseInt(raw, 10);
  return Number.isFinite(cols) && cols > 0 ? cols : 10;
}

function syncFacesPageSize() {
  const cols = faceColumnCount();
  if (facesGallery.hidden) {
    facesPageSize = cols;
    return facesPageSize;
  }
  const styles = getComputedStyle(facesGrid);
  const gap = Number.parseFloat(styles.rowGap) || 14;
  const width = facesGrid.clientWidth;
  const height = facesGrid.clientHeight;
  const colW = width > 0 ? (width - gap * Math.max(0, cols - 1)) / cols : 120;
  const sample = facesGrid.querySelector(".face-card");
  const cardH = sample ? sample.getBoundingClientRect().height : Math.max(96, colW + 58);
  const available = height || Math.max(0, window.innerHeight - facesGrid.getBoundingClientRect().top - 24);
  const rows = Math.max(1, Math.floor((available + gap) / (cardH + gap)));
  facesPageSize = cols * rows;
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

function applyFaceNames(faces) {
  const cards = [...facesGrid.querySelectorAll(".face-card")];
  const byFile = new Map(cards.map((el) => [el.dataset.filename, el]));
  for (const face of faces) {
    const el = byFile.get(face.filename);
    if (!el) continue;
    const strong = el.querySelector(".face-cap strong");
    if (strong && face.name && strong.textContent !== face.name) {
      strong.textContent = face.name;
      const img = el.querySelector("img");
      if (img) img.alt = face.name;
    }
  }
}

function showFaces({ push = true } = {}) {
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
  return loadFaces();
}

async function fetchFacesPage() {
  syncFacesPageSize();
  const res = await fetch(
    `/api/faces?offset=${facesPage * facesPageSize}&limit=${facesPageSize}&names=1`,
  );
  const data = await res.json();
  const faces = Array.isArray(data) ? data : data.faces;
  const total = Array.isArray(data) ? data.length : Number(data.total) || 0;
  return { res, data, faces, total };
}

async function loadFaces() {
  stopFacesPoll();
  const limit = syncFacesPageSize();
  facesEmpty.hidden = false;
  facesEmpty.textContent = "Loading snapshots…";
  updateFacesPager();
  try {
    const { res, data, faces, total } = await fetchFacesPage();
    facesTotal = total;
    if (facesTotal && facesPage >= facesPageCount()) {
      facesPage = facesPageCount() - 1;
      return loadFaces();
    }
    if (!res.ok || !Array.isArray(faces)) {
      facesGrid.replaceChildren();
      facesEmpty.textContent = data.error || "Could not load snapshots";
      updateFacesPager();
      return;
    }
    if (facesTotal === 0) {
      facesGrid.replaceChildren();
      facesEmpty.textContent = "No snapshots yet";
      updateFacesPager();
      return;
    }
    facesEmpty.hidden = true;
    renderFaceCards(faces);
    updateFacesPager();
    if (syncFacesPageSize() !== limit) return loadFaces();
  } catch (err) {
    facesGrid.replaceChildren();
    facesEmpty.textContent = String(err.message || err);
  } finally {
    if (!facesGallery.hidden) startFacesPoll();
  }
}

async function refreshFaces() {
  if (facesPage !== 0) return;
  const { res, faces, total } = await fetchFacesPage();
  if (!res.ok || !Array.isArray(faces)) return;
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
  if (have === incoming) {
    applyFaceNames(faces);
    return;
  }
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
  const pageUrl = `/faces?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`;
  const feedUrl = `/clip-stream?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}`;
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
  startClipFeed(range.start, range.end, 0);
  player.scrollIntoView({ behavior: "smooth", block: "start" });
}

function applyUrl() {
  const url = new URL(location.href);
  if (url.pathname === "/faces") {
    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");
    showFaces({ push: false }).then(() => {
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
    statusEl.textContent = `Created ${data.name}`;
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
  if (!snapsModal.open) snapsModal.showModal();
  loadCapturedSnaps();
});
document.getElementById("btn-close-snaps").addEventListener("click", () => snapsModal.close());
btnFacesPrev.addEventListener("click", () => {
  if (facesPage <= 0) return;
  facesPage -= 1;
  loadFaces();
});
btnFacesNext.addEventListener("click", () => {
  if (facesPage >= facesPageCount() - 1) return;
  facesPage += 1;
  loadFaces();
});

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
  await addFacesToGroup(
    uuids.map((uuid) => ({
      label: uuid,
      body: async () => ({ uuid }),
    })),
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

clipBtn.addEventListener("click", (event) => {
  event.preventDefault();
  showClipForm();
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
