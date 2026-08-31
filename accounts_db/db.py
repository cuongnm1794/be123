import os
import asyncpg
from datetime import datetime, timezone, timedelta

DB_CONFIG = {
    "host": os.getenv("DB_LEARN_HOST", "localhost"),
    "port": int(os.getenv("DB_LEARN_PORT", "5432")),
    "database": os.getenv("DB_LEARN_NAME", "auto_learning"),
    "user": os.getenv("DB_LEARN_USER", "postgres"),
    "password": os.getenv("DB_LEARN_PASSWORD", "postgres"),
}

_pool: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        _pool = await asyncpg.create_pool(**DB_CONFIG)
    return _pool


async def init_db():
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                name VARCHAR(255),
                user_id INTEGER,
                site VARCHAR(50) DEFAULT 'dailoi',
                batch_name VARCHAR(100),
                is_finish BOOLEAN DEFAULT FALSE,
                is_running BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        # Migration: add site + batch_name if missing
        for col, dtype in [("site", "VARCHAR(50) DEFAULT 'dailoi'"), ("batch_name", "VARCHAR(100)")]:
            await conn.execute(f"""
                DO $$ BEGIN
                    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_name='users' AND column_name='{col}')
                    THEN ALTER TABLE users ADD COLUMN {col} {dtype};
                    END IF;
                END $$;
            """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS courses (
                id SERIAL PRIMARY KEY,
                course_name VARCHAR(500) NOT NULL,
                description TEXT,
                link VARCHAR(1000) NOT NULL
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS user_courses (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
                progress FLOAT DEFAULT 0,
                time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, course_id)
            )
        """)
        await conn.execute("""
            DO $$ BEGIN
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='user_courses' AND column_name='completed')
                THEN
                    ALTER TABLE user_courses ADD COLUMN completed BOOLEAN DEFAULT FALSE;
                END IF;
            END $$;
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS logs (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                action TEXT NOT NULL,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS study_hours (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                study_date DATE NOT NULL,
                hours_studied FLOAT DEFAULT 0,
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, study_date)
            )
        """)
        # Migration: align with Electron schema (hours_studied, not hours)
        await conn.execute("""
            DO $$ BEGIN
                IF EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='study_hours' AND column_name='hours')
                   AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='study_hours' AND column_name='hours_studied')
                THEN
                    ALTER TABLE study_hours RENAME COLUMN hours TO hours_studied;
                ELSIF EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='study_hours' AND column_name='hours')
                   AND EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='study_hours' AND column_name='hours_studied')
                THEN
                    UPDATE study_hours SET hours_studied = COALESCE(hours_studied, 0) + COALESCE(hours, 0)
                    WHERE hours IS NOT NULL AND hours <> 0;
                    ALTER TABLE study_hours DROP COLUMN hours;
                ELSIF NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_name='study_hours' AND column_name='hours_studied')
                THEN
                    ALTER TABLE study_hours ADD COLUMN hours_studied FLOAT DEFAULT 0;
                END IF;
            END $$;
        """)
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS study_sessions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                course_id INTEGER REFERENCES courses(id) ON DELETE CASCADE,
                lesson_name VARCHAR(500),
                slide_id INTEGER,
                start_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                end_time TIMESTAMP,
                duration_seconds INTEGER DEFAULT 0,
                progress_after FLOAT
            )
        """)
        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_study_sessions_user_course
            ON study_sessions(user_id, course_id)
        """)
        await conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_study_sessions_start
            ON study_sessions(start_time)
        """)
        await conn.execute("""
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
        """)


async def close_db():
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


# ── User operations ──

async def get_all_users(site: str = None, batch: str = None):
    pool = await get_pool()
    query = "SELECT * FROM users"
    params = []
    conditions = []
    if site:
        conditions.append(f"site = ${len(params)+1}")
        params.append(site)
    if batch:
        conditions.append(f"batch_name = ${len(params)+1}")
        params.append(batch)
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    query += " ORDER BY id DESC"
    rows = await pool.fetch(query, *params)
    return [dict(r) for r in rows]


