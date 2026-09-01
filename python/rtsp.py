from json import loads
from pathlib import Path
from urllib.parse import quote

CAMERA_FILE = Path(__file__).resolve().parent.parent / "camera_info.json"


def load_cameras():
    if not CAMERA_FILE.exists():
        return []
    raw = CAMERA_FILE.read_text()
    if not raw.strip():
        return []
    data = loads(raw)
    return data if isinstance(data, list) else []


def get_camera(id=None):
    cameras = load_cameras()
    if id:
        for cam in cameras:
            if cam.get("id") == id or cam.get("name") == id:
                return cam
        return None
    return cameras[0] if cameras else None


def get_rtsp_url(cam, subtype=0):
    user = quote(cam["username"], safe="")
    password = quote(cam["password"], safe="")
    return f"rtsp://{user}:{password}@{cam['host']}:554/rtsp/streaming?channel=01&subtype={subtype}"
