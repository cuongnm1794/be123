"""Background jobs — học đa user song song (giống Electron start-multiple-learning)."""
import asyncio
import os
from datetime import datetime, timezone
from typing import Any

from . import browser, db, steps
from . import learning as auto_learn

MULTI_LEARNING_CONCURRENCY = int(os.getenv("MULTI_LEARNING_CONCURRENCY", "10"))
MULTI_LEARNING_START_STAGGER_MS = int(os.getenv("MULTI_LEARNING_START_STAGGER_MS", "3000"))
SKIPPED_COURSE_NAME = "KIEN THUC MOI VE XE NANG HANG"

_tasks: dict[int, asyncio.Task] = {}
_meta: dict[int, dict[str, Any]] = {}
_lock = asyncio.Lock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _strip_diacritics(s: str) -> str:
    import unicodedata
    s = s.replace("đ", "d").replace("Đ", "D")
    return "".join(
        c for c in unicodedata.normalize("NFD", s)
        if unicodedata.category(c) != "Mn"
    )


def should_skip_course(name: str | None) -> bool:
    if not name:
        return False
    a = _strip_diacritics(name.strip()).upper()
    b = _strip_diacritics(SKIPPED_COURSE_NAME).upper()
    return a == b or b in a


def is_user_running(user_id: int) -> bool:
    task = _tasks.get(user_id)
    return task is not None and not task.done()


async def get_job_status(user_id: int | None = None) -> dict:
    async with _lock:
        if user_id is not None:
            meta = dict(_meta.get(user_id, {}))
            meta["running"] = is_user_running(user_id)
            return {"user_id": user_id, **meta}
        jobs = []
        for uid in sorted(set(_tasks) | set(_meta)):
            m = dict(_meta.get(uid, {}))
            m["user_id"] = uid
            m["running"] = is_user_running(uid)
            jobs.append(m)
        return {"jobs": jobs, "active_count": sum(1 for j in jobs if j.get("running"))}


async def _execute_learning_session(user_id: int, course_id: int) -> dict:
    u = await db.get_user_by_id(user_id)
    c = await db.get_course_by_id(course_id)
    if not u or not c:
        return {"success": False, "error": "User or course not found"}

    if should_skip_course(c.get("course_name")):
        await db.create_log(user_id, f"Skipped blocked course: {c['course_name']}")
        return {"success": True, "skipped": True, "course": c["course_name"]}

    today_hours = await db.get_today_study_hours(user_id)
    if today_hours >= 10:
        return {"success": False, "error": "Da dat 10 gio hoc trong ngay"}

    ucs = await db.get_user_courses(user_id)
    uc = next((x for x in ucs if x["course_id"] == course_id), None)
    prog = uc["progress"] if uc else 0
    completed = uc["completed"] if uc else False
    if completed:
        return {"success": True, "skipped": True, "course": c["course_name"], "message": "already completed"}

    steps.record(user_id, "study", f"Bắt đầu khóa: {c['course_name']}", course=c["course_name"])
    await db.create_log(user_id, f"Started learning: {c['course_name']}")
    await browser.launch_browser(user_id, "learn")
    page = await browser.get_page(user_id)

    # Page đơ / tab chết → đóng mở lại (CHỈ khi thật sự chết).
    # Lưu ý: page.evaluate() KHÔNG nhận kwarg timeout — dùng wait_for cho có timeout.
    import asyncio as _asyncio
    page_dead = False
    try:
        if page.is_closed():
            page_dead = True
        else:
            await _asyncio.wait_for(page.evaluate("1"), timeout=8.0)
    except Exception:
        page_dead = True

    if page_dead:
        steps.record(user_id, "prepare", "Tab Chrome thực sự không phản hồi → mở lại", status="warn")
        await db.create_log(user_id, "Browser page khong phan hoi, mo lai...")
        await browser.close_browser(user_id)
        await browser.launch_browser(user_id, "learn")
        page = await browser.get_page(user_id)

    await browser.stop_auto_slide(page, learning_active=True)
    await browser.set_stop_flag(user_id, False)

    try:
        success = await auto_learn.start_learning(user_id, course_id, c["link"], prog)
        if success:
            await db.update_user(user_id, is_finish=True)
            await db.update_course_completed(user_id, course_id, True)
            await db.create_log(user_id, f"Completed: {c['course_name']}")
        return {"success": success, "course": c["course_name"], "course_id": course_id}
    except Exception as e:
        await db.create_log(user_id, f"Learning error: {e}")
        return {"success": False, "error": str(e), "course": c["course_name"]}


