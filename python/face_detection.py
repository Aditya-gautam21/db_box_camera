import os
from datetime import datetime

import cv2
from insightface.app import FaceAnalysis


class FaceDetector:
    def __init__(self, output_dir="data/face"):
        self.output_dir = output_dir
        os.makedirs(output_dir, exist_ok=True)
        self.app = FaceAnalysis(name="buffalo_s", providers=["CPUExecutionProvider"])
        self.app.prepare(ctx_id=-1, det_size=(640, 640))

    def detect(self, frame):
        events = []
        vis = frame.copy()
        faces = self.app.get(vis)
        for face in faces:
            box = face.bbox.astype(int).tolist()
            cv2.rectangle(vis, (box[0], box[1]), (box[2], box[3]), (0, 255, 0), 2)
            path = os.path.join(
                self.output_dir,
                f"face_{datetime.now().replace(microsecond=0)}_age{face.age}.jpg",
            )
            cv2.imwrite(path, vis)
            events.append({
                "type": "face",
                "bbox": box,
                "score": float(face.det_score),
                "age": int(face.age) if face.age is not None else None,
                "path": path,
            })
        return events
