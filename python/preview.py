import os

import cv2
import numpy as np

WIN = "infer"


def screen_size():
    try:
        import tkinter as tk

        root = tk.Tk()
        root.withdraw()
        size = (int(root.winfo_screenwidth()), int(root.winfo_screenheight()))
        root.destroy()
        if size[0] > 1 and size[1] > 1:
            return size
    except Exception:
        pass
    return 1920, 1080


def letterbox(img, tw, th):
    tw, th = max(2, int(tw)), max(2, int(th))
    h, w = img.shape[:2]
    scale = min(tw / w, th / h)
    nw, nh = max(1, int(w * scale)), max(1, int(h * scale))
    ox, oy = (tw - nw) // 2, (th - nh) // 2
    canvas = np.zeros((th, tw, 3), dtype=img.dtype)
    canvas[oy : oy + nh, ox : ox + nw] = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_LINEAR)
    return canvas


def draw_box(img, xyxy, color, label=""):
    x1, y1, x2, y2 = (int(xyxy[0]), int(xyxy[1]), int(xyxy[2]), int(xyxy[3]))
    cv2.rectangle(img, (x1, y1), (x2, y2), color, 2)
    if label:
        cv2.putText(img, label, (x1, max(14, y1 - 5)), cv2.FONT_HERSHEY_SIMPLEX, 0.45, color, 1, cv2.LINE_AA)


class Preview:
    def __init__(self, title=WIN):
        self.title = title
        self.ok = bool(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"))
        if not self.ok:
            return
        try:
            cv2.namedWindow(title, cv2.WINDOW_NORMAL)
        except cv2.error:
            self.ok = False

    def _target(self):
        try:
            _, _, w, h = cv2.getWindowImageRect(self.title)
            if w >= 2 and h >= 2:
                return w, h
        except cv2.error:
            pass
        return 960, 540

    def show(self, frame):
        if not self.ok:
            return False
        cv2.imshow(self.title, letterbox(frame, *self._target()))
        return (cv2.waitKey(1) & 0xFF) == 27

    def close(self):
        if self.ok:
            cv2.destroyWindow(self.title)
