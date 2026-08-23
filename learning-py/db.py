import os
from datetime import datetime, timezone, timedelta

import asyncpg
from dotenv import load_dotenv

load_dotenv()

DB_CONFIG = {
    "host": os.getenv("DB_LEARN_HOST", "localhost"),
    "port": int(os.getenv("DB_LEARN_PORT", "5432")),
    "database": os.getenv("DB_LEARN_NAME", "auto_learning"),
    "user": os.getenv("DB_LEARN_USER", "postgres"),
    "password": os.getenv("DB_LEARN_PASSWORD", "postgres"),
}

UTC_PLUS_7 = timezone(timedelta(hours=7))
_pool: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(**DB_CONFIG)
    return _pool


async def close_db() -> None:
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


async def init_db() -> None:
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                name VARCHAR(255),
                user_id INTEGER,
                is_finish BOOLEAN DEFAULT FALSE,
                is_running BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS courses (
                id SERIAL PRIMARY KEY,
                course_name VARCHAR(500) NOT NULL,
                description TEXT,
                link VARCHAR(1000) NOT NULL
            )
            """
        )
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS user_courses (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
                progress FLOAT DEFAULT 0,
                time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, course_id)
            )
            """
        )
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS logs (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                action TEXT NOT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS study_hours (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                study_date DATE NOT NULL,
                hours_studied FLOAT DEFAULT 0,
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, study_date)
            )
            """
        )
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS lesson_checkpoints (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
                last_slide_id INTEGER NOT NULL,
                last_lesson_name VARCHAR(500),
                last_lesson_index INTEGER,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, course_id)
            )
            """
        )


async def get_user_by_id(user_id: int) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow("SELECT * FROM users WHERE id = $1", user_id)
    return dict(row) if row else None


async def get_user_by_username(username: str) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow("SELECT * FROM users WHERE username = $1", username)
    return dict(row) if row else None


async def get_all_users() -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch("SELECT * FROM users ORDER BY id ASC")
    return [dict(r) for r in rows]


async def get_running_users() -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT * FROM users WHERE is_running = TRUE ORDER BY id ASC"
    )
    return [dict(r) for r in rows]


async def create_user(
    username: str,
    password: str,
    *,
    name: str | None = None,
    is_running: bool = True,
) -> dict:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        INSERT INTO users (username, password, name, is_finish, is_running)
        VALUES ($1, $2, $3, FALSE, $4)
        RETURNING *
        """,
        username,
        password,
        name,
        is_running,
    )
    await create_log(row["id"], "User created (seed)")
    return dict(row)


async def update_user(uid: int, **fields) -> dict | None:
    pool = await get_pool()
    allowed = {"username", "password", "name", "is_finish", "is_running", "user_id"}
    updates = {k: v for k, v in fields.items() if k in allowed and v is not None}
    if not updates:
        return None
    set_clause = ", ".join(f"{k} = ${i + 1}" for i, k in enumerate(updates))
    values = list(updates.values()) + [uid]
    row = await pool.fetchrow(
        f"UPDATE users SET {set_clause} WHERE id = ${len(values)} RETURNING *",
        *values,
    )
    return dict(row) if row else None


async def get_course_by_id(course_id: int) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow("SELECT * FROM courses WHERE id = $1", course_id)
    return dict(row) if row else None


async def get_course_by_link(link: str) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow("SELECT * FROM courses WHERE link = $1", link)
    return dict(row) if row else None


async def create_course(course_name: str, description: str, link: str) -> dict:
    existing = await get_course_by_link(link)
    if existing:
        return existing
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        INSERT INTO courses (course_name, description, link)
        VALUES ($1, $2, $3)
        RETURNING *
        """,
        course_name,
        description,
        link,
    )
    return dict(row)