async def get_user_by_id(user_id: int):
    pool = await get_pool()
    row = await pool.fetchrow("SELECT * FROM users WHERE id = $1", user_id)
    return dict(row) if row else None


async def get_user_by_username(username: str):
    pool = await get_pool()
    row = await pool.fetchrow("SELECT * FROM users WHERE username = $1", username)
    return dict(row) if row else None


async def get_running_users(site: str = None):
    pool = await get_pool()
    if site:
        rows = await pool.fetch(
            "SELECT * FROM users WHERE is_running = TRUE AND site = $1 ORDER BY id ASC",
            site,
        )
    else:
        rows = await pool.fetch(
            "SELECT * FROM users WHERE is_running = TRUE ORDER BY id ASC"
        )
    return [dict(r) for r in rows]


async def create_user(
    username: str,
    password: str,
    is_running: bool = False,
    site: str = "dailoi",
    batch: str = None,
    name: str = None,
):
    pool = await get_pool()
    row = await pool.fetchrow(
        "INSERT INTO users (username, password, name, is_finish, is_running, site, batch_name) "
        "VALUES ($1, $2, $3, FALSE, $4, $5, $6) RETURNING *",
        username, password, name, is_running, site, batch,
    )
    await pool.execute(
        "INSERT INTO logs (user_id, action, timestamp) VALUES ($1, $2, $3)",
        row["id"], f"User created ({site})", datetime.now(),
    )
    return dict(row)


async def update_user(uid: int, **fields):
    pool = await get_pool()
    allowed = {"username", "password", "name", "is_finish", "is_running", "user_id", "site", "batch_name"}
    updates = {k: v for k, v in fields.items() if k in allowed and v is not None}
    if not updates:
        return None
    set_clause = ", ".join(f"{k} = ${i+1}" for i, k in enumerate(updates))
    values = list(updates.values()) + [uid]
    row = await pool.fetchrow(
        f"UPDATE users SET {set_clause} WHERE id = ${len(values)} RETURNING *",
        *values,
    )
    if row:
        await pool.execute(
            "INSERT INTO logs (user_id, action, timestamp) VALUES ($1, $2, $3)",
            uid, "User updated", datetime.now(),
        )
    return dict(row) if row else None


async def get_batches(site: str = None):
    pool = await get_pool()
    query = "SELECT DISTINCT batch_name FROM users WHERE batch_name IS NOT NULL"
    params = []
    if site:
        query += " AND site = $1"
        params.append(site)
    query += " ORDER BY batch_name"
    rows = await pool.fetch(query, *params)
    return [r["batch_name"] for r in rows]


async def count_users(site: str = None):
    pool = await get_pool()
    query = "SELECT COUNT(*) as count FROM users"
    params = []
    if site:
        query += " WHERE site = $1"
        params.append(site)
    row = await pool.fetchrow(query, *params)
    return row["count"]


async def delete_user(user_id: int):
    pool = await get_pool()
    result = await pool.execute("DELETE FROM users WHERE id = $1", user_id)
    success = result != "DELETE 0"
    if success:
        await pool.execute(
            "INSERT INTO logs (user_id, action, timestamp) VALUES ($1, $2, $3)",
            user_id, "User deleted", datetime.now(),
        )
    return success


# ── Course operations ──

async def get_all_courses():
    pool = await get_pool()
    rows = await pool.fetch("SELECT * FROM courses ORDER BY id ASC")
    return [dict(r) for r in rows]


async def get_course_by_id(course_id: int):
    pool = await get_pool()
    row = await pool.fetchrow("SELECT * FROM courses WHERE id = $1", course_id)
    return dict(row) if row else None


async def get_course_by_link(link: str):
    pool = await get_pool()
    row = await pool.fetchrow("SELECT * FROM courses WHERE link = $1", link)
    return dict(row) if row else None


async def create_course(course_name: str, description: str, link: str):
    existing = await get_course_by_link(link)
    if existing:
        return existing
    pool = await get_pool()
    row = await pool.fetchrow(
        "INSERT INTO courses (course_name, description, link) VALUES ($1, $2, $3) RETURNING *",
        course_name, description, link,
    )
    return dict(row)


