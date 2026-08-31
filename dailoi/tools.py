import json
from . import db, browser, jobs
from . import login as auto_login, sync as auto_sync, learning as auto_learn

SITE = browser.SITE_HOST


# ── User ──

async def user_list(site: str = "", batch: str = "") -> str:
    s = site if site else None
    b = batch if batch else None
    users = await db.get_all_users(s, b)
    for u in users:
        for k, v in u.items():
            if hasattr(v, 'isoformat'):
                u[k] = v.isoformat()
    return json.dumps(users, ensure_ascii=False, indent=2, default=str)


async def user_create(username: str, password: str, is_running: bool = False,
                      site: str = "dailoi", batch: str = "") -> str:
    b = batch if batch else None
    user = await db.create_user(username, password, is_running, site, b)
    return json.dumps(user, ensure_ascii=False, default=str)


async def user_update(user_id: int, **fields) -> str:
    user = await db.update_user(user_id, **fields)
    if not user:
        return json.dumps({"error": "User not found"})
    return json.dumps(user, ensure_ascii=False, default=str)


async def user_delete(user_id: int) -> str:
    success = await db.delete_user(user_id)
    return json.dumps({"success": success, "user_id": user_id})


async def batch_list(site: str = "") -> str:
    s = site if site else None
    batches = await db.get_batches(s)
    return json.dumps(batches, ensure_ascii=False)


async def user_count(site: str = "") -> str:
    s = site if site else None
    counts = {}
    if s:
        counts[s] = await db.count_users(s)
    else:
        counts["dailoi"] = await db.count_users("dailoi")
        counts["namcaonguyen"] = await db.count_users("namcaonguyen")
    counts["total"] = await db.count_users()
    return json.dumps(counts)


async def user_stats(user_id: int) -> str:
    u = await db.get_user_by_id(user_id)
    if not u:
        return json.dumps({"error": "User not found"})
    stats = await db.get_user_course_stats(user_id)
    today = await db.get_today_study_hours(user_id)
    return json.dumps({"user": {"id": u["id"], "username": u["username"], "name": u["name"]},
                       "courses": stats, "today_study_hours": today}, ensure_ascii=False, default=str)


# ── Course ──

async def course_list() -> str:
    courses = await db.get_all_courses()
    return json.dumps(courses, ensure_ascii=False, default=str)


async def user_courses(user_id: int) -> str:
    courses = await db.get_user_courses(user_id)
    return json.dumps(courses, ensure_ascii=False, default=str)


async def incomplete_courses(user_id: int) -> str:
    courses = await db.get_incomplete_courses(user_id)
    return json.dumps(courses, ensure_ascii=False, default=str)


# ── Browser automation ──

async def browser_launch(user_id: int) -> str:
    await browser.launch_browser(user_id, "learn")
    return json.dumps({"success": True, "user_id": user_id})


async def browser_login(user_id: int) -> str:
    u = await db.get_user_by_id(user_id)
    if not u:
        return json.dumps({"success": False, "error": "User not found"})
    try:
        await browser.launch_browser(user_id, "learn")
    except Exception as e:
        await db.create_log(user_id, f"Login: mo Chrome that bai — {e}")
        return json.dumps({"success": False, "error": str(e)}, ensure_ascii=False)
    result = await auto_login.login(user_id, u["username"], u["password"])
    if result.get("success") and result.get("web_user_id"):
        try:
            await db.update_user(user_id, **{"user_id": result["web_user_id"]})
        except Exception:
            pass
        if result.get("name"):
            try:
                await db.update_user(user_id, name=result["name"])
            except Exception:
                pass
    await db.create_log(user_id,
        f"Login {'successful' if result.get('success') else 'failed'}"
        + (f" (web_id: {result.get('web_user_id')})" if result.get('web_user_id') else ""))
    return json.dumps(result, ensure_ascii=False, default=str)


async def browser_sync(user_id: int, auto_login_first: bool = True) -> str:
    """Đồng bộ khóa học. Mặc định tự login trước nếu chưa có web_user_id hoặc auto_login_first=True."""
    u = await db.get_user_by_id(user_id)
    if not u:
        return json.dumps({"error": "User not found"})
    await browser.launch_browser(user_id, "learn")
    login_result = None
    if auto_login_first or not u.get("user_id"):
        login_result = await auto_login.login(user_id, u["username"], u["password"])
        if not login_result.get("success"):
            return json.dumps({
                "error": "Login failed before sync",
                "login": login_result,
            }, ensure_ascii=False, default=str)
    result = await auto_sync.sync_courses(user_id)
    if login_result:
        result = {"login": login_result.get("success"), **result}
    return json.dumps(result, ensure_ascii=False, default=str)


