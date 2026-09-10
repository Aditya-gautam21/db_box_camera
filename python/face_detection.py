import os
from datetime import datetime

import cv2
from insightface.app import FaceAnalysis
from ai_config import infer_lock, onnx_providers
from preview import draw_box


class FaceDetector:
    def __init__(self, output_dir="data/face"):
        self.output_dir = output_dir
        os.makedirs(output_dir, exist_ok=True)
        providers = onnx_providers()
        ctx_id = 0 if providers[0] == "CUDAExecutionProvider" else -1
        print(f"face: loading buffalo_s {providers[0]} ctx={ctx_id}", flush=True)
        self.app = FaceAnalysis(name="buffalo_s", providers=providers)
        self.app.prepare(ctx_id=ctx_id, det_size=(640, 640))
        self.overlay = []

    def detect(self, frame, vis=None):
        events = []
        overlay = []
        with infer_lock:
            faces = self.app.get(frame)
        for face in faces:
            box = face.bbox.astype(int).tolist()
            label = f"face {int(face.age) if face.age is not None else '?'}"
            overlay.append((box, (0, 255, 0), label))
            if vis is not None:
                draw_box(vis, box, (0, 255, 0), label)
            path = os.path.join(
                self.output_dir,
                f"face_{datetime.now().replace(microsecond=0)}_age{face.age}.jpg",
            )
            snap = vis if vis is not None else frame
            #cv2.imwrite(path, snap)
            events.append({
                "type": "face",
                "bbox": box,
                "score": float(face.det_score),
                "age": int(face.age) if face.age is not None else None,
                "path": path,
            })
        self.overlay = overlay
        return events