# ── UserCourse operations ──

async def get_user_courses(user_id: int):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT uc.*, c.course_name, c.description, c.link "
        "FROM user_courses uc JOIN courses c ON uc.course_id = c.id "
        "WHERE uc.user_id = $1 ORDER BY c.id ASC",
        user_id,
    )
    return [dict(r) for r in rows]


async def get_incomplete_courses(user_id: int):
    pool = await get_pool()
    rows = await pool.fetch(
        "SELECT uc.*, c.course_name, c.description, c.link "
        "FROM user_courses uc JOIN courses c ON uc.course_id = c.id "
        "WHERE uc.user_id = $1 AND NOT uc.completed ORDER BY c.id ASC",
        user_id,
    )
    return [dict(r) for r in rows]


async def get_user_course_stats(user_id: int):
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT COUNT(*) as total, COUNT(CASE WHEN completed THEN 1 END) as completed "
        "FROM user_courses WHERE user_id = $1",
        user_id,
    )
    return {"total": row["total"], "completed": row["completed"]}


async def update_course_progress(user_id: int, course_id: int, progress: float):
    pool = await get_pool()
    p = max(0.0, min(100.0, float(progress)))
    row = await pool.fetchrow(
        "INSERT INTO user_courses (user_id, course_id, progress, time) "
        "VALUES ($1, $2, $3, CURRENT_TIMESTAMP) "
        "ON CONFLICT (user_id, course_id) DO UPDATE SET "
        "progress = GREATEST(user_courses.progress, EXCLUDED.progress), "
        "time = CURRENT_TIMESTAMP "
        "RETURNING *",
        user_id, course_id, p,
    )
    return dict(row) if row else None


async def update_course_completed(user_id: int, course_id: int, completed: bool = True):
    pool = await get_pool()
    row = await pool.fetchrow(
        "UPDATE user_courses SET completed = $3, time = CURRENT_TIMESTAMP "
        "WHERE user_id = $1 AND course_id = $2 RETURNING *",
        user_id, course_id, completed,
    )
    return dict(row) if row else None


async def create_user_course(user_id: int, course_id: int, progress: float = 0):
    pool = await get_pool()
    row = await pool.fetchrow(
        "INSERT INTO user_courses (user_id, course_id, progress, time) "
        "VALUES ($1, $2, $3, CURRENT_TIMESTAMP) "
        "ON CONFLICT (user_id, course_id) DO UPDATE SET progress = $3, time = CURRENT_TIMESTAMP RETURNING *",
        user_id, course_id, progress,
    )
    return dict(row)


# ── Study hours ──

UTC_PLUS_7 = timezone(timedelta(hours=7))


async def get_today_study_hours(user_id: int):
    pool = await get_pool()
    from datetime import date as date_type
    today = datetime.now(UTC_PLUS_7).date()
    row = await pool.fetchrow(
        "SELECT COALESCE(SUM(hours_studied), 0) as total FROM study_hours WHERE user_id = $1 AND study_date = $2",
        user_id, today,
    )
    return float(row["total"]) if row else 0.0


async def add_study_hours(user_id: int, hours: float):
    pool = await get_pool()
    today = datetime.now(UTC_PLUS_7).date()
    await pool.execute(
        "INSERT INTO study_hours (user_id, study_date, hours_studied, last_updated) "
        "VALUES ($1, $2, $3, CURRENT_TIMESTAMP) "
        "ON CONFLICT (user_id, study_date) DO UPDATE SET "
        "hours_studied = study_hours.hours_studied + EXCLUDED.hours_studied, "
        "last_updated = CURRENT_TIMESTAMP",
        user_id, today, hours,
    )


