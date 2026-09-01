import json
from pathlib import Path

import supervision as sv
from ultralytics import YOLO

CONFIG = Path(__file__).resolve().parent.parent / "data" / "line_cross.json"


def _pair(value):
    if not isinstance(value, (list, tuple)) or len(value) != 2:
        return None
    x, y = float(value[0]), float(value[1])
    if not (0 <= x <= 1 and 0 <= y <= 1):
        return None
    return x, y


def _read_config():
    try:
        st = CONFIG.stat()
        data = json.loads(CONFIG.read_text())
        a, b = _pair(data.get("a")), _pair(data.get("b"))
        if not a or not b:
            return None, st.st_mtime
        return {"a": a, "b": b, "side": _pair(data.get("side"))}, st.st_mtime
    except FileNotFoundError:
        return None, None
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return None, None


class LineCrossDetector:
    def __init__(self):
        self.model = None
        self.tracker = None
        self.zone = None
        self.alarm_in = True
        self._mtime = None
        self._norm = None
        self._hw = None
        print("line_cross: draw the tripwire in the live UI", flush=True)

    def _ensure_model(self):
        if self.model is not None:
            return
        print("line_cross: loading yolo26n.pt", flush=True)
        self.model = YOLO(model="yolo26n.pt")
        self.tracker = sv.ByteTrack()

    def _sync(self, width, height):
        cfg, mtime = _read_config()
        if mtime == self._mtime and self._hw == (width, height) and (self.zone is not None) == (self._norm is not None):
            return
        self._mtime = mtime
        self._norm = cfg
        self._hw = (width, height)
        if not cfg:
            self.zone = None
            return
        self._ensure_model()
        a, b, side = cfg["a"], cfg["b"], cfg["side"]

        def px(p):
            return sv.Point(int(round(p[0] * (width - 1))), int(round(p[1] * (height - 1))))

        self.zone = sv.LineZone(
            start=px(a),
            end=px(b),
            triggering_anchors=(sv.Position.BOTTOM_CENTER,),
        )
        self.alarm_in = True
        if side is not None:
            (x0, y0), (x1, y1), (x2, y2) = a, b, side
            self.alarm_in = ((x1 - x0) * (y2 - y0) - (y1 - y0) * (x2 - x0)) >= 0

    def detect(self, frame):
        h, w = frame.shape[:2]
        self._sync(w, h)
        if self.zone is None:
            return []
        events = []
        results = self.model(frame, classes=[0], verbose=False)[0]
        detections = self.tracker.update_with_detections(sv.Detections.from_ultralytics(results))
        crossed_in, crossed_out = self.zone.trigger(detections)
        for i, (is_in, is_out) in enumerate(zip(crossed_in, crossed_out)):
            if not (is_in or is_out):
                continue
            tid = detections.tracker_id[i]
            entering = is_in == self.alarm_in
            events.append({
                "type": "line_cross",
                "track": int(tid) if tid is not None else None,
                "direction": "entering" if entering else "leaving",
            })
        return events
