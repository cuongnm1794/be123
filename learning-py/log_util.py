"""Logging đơn giản cho automation."""

from datetime import datetime


def log(user_id: int, phase: str, message: str, *, status: str = "info") -> None:
    ts = datetime.now().strftime("%H:%M:%S")
    prefix = f"[{ts}] user={user_id} [{phase}]"
    print(f"{prefix} {message}")


def progress(user_id: int, pct: float, message: str, step: str = "status") -> None:
    log(user_id, step, f"({pct:.0f}%) {message}", status="info")
