"""
Quản lý cửa sổ Chrome theo học viên — dùng cho "quản lý học viên":
liệt kê cửa sổ, đưa 1 học viên lên trên cùng (để site tính giờ), xếp cửa sổ
sao cho thấy hết tất cả (tile lưới). Không dùng CDP — toàn OS-level.

Cửa sổ được gán user_id bằng cách khớp command line của process chrome:
  --user-data-dir=.../user-{id}   (launcher tạo profile user-{id})
"""

import ctypes
import ctypes.wintypes as wt
import math
import re
import sys

import psutil

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32

SW_RESTORE = 9
SW_SHOW = 5
SW_MINIMIZE = 6


class _Rect(ctypes.Structure):
    _fields_ = [
        ("left", ctypes.c_long),
        ("top", ctypes.c_long),
        ("right", ctypes.c_long),
        ("bottom", ctypes.c_long),
    ]


def _ensure_console_utf8():
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass


_ensure_console_utf8()


# ── Enumerate top-level windows ──

WNDENUMPROC = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)


def _enum_windows():
    """Trả về list [(hwnd, pid)] tất cả top-level windows."""
    results = []

    def _cb(hwnd, _lparam):
        pid = wt.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        results.append((hwnd, pid.value))
        return True

    user32.EnumWindows(WNDENUMPROC(_cb), 0)
    return results


def _window_title(hwnd):
    length = user32.GetWindowTextLengthW(hwnd)
    if not length:
        return ""
    buf = ctypes.create_unicode_buffer(length + 1)
    user32.GetWindowTextW(hwnd, buf, length + 1)
    return buf.value


def _window_rect(hwnd):
    r = _Rect()
    if not user32.GetWindowRect(hwnd, ctypes.byref(r)):
        return None
    return {
        "left": int(r.left),
        "top": int(r.top),
        "right": int(r.right),
        "bottom": int(r.bottom),
        "width": int(r.right - r.left),
        "height": int(r.bottom - r.top),
    }


def _chrome_student_pids():
    """Map user_id -> {pid, cmdline} cho các process chrome có profile user-{id}."""
    user_map = {}
    for proc in psutil.process_iter(["pid", "name", "cmdline"]):
        try:
            name = (proc.info.get("name") or "").lower()
            if name not in ("chrome.exe",):
                continue
            cmdline = proc.info.get("cmdline") or []
            joined = " ".join(cmdline)
            m = re.search(r"user-data-dir[^ ]*?[\\/]user-(\d+)", joined, re.I)
            if not m:
                continue
            user_id = int(m.group(1))
            user_map.setdefault(user_id, []).append(proc.info)
        except Exception:
            continue
    return user_map


def list_student_windows():
    """Liệt kê cửa sổ chính của từng học viên (1 cửa sổ / pid lớn nhất)."""
    user_map = _chrome_student_pids()
    if not user_map:
        return []

    windows = []
    for user_id, procs in sorted(user_map.items()):
        pids = [p["pid"] for p in procs]
        best = None
        for hwnd, pid in _enum_windows():
            if pid not in pids:
                continue
            rect = _window_rect(hwnd)
            if not rect or rect["width"] < 100 or rect["height"] < 50:
                continue
            # window còn hiển thị (không minimize ẩn hẳn)
            if not user32.IsWindowVisible(hwnd):
                continue
            area = rect["width"] * rect["height"]
            if best is None or area > best["area"]:
                best = {
                    "hwnd": hwnd,
                    "pid": pid,
                    "area": area,
                    "rect": rect,
                    "title": _window_title(hwnd),
                }
        if best:
            windows.append(
                {
                    "user_id": user_id,
                    "hwnd": int(best["hwnd"]),
                    "pid": best["pid"],
                    "title": best["title"],
                    "rect": best["rect"],
                }
            )
    return windows


def _restore_and_foreground(hwnd):
    """Bỏ minimize + đưa cửa sổ lên trên cùng (topmost/focus)."""
    user32.ShowWindow(hwnd, SW_RESTORE)
    user32.SetForegroundWindow(hwnd)
    # Nếu SetForegroundWindow bị OS chặn, thử lại qua AttachThreadInput
    if user32.GetForegroundWindow() != hwnd:
        user32.ShowWindow(hwnd, SW_SHOW)
        user32.SetWindowPos(hwnd, -1, 0, 0, 0, 0, 0x0001 | 0x0002)  # HWND_TOPMOST
        user32.SetWindowPos(hwnd, -2, 0, 0, 0, 0, 0x0001 | 0x0002)  # HWND_NOTOPMOST
        user32.SetForegroundWindow(hwnd)
    return user32.GetForegroundWindow() == hwnd


