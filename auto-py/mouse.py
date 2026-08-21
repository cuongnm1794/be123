import threading
import time

import pyautogui

MOVE_DURATION = .5
PAUSE_BEFORE_CLICK = 0.15

pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0.05

_lock = threading.Lock()


def _move_to(x: int, y: int) -> None:
    pyautogui.moveTo(x, y, duration=MOVE_DURATION, tween=pyautogui.easeInOutQuad)


def move_to(x: int, y: int) -> None:
    with _lock:
        _move_to(x, y)


def click_at(x: int, y: int) -> None:
    with _lock:
        _move_to(x, y)
        time.sleep(PAUSE_BEFORE_CLICK)
        pyautogui.click()
