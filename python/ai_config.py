import json
import os
import threading
from pathlib import Path

infer_lock = threading.Lock()
DEVICE = "cpu"
USE_GPU = False

try:
    import torch
    if torch.cuda.is_available():
        DEVICE = 0
        USE_GPU = True
        torch.set_num_threads(2)
        torch.backends.cudnn.benchmark = True
except Exception:
    pass


def yolo_kw(**extra):
    kw = {"verbose": False, "device": DEVICE, **extra}
    if USE_GPU:
        kw.setdefault("half", True)
    return kw


def load_yolo(weights):
    from ultralytics import YOLO
    where = f"cuda:{DEVICE}" if USE_GPU else "cpu"
    print(f"loading {weights} on {where}", flush=True)
    model = YOLO(model=weights)
    if USE_GPU:
        model.to("cuda")
    return model


def onnx_providers():
    try:
        import onnxruntime as ort
        available = set(ort.get_available_providers())
    except Exception:
        available = set()
    if "CUDAExecutionProvider" in available:
        return ["CUDAExecutionProvider", "CPUExecutionProvider"]
    return ["CPUExecutionProvider"]


def log_device():
    if USE_GPU:
        import torch
        name = torch.cuda.get_device_name(0)
        vram = torch.cuda.get_device_properties(0).total_memory / (1024 ** 3)
        print(f"infer: {name} {vram:.1f} GiB  yolo=cuda  face={onnx_providers()[0]}", flush=True)
    else:
        print(f"infer: cpu  face={onnx_providers()[0]}", flush=True)


MODELS = ("area_intrusion", "line_cross", "fall", "fire", "face")
DEFAULTS = {
    "area_intrusion": True,
    "line_cross": True,
    "fall": True,
    "fire": True,
    "face": False,
}
CONFIG = Path(__file__).resolve().parent / "ai_models.json"
STATS = Path(__file__).resolve().parent / "ai_stats.json"


def atomic_write(path, text):
    tmp = path.with_name(f"{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
    tmp.write_text(text)
    tmp.replace(path)


def read_models():
    try:
        st = CONFIG.stat()
        data = json.loads(CONFIG.read_text())
        raw = data.get("models", data) if isinstance(data, dict) else {}
        if not isinstance(raw, dict):
            raw = {}
        out = dict(DEFAULTS)
        for key in MODELS:
            if key not in raw:
                continue
            value = raw[key]
            if isinstance(value, str):
                out[key] = value.strip().lower() in ("on", "true", "1", "yes")
            else:
                out[key] = bool(value)
        return out, st.st_mtime
    except FileNotFoundError:
        return dict(DEFAULTS), None
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return dict(DEFAULTS), None