async def _run_user_all_incomplete(user_id: int) -> dict:
    """Học lần lượt các khóa chưa xong của 1 user (chạy trong 1 background task)."""
    attempted = succeeded = failed = 0
    failed_reasons: list[str] = []

    incomplete = await db.get_incomplete_courses(user_id)
    actionable = [c for c in incomplete if not should_skip_course(c.get("course_name"))]

    for uc in actionable:
        if await browser.is_stopped(user_id):
            break
        if await db.get_today_study_hours(user_id) >= 10:
            break

        course = await db.get_course_by_id(uc["course_id"])
        if not course:
            continue

        attempted += 1
        result = await _execute_learning_session(user_id, uc["course_id"])
        if result.get("success") and not result.get("skipped"):
            succeeded += 1
        elif not result.get("skipped"):
            failed += 1
            failed_reasons.append(result.get("course") or str(uc["course_id"]))

    return {
        "success": failed == 0,
        "user_id": user_id,
        "attempted": attempted,
        "succeeded": succeeded,
        "failed": failed,
        "failed_courses": failed_reasons,
    }


async def _job_wrapper(user_id: int, course_id: int | None, mode: str):
    key = user_id
    await browser.set_stop_flag(user_id, False)
    steps.record(user_id, "prepare", f"Job bắt đầu (mode={mode})")
    try:
        async with _lock:
            if key in _meta:
                _meta[key]["status"] = "running"
                _meta[key]["updated_at"] = _now_iso()

        if mode == "all_incomplete" or course_id is None:
            result = await _run_user_all_incomplete(user_id)
        else:
            # mode "course": chạy khoá chỉ định, sau đó TỰ ĐỘNG chuyển tiếp
            # các khoá chưa hoàn thành còn lại (auto-advance).
            attempted = succeeded = failed = 0
            failed_reasons: list[str] = []

            def _count(r: dict) -> None:
                nonlocal attempted, succeeded, failed, failed_reasons
                attempted += 1
                if r.get("success") and not r.get("skipped"):
                    succeeded += 1
                elif not r.get("skipped"):
                    failed += 1
                    failed_reasons.append(r.get("course") or str(r.get("course_id")))

            # 1) Khóa chỉ định
            first = await _execute_learning_session(user_id, course_id)
            _count(first)
            # Từ giờ lấy các khoá chưa hoàn thành còn lại (bỏ khoá vừa xong)
            if first.get("success"):
                incomplete = await db.get_incomplete_courses(user_id)
                actionable = [
                    c for c in incomplete
                    if not should_skip_course(c.get("course_name"))
                    and c.get("course_id") != course_id
                ]
                for uc in actionable:
                    if await browser.is_stopped(user_id):
                        break
                    if await db.get_today_study_hours(user_id) >= 10:
                        break
                    course = await db.get_course_by_id(uc["course_id"])
                    if not course:
                        continue
                    r = await _execute_learning_session(user_id, uc["course_id"])
                    _count(r)

            result = {
                "success": failed == 0,
                "user_id": user_id,
                "attempted": attempted,
                "succeeded": succeeded,
                "failed": failed,
                "failed_courses": failed_reasons,
            }
        async with _lock:
            _meta[key] = {
                "status": "done" if result.get("success") else "failed",
                "finished_at": _now_iso(),
                **result,
            }
        steps.record(
            user_id, "done" if result.get("success") else "error",
            f"Job kết thúc: {result.get('attempted', 0)} thử / {result.get('succeeded', 0)} ok / {result.get('failed', 0)} lỗi",
            status="ok" if result.get("success") else "error",
        )
    except asyncio.CancelledError:
        async with _lock:
            _meta[key] = {"status": "cancelled", "user_id": user_id, "finished_at": _now_iso()}
        steps.record(user_id, "stop", "Job bị hủy (cancelled)", status="warn")
        await db.create_log(user_id, "Learning cancelled")
        raise
    except Exception as e:
        async with _lock:
            _meta[key] = {"status": "error", "error": str(e), "user_id": user_id, "finished_at": _now_iso()}
        steps.record(user_id, "error", f"Job lỗi: {e}", status="error")
        await db.create_log(user_id, f"Learning job error: {e}")
    finally:
        async with _lock:
            _tasks.pop(user_id, None)
        try:
            await browser.set_stop_flag(user_id, False)
        except Exception:
            pass


async def _prepare_user_for_learning(user_id: int, *, force: bool = False) -> tuple[bool, str | None]:
    """Chuẩn bị trước khi start: hủy job zombie. KHÔNG đóng browser —
    recovery trong learning.py sẽ tự điều hướng lại (login/profile/khóa)."""
    url = await browser.get_current_url(user_id)
    stuck = browser.is_stuck_idle_url(url)
    running = is_user_running(user_id)

    if running:
        if force or stuck:
            await stop_user_job(user_id)
            await asyncio.sleep(0.5)
        else:
            return False, "already_running"

    await browser.set_stop_flag(user_id, False)
    return True, None