async def get_weekly_study_hours(user_id: int = None):
    """Giờ học 7 ngày gần nhất. Trả về list {date, hours}. Nếu user_id=None thì tổng tất cả."""
    pool = await get_pool()
    from datetime import date as date_type, timedelta as td
    today = datetime.now(UTC_PLUS_7).date()
    start = today - td(days=6)
    if user_id:
        rows = await pool.fetch(
            "SELECT study_date, SUM(hours_studied) as hours FROM study_hours "
            "WHERE user_id = $1 AND study_date >= $2 GROUP BY study_date ORDER BY study_date",
            user_id, start,
        )
    else:
        rows = await pool.fetch(
            "SELECT study_date, SUM(hours_studied) as hours FROM study_hours "
            "WHERE study_date >= $1 GROUP BY study_date ORDER BY study_date",
            start,
        )
    by_date = {r["study_date"]: float(r["hours"]) for r in rows}
    result = []
    for i in range(7):
        d = start + td(days=i)
        result.append({"date": d.isoformat(), "hours": by_date.get(d, 0)})
    return result


# ── Lesson checkpoint ──

async def get_lesson_checkpoint(user_id: int, course_id: int):
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT * FROM lesson_checkpoints WHERE user_id = $1 AND course_id = $2",
        user_id, course_id,
    )
    return dict(row) if row else None


async def upsert_lesson_checkpoint(user_id: int, course_id: int, last_slide_id: int,
                                    last_lesson_name: str = None, last_lesson_index: int = None):
    pool = await get_pool()
    row = await pool.fetchrow(
        "INSERT INTO lesson_checkpoints (user_id, course_id, last_slide_id, last_lesson_name, last_lesson_index, updated_at) "
        "VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP) "
        "ON CONFLICT (user_id, course_id) DO UPDATE SET "
        "last_slide_id = EXCLUDED.last_slide_id, last_lesson_name = EXCLUDED.last_lesson_name, "
        "last_lesson_index = EXCLUDED.last_lesson_index, updated_at = CURRENT_TIMESTAMP "
        "RETURNING *",
        user_id, course_id, last_slide_id, last_lesson_name, last_lesson_index,
    )
    return dict(row)


async def clear_lesson_checkpoint(user_id: int, course_id: int):
    pool = await get_pool()
    await pool.execute(
        "DELETE FROM lesson_checkpoints WHERE user_id = $1 AND course_id = $2",
        user_id, course_id,
    )


# ── Log operations ──

async def create_log(user_id: int, action: str):
    pool = await get_pool()
    await pool.execute(
        "INSERT INTO logs (user_id, action, timestamp) VALUES ($1, $2, $3)",
        user_id, action, datetime.now(),
    )


async def get_logs(user_id: int = None):
    pool = await get_pool()
    if user_id:
        rows = await pool.fetch(
            "SELECT * FROM logs WHERE user_id = $1 ORDER BY timestamp DESC LIMIT 100",
            user_id,
        )
    else:
        rows = await pool.fetch(
            "SELECT * FROM logs ORDER BY timestamp DESC LIMIT 100"
        )
    return [dict(r) for r in rows]


# ── Study sessions ──

async def start_study_session(user_id: int, course_id: int, lesson_name: str = None, slide_id: int = None) -> int:
    """Tạo mới study session, trả về session id."""
    pool = await get_pool()
    row = await pool.fetchrow(
        "INSERT INTO study_sessions (user_id, course_id, lesson_name, slide_id, start_time) "
        "VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP) RETURNING id",
        user_id, course_id, lesson_name, slide_id,
    )
    return row["id"]


async def end_study_session(session_id: int, duration_seconds: int = None, progress_after: float = None):
    """Kết thúc study session: cập nhật end_time, duration, progress."""
    pool = await get_pool()
    if duration_seconds is not None:
        await pool.execute(
            "UPDATE study_sessions SET end_time = CURRENT_TIMESTAMP, duration_seconds = $1, progress_after = $2 "
            "WHERE id = $3",
            duration_seconds, progress_after, session_id,
        )
    else:
        # Tự tính duration từ start_time nếu không truyền
        await pool.execute(
            "UPDATE study_sessions SET end_time = CURRENT_TIMESTAMP, "
            "duration_seconds = EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - start_time))::INTEGER, progress_after = $1 "
            "WHERE id = $2",
            progress_after, session_id,
        )


