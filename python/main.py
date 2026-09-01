import json
import time
from pathlib import Path
from dotenv import load_dotenv

from face_detection import FaceDetector
from fall_detection import FallDetector
from fire_detection import FireDetector
from line_cross import LineCrossDetector
from preview import Preview
from stream import INFER_DT, start_stream

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


def emit(events):
    for event in events:
        print(json.dumps(event), flush=True)

def main():
    #face = FaceDetector()
    fall = FallDetector()
    fire = FireDetector()
    line = LineCrossDetector()
#    preview = Preview()
    last_infer = 0.0
    vis = None
#    try:
    for frame in start_stream():
        now = time.monotonic()
        if now - last_infer >= INFER_DT:
            last_infer = now
            #emit(face.detect(frame))
            emit(fall.detect(frame, now))
            emit(fire.detect(frame))
            emit(line.detect(frame))
#            vis = fall.last_vis
#            if preview.show(vis if vis is not None else frame):
#               break
#   finally:
#       preview.close()

if __name__ == "__main__":
    main()
