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


class Preview:
    def __init__(self, title=WIN):
        self.title = title
        self.ok = bool(os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"))
        if not self.ok:
            return
        tw, th = screen_size()
        try:
            cv2.namedWindow(title, cv2.WINDOW_NORMAL)
            cv2.imshow(title, np.zeros((th, tw, 3), dtype=np.uint8))
            cv2.setWindowProperty(title, cv2.WND_PROP_FULLSCREEN, cv2.WINDOW_FULLSCREEN)
        except cv2.error:
            self.ok = False

    def _target(self):
        try:
            _, _, w, h = cv2.getWindowImageRect(self.title)
            if w >= 2 and h >= 2:
                return w, h
        except cv2.error:
            pass
        return screen_size()

    def show(self, frame):
        if not self.ok:
            return False
        cv2.imshow(self.title, letterbox(frame, *self._target()))
        return (cv2.waitKey(1) & 0xFF) == 27

    def close(self):
        if self.ok:
            cv2.destroyWindow(self.title)