async def get_study_sessions(user_id: int = None, course_id: int = None, days: int = 7, limit: int = 50):
    """Lấy danh sách study sessions, có thể lọc theo user/course/khoảng ngày."""
    pool = await get_pool()
    from datetime import timedelta as td
    since = datetime.now() - td(days=days)

    conditions = ["ss.start_time >= $1"]
    params = [since]
    idx = 2

    if user_id:
        conditions.append(f"ss.user_id = ${idx}")
        params.append(user_id)
        idx += 1
    if course_id:
        conditions.append(f"ss.course_id = ${idx}")
        params.append(course_id)
        idx += 1

    query = f"""
        SELECT ss.*, u.name as user_name, c.course_name
        FROM study_sessions ss
        LEFT JOIN users u ON ss.user_id = u.id
        LEFT JOIN courses c ON ss.course_id = c.id
        WHERE {' AND '.join(conditions)}
        ORDER BY ss.start_time DESC
        LIMIT ${idx}
    """
    params.append(limit)
    rows = await pool.fetch(query, *params)
    return [dict(r) for r in rows]


async def get_course_study_time(user_id: int, course_id: int = None):
    """Thời gian học + progress theo course. Nếu course_id=None thì trả về tất cả course của user."""
    pool = await get_pool()
    if course_id:
        row = await pool.fetchrow(
            "SELECT COALESCE(SUM(duration_seconds), 0) as total_seconds "
            "FROM study_sessions WHERE user_id = $1 AND course_id = $2 AND end_time IS NOT NULL",
            user_id, course_id,
        )
        total_seconds = int(row["total_seconds"])
        # Lấy progress từ user_courses
        prog_row = await pool.fetchrow(
            "SELECT uc.progress, c.course_name FROM user_courses uc "
            "JOIN courses c ON uc.course_id = c.id "
            "WHERE uc.user_id = $1 AND uc.course_id = $2",
            user_id, course_id,
        )
        return {
            "total_seconds": total_seconds,
            "total_hours": round(total_seconds / 3600, 1),
            "progress": float(prog_row["progress"]) if prog_row else 0.0,
            "course_name": prog_row["course_name"] if prog_row else None,
        }
    else:
        rows = await pool.fetch(
            "SELECT ss.course_id, c.course_name, "
            "COALESCE(SUM(ss.duration_seconds), 0) as total_seconds, "
            "COUNT(ss.id) as session_count, MAX(ss.start_time) as last_study, "
            "uc.progress "
            "FROM study_sessions ss "
            "JOIN courses c ON ss.course_id = c.id "
            "LEFT JOIN user_courses uc ON uc.user_id = ss.user_id AND uc.course_id = ss.course_id "
            "WHERE ss.user_id = $1 AND ss.end_time IS NOT NULL "
            "GROUP BY ss.course_id, c.course_name, uc.progress ORDER BY total_seconds DESC",
            user_id,
        )
        result = []
        for r in rows:
            item = dict(r)
            if hasattr(item.get("last_study"), 'isoformat'):
                item["last_study"] = item["last_study"].isoformat()
            item["total_hours"] = round(int(item["total_seconds"]) / 3600, 1)
            if isinstance(item.get("progress"), (int, float)):
                item["progress"] = float(item["progress"])
            result.append(item)
        return result


