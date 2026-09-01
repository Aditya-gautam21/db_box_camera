import os
import subprocess
import numpy as np

from rtsp import get_camera, get_rtsp_url

INFER_DT = 1.0 / 3.0
INFER_MAX_SIDE = 640


def _even(n):
    n = max(2, int(n))
    return n if n % 2 == 0 else n - 1


def _probe_size(url):
    cmd = [
        "ffprobe",
        "-rtsp_transport", "tcp",
        "-timeout", "5000000",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "csv=p=0:s=x",
        "-v", "error",
        url,
    ]
    try:
        out = subprocess.check_output(cmd, timeout=8, text=True).strip()
        w, h = out.split("x", 1)
        w, h = int(w), int(h)
        if w >= 2 and h >= 2:
            return w, h
    except (subprocess.SubprocessError, ValueError, OSError):
        pass
    return None


def infer_wh(src_w, src_h, max_side=INFER_MAX_SIDE):
    long = max(src_w, src_h)
    if long <= max_side:
        return _even(src_w), _even(src_h)
    scale = max_side / long
    return _even(src_w * scale), _even(src_h * scale)


def start_stream(channels=3, max_side=INFER_MAX_SIDE, camera_id=None, subtype=1):
    cam = get_camera(camera_id or os.getenv("CAMERA_ID"))
    if cam:
        url = get_rtsp_url(cam, subtype=int(os.getenv("RTSP_SUBTYPE", subtype)))
    else:
        url = os.getenv("INF_RTSP") or os.getenv("CAM_RTSP")
        if not url:
            raise RuntimeError("add a camera to camera_info.json or set INF_RTSP")

    probed = _probe_size(url)
    if probed:
        src_w, src_h = probed
        width, height = infer_wh(src_w, src_h, max_side)
        scale = (width, height) != (src_w, src_h)
    else:
        src_w, src_h = None, None
        width, height = infer_wh(640, 360, max_side)
        scale = True

    vf = f"format=bgr24" if not scale else f"scale={width}:{height}:flags=area,format=bgr24"
    print(
        f"stream: {src_w}x{src_h} -> {width}x{height}" if src_w else f"stream: {width}x{height} (unprobed)",
        flush=True,
    )

    frame_size = width * height * channels
    cmd = [
        "ffmpeg",
        "-rtsp_transport", "tcp",
        "-i", url,
        "-vf", vf,
        "-f", "rawvideo", "-an", "-sn", "pipe:1",
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, bufsize=frame_size)
    try:
        while True:
            raw = proc.stdout.read(frame_size)
            if len(raw) < frame_size:
                break
            yield np.frombuffer(raw, dtype=np.uint8).reshape((height, width, 3)).copy()
    finally:
        proc.kill()
        proc.wait()
