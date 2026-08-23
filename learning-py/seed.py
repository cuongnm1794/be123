"""Seed 3 học viên từ info.txt vào DB auto_learning."""

import db

DEFAULT_COURSE = {
    "course_name": "Môn học Pháp Luật Giao thông Đường Bộ",
    "link": "https://hoclythuyetlaixe.eco-tek.com.vn/slides/mon-hoc-phap-luat-giao-thong-uong-bo-315",
}

SEED_USERS = [
    {"name": "Ý", "username": "067199004010"},
    {"name": "Luyến", "username": "067188003393"},
    {"name": "Nhung", "username": "067182000262"},
]


async def seed_students() -> list[dict]:
    await db.init_db()
    course = await db.create_course(
        DEFAULT_COURSE["course_name"],
        "",
        DEFAULT_COURSE["link"],
    )

    created: list[dict] = []
    for item in SEED_USERS:
        username = item["username"]
        password = username
        existing = await db.get_user_by_username(username)
        if existing:
            user = existing
            print(f"  Da co user: {username} (id={user['id']})")
        else:
            user = await db.create_user(
                username,
                password,
                name=item["name"],
                is_running=True,
            )
            print(f"  Tao user: {item['name']} / {username} (id={user['id']})")

        await db.create_user_course(user["id"], course["id"], 0)
        created.append(user)

    print(f"\nSeed xong {len(created)} hoc vien, khoa: {DEFAULT_COURSE['course_name']}")
    return created