async def browser_login_all(user_ids: list[int], concurrency: int = 3) -> str:
    """Login nhiều user song song — đóng browser sau mỗi user để tránh treo RAM."""
    import asyncio

    sem = asyncio.Semaphore(concurrency)

    async def _login_one(uid: int) -> dict:
        async with sem:
            try:
                u = await db.get_user_by_id(uid)
                if not u:
                    return {"user_id": uid, "error": "User not found"}
                await browser.launch_browser(uid, "learn")
                result = await auto_login.login(uid, u["username"], u["password"])
                return {"user_id": uid, **result}
            except Exception as e:
                return {"user_id": uid, "error": str(e)}
            finally:
                try:
                    await browser.close_browser(uid)
                except Exception:
                    pass

    results = await asyncio.gather(*[_login_one(uid) for uid in user_ids])
    ok = sum(1 for r in results if r.get("success"))
    return json.dumps({"total": len(results), "success": ok, "results": results}, ensure_ascii=False, default=str)


async def browser_sync_all(user_ids: list[int], concurrency: int = 3) -> str:
    """Đồng bộ nhiều user song song — tự launch + login + sync, đóng browser sau mỗi user."""
    import asyncio

    sem = asyncio.Semaphore(concurrency)

    async def _sync_one(uid: int) -> dict:
        async with sem:
            try:
                u = await db.get_user_by_id(uid)
                if not u:
                    return {"user_id": uid, "error": "User not found"}
                await browser.launch_browser(uid, "learn")
                login_result = await auto_login.login(uid, u["username"], u["password"])
                if not login_result.get("success"):
                    return {"user_id": uid, "login": False, "error": login_result.get("error", "Login failed")}
                r = await auto_sync.sync_courses(uid)
                return {"user_id": uid, "login": True, **r}
            except Exception as e:
                return {"user_id": uid, "error": str(e)}
            finally:
                try:
                    await browser.close_browser(uid)
                except Exception:
                    pass

    results = await asyncio.gather(*[_sync_one(uid) for uid in user_ids])
    ok = sum(1 for r in results if r.get("success"))
    return json.dumps({"synced": len(results), "success": ok, "results": results}, ensure_ascii=False, default=str)


async def browser_start_learning(user_id: int, course_id: int, background: bool = True) -> str:
    """Bắt đầu học 1 khóa. Mặc định chạy nền — không chặn user khác."""
    u = await db.get_user_by_id(user_id)
    c = await db.get_course_by_id(course_id)
    if not u or not c:
        return json.dumps({"error": "User or course not found"})
    result = await jobs.start_learning_job(user_id, course_id, background=background)
    return json.dumps(result, ensure_ascii=False, default=str)


async def browser_start_multi_learning(
    user_ids: list[int] | None = None,
    course_id: int | None = None,
    only_auto_run: bool = True,
    concurrency: int = 0,
    force: bool = False,
) -> str:
    """Học song song nhiều user (giống Electron Chạy tất cả). Trả về ngay."""
    ids = user_ids if user_ids else None
    conc = concurrency if concurrency and concurrency > 0 else None
    result = await jobs.start_multi_learning(
        ids, course_id, only_auto_run=only_auto_run, concurrency=conc, force=force,
    )
    return json.dumps(result, ensure_ascii=False, default=str)


async def browser_restart_learning(user_id: int, course_id: int | None = None) -> str:
    """Stop + đóng browser idle + start lại."""
    result = await jobs.restart_learning_job(user_id, course_id)
    return json.dumps(result, ensure_ascii=False, default=str)


async def browser_jobs_status(user_id: int = 0) -> str:
    status = await jobs.get_job_status(user_id if user_id > 0 else None)
    return json.dumps(status, ensure_ascii=False, default=str)


async def browser_stop_all() -> str:
    result = await jobs.stop_all_jobs()
    return json.dumps(result, ensure_ascii=False, default=str)


async def browser_stop(user_id: int) -> str:
    result = await jobs.stop_user_job(user_id)
    return json.dumps(result, ensure_ascii=False, default=str)


async def browser_status(user_id: int) -> str:
    stopped = await browser.is_stopped(user_id)
    job = await jobs.get_job_status(user_id)
    ctx = browser._contexts.get(user_id)
    page = browser._pages.get(user_id)
    url = ""
    try:
        if page and not page.is_closed():
            url = page.url
    except Exception:
        pass
    return json.dumps({
        "user_id": user_id,
        "browser_open": ctx is not None,
        "current_url": url,
        "stopped": stopped,
        "job": job,
    })


async def browser_close(user_id: int) -> str:
    await browser.close_browser(user_id)
    return json.dumps({"success": True, "user_id": user_id})


async def browser_delete_profile(user_id: int) -> str:
    result = await browser.delete_profile(user_id)
    result["user_id"] = user_id
    return json.dumps(result, ensure_ascii=False, default=str)


async def browser_close_all() -> str:
    result = await browser.close_all_browsers()
    return json.dumps(result, ensure_ascii=False, default=str)


