const view = document.getElementById("view");
const statusEl = document.getElementById("status");
const liveBtn = document.getElementById("btn-live");
const clipBtn = document.getElementById("btn-clip");
const clipForm = document.getElementById("clip-form");
const startInput = document.getElementById("start");
const endInput = document.getElementById("end");
const liveDot = document.getElementById("live-dot");
const modeLabel = document.getElementById("mode-label");
const rawLink = document.getElementById("raw-link");

let endTimer;
let audioAbort;
let audioCtx;
let audioNextTime = 0;

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

function stopView() {
  clearTimeout(endTimer);
  stopAudio();
  view.removeAttribute("src");
}

function playFeed(videoUrl, audioUrl) {
  stopView();
  view.src = videoUrl;
  if (audioUrl) startPcmAudio(audioUrl);
}

function setChrome({ live, status, mode, rawHref, rawText }) {
  liveBtn.classList.toggle("active", live);
  clipBtn.classList.toggle("active", !live);
  liveDot.classList.toggle("on", live);
  clipForm.hidden = live;
  statusEl.textContent = status;
  modeLabel.textContent = mode;
  rawLink.href = rawHref;
  rawLink.textContent = rawText;
}

function showLive({ push = true } = {}) {
  if (push) history.pushState({}, "", "/live");
  setChrome({
    live: true,
    status: "Live view",
    mode: "Live · /stream",
    rawHref: "/stream",
    rawText: "Open /stream",
  });
  playFeed("/stream", "/stream-audio");
}

function showClipForm({ push = true } = {}) {
  if (push) history.pushState({}, "", "/clip");
  setChrome({
    live: false,
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
    live: false,
    status: "Playing archive",
    mode: "Clip · /clip-stream",
    rawHref: feedUrl,
    rawText: "Open /clip-stream",
  });
  playFeed(feedUrl, `/clip-audio?start=${encodeURIComponent(range.start)}&end=${encodeURIComponent(range.end)}`);
  endTimer = setTimeout(() => showLive({ push: true }), range.ms + 2000);
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

function applyUrl() {
  const url = new URL(location.href);
  const onClip = url.pathname === "/clip";
  if (!onClip) {
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

clipForm.addEventListener("submit", (event) => {
  event.preventDefault();
  playClip();
});

document.getElementById("btn-save").addEventListener("click", () => {
  saveClipToDisk();
});

window.addEventListener("popstate", applyUrl);
window.addEventListener("pointerdown", () => {
  audioCtx?.resume();
});
applyUrl();