async def restart_learning_job(
    user_id: int,
    course_id: int | None = None,
) -> dict:
    """Stop job zombie + start lại. Recovery trong learning.py tự điều hướng
    (login lại / vào profile / mở khóa) khi kẹt trang chủ — không đóng browser."""
    ok, err = await _prepare_user_for_learning(user_id, force=True)
    if not ok:
        return {"success": False, "error": err, "user_id": user_id}
    return await start_learning_job(user_id, course_id, background=True, force=True)


async def start_learning_job(
    user_id: int,
    course_id: int | None = None,
    *,
    background: bool = True,
    mode: str = "course",
    force: bool = False,
) -> dict:
    """Queue học 1 user. course_id=None → học tất cả khóa chưa xong."""
    ok, err = await _prepare_user_for_learning(user_id, force=force)
    if not ok:
        return {
            "success": False,
            "error": err,
            "user_id": user_id,
            "running": True,
        }

    async with _lock:
        if is_user_running(user_id):
            return {
                "success": False,
                "error": "User already learning",
                "user_id": user_id,
                "running": True,
            }

        job_mode = "all_incomplete" if course_id is None else mode
        _meta[user_id] = {
            "status": "queued",
            "user_id": user_id,
            "course_id": course_id,
            "mode": job_mode,
            "queued_at": _now_iso(),
        }
        steps.clear(user_id)
        steps.record(user_id, "prepare", "Xếp hàng job học")
        task = asyncio.create_task(_job_wrapper(user_id, course_id, job_mode))
        _tasks[user_id] = task

    if background:
        return {
            "success": True,
            "queued": True,
            "background": True,
            "user_id": user_id,
            "course_id": course_id,
            "mode": job_mode,
            "message": "Job da xep hang — goi dl_browser_jobs_status de theo doi",
        }

    try:
        await task
    except Exception:
        pass
    status = await get_job_status(user_id)
    return {"success": True, "background": False, **status}


async def start_multi_learning(
    user_ids: list[int] | None = None,
    course_id: int | None = None,
    *,
    only_auto_run: bool = True,
    concurrency: int | None = None,
    force: bool = False,
) -> dict:
    """Khởi chạy học song song nhiều user (không chờ xong)."""
    limit = concurrency or MULTI_LEARNING_CONCURRENCY

    if user_ids:
        targets = list(dict.fromkeys(int(u) for u in user_ids))
    else:
        users = await db.get_all_users()
        targets = [u["id"] for u in users if u.get("is_running")] if only_auto_run else [u["id"] for u in users]

    if not targets:
        return {"success": False, "error": "Khong co user nao de chay", "queued": []}

    sem = asyncio.Semaphore(max(1, limit))
    queued: list[dict] = []
    skipped: list[dict] = []

    async def _start_one(uid: int, index: int):
        if index > 0:
            stagger = min(index * MULTI_LEARNING_START_STAGGER_MS, 15000)
            await asyncio.sleep(stagger / 1000)

        async with sem:
            url = await browser.get_current_url(uid)
            stuck = browser.is_stuck_idle_url(url)
            running = is_user_running(uid)

            if running and not force and not stuck:
                skipped.append({"user_id": uid, "reason": "already_running"})
                return

            r = await start_learning_job(uid, course_id, background=True, force=force or stuck)
            if r.get("queued") or r.get("success"):
                queued.append({"user_id": uid, "course_id": course_id, "restarted": force or stuck})
            else:
                skipped.append({"user_id": uid, "reason": r.get("error", "not_queued")})

    await asyncio.gather(*(_start_one(uid, i) for i, uid in enumerate(targets)))

    return {
        "success": True,
        "queued_count": len(queued),
        "skipped_count": len(skipped),
        "concurrency": limit,
        "queued": queued,
        "skipped": skipped,
        "message": f"Da xep hang {len(queued)} user song song (toi da {limit})",
    }


async def stop_user_job(user_id: int) -> dict:
    await browser.set_stop_flag(user_id, True)
    try:
        page = await browser.get_page(user_id)
        await browser.stop_auto_slide(page, learning_active=False)
        await browser.set_learning_active(page, active=False)
    except Exception:
        pass

    task = _tasks.get(user_id)
    if task and not task.done():
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        except Exception:
            pass

    async with _lock:
        _meta[user_id] = {
            "status": "stopped",
            "user_id": user_id,
            "finished_at": _now_iso(),
        }
        _tasks.pop(user_id, None)

    return {"success": True, "user_id": user_id, "message": "Stop signal sent"}


async def stop_all_jobs() -> dict:
    async with _lock:
        uids = list(_tasks.keys())
    results = []
    for uid in uids:
        results.append(await stop_user_job(uid))
    return {"success": True, "stopped": len(results), "users": uids}
