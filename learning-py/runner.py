"""Auto learning CLI — port tu Electron sang Python."""

import argparse
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from dotenv import load_dotenv

load_dotenv()

import browser
import db
import learning
import login as login_mod
import seed
import sync


async def cmd_init_db() -> None:
    await db.init_db()
    print("DB initialized.")


async def cmd_seed() -> None:
    await seed.seed_students()


async def cmd_login(user_id: int | None, all_running: bool) -> None:
    await db.init_db()
    users = await _resolve_users(user_id, all_running)
    for user in users:
        await browser.launch_browser(user["id"])
        result = await login_mod.login(
            user["id"],
            user["username"],
            user.get("password") or user["username"],
        )
        print(f"User {user['id']} ({user['username']}): {result}")


async def cmd_sync(user_id: int | None, all_running: bool) -> None:
    await db.init_db()
    users = await _resolve_users(user_id, all_running)
    for user in users:
        await browser.launch_browser(user["id"])
        result = await sync.sync_courses(user["id"])
        print(f"User {user['id']}: {result}")


async def cmd_learn(user_id: int | None, all_running: bool) -> None:
    await db.init_db()
    users = await _resolve_users(user_id, all_running)
    for user in users:
        result = await learning.run_user_learning(user["id"])
        print(f"User {user['id']}: {result}")


async def cmd_run(user_id: int | None, all_running: bool) -> None:
    """Luong day du: init profile -> login -> sync -> hoc."""
    await cmd_learn(user_id, all_running)


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


def main(argv: list[str] | None = None) -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="Auto learning (Python port tu Electron)")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("init-db", help="Tao bang PostgreSQL")

    sub.add_parser("seed", help="Seed 3 hoc vien tu info.txt")

    p_login = sub.add_parser("login", help="Khoi tao profile + dang nhap")
    _add_user_args(p_login)

    p_sync = sub.add_parser("sync", help="Dong bo khoa hoc tu profile web")
    _add_user_args(p_sync)

    p_learn = sub.add_parser("learn", help="Login + sync + chay hoc")
    _add_user_args(p_learn)

    p_run = sub.add_parser("run", help="Alias cua learn")
    _add_user_args(p_run)

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


def _add_user_args(parser: argparse.ArgumentParser) -> None:
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--user-id", type=int, help="ID user trong DB")
    group.add_argument("--all-running", action="store_true", help="Chay tat ca user is_running=true")


if __name__ == "__main__":
    main()
