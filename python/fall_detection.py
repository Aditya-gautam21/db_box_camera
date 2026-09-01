import os
from datetime import datetime
import cv2
from ultralytics import YOLO

DROP_PX_S = 120
DROP_WINDOW = 2.0
HOLD_S = 5.0

def is_fall(kxy, kconf, xyxy):
    if kxy is None or len(kxy) < 13:
        return False
    for i in (5, 6, 11, 12):
        if kconf is not None and float(kconf[i]) < 0.3:
            return False
    shoulder = (kxy[5] + kxy[6]) / 2
    hip = (kxy[11] + kxy[12]) / 2
    torso_flat = abs(hip[0] - shoulder[0]) > abs(hip[1] - shoulder[1]) * 1.2
    x1, y1, x2, y2 = xyxy
    box_wide = (x2 - x1) > (y2 - y1)
    return bool(torso_flat and box_wide)

def body_y(kxy, kconf, xyxy):
    if kxy is not None and len(kxy) >= 13:
        if kconf is None or (float(kconf[11]) >= 0.3 and float(kconf[12]) >= 0.3):
            return float((kxy[11][1] + kxy[12][1]) / 2)
    return float((xyxy[1] + xyxy[3]) / 2)

class FallDetector:
    def __init__(self, output_dir="data/fall"):
        self.output_dir = output_dir
        os.makedirs(output_dir, exist_ok=True)
        self.model = YOLO(model="yolo26n-pose.pt")
        self.tracks = {}
        self.alerted = set()
        self.last_vis = None

    def detect(self, frame, now):
        events = []
        r = self.model.track(frame, persist=True, verbose=False, conf=0.45)[0]
        vis = r.plot()
        self.last_vis = vis
        live = set()

        if r.boxes is not None and r.keypoints is not None and r.boxes.id is not None:
            for i, tid in enumerate(r.boxes.id.int().tolist()):
                live.add(tid)
                kxy = r.keypoints.xy[i].cpu().numpy()
                kconf = r.keypoints.conf[i].cpu().numpy() if r.keypoints.conf is not None else None
                xyxy = r.boxes.xyxy[i].cpu().numpy()
                y = body_y(kxy, kconf, xyxy)
                st = self.tracks.get(tid, {"y": y, "t": now, "drop_t": None, "since": None})
                dt = now - st["t"]
                if dt > 0.05 and (y - st["y"]) / dt >= DROP_PX_S:
                    st["drop_t"] = now
                dropped = st["drop_t"] is not None and (now - st["drop_t"]) <= DROP_WINDOW
                fallen = is_fall(kxy, kconf, xyxy)
                x1, y1 = int(xyxy[0]), int(xyxy[1])

                if fallen and (dropped or st["since"] is not None):
                    if st["since"] is None:
                        st["since"] = now
                    held = now - st["since"]
                    label = "FALL" if held >= HOLD_S or tid in self.alerted else f"DOWN {held:.0f}/{HOLD_S:.0f}s"
                    cv2.putText(vis, label, (x1, max(20, y1 - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)
                    if held >= HOLD_S and tid not in self.alerted:
                        self.alerted.add(tid)
                        path = os.path.join(
                            self.output_dir,
                            f"fall_{datetime.now().replace(microsecond=0)}_{tid}.jpg",
                        )
                        cv2.imwrite(path, vis)
                        events.append({
                            "type": "fall",
                            "track": int(tid),
                            "bbox": [int(v) for v in xyxy],
                            "path": path,
                        })
                else:
                    st["since"] = None
                    if not fallen:
                        self.alerted.discard(tid)
                        if not dropped:
                            st["drop_t"] = None

                st["y"], st["t"] = y, now
                self.tracks[tid] = st

        for tid in list(self.tracks):
            if tid not in live:
                self.tracks.pop(tid, None)
                self.alerted.discard(tid)

        return events
