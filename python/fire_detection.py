import os
import time
from datetime import datetime

import cv2
from huggingface_hub import hf_hub_download
from ultralytics import YOLO

FIRE_REPO = "SalahALHaismawi/yolov26-fire-detection"
FIRE_FILE = "best.pt"
FIRE_CLS = 0
CONF = 0.6
MIN_AREA_FRAC = 0.004
HITS_NEEDED = 3
COOLDOWN_S = 10.0


class FireDetector:
    def __init__(self, output_dir="data/fire"):
        self.output_dir = output_dir
        os.makedirs(output_dir, exist_ok=True)
        weights = hf_hub_download(repo_id=FIRE_REPO, filename=FIRE_FILE)
        self.model = YOLO(weights)
        self.hits = 0
        self.last_alert = 0.0

    def detect(self, frame):
        h, w = frame.shape[:2]
        min_area = MIN_AREA_FRAC * w * h
        r = self.model.predict(frame, verbose=False, conf=CONF, classes=[FIRE_CLS])[0]
        fires = []
        if r.boxes is not None:
            for box in r.boxes:
                xyxy = box.xyxy[0].cpu().tolist()
                area = (xyxy[2] - xyxy[0]) * (xyxy[3] - xyxy[1])
                if area < min_area:
                    continue
                fires.append({
                    "bbox": [int(v) for v in xyxy],
                    "score": float(box.conf[0]),
                })

        if not fires:
            self.hits = 0
            return []

        self.hits += 1
        now = time.monotonic()
        if self.hits < HITS_NEEDED or now - self.last_alert < COOLDOWN_S:
            return []

        self.last_alert = now
        self.hits = 0
        vis = r.plot()
        cv2.putText(vis, f"{len(fires)} fire", (30, 50), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (0, 0, 255), 3)
        path = os.path.join(
            self.output_dir,
            f"fire_{datetime.now().replace(microsecond=0)}.jpg",
        )
        cv2.imwrite(path, vis)
        return [{
            "type": "fire",
            "count": len(fires),
            "score": max(f["score"] for f in fires),
            "path": path,
        }]
