import json
from pathlib import Path

import cv2
import supervision as sv
from ai_config import infer_lock, load_yolo, yolo_kw
from preview import draw_box

CONFIG = Path(__file__).resolve().parent / "line_cross.json"
LEGACY = Path(__file__).resolve().parent.parent / "data" / "line_cross.json"


def _pair(value):
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        return None
    x, y = float(value[0]), float(value[1])
    if not (0 <= x <= 1 and 0 <= y <= 1):
        return None
    return x, y


def _entry(data, cam_id):
    if not isinstance(data, dict):
        return None
    cameras = data.get("cameras")
    if isinstance(cameras, dict):
        item = cameras.get(cam_id) if cam_id else None
        if not isinstance(item, dict) and cameras and not cam_id:
            item = next(iter(cameras.values()), None)
        data = item if isinstance(item, dict) else None
    elif cam_id and data.get("cam") and str(data.get("cam")) != str(cam_id):
        return None
    if not isinstance(data, dict):
        return None
    a, b = _pair(data.get("a")), _pair(data.get("b"))
    if not a or not b:
        return None
    return {"a": a, "b": b, "side": _pair(data.get("side"))}


def _read_config(cam_id):
    for path in (CONFIG, LEGACY):
        try:
            st = path.stat()
            cfg = _entry(json.loads(path.read_text()), cam_id)
            return cfg, st.st_mtime
        except FileNotFoundError:
            continue
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            return None, None
    return None, None


def _side(x0, y0, x1, y1, px, py):
    return (x1 - x0) * (py - y0) - (y1 - y0) * (px - x0)


def _hit(p0, p1, q0, q1):
    s1 = _side(*q0, *q1, *p0)
    s2 = _side(*q0, *q1, *p1)
    s3 = _side(*p0, *p1, *q0)
    s4 = _side(*p0, *p1, *q1)
    return (s1 > 0) != (s2 > 0) and (s3 > 0) != (s4 > 0)


class LineCrossDetector:
    def __init__(self):
        self.model = None
        self.tracker = None
        self.alarm_in = True
        self._mtime = None
        self._hw = None
        self._cam = None
        self._missing = False
        self._prev = {}
        self.overlay = []
        self.overlay_line = None
        print("line_cross: draw the tripwire on the AI page", flush=True)

    def _ensure_model(self):
        if self.model is not None:
            return
        print("line_cross: loading yolo26n.pt", flush=True)
        self.model = load_yolo("yolo26n.pt")
        self.tracker = sv.ByteTrack()

    def _sync(self, width, height, cam_id):
        cfg, mtime = _read_config(cam_id)
        same = (
            mtime == self._mtime
            and self._hw == (width, height)
            and self._cam == cam_id
            and (self.overlay_line is not None) == (cfg is not None)
        )
        if same:
            return
        self._mtime = mtime
        self._hw = (width, height)
        self._cam = cam_id
        self._prev = {}
        if not cfg:
            self.overlay_line = None
            if not self._missing:
                self._missing = True
                print(f"line_cross: no tripwire for {cam_id or 'camera'} — draw a line in the AI UI", flush=True)
            return
        self._missing = False
        self._ensure_model()
        a, b, side = cfg["a"], cfg["b"], cfg["side"]
        start = (int(round(a[0] * (width - 1))), int(round(a[1] * (height - 1))))
        end = (int(round(b[0] * (width - 1))), int(round(b[1] * (height - 1))))
        self.overlay_line = (start, end)
        self.alarm_in = True
        if side is not None:
            (x0, y0), (x1, y1), (x2, y2) = a, b, side
            self.alarm_in = ((x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0)) >= 0
        print(f"line_cross: tripwire loaded for {cam_id}", flush=True)

    def detect(self, frame, cam_id=None, vis=None):
        h, w = frame.shape[:2]
        self._sync(w, h, str(cam_id) if cam_id else None)
        if self.overlay_line is None:
            self.overlay = []
            return []
        events = []
        overlay = []
        with infer_lock:
            results = self.model(frame, classes=[0], **yolo_kw())[0]
        detections = self.tracker.update_with_detections(sv.Detections.from_ultralytics(results))
        line = self.overlay_line
        if vis is not None:
            cv2.line(vis, line[0], line[1], (255, 180, 0), 2)
        live = set()
        ids = detections.tracker_id
        for i, xyxy in enumerate(detections.xyxy):
            tid = int(ids[i]) if ids is not None and ids[i] is not None else None
            x1, y1, x2, y2 = (float(v) for v in xyxy)
            pt = ((x1 + x2) / 2.0, (y1 + y2) / 2.0)
            crossed = False
            if tid is not None:
                live.add(tid)
                prev = self._prev.get(tid)
                self._prev[tid] = pt
                if prev is not None and _hit(prev, pt, line[0], line[1]):
                    crossed = True
                    now_in = _side(*line[0], *line[1], *pt) >= 0
                    events.append({
                        "type": "line_cross",
                        "track": tid,
                        "cam": cam_id,
                        "direction": "entering" if now_in == self.alarm_in else "leaving",
                    })
            color = (0, 255, 255) if crossed else (255, 180, 0)
            tag = "cross" if crossed else f"id {tid if tid is not None else i}"
            overlay.append((xyxy, color, f"line {tag}"))
            if vis is not None:
                draw_box(vis, xyxy, color, f"line {tag}")
        self._prev = {tid: pt for tid, pt in self._prev.items() if tid in live}
        self.overlay = overlay
        return events
