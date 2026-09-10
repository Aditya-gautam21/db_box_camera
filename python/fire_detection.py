import os
import time
from datetime import datetime

import cv2
from huggingface_hub import hf_hub_download
from ai_config import infer_lock, load_yolo, yolo_kw
from preview import draw_box

FIRE_REPO = "SalahALHaismawi/yolov26-fire-detection"
FIRE_FILE = "best.pt"
FIRE_CLS = 0
CONF = 0.25
ALARM_CONF = 0.5
MIN_AREA_FRAC = 0.004
HITS_NEEDED = 3
COOLDOWN_S = 10.0
COLORS = {
    0: (0, 0, 255),
    1: (0, 220, 255),
    2: (180, 180, 180),
}


class FireDetector:
    def __init__(self, output_dir="data/fire"):
        self.output_dir = output_dir
        os.makedirs(output_dir, exist_ok=True)
        print("fire: loading yolov26-fire", flush=True)
        weights = hf_hub_download(repo_id=FIRE_REPO, filename=FIRE_FILE)
        self.model = load_yolo(weights)
        self.hits = 0
        self.last_alert = 0.0
        self.overlay = []

    def detect(self, frame, vis=None):
        h, w = frame.shape[:2]
        min_area = MIN_AREA_FRAC * w * h
        with infer_lock:
            r = self.model.predict(frame, conf=CONF, imgsz=640, **yolo_kw())[0]
        fires = []
        overlay = []
        if r.boxes is not None:
            for box in r.boxes:
                xyxy = box.xyxy[0].cpu().tolist()
                cls = int(box.cls[0])
                score = float(box.conf[0])
                name = self.model.names.get(cls, str(cls))
                color = COLORS.get(cls, (0, 0, 255))
                label = f"{name} {score:.2f}"
                overlay.append((xyxy, color, label))
                if vis is not None:
                    draw_box(vis, xyxy, color, label)
                if cls != FIRE_CLS or score < ALARM_CONF:
                    continue
                area = (xyxy[2] - xyxy[0]) * (xyxy[3] - xyxy[1])
                if area < min_area:
                    continue
                fires.append({
                    "bbox": [int(v) for v in xyxy],
                    "score": score,
                })
        self.overlay = overlay

        if not fires:
            self.hits = 0
            return []

        self.hits += 1
        now = time.monotonic()
        if self.hits < HITS_NEEDED or now - self.last_alert < COOLDOWN_S:
            return []

        self.last_alert = now
        self.hits = 0
        snap = r.plot()
        cv2.putText(snap, f"{len(fires)} fire", (30, 50), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (0, 0, 255), 3)
        path = os.path.join(
            self.output_dir,
            f"fire_{datetime.now().replace(microsecond=0)}.jpg",
        )
        cv2.imwrite(path, snap)
        return [{
            "type": "fire",
            "count": len(fires),
            "score": max(f["score"] for f in fires),
            "path": path,
        }]