async def create_user_course(user_id: int, course_id: int, progress: float = 0) -> dict:
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        INSERT INTO user_courses (user_id, course_id, progress, time)
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
        ON CONFLICT (user_id, course_id)
        DO UPDATE SET progress = EXCLUDED.progress, time = CURRENT_TIMESTAMP
        RETURNING *
        """,
        user_id,
        course_id,
        progress,
    )
    return dict(row)


async def get_user_courses(user_id: int) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT uc.*, c.course_name, c.description, c.link
        FROM user_courses uc
        JOIN courses c ON uc.course_id = c.id
        WHERE uc.user_id = $1
        ORDER BY c.id ASC
        """,
        user_id,
    )
    return [dict(r) for r in rows]


async def get_incomplete_courses(user_id: int) -> list[dict]:
    pool = await get_pool()
    rows = await pool.fetch(
        """
        SELECT uc.*, c.course_name, c.description, c.link
        FROM user_courses uc
        JOIN courses c ON uc.course_id = c.id
        WHERE uc.user_id = $1 AND uc.progress < 100
        ORDER BY c.id ASC
        """,
        user_id,
    )
    return [dict(r) for r in rows]


async def update_course_progress(user_id: int, course_id: int, progress: float) -> dict | None:
    pool = await get_pool()
    p = max(0.0, min(100.0, float(progress)))
    row = await pool.fetchrow(
        """
        UPDATE user_courses
        SET progress = $1, time = CURRENT_TIMESTAMP
        WHERE user_id = $2 AND course_id = $3
        RETURNING *
        """,
        p,
        user_id,
        course_id,
    )
    return dict(row) if row else None


async def get_today_study_hours(user_id: int) -> float:
    pool = await get_pool()
    today = datetime.now(UTC_PLUS_7).date()
    row = await pool.fetchrow(
        "SELECT hours_studied FROM study_hours WHERE user_id = $1 AND study_date = $2",
        user_id,
        today,
    )
    return float(row["hours_studied"]) if row else 0.0


async def add_study_hours(user_id: int, hours: float) -> None:
    pool = await get_pool()
    today = datetime.now(UTC_PLUS_7).date()
    await pool.execute(
        """
        INSERT INTO study_hours (user_id, study_date, hours_studied, last_updated)
        VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
        ON CONFLICT (user_id, study_date)
        DO UPDATE SET
            hours_studied = study_hours.hours_studied + EXCLUDED.hours_studied,
            last_updated = CURRENT_TIMESTAMP
        """,
        user_id,
        today,
        hours,
    )


async def get_lesson_checkpoint(user_id: int, course_id: int) -> dict | None:
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT * FROM lesson_checkpoints WHERE user_id = $1 AND course_id = $2",
        user_id,
        course_id,
    )
    return dict(row) if row else None


async def upsert_lesson_checkpoint(
    user_id: int,
    course_id: int,
    last_slide_id: int,
    last_lesson_name: str | None = None,
    last_lesson_index: int | None = None,
) -> None:
    pool = await get_pool()
    await pool.execute(
        """
        INSERT INTO lesson_checkpoints
            (user_id, course_id, last_slide_id, last_lesson_name, last_lesson_index, updated_at)
        VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
        ON CONFLICT (user_id, course_id)
        DO UPDATE SET
            last_slide_id = EXCLUDED.last_slide_id,
            last_lesson_name = EXCLUDED.last_lesson_name,
            last_lesson_index = EXCLUDED.last_lesson_index,
            updated_at = CURRENT_TIMESTAMP
        """,
        user_id,
        course_id,
        last_slide_id,
        last_lesson_name,
        last_lesson_index,
    )


async def clear_lesson_checkpoint(user_id: int, course_id: int) -> None:
    pool = await get_pool()
    await pool.execute(
        "DELETE FROM lesson_checkpoints WHERE user_id = $1 AND course_id = $2",
        user_id,
        course_id,
    )


async def create_log(user_id: int, action: str) -> None:
    pool = await get_pool()
    await pool.execute(
        "INSERT INTO logs (user_id, action, timestamp) VALUES ($1, $2, $3)",
        user_id,
        action,
        datetime.now(),
    )
