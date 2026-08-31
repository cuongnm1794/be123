"""Seed NCN users — goi seed/seed_all.py."""

import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


async def seed_students() -> list[dict]:
    from seed.seed_all import seed_site

    seed_dir = ROOT / "seed"
    result = await seed_site(seed_dir / "namcaonguyen-users.json")
    print(f"Seed xong {result['users_in_file']} hoc vien NCN")
    return result


if __name__ == "__main__":
    from dotenv import load_dotenv

    load_dotenv(ROOT / "accounts_db" / ".env")
    from accounts_db import db

    async def _main():
        await db.init_db()
        await seed_students()
        await db.close_db()

    asyncio.run(_main())