async def get_dashboard_insights(days: int = 30):
    """Tổng hợp insights cho dashboard - thống kê toàn hệ thống."""
    pool = await get_pool()
    from datetime import timedelta as td
    since = datetime.now() - td(days=days)

    # Tổng số giờ học trong kỳ
    total_hours_row = await pool.fetchrow(
        "SELECT COALESCE(SUM(duration_seconds), 0) as total_seconds FROM study_sessions "
        "WHERE start_time >= $1 AND end_time IS NOT NULL",
        since,
    )
    total_seconds = int(total_hours_row["total_seconds"])

    # Tổng số sessions
    total_sessions_row = await pool.fetchrow(
        "SELECT COUNT(*) as count FROM study_sessions WHERE start_time >= $1", since,
    )
    total_sessions = total_sessions_row["count"]

    # Số học viên đang hoạt động
    active_users_row = await pool.fetchrow(
        "SELECT COUNT(DISTINCT user_id) as count FROM study_sessions WHERE start_time >= $1", since,
    )

    # Top học viên chăm chỉ
    top_users = await pool.fetch(
        "SELECT ss.user_id, u.name, u.username, COALESCE(SUM(ss.duration_seconds), 0) as total_seconds, "
        "COUNT(ss.id) as session_count "
        "FROM study_sessions ss JOIN users u ON ss.user_id = u.id "
        "WHERE ss.start_time >= $1 AND ss.end_time IS NOT NULL "
        "GROUP BY ss.user_id, u.name, u.username ORDER BY total_seconds DESC LIMIT 10",
        since,
    )

    # Thống kê theo ngày
    daily_stats = await pool.fetch(
        "SELECT DATE(start_time) as study_date, "
        "COALESCE(SUM(duration_seconds), 0) as total_seconds, COUNT(*) as session_count "
        "FROM study_sessions WHERE start_time >= $1 AND end_time IS NOT NULL "
        "GROUP BY DATE(start_time) ORDER BY study_date",
        since,
    )

    # Course completion stats
    course_stats = await pool.fetch(
        "SELECT c.id, c.course_name, COUNT(uc.id) as total_students, "
        "COUNT(CASE WHEN uc.progress >= 100 THEN 1 END) as completed "
        "FROM courses c JOIN user_courses uc ON c.id = uc.course_id "
        "GROUP BY c.id, c.course_name ORDER BY total_students DESC",
    )

    # Learner insights
    learner_insights = await get_learner_insights(days=days)

    result = {
        "days": days,
        "total_seconds": total_seconds,
        "total_hours": round(total_seconds / 3600, 1),
        "total_sessions": total_sessions,
        "active_users": active_users_row["count"],
        "daily_avg_hours": round(total_seconds / 3600 / max(days, 1), 2),
        "top_users": [
            {
                "user_id": r["user_id"],
                "name": r["name"],
                "username": r["username"],
                "total_hours": round(int(r["total_seconds"]) / 3600, 1),
                "session_count": r["session_count"],
            }
            for r in top_users
        ],
        "daily_stats": [
            {
                "date": r["study_date"].isoformat() if hasattr(r["study_date"], 'isoformat') else str(r["study_date"]),
                "hours": round(int(r["total_seconds"]) / 3600, 1),
                "sessions": r["session_count"],
            }
            for r in daily_stats
        ],
        "course_stats": [
            {
                "course_id": r["id"],
                "course_name": r["course_name"],
                "total_students": r["total_students"],
                "completed": r["completed"],
                "completion_rate": round(r["completed"] / max(r["total_students"], 1) * 100, 1),
            }
            for r in course_stats
        ],
        "learner_insights": {
            "total_learners": learner_insights["total_learners"],
            "almost_done": learner_insights["almost_done"],
            "inactive_slow": learner_insights["inactive_slow"],
            "struggling": learner_insights["struggling"],
        },
    }
    return result


# ── Learner insights ──

