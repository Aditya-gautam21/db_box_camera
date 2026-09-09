import json
import threading
import time
from pathlib import Path

import cv2
import numpy as np
import supervision as sv

from ai_config import atomic_write, infer_lock, load_yolo, read_models, yolo_kw
from preview import draw_box
from stream import start_stream

CONFIG = Path(__file__).resolve().parent / "area_intrusion.json"
STATS = Path(__file__).resolve().parent / "area_intrusion_stats.json"


def _pair(value):
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        return None
    x, y = float(value[0]), float(value[1])
    if not (0 <= x <= 1 and 0 <= y <= 1):
        return None
    return x, y


def _overlaps(zone, detections):
    if len(detections) == 0:
        return np.array([], dtype=bool)
    zx1, zy1, zx2, zy2 = zone
    x1, y1, x2, y2 = detections.xyxy.T
    return (x1 < zx2) & (x2 > zx1) & (y1 < zy2) & (y2 > zy1)


def _read_zones():
    try:
        st = CONFIG.stat()
        data = json.loads(CONFIG.read_text())
    except FileNotFoundError:
        return {}, None
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return {}, None
    zones = {}
    cameras = data.get("cameras")
    if isinstance(cameras, dict):
        items = cameras.items()
    elif data.get("cam"):
        items = [(data.get("cam"), data)]
    else:
        return {}, st.st_mtime
    for cam_id, entry in items:
        if not cam_id or not isinstance(entry, dict):
            continue
        a, b = _pair(entry.get("a")), _pair(entry.get("b"))
        if a and b:
            zones[str(cam_id)] = {"a": a, "b": b}
    return zones, st.st_mtime


