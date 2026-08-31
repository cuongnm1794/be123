"""CLI runner for Dai Loi automation."""

import argparse
import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from dotenv import load_dotenv

load_dotenv(ROOT / "accounts_db" / ".env")
load_dotenv(ROOT / ".env")

import browser
import db
import learning
import login as login_mod
import sync


async def cmd_init_db():
    await db.init_db()
    print("DB initialized.")


async def cmd_seed():
    from seed.seed_all import main as seed_main

    await seed_main(["dailoi"])


async def _resolve_users(user_id: int | None, all_running: bool) -> list[dict]:
    if user_id is not None:
        user = await db.get_user_by_id(user_id)
        if not user:
            raise SystemExit(f"Khong tim thay user id={user_id}")
        return [user]
    if all_running:
        users = await db.get_running_users()
        if not users:
            raise SystemExit("Khong co user nao bat is_running")
        return users
    raise SystemExit("Can --user-id N hoac --all-running")


async def cmd_login(user_id: int | None, all_running: bool):
    await db.init_db()
    for user in await _resolve_users(user_id, all_running):
        await browser.launch_browser(user["id"])
        result = await login_mod.login(user["id"], user["username"], user["password"])
        print(f"User {user['id']}: {result}")


async def cmd_sync(user_id: int | None, all_running: bool):
    await db.init_db()
    for user in await _resolve_users(user_id, all_running):
        await browser.launch_browser(user["id"])
        result = await sync.sync_courses(user["id"])
        print(f"User {user['id']}: {result}")


async def cmd_learn(user_id: int | None, all_running: bool):
    await db.init_db()
    for user in await _resolve_users(user_id, all_running):
        result = await learning.run_user_learning(user["id"])
        print(f"User {user['id']}: {result}")


def _add_user_args(parser: argparse.ArgumentParser):
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--user-id", type=int)
    group.add_argument("--all-running", action="store_true")


def main(argv: list[str] | None = None):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="Dai Loi auto learning")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("init-db")
    sub.add_parser("seed")
    for name, help_text in [
        ("login", "Dang nhap"),
        ("sync", "Dong bo khoa hoc"),
        ("learn", "Hoc tu dong"),
        ("run", "Alias learn"),
    ]:
        p = sub.add_parser(name, help=help_text)
        _add_user_args(p)

    args = parser.parse_args(argv)

    async def _run():
        try:
            if args.command == "init-db":
                await cmd_init_db()
            elif args.command == "seed":
                await cmd_seed()
            elif args.command == "login":
                await cmd_login(args.user_id, args.all_running)
            elif args.command == "sync":
                await cmd_sync(args.user_id, args.all_running)
            elif args.command in ("learn", "run"):
                await cmd_learn(args.user_id, args.all_running)
        finally:
            await browser.close_all_browsers()
            await db.close_db()

    asyncio.run(_run())


if __name__ == "__main__":
    main()