async def get_learner_insights(days: int = 7):
    """Phân tích học viên: ai sắp xong, ai chậm, ai không học."""
    pool = await get_pool()
    from datetime import timedelta as td
    now = datetime.now(UTC_PLUS_7)
    since = now - td(days=days)

    # Lấy tất cả user đang active (có course)
    users_rows = await pool.fetch("""
        SELECT u.id, u.name, u.username, u.batch_name
        FROM users u
        WHERE u.site = 'dailoi'
        ORDER BY u.id
    """)

    # Progress tổng hợp của từng user
    learner_list = []
    for u in users_rows:
        uid = u["id"]
        # Tổng số courses + đã hoàn thành
        stats_row = await pool.fetchrow(
            "SELECT COUNT(*) as total, "
            "COUNT(CASE WHEN progress >= 100 THEN 1 END) as completed, "
            "COALESCE(AVG(progress), 0) as avg_progress "
            "FROM user_courses WHERE user_id = $1",
            uid,
        )
        # Lần học gần nhất
        last_row = await pool.fetchrow(
            "SELECT MAX(start_time) as last_study FROM study_sessions WHERE user_id = $1",
            uid,
        )
        last_study = last_row["last_study"] if last_row else None
        days_since_last_study = (now - last_study).days if last_study else None

        # Tổng số giờ học
        hours_row = await pool.fetchrow(
            "SELECT COALESCE(SUM(duration_seconds), 0) as total_seconds "
            "FROM study_sessions WHERE user_id = $1 AND end_time IS NOT NULL",
            uid,
        )
        total_hours = round(int(hours_row["total_seconds"]) / 3600, 1)

        learner_list.append({
            "user_id": uid,
            "name": u["name"] or u["username"],
            "username": u["username"],
            "batch": u["batch_name"],
            "total_courses": stats_row["total"],
            "completed_courses": stats_row["completed"],
            "avg_progress": round(float(stats_row["avg_progress"]), 1),
            "total_hours": total_hours,
            "last_study": last_study.isoformat() if last_study and hasattr(last_study, 'isoformat') else (str(last_study) if last_study else None),
            "days_since_last_study": days_since_last_study,
        })

    # Phân loại
    almost_done = [l for l in learner_list if 80 <= l["avg_progress"] < 100]
    completed = [l for l in learner_list if l["avg_progress"] >= 100]
    slow = [l for l in learner_list if l["days_since_last_study"] is not None and l["days_since_last_study"] >= days]
    struggling = [l for l in learner_list if l["avg_progress"] < 30 and l["total_courses"] > 0]

    return {
        "total_learners": len(learner_list),
        "almost_done": sorted(almost_done, key=lambda x: x["avg_progress"], reverse=True),
        "completed": sorted(completed, key=lambda x: x["avg_progress"], reverse=True),
        "inactive_slow": sorted(slow, key=lambda x: x["days_since_last_study"], reverse=True),
        "struggling": sorted(struggling, key=lambda x: x["avg_progress"]),
        "all_learners": sorted(learner_list, key=lambda x: x["avg_progress"], reverse=True),
    }


# ── Student insights list (frontend-facing) ──

async def get_student_insights_list(days: int = 30):
    """Trả về danh sách học viên kèm trạng thái, đúng format StudentInsight."""
    raw = await get_learner_insights(days=days)
    from datetime import datetime, timedelta, timezone
    now_utc7 = datetime.now(timezone(timedelta(hours=7)))
    cutoff = now_utc7 - timedelta(days=days)
    result = []
    for l in raw["all_learners"]:
        # Xác định status
        if l["avg_progress"] >= 80:
            status = "almost_done"
        elif l["days_since_last_study"] is not None and l["days_since_last_study"] >= max(days, 7):
            status = "inactive"
        elif l["avg_progress"] < 30 and l["total_courses"] > 0:
            status = "behind"
        else:
            status = "on_track"
        last_active = l["last_study"] if l["last_study"] else ""
        result.append({
            "user_id": l["user_id"],
            "username": l["username"],
            "name": l["name"],
            "completed_courses": l["completed_courses"],
            "total_courses": l["total_courses"],
            "completion_rate": l["avg_progress"],
            "last_active": last_active,
            "status": status,
        })
    return result


# ── Course progress history ──

async def get_course_progress_history(days: int = 90):
    """Trả về progress history theo course qua thời gian từ study_sessions.
    Mỗi điểm là (date, progress, course_name) — dùng cho line chart."""
    pool = await get_pool()
    from datetime import timedelta as td
    since = datetime.now() - td(days=days)
    rows = await pool.fetch("""
        SELECT
            ss.course_id,
            c.course_name,
            DATE(ss.start_time) as study_date,
            MAX(ss.progress_after) as max_progress
        FROM study_sessions ss
        JOIN courses c ON ss.course_id = c.id
        WHERE ss.start_time >= $1
          AND ss.progress_after IS NOT NULL
          AND ss.end_time IS NOT NULL
        GROUP BY ss.course_id, c.course_name, DATE(ss.start_time)
        ORDER BY c.course_name, study_date
    """, since)
    return [
        {
            "date": r["study_date"].isoformat() if hasattr(r["study_date"], 'isoformat') else str(r["study_date"]),
            "progress": float(r["max_progress"]),
            "course_name": r["course_name"],
        }
        for r in rows
    ]