class AreaIntrusionDetector:
    def __init__(self):
        self.model = None
        self._infer_lock = threading.Lock()
        self._lock = threading.Lock()
        self._zones = {}
        self._mtime = None
        self._state = {}
        self._infer_cam = None
        self._extra = set()
        self._threads = {}
        self._stop = threading.Event()
        self.overlay = []
        self.overlay_zone = None
        print("area_intrusion: draw a box per camera in the live UI", flush=True)

    def start(self, infer_cam_id=None):
        self._infer_cam = str(infer_cam_id) if infer_cam_id else None
        threading.Thread(target=self._watch_loop, daemon=True, name="area-watch").start()

    def _cam_state(self, cam_id):
        state = self._state.get(cam_id)
        if state is None:
            state = {
                "zone": None,
                "inside": set(),
                "total": 0,
                "recent": [],
                "hw": None,
                "norm": None,
                "tracker": None,
                "stats_t": 0,
                "last_inside": -1,
            }
            self._state[cam_id] = state
        return state

    def _flush_stats(self, cam_id, state, events):
        now = time.time()
        for event in events:
            state["total"] += 1
            state["recent"].append({**event, "t": now})
        if len(state["recent"]) > 50:
            state["recent"] = state["recent"][-50:]
        inside = len(state["inside"]) if state["zone"] is not None else 0
        if not events and inside == state["last_inside"] and now - state["stats_t"] < 1:
            return
        state["last_inside"] = inside
        state["stats_t"] = now
        snapshot = {
            "inside": inside,
            "total": state["total"],
            "updated": now,
            "recent": state["recent"],
        }
        with self._lock:
            cameras = {}
            try:
                prev = json.loads(STATS.read_text())
                if isinstance(prev.get("cameras"), dict):
                    cameras = prev["cameras"]
            except (FileNotFoundError, OSError, json.JSONDecodeError, TypeError):
                pass
            cameras[cam_id] = snapshot
            try:
                atomic_write(STATS, json.dumps({"cameras": cameras}) + "\n")
            except OSError:
                pass

    def _ensure_model(self):
        if self.model is not None:
            return
        with self._infer_lock:
            if self.model is not None:
                return
            print("area_intrusion: loading yolo26n.pt", flush=True)
            self.model = load_yolo("yolo26n.pt")

    def _reload(self):
        zones, mtime = _read_zones()
        with self._lock:
            if mtime == self._mtime:
                return
            self._mtime = mtime
            self._zones = zones
            for cam_id in [c for c in self._state if c not in zones]:
                self._state.pop(cam_id, None)

    def _sync_zone(self, cam_id, width, height):
        self._reload()
        with self._lock:
            cfg = self._zones.get(cam_id)
            state = self._cam_state(cam_id)
            if state["norm"] is cfg and state["hw"] == (width, height) and (state["zone"] is not None) == (cfg is not None):
                return state
        if cfg:
            self._ensure_model()
        with self._lock:
            cfg = self._zones.get(cam_id)
            state = self._cam_state(cam_id)
            state["norm"] = cfg
            state["hw"] = (width, height)
            state["inside"].clear()
            if not cfg:
                state["zone"] = None
                return state
            if state["tracker"] is None:
                state["tracker"] = sv.ByteTrack()
            a, b = cfg["a"], cfg["b"]
            x1, x2 = sorted((int(round(a[0] * (width - 1))), int(round(b[0] * (width - 1)))))
            y1, y2 = sorted((int(round(a[1] * (height - 1))), int(round(b[1] * (height - 1)))))
            state["zone"] = np.array([x1, y1, x2, y2], dtype=np.int64)
            return state

    def _watch_loop(self):
        while not self._stop.is_set():
            self._reload()
            enabled, _ = read_models()
            with self._lock:
                wanted = set(self._zones) - {self._infer_cam} if enabled.get("area_intrusion") else set()
            self._extra = wanted
            for cam_id in wanted:
                thread = self._threads.get(cam_id)
                if thread is not None and thread.is_alive():
                    continue
                thread = threading.Thread(target=self._run_cam, args=(cam_id,), daemon=True, name=f"area-{cam_id}")
                self._threads[cam_id] = thread
                thread.start()
            for cam_id, thread in list(self._threads.items()):
                if cam_id in wanted and thread.is_alive():
                    continue
                self._threads.pop(cam_id, None)
            self._stop.wait(1)

    def _run_cam(self, cam_id):
        print(f"area_intrusion: watching {cam_id}", flush=True)
        try:
            for frame in start_stream(camera_id=cam_id):
                if self._stop.is_set() or cam_id not in self._extra:
                    break
                for event in self.detect(frame, cam_id):
                    print(json.dumps(event), flush=True)
        except Exception as err:
            print(f"area_intrusion: {cam_id} {err}", flush=True)

    def detect(self, frame, cam_id=None, vis=None):
        if not cam_id:
            return []
        cam_id = str(cam_id)
        paint = vis is not None or cam_id == self._infer_cam
        h, w = frame.shape[:2]
        state = self._sync_zone(cam_id, w, h)
        if state["zone"] is None:
            state["inside"].clear()
            if paint:
                self.overlay = []
                self.overlay_zone = None
            self._flush_stats(cam_id, state, [])
            return []
        with self._infer_lock:
            with infer_lock:
                results = self.model(frame, classes=[0], **yolo_kw())[0]
        detections = state["tracker"].update_with_detections(sv.Detections.from_ultralytics(results))
        zone = tuple(int(v) for v in state["zone"])
        if paint:
            self.overlay_zone = zone
            if vis is not None:
                cv2.rectangle(vis, (zone[0], zone[1]), (zone[2], zone[3]), (90, 164, 227), 2)
        events = []
        overlay = []
        live = set()
        for i, is_in in enumerate(_overlaps(state["zone"], detections)):
            tid = detections.tracker_id[i]
            if tid is None:
                continue
            tid = int(tid)
            live.add(tid)
            color = (0, 215, 255) if is_in else (90, 164, 227)
            label = f"area {tid}{' IN' if is_in else ''}"
            if paint:
                overlay.append((detections.xyxy[i], color, label))
                if vis is not None:
                    draw_box(vis, detections.xyxy[i], color, label)
            if is_in and tid not in state["inside"]:
                events.append({"type": "area_intrusion", "track": tid, "cam": cam_id})
            if is_in:
                state["inside"].add(tid)
            else:
                state["inside"].discard(tid)
        if paint:
            self.overlay = overlay
        state["inside"].intersection_update(live)
        self._flush_stats(cam_id, state, events)
        return events
