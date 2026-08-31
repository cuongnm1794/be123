"""Test kết nối Telegram bot — đọc notify.env và gửi tin thử.

Chạy:
    py -3.11 test_telegram_bot.py
    py -3.11 test_telegram_bot.py --send
    py -3.11 test_telegram_bot.py --updates
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from notify import get_notify_config, send_notification


def _api_get(token: str, method: str) -> dict:
    url = f"https://api.telegram.org/bot{token}/{method}"
    req = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            return {"ok": False, "description": body or str(exc)}


def mask_token(token: str) -> str:
    if len(token) <= 12:
        return "***"
    return f"{token[:8]}...{token[-4:]}"


def check_config(cfg: dict) -> list[str]:
    issues: list[str] = []
    if not cfg["bot_token"]:
        issues.append("Thiếu TELEGRAM_BOT_TOKEN trong notify.env")
    if not cfg["chat_id"]:
        issues.append("Thiếu TELEGRAM_CHAT_ID trong notify.env")
    if not cfg["enabled"]:
        issues.append("TELEGRAM_NOTIFY_ENABLED=false hoặc config chưa đủ")
    return issues


def print_get_me(token: str) -> bool:
    print("\n[1] getMe — kiểm tra token bot")
    data = _api_get(token, "getMe")
    if not data.get("ok"):
        print(f"  FAIL: {data.get('description', data)}")
        return False
    bot = data.get("result", {})
    print(f"  OK — @{bot.get('username')} ({bot.get('first_name')})")
    return True


def print_get_updates(token: str) -> None:
    print("\n[2] getUpdates — xem chat id từ tin nhắn gần nhất")
    data = _api_get(token, "getUpdates")
    if not data.get("ok"):
        print(f"  FAIL: {data.get('description', data)}")
        return

    updates = data.get("result") or []
    if not updates:
        print("  result rỗng — chưa có tin nhắn nào gửi cho bot.")
        print("  → Mở Telegram, tìm bot, bấm Start, gửi 'hi', chạy lại với --updates")
        return

    seen: set[int] = set()
    for item in updates:
        msg = item.get("message") or item.get("edited_message") or {}
        chat = msg.get("chat") or {}
        chat_id = chat.get("id")
        if chat_id is None or chat_id in seen:
            continue
        seen.add(chat_id)
        name = chat.get("first_name") or chat.get("title") or "?"
        username = chat.get("username")
        user_part = f" @{username}" if username else ""
        print(f"  chat.id = {chat_id}  ({name}{user_part}, type={chat.get('type')})")


def send_test_message() -> bool:
    print("\n[3] sendMessage — gửi tin thử qua notify.py")
    result = send_notification(
        "practice_round_complete",
        user_id=4,
        practice_round=1,
        max_rounds=3,
        dedup_key=None,
    )
    if result.get("ok"):
        print(f"  OK — message_id={result.get('message_id')}")
        print("  Kiểm tra Telegram xem có nhận tin không.")
        return True

    if result.get("skipped"):
        print(f"  SKIP — {result.get('reason')}")
    else:
        print(f"  FAIL — {result.get('error', result)}")
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description="Test Telegram bot (notify.env)")
    parser.add_argument("--send", action="store_true", help="Gửi tin thử NCN")
    parser.add_argument("--updates", action="store_true", help="Chỉ in getUpdates (lấy chat id)")
    args = parser.parse_args()

    cfg = get_notify_config()
    print("=== Test Telegram Bot ===")
    print(f"notify.env: token={mask_token(cfg['bot_token'])}, chat_id={cfg['chat_id'] or '(trống)'}, enabled={cfg['enabled']}")

    issues = check_config(cfg)
    if issues and not args.updates:
        for line in issues:
            print(f"  ! {line}")

    if not cfg["bot_token"]:
        return 1

    if args.updates:
        print_get_updates(cfg["bot_token"])
        return 0

    ok = print_get_me(cfg["bot_token"])
    if not ok:
        return 1

    if args.send:
        if issues:
            print("\nKhông gửi được — sửa notify.env trước.")
            return 1
        return 0 if send_test_message() else 1

    print_get_updates(cfg["bot_token"])
    print("\nGửi tin thử: py -3.11 test_telegram_bot.py --send")
    return 0


if __name__ == "__main__":
    sys.exit(main())