async def browser_steps(user_id: int, limit: int = 200) -> str:
    from . import steps as dl_steps
    return json.dumps(
        {"user_id": user_id, "steps": dl_steps.get_steps(user_id, limit)},
        ensure_ascii=False, default=str,
    )


async def browser_screenshot(user_id: int) -> str:
    from pathlib import Path
    page = await browser.get_page(user_id)
    ss_dir = Path("D:/2025/Linh/hermes-bridge/screenshots")
    ss_dir.mkdir(exist_ok=True)
    fn = f"user-{user_id}.png"
    await page.screenshot(path=str(ss_dir / fn), full_page=False)
    return json.dumps({"success": True, "path": str(ss_dir / fn)})


# ── Auto-slide (extension-auto) ──

async def auto_slide_start(user_id: int) -> str:
    page = await browser.get_page(user_id)
    try:
        # Không chạy song song với start_learning — tránh double-click next
        await browser.set_learning_active(page, active=False)
        result = await page.evaluate("""
            (async () => {
                if (window._hermesAutoSlideRunning) return 'already running';
                window._hermesAutoSlideRunning = true;
                window._hermesSlideCount = 0;
                const getRandom = (min,max) => Math.floor(Math.random()*(max-min+1))+min;
                function clickNext() {
                    let btn = document.querySelector('#next-slide-button');
                    if (!btn) {
                        for (const b of document.querySelectorAll('button')) {
                            const t = (b.textContent||'').toLowerCase();
                            if (t.includes('next')||t.includes('tiếp')||t=== '→') { btn=b; break; }
                        }
                    }
                    if (btn) { btn.click(); window._hermesSlideCount++; return true; }
                    return false;
                }
                async function loop() {
                    if (!window._hermesAutoSlideRunning) return;
                    const el = document.querySelector('[data-main-object*="slide.slide"]');
                    let sid = 15659;
                    if (el) { const m = el.getAttribute('data-main-object'); const mx = m && m.match(/slide\\.slide\\((\\d+),/); if (mx) sid = parseInt(mx[1]); }
                    try {
                        const r = await fetch('https://hoclythuyetlaixe.eco-tek.com.vn/slide/countdown-start/',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:0,jsonrpc:'2.0',method:'call',params:{slide_id:sid}})});
                        const d = await r.json();
                        let delay = 15000;
                        if (d?.result?.end_time) { const rem = d.result.end_time-Math.floor(Date.now()/1000); delay = Math.max(rem+getRandom(5,15),3)*1000; }
                        else { delay = getRandom(10,30)*1000; }
                        setTimeout(async () => { if (window._hermesAutoSlideRunning) { clickNext(); loop(); } }, delay);
                    } catch(e) { setTimeout(loop, getRandom(10,30)*1000); }
                }
                loop();
                return 'started';
            })()
        """)
        return json.dumps({"success": True, "result": result})
    except Exception as e:
        return json.dumps({"error": str(e)})


async def auto_slide_stop(user_id: int) -> str:
    page = await browser.get_page(user_id)
    try:
        await browser.stop_auto_slide(page, learning_active=False)
        return json.dumps({"success": True})
    except Exception as e:
        return json.dumps({"error": str(e)})


async def auto_slide_status(user_id: int) -> str:
    page = await browser.get_page(user_id)
    try:
        r = await page.evaluate("JSON.stringify({running: window._hermesAutoSlideRunning||false, count: window._hermesSlideCount||0})")
        return r
    except Exception as e:
        return json.dumps({"error": str(e)})


# ── Logs ──

async def get_logs(user_id: int = 0) -> str:
    logs = await db.get_logs(user_id if user_id > 0 else None)
    return json.dumps(logs, ensure_ascii=False, default=str)


# ── Login status ──

async def login_status(user_id: int) -> str:
    await browser.launch_browser(user_id, "learn")
    page = await browser.get_page(user_id)
    try:
        await page.goto(f"https://{SITE}/my/home", wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(2000)
        url = page.url
        logged_in = "login" not in url and "signin" not in url
        result = {"logged_in": logged_in, "url": url}
        if logged_in:
            try:
                wid = await page.evaluate("(()=>{const m=document.body.innerHTML.match(/\"user_id\"\\s*:\\s*(\\d+)/);return m?parseInt(m[1]):null})()")
                if wid:
                    result["web_user_id"] = wid
                    try: await db.update_user(user_id, **{"user_id": wid})
                    except: pass
            except: pass
            try:
                el = await page.query_selector('span[itemprop="name"]')
                if el:
                    name = (await el.text_content() or "").strip()
                    if name:
                        result["name"] = name
                        try: await db.update_user(user_id, name=name)
                        except: pass
            except: pass
        return json.dumps(result, ensure_ascii=False, default=str)
    except Exception as e:
        return json.dumps({"logged_in": False, "error": str(e)})