def focus_user_window(user_id):
    """Đưa cửa sổ học viên user_id lên trên cùng. Trả về window hoặc None."""
    for w in list_student_windows():
        if w["user_id"] == int(user_id):
            _restore_and_foreground(w["hwnd"])
            return w
    return None


def _top_level_hwnd(hwnd):
    """Đưa hwnd về top-level ancestor."""
    GA_ROOT = 2
    root = user32.GetAncestor(hwnd, GA_ROOT)
    return root or hwnd


def focus_window_at_point(x: int, y: int) -> dict:
    """
    Tìm cửa sổ top-level chứa điểm màn hình (x, y) và đưa lên foreground.
    Dùng trước mỗi click OS để tránh trúng cửa sổ Chrome khác khi chồng nhau.
    """
    pt = wt.POINT(int(x), int(y))
    hwnd = user32.WindowFromPoint(pt)
    if not hwnd:
        return {"ok": False, "error": "WindowFromPoint returned 0"}

    hwnd = _top_level_hwnd(hwnd)
    rect = _window_rect(hwnd)
    if not rect:
        return {"ok": False, "error": "Cannot read window rect"}

    focused = _restore_and_foreground(hwnd)
    return {
        "ok": focused,
        "hwnd": int(hwnd),
        "title": _window_title(hwnd),
        "rect": rect,
    }


def prepare_focus_for_action(x: int, y: int, user_id: int | None = None) -> None:
    """Focus cửa sổ tại điểm click; chỉ fallback user_id khi không tìm được cửa sổ."""
    result = focus_window_at_point(x, y)
    if not result.get("ok") and user_id is not None:
        focus_user_window(int(user_id))


def _work_area():
    """Vùng làm việc màn hình chính (trừ taskbar)."""
    r = _Rect()
    # SPI_GETWORKAREA = 0x0030
    user32.SystemParametersInfoW(0x0030, 0, ctypes.byref(r), 0)
    return {
        "left": int(r.left),
        "top": int(r.top),
        "right": int(r.right),
        "bottom": int(r.bottom),
        "width": int(r.right - r.left),
        "height": int(r.bottom - r.top),
    }


def arrange_student_windows():
    """Xếp lưới tất cả cửa sổ học viên để thấy hết (có đè nhẹ nếu đông)."""
    windows = list_student_windows()
    if not windows:
        return {"arranged": 0, "windows": []}

    area = _work_area()
    n = len(windows)
    cols = math.ceil(math.sqrt(n))
    rows = math.ceil(n / cols)
    margin = 4
    cell_w = area["width"] / cols
    cell_h = area["height"] / rows

    arranged = []
    for i, w in enumerate(windows):
        col = i % cols
        row = i // cols
        x = area["left"] + int(col * cell_w) + margin
        y = area["top"] + int(row * cell_h) + margin
        ww = max(200, int(cell_w) - 2 * margin)
        wh = max(120, int(cell_h) - 2 * margin)
        user32.ShowWindow(w["hwnd"], SW_RESTORE)
        user32.SetWindowPos(w["hwnd"], 0, x, y, ww, wh, 0x0040)  # SWP_NOZORDER
        arranged.append(
            {
                "user_id": w["user_id"],
                "rect": {"left": x, "top": y, "width": ww, "height": wh},
            }
        )
    return {"arranged": len(arranged), "windows": arranged, "work_area": area}


def minimize_user_window(user_id):
    for w in list_student_windows():
        if w["user_id"] == int(user_id):
            user32.ShowWindow(w["hwnd"], SW_MINIMIZE)
            return True
    return False


def stop_all_windows_report():
    """Trả về JSON-ish dict cho /windows."""
    return {
        "windows": [
            {
                "user_id": w["user_id"],
                "pid": w["pid"],
                "title": w["title"],
                "rect": w["rect"],
            }
            for w in list_student_windows()
        ]
    }