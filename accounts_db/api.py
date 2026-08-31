import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

load_dotenv(Path(__file__).resolve().parent / ".env")
load_dotenv(ROOT / ".env")

from accounts_db import db

app = FastAPI(title="Accounts DB API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _serialize(row: dict) -> dict:
    out = {}
    for k, v in row.items():
        if hasattr(v, "isoformat"):
            out[k] = v.isoformat()
        else:
            out[k] = v
    return out


@app.on_event("startup")
async def startup():
    await db.init_db()


@app.on_event("shutdown")
async def shutdown():
    await db.close_db()


@app.get("/health")
async def health():
    return {"ok": True, "service": "accounts-db"}


@app.get("/api/users")
async def list_users(
    site: str | None = Query(None),
    batch: str | None = Query(None),
):
    users = await db.get_all_users(site=site, batch=batch)
    return [_serialize(u) for u in users]


@app.get("/api/users/{user_id}")
async def get_user(user_id: int):
    user = await db.get_user_by_id(user_id)
    if not user:
        raise HTTPException(404, "User not found")
    return _serialize(user)


@app.get("/api/users/{user_id}/summary")
async def user_summary(user_id: int):
    user = await db.get_user_by_id(user_id)
    if not user:
        raise HTTPException(404, "User not found")
    courses = await db.get_user_courses(user_id)
    stats = await db.get_user_course_stats(user_id)
    today_hours = await db.get_today_study_hours(user_id)
    weekly = await db.get_weekly_study_hours(user_id)
    logs = await db.get_logs(user_id)
    return {
        "user": _serialize(user),
        "stats": stats,
        "today_hours": today_hours,
        "weekly_hours": weekly,
        "courses": [
            {
                **_serialize(c),
                "passed": bool(c.get("completed")) or float(c.get("progress") or 0) >= 100,
            }
            for c in courses
        ],
        "recent_logs": [_serialize(l) for l in logs[:20]],
    }


@app.get("/api/insights")
async def insights(
    site: str | None = Query(None),
    days: int = Query(30, ge=1, le=365),
):
    users = await db.get_all_users(site=site)
    result = []
    for u in users:
        uid = u["id"]
        courses = await db.get_user_courses(uid)
        stats = await db.get_user_course_stats(uid)
        today_hours = await db.get_today_study_hours(uid)
        course_rows = []
        for c in courses:
            progress = float(c.get("progress") or 0)
            passed = bool(c.get("completed")) or progress >= 100
            course_rows.append(
                {
                    "course_id": c["course_id"],
                    "course_name": c["course_name"],
                    "progress": progress,
                    "passed": passed,
                    "link": c.get("link"),
                }
            )
        result.append(
            {
                "user_id": uid,
                "username": u["username"],
                "name": u.get("name"),
                "site": u.get("site"),
                "batch_name": u.get("batch_name"),
                "is_running": u.get("is_running"),
                "is_finish": u.get("is_finish"),
                "today_hours": today_hours,
                "courses_completed": stats.get("completed", 0),
                "courses_total": stats.get("total", 0),
                "courses": course_rows,
            }
        )
    return result


@app.post("/api/users/{user_id}/courses/{course_id}/progress")
async def update_progress(user_id: int, course_id: int, body: dict):
    progress = float(body.get("progress", 0))
    row = await db.update_course_progress(user_id, course_id, progress)
    if not row:
        raise HTTPException(404, "User course not found")
    if progress >= 100 or body.get("passed"):
        await db.update_course_completed(user_id, course_id, True)
    await db.create_log(
        user_id,
        f"Progress {course_id}: {progress}%"
        + (" (passed)" if progress >= 100 or body.get("passed") else ""),
    )
    return _serialize(row)


@app.post("/api/users/{user_id}/log")
async def add_log(user_id: int, body: dict):
    action = body.get("action")
    if not action:
        raise HTTPException(400, "action required")
    await db.create_log(user_id, action)
    if body.get("hours"):
        await db.add_study_hours(user_id, float(body["hours"]))
    return {"ok": True}


@app.get("/api/users/{user_id}/logs")
async def user_logs(user_id: int):
    logs = await db.get_logs(user_id)
    return [_serialize(l) for l in logs]


if __name__ == "__main__":
    port = int(os.getenv("ACCOUNTS_API_PORT", "3004"))
    uvicorn.run("api:app", host="0.0.0.0", port=port, reload=False)
