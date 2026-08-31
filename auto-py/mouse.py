import threading
import time

import pyautogui

from windows import prepare_focus_for_action

MOVE_DURATION = 0.5
SCROLL_MOVE_DURATION = 0.06
PAUSE_BEFORE_CLICK = 0.15
SCROLL_PAUSE = 0.04
FOCUS_SETTLE_MS = 0.08

pyautogui.FAILSAFE = True
pyautogui.PAUSE = 0.05

_lock = threading.Lock()


def _move_to(x: int, y: int, duration: float = MOVE_DURATION) -> None:
    pyautogui.moveTo(x, y, duration=duration, tween=pyautogui.easeInOutQuad)


def move_to(x: int, y: int, user_id: int | None = None) -> None:
    with _lock:
        prepare_focus_for_action(x, y, user_id)
        time.sleep(FOCUS_SETTLE_MS)
        _move_to(x, y)


def click_at(x: int, y: int, user_id: int | None = None) -> None:
    with _lock:
        prepare_focus_for_action(x, y, user_id)
        time.sleep(FOCUS_SETTLE_MS)
        _move_to(x, y)
        time.sleep(PAUSE_BEFORE_CLICK)
        pyautogui.click()


def scroll_at(x: int, y: int, amount: int, user_id: int | None = None) -> None:
    """Cuon con chuot tai (x,y). amount > 0 = len, < 0 = xuong (pyautogui)."""
    with _lock:
        prepare_focus_for_action(x, y, user_id)
        time.sleep(FOCUS_SETTLE_MS)
        _move_to(x, y, duration=SCROLL_MOVE_DURATION)
        time.sleep(SCROLL_PAUSE)
        pyautogui.scroll(int(amount))


def type_text(
    text: str,
    x: int | None = None,
    y: int | None = None,
    clear_first: bool = False,
    user_id: int | None = None,
) -> None:
    with _lock:
        if x is not None and y is not None:
            prepare_focus_for_action(x, y, user_id)
            time.sleep(FOCUS_SETTLE_MS)
            _move_to(x, y)
            time.sleep(PAUSE_BEFORE_CLICK)
            pyautogui.click()
            time.sleep(0.1)

        if clear_first:
            pyautogui.hotkey("ctrl", "a")
            time.sleep(0.05)
            pyautogui.press("delete")
            time.sleep(0.05)

        pyautogui.write(str(text), interval=0.03)
