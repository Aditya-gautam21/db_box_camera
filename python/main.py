import json
import threading
import time
from pathlib import Path

import cv2
from dotenv import load_dotenv

from ai_config import MODELS, STATS, atomic_write, log_device, read_models
from area_intrusion import AreaIntrusionDetector
from fall_detection import FallDetector
from fire_detection import FireDetector
from line_cross import LineCrossDetector
from preview import Preview, draw_box
from rtsp import get_camera
from stream import INFER_DT, start_stream

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


def emit(events):
    for event in events:
        print(json.dumps(event), flush=True)


class ModelHub:
    def __init__(self, area, cam_id):
        self.area = area
        self.cam_id = cam_id
        self.enabled, self._mtime = read_models()
        self._det = {"area_intrusion": area}
        self.stats = {key: {"total": 0, "recent": []} for key in MODELS}
        self._flush_t = 0
        self._frame = None
        self._stop = threading.Event()
        self._name_locks = {name: threading.Lock() for name in MODELS}
        self._stats_lock = threading.Lock()
        self._workers = []
        for name in MODELS:
            thread = threading.Thread(target=self._loop, args=(name,), daemon=True, name=f"ai-{name}")
            self._workers.append(thread)
            thread.start()

    def set_frame(self, frame):
        self._frame = frame

    def stop(self):
        self._stop.set()

    def _load(self, name):
        got = self._det.get(name)
        if got is not None:
            return got
        with self._name_locks[name]:
            got = self._det.get(name)
            if got is not None:
                return got
            if name == "fall":
                got = FallDetector()
            elif name == "fire":
                got = FireDetector()
            elif name == "line_cross":
                got = LineCrossDetector()
            elif name == "face":
                from face_detection import FaceDetector
                got = FaceDetector()
            else:
                return None
            self._det[name] = got
            return got

    def sync(self):
        enabled, mtime = read_models()
        if mtime == self._mtime:
            return
        self._mtime = mtime
        self.enabled = enabled

    def record(self, events):
        now = time.time()
        with self._stats_lock:
            for event in events:
                key = event.get("type")
                if key not in self.stats:
                    continue
                self.stats[key]["total"] += 1
                self.stats[key]["recent"].append({**event, "t": now})
                if len(self.stats[key]["recent"]) > 50:
                    self.stats[key]["recent"] = self.stats[key]["recent"][-50:]
            if events or now - self._flush_t >= 1:
                self._flush_t = now
                payload = json.dumps({
                    "updated": now,
                    "models": self.stats,
                }) + "\n"
            else:
                payload = None
        if payload is None:
            return
        try:
            atomic_write(STATS, payload)
        except OSError:
            pass

    def _clear_overlay(self, name):
        det = self._det.get(name)
        if det is None:
            return
        det.overlay = []
        if hasattr(det, "overlay_line"):
            det.overlay_line = None
        if hasattr(det, "overlay_zone"):
            det.overlay_zone = None

    def _infer(self, name, frame, now):
        det = self._load(name)
        if det is None:
            return []
        if name == "fall":
            return det.detect(frame, now)
        if name == "area_intrusion":
            return det.detect(frame, self.cam_id)
        if name == "line_cross":
            return det.detect(frame, self.cam_id)
        return det.detect(frame)

    def _loop(self, name):
        last = 0.0
        while not self._stop.is_set():
            self.sync()
            if not self.enabled.get(name):
                self._clear_overlay(name)
                self._stop.wait(0.05)
                continue
            frame = self._frame
            if frame is None:
                time.sleep(0.01)
                continue
            delay = last + INFER_DT - time.monotonic()
            if delay > 0:
                time.sleep(delay)
                continue
            last = time.monotonic()
            frame = self._frame
            if frame is None:
                continue
            try:
                events = self._infer(name, frame.copy(), last)
            except Exception as err:
                print(f"{name}: {err}", flush=True)
                continue
            self.record(events)
            emit(events)

    def paint(self, vis):
        for name in MODELS:
            if not self.enabled.get(name):
                continue
            det = self._det.get(name)
            if det is None:
                continue
            zone = getattr(det, "overlay_zone", None)
            if zone is not None:
                x1, y1, x2, y2 = zone
                cv2.rectangle(vis, (x1, y1), (x2, y2), (90, 164, 227), 2)
            line = getattr(det, "overlay_line", None)
            if line is not None:
                cv2.line(vis, line[0], line[1], (255, 180, 0), 2)
            for xyxy, color, label in list(getattr(det, "overlay", None) or []):
                draw_box(vis, xyxy, color, label)


def main():
    log_device()
    default = get_camera()
    default_id = default.get("id") if default else None
    area = AreaIntrusionDetector()
    area.start(default_id)
    hub = ModelHub(area, default_id)
    preview = Preview()
    try:
        for frame in start_stream():
            hub.set_frame(frame)
            if preview.ok:
                vis = frame.copy()
                hub.paint(vis)
                if preview.show(vis):
                    break
    finally:
        hub.stop()
        preview.close()


if __name__ == "__main__":
    main()
