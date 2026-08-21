"""Chup man hinh cua so Google Chrome va luu vao thu muc images."""
from datetime import datetime
from pathlib import Path

import pyautogui
import pygetwindow as gw

IMAGES_DIR = Path(__file__).resolve().parent / "images"


def _chrome_windows():
    return [
        w
        for w in gw.getAllWindows()
        if w.title
        and w.visible
        and w.width > 1
        and w.height > 1
        and "google chrome" in w.title.lower()
    ]


def get_chrome_window():
    windows = _chrome_windows()
    if not windows:
        raise RuntimeError("Khong tim thay cua so Google Chrome dang mo.")
    return max(windows, key=lambda w: w.width * w.height)


def capture_chrome(save_dir: Path = IMAGES_DIR) -> Path:
    win = get_chrome_window()
    if win.isMinimized:
        win.restore()

    region = (win.left, win.top, win.width, win.height)
    image = pyautogui.screenshot(region=region)

    save_dir.mkdir(parents=True, exist_ok=True)
    filename = f"chrome_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png"
    path = save_dir / filename
    image.save(path)
    return path


if __name__ == "__main__":
    out = capture_chrome()
    print(f"Da luu: {out}")
