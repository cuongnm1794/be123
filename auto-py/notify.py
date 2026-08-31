"""Telegram notification hub — mọi profile Chrome gọi /notify?user_id=…&event=…"""

from __future__ import annotations

import html
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

PROFILE_MAP: dict[int, dict[str, str]] = {
    1: {"name": "Ý", "cccd": "067199004010"},
    2: {"name": "Luyến", "cccd": "067188003393"},
    3: {"name": "Nhung", "cccd": "067182000262"},
    4: {"name": "Huy", "cccd": "067090002078"},
}

DEDUP_SEC = 60
_recent_keys: dict[str, float] = {}


def _load_notify_env() -> None:
    env_path = Path(__file__).resolve().parent / "notify.env"
    if not env_path.is_file():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


_load_notify_env()


def get_notify_config() -> dict:
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.getenv("TELEGRAM_CHAT_ID", "").strip()
    enabled_raw = os.getenv("TELEGRAM_NOTIFY_ENABLED", "").strip().lower()
    if enabled_raw in ("0", "false", "no", "off"):
        enabled = False
    elif enabled_raw in ("1", "true", "yes", "on"):
        enabled = True
    else:
        enabled = bool(token and chat_id)
    return {
        "enabled": enabled,
        "bot_token": token,
        "chat_id": chat_id,
    }


def profile_name(user_id: int | None) -> str | None:
    if user_id is None:
        return None
    return PROFILE_MAP.get(int(user_id), {}).get("name")


def user_label(user_id: int | None, user_name: str | None = None) -> str:
    name = (user_name or profile_name(user_id) or "").strip()
    if name and user_id is not None:
        return f"{name} (user {user_id})"
    if user_id is not None:
        return f"user {user_id}"
    return "không rõ"


def _format_time() -> str:
    now = datetime.now()
    return now.strftime("%H:%M %d/%m/%Y")


def _should_skip(dedup_key: str | None) -> bool:
    if not dedup_key:
        return False
    now = time.time()
    last = _recent_keys.get(dedup_key)
    if last is not None and now - last < DEDUP_SEC:
        return True
    _recent_keys[dedup_key] = now
    return False


def format_message(
    event: str,
    *,
    user_id: int | None = None,
    user_name: str | None = None,
    practice_round: int | None = None,
    max_rounds: int | None = None,
    message: str | None = None,
    page_url: str | None = None,
) -> str:
    who = html.escape(user_label(user_id, user_name))
    when = _format_time()
    page = f"\n🔗 {html.escape(page_url)}" if page_url else ""

    if event == "practice_round_complete":
        rnd = int(practice_round or 0)
        mx = int(max_rounds or 0)
        more = (
            "Tiếp tục lượt tiếp theo…"
            if mx and rnd < mx
            else "Đã đủ số lượt — kiểm tra tiến độ Số giờ."
        )
        return (
            f"✅ <b>NCN — Xong lượt ôn luyện</b>\n"
            f"👤 Học viên: <b>{who}</b>\n"
            f"📊 Lượt: <b>{rnd or '?'}/{mx or '?'}</b>\n"
            f"📝 {html.escape(more)}\n"
            f"🕐 {when}{page}"
        )

    if event == "practice_all_complete":
        mx = max_rounds if max_rounds is not None else "?"
        return (
            f"🎉 <b>NCN — Hoàn thành {mx} lượt ôn luyện</b>\n"
            f"👤 Học viên: <b>{who}</b>\n"
            f"📊 Đã xong đủ {mx} lượt trong phiên này.\n"
            f"🕐 {when}{page}"
        )

    if event == "devtools_suspicion":
        detail = message or "Popup nghi ngờ DevTools — cần giải captcha thủ công."
        return (
            f"⚠️ <b>NCN — Nghi ngờ DevTools</b>\n"
            f"👤 Học viên: <b>{who}</b>\n"
            f"📝 {html.escape(detail)}\n"
            f"⛔ Acc đã dừng — vào giải captcha rồi bật lại flow.\n"
            f"🕐 {when}{page}"
        )

    fallback = message or event or "Thông báo NCN"
    return f"ℹ️ <b>NCN</b>\n{html.escape(fallback)}\n🕐 {when}"


def _build_dedup_key(event: str, user_id: int | None, practice_round, max_rounds) -> str | None:
    uid = user_id if user_id is not None else "x"
    if event == "devtools_suspicion":
        return f"devtools:{uid}"
    if event == "practice_round_complete":
        return f"round:{uid}:{practice_round}"
    if event == "practice_all_complete":
        return f"all:{uid}:{max_rounds}"
    return None


def send_notification(
    event: str,
    *,
    user_id: int | None = None,
    user_name: str | None = None,
    practice_round: int | None = None,
    max_rounds: int | None = None,
    message: str | None = None,
    page_url: str | None = None,
    text: str | None = None,
    dedup_key: str | None = None,
) -> dict:
    cfg = get_notify_config()
    if not cfg["enabled"]:
        return {"ok": False, "skipped": True, "reason": "disabled"}
    if not cfg["bot_token"] or not cfg["chat_id"]:
        return {"ok": False, "skipped": True, "reason": "missing_config"}

    key = dedup_key or _build_dedup_key(event, user_id, practice_round, max_rounds)
    if _should_skip(key):
        return {"ok": False, "skipped": True, "reason": "dedup"}

    body_text = text or format_message(
        event,
        user_id=user_id,
        user_name=user_name,
        practice_round=practice_round,
        max_rounds=max_rounds,
        message=message,
        page_url=page_url,
    )

    url = f"https://api.telegram.org/bot{cfg['bot_token']}/sendMessage"
    payload = json.dumps(
        {
            "chat_id": cfg["chat_id"],
            "text": body_text,
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        }
    ).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        try:
            err_body = exc.read().decode("utf-8")
            err_json = json.loads(err_body)
            desc = err_json.get("description") or err_body
        except Exception:
            desc = str(exc)
        return {"ok": False, "error": desc}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}

    if not data.get("ok"):
        return {"ok": False, "error": data.get("description") or "telegram_error"}

    return {
        "ok": True,
        "message_id": data.get("result", {}).get("message_id"),
        "user_id": user_id,
        "event": event,
    }
