const view = document.getElementById("view");
const statusEl = document.getElementById("status");
const liveBtn = document.getElementById("btn-live");
const clipBtn = document.getElementById("btn-clip");
const facesBtn = document.getElementById("btn-faces");
const clipForm = document.getElementById("clip-form");
const player = document.getElementById("player");
const facesGallery = document.getElementById("faces-gallery");
const facesGrid = document.getElementById("faces-grid");
const facesEmpty = document.getElementById("faces-empty");
const startInput = document.getElementById("start");
const endInput = document.getElementById("end");
const liveDot = document.getElementById("live-dot");
const modeLabel = document.getElementById("mode-label");
const rawLink = document.getElementById("raw-link");
const transport = document.getElementById("transport");
const btnPlay = document.getElementById("btn-play");
const btnBack = document.getElementById("btn-back");
const btnFwd = document.getElementById("btn-fwd");
const seekEl = document.getElementById("seek");
const timeLabel = document.getElementById("time-label");
const btnFs = document.getElementById("btn-fs");

let endTimer;
let tickTimer;
let audioAbort;
let audioCtx;
let audioNextTime = 0;
let playback = null;
let seekDragging = false;
let onPlaybackEnded = null;
let facesPoll;

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
  if (audioCtx) {
    audioCtx.close().catch(() => {});
    audioCtx = null;
  }
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

function startLiveFeed() {
  clearTimeout(endTimer);
  playback = { kind: "live", paused: false };
  onPlaybackEnded = null;
  setTransport("live");
  setPausedUi(false);
  playFeed("/stream", "/stream-audio");
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
    startLiveFeed();
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

      const src = audioCtx.createBufferSource();
      src.buffer = audioBuf;
      src.connect(audioCtx.destination);
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
  liveDot.classList.toggle("on", page === "live");
  clipForm.hidden = page !== "clip";
  facesGallery.hidden = page !== "faces";
  player.hidden = !showPlayer;
  if (!showPlayer && isPlayerFullscreen()) {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    exit?.call(document);
  }
  statusEl.textContent = status;
  modeLabel.textContent = mode;
  rawLink.href = rawHref;
  rawLink.textContent = rawText;
  if (page !== "faces") stopFacesPoll();
}

function showLive({ push = true } = {}) {
  if (push) history.pushState({}, "", "/live");
  setChrome({
    page: "live",
    status: "Live view",
    mode: "Live · /stream",
    rawHref: "/stream",
    rawText: "Open /stream",
  });
  startLiveFeed();
}

function showClipForm({ push = true } = {}) {
  if (push) history.pushState({}, "", "/clip");
  setChrome({
    page: "clip",
    status: "Pick start and end, then play",
    mode: "Clip",
    rawHref: "/clip-stream",
    rawText: "Open /clip-stream",
  });
  stopView();
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
  cap.textContent = face.start
    ? `${face.name} · ${fromCameraTime(face.start).replace("T", " ")}`
    : face.name;
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

function showFaces({ push = true } = {}) {
  if (push) history.pushState({}, "", "/faces");
  setChrome({
    page: "faces",
    status: "Saved snapshots",
    mode: "Faces",
    rawHref: "/clip-stream",
    rawText: "Open /clip-stream",
    showPlayer: false,
  });
  stopView();
  return loadFaces();
}

async function loadFaces() {
  stopFacesPoll();
  facesEmpty.hidden = false;
  facesEmpty.textContent = "Loading snapshots…";
  facesGrid.replaceChildren();
  try {
    const res = await fetch("/api/faces");
    const faces = await res.json();
    if (!res.ok || !Array.isArray(faces)) {
      facesEmpty.textContent = "Could not load snapshots";
      return;
    }
    if (faces.length === 0) {
      facesEmpty.textContent = "No snapshots yet";
      return;
    }
    facesEmpty.hidden = true;
    const frag = document.createDocumentFragment();
    for (const face of faces) frag.append(makeFaceCard(face));
    facesGrid.replaceChildren(frag);
  } catch (err) {
    facesEmpty.textContent = String(err.message || err);
  } finally {
    if (!facesGallery.hidden) startFacesPoll();
  }
}

async function refreshFaces() {
  const res = await fetch("/api/faces");
  const faces = await res.json();
  if (!res.ok || !Array.isArray(faces)) return;
  if (faces.length === 0) {
    if (facesGrid.childElementCount === 0) {
      facesEmpty.hidden = false;
      facesEmpty.textContent = "No snapshots yet";
    }
    return;
  }
  facesEmpty.hidden = true;
  const have = new Set(
    [...facesGrid.querySelectorAll(".face-card")].map((el) => el.dataset.filename),
  );
  const incoming = [];
  for (const face of faces) {
    if (have.has(face.filename)) break;
    incoming.push(face);
  }
  if (incoming.length === 0) return;
  const frag = document.createDocumentFragment();
  for (const face of incoming) frag.append(makeFaceCard(face));
  facesGrid.prepend(frag);
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
  if (url.pathname !== "/clip") {
    showLive({ push: false });
    return;
  }
  startInput.value = fromCameraTime(url.searchParams.get("start"));
  endInput.value = fromCameraTime(url.searchParams.get("end"));
  if (startInput.value && endInput.value) playClip({ push: false });
  else showClipForm({ push: false });
}

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

clipForm.addEventListener("submit", (event) => {
  event.preventDefault();
  playClip();
});

document.getElementById("btn-save").addEventListener("click", () => {
  saveClipToDisk();
});

btnPlay.addEventListener("click", () => togglePlayback());
btnBack.addEventListener("click", () => skipBy(-10_000));
btnFwd.addEventListener("click", () => skipBy(10_000));
btnFs.addEventListener("click", () => toggleFullscreen());
view.addEventListener("click", () => togglePlayback());
document.addEventListener("fullscreenchange", syncFullscreenLabel);
document.addEventListener("webkitfullscreenchange", syncFullscreenLabel);

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
  if (event.code === "KeyF") {
    if (player.hidden) return;
    event.preventDefault();
    toggleFullscreen();
  }
});

window.addEventListener("popstate", applyUrl);
window.addEventListener("pointerdown", () => {
  audioCtx?.resume();
});
applyUrl();
