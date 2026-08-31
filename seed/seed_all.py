"""Seed accounts + courses for Nam Cao Nguyen and Dai Loi into auto_learning DB."""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv

load_dotenv(ROOT / "accounts_db" / ".env")
load_dotenv(ROOT / ".env")

from accounts_db import db


async def seed_site(config_path: Path) -> dict:
    data = json.loads(config_path.read_text(encoding="utf-8"))
    site = data["site"]
    batch = data.get("batch")
    default_password = data.get("default_password", "123456")

    course_map: dict[str, int] = {}
    for course in data.get("courses", []):
        row = await db.create_course(
            course["course_name"],
            course.get("description", ""),
            course["link"],
        )
        course_map[course["link"]] = row["id"]

    created_users = 0
    linked_courses = 0
    for item in data.get("users", []):
        username = item["username"]
        password = item.get("password") or default_password
        existing = await db.get_user_by_username(username)
        if existing:
            user = existing
            if item.get("name") and not user.get("name"):
                await db.update_user(user["id"], name=item["name"])
            print(f"  [{site}] da co: {item.get('name', username)} ({username})")
        else:
            user = await db.create_user(
                username,
                password,
                is_running=item.get("is_running", False),
                site=site,
                batch=batch,
                name=item.get("name"),
            )
            created_users += 1
            print(f"  [{site}] tao moi: {item.get('name', username)} ({username}) id={user['id']}")

        for link, course_id in course_map.items():
            progress = 0.0
            for uc in item.get("courses", []):
                if uc.get("link") == link or uc.get("name"):
                    progress = float(uc.get("progress", 0))
                    break
            await db.create_user_course(user["id"], course_id, progress)
            if progress >= 100:
                await db.update_course_completed(user["id"], course_id, True)
            linked_courses += 1

    return {
        "site": site,
        "users_in_file": len(data.get("users", [])),
        "users_created": created_users,
        "courses": len(course_map),
        "user_course_links": linked_courses,
    }


async def main(sites: list[str] | None = None) -> None:
    await db.init_db()
    seed_dir = Path(__file__).resolve().parent
    configs = {
        "namcaonguyen": seed_dir / "namcaonguyen-users.json",
        "dailoi": seed_dir / "dailoi-users.json",
    }
    selected = sites or list(configs.keys())
    print("Seeding auto_learning...")
    results = []
    for name in selected:
        path = configs.get(name)
        if not path or not path.exists():
            print(f"  Bo qua {name}: khong tim thay {path}")
            continue
        print(f"\n== {name} ==")
        results.append(await seed_site(path))

    print("\n--- Ket qua ---")
    for r in results:
        print(
            f"{r['site']}: {r['users_created']} user moi / {r['users_in_file']} trong file, "
            f"{r['courses']} khoa, {r['user_course_links']} lien ket"
        )
    print(
        "\nQuiz NCN: chay `cd be-namcaonguyen && npm run db:import` sau khi Postgres + init DB."
    )


if __name__ == "__main__":
    import sys

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Seed tai khoan NCN + Dai Loi")
    parser.add_argument(
        "--site",
        choices=["namcaonguyen", "dailoi", "all"],
        default="all",
        help="Site can seed (mac dinh: all)",
    )
    args = parser.parse_args()
    site_list = None if args.site == "all" else [args.site]
    asyncio.run(main(site_list))
