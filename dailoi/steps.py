"""Nhật ký từng bước (structured) cho quá trình học tự động.

Ghi lại từng giai đoạn: login / trang_chu / vao_khoa / vao_bai / hoc_bai / xong / loi.
Lưu trong RAM (ring buffer mỗi user) để dashboard hiển thị dạng bảng + copy gửi log.
"""
from collections import deque
from datetime import datetime, timezone
from typing import Any

# Giai đoạn chuẩn (dùng cho màu/nhãn ở UI)
PHASES = {
    "prepare": "Chuẩn bị",
    "login": "Đăng nhập",
    "home": "Trang chủ/Profile",
    "recover": "Recovery",
    "enter_course": "Vào khóa",
    "enter_lesson": "Vào bài",
    "study": "Học bài",
    "progress": "Tiến độ",
    "done": "Hoàn tất",
    "error": "Lỗi",
    "stop": "Dừng",
}

_MAX_PER_USER = 300
_steps: dict[int, deque] = {}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def record(
    user_id: int,
    phase: str,
    message: str,
    *,
    url: str = "",
    status: str = "info",
    course: str = "",
    lesson: str = "",
    extra: dict[str, Any] | None = None,
) -> None:
    """Ghi 1 bước. status: info | ok | warn | error."""
    buf = _steps.get(user_id)
    if buf is None:
        buf = deque(maxlen=_MAX_PER_USER)
        _steps[user_id] = buf
    buf.append({
        "ts": _now(),
        "phase": phase,
        "phase_label": PHASES.get(phase, phase),
        "status": status,
        "message": message,
        "url": url or "",
        "course": course or "",
        "lesson": lesson or "",
        "extra": extra or {},
    })


def get_steps(user_id: int, limit: int = 200) -> list[dict]:
    buf = _steps.get(user_id)
    if not buf:
        return []
    items = list(buf)
    if limit and len(items) > limit:
        items = items[-limit:]
    return items


def clear(user_id: int) -> None:
    _steps.pop(user_id, None)


def clear_all() -> None:
    _steps.clear()
