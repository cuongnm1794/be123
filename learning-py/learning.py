import random
import re
from urllib.parse import urlparse

import browser
import db
import log_util
import login as login_mod

SITE = browser.SITE_HOST
COUNTDOWN_URL = f"https://{SITE}/slide/countdown-start/"
SITE_RETRY_DELAY_MS = 5000
SKIPPED_COURSE_NAME = "KIEN THUC MOI VE XE NANG HANG"


def _normalize_course_name(name: str | None) -> str:
    import unicodedata

    if not name:
        return ""
    text = unicodedata.normalize("NFD", name)
    text = "".join(c for c in text if unicodedata.category(c) != "Mn")
    text = re.sub(r"[^a-zA-Z0-9]+", " ", text)
    return text.strip().upper()


def should_skip_course(course_name: str | None) -> bool:
    return _normalize_course_name(course_name) == SKIPPED_COURSE_NAME


def _course_url(link: str) -> str:
    if link.startswith("http"):
        return link
    path = link if link.startswith("/") else f"/{link}"
    return f"https://{SITE}{path}"


def _path_key(url_or_link: str) -> str:
    if not url_or_link:
        return ""
    try:
        if url_or_link.startswith("http"):
            path = urlparse(url_or_link).path
        else:
            path = url_or_link if url_or_link.startswith("/") else f"/{url_or_link}"
            path = path.split("?")[0]
        return path.rstrip("/") or "/"
    except Exception:
        return url_or_link.split("?")[0]


def _is_profile_user_area(url: str) -> bool:
    try:
        parsed = urlparse(url)
        return parsed.hostname and SITE in parsed.hostname and parsed.path.startswith("/profile/user")
    except Exception:
        return False


def _is_incomplete_profile_user_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
        if not parsed.hostname or SITE not in parsed.hostname:
            return False
        return bool(re.match(r"^/profile/user/?$", parsed.path))
    except Exception:
        return False


def _is_matching_course_url(url: str, course_link: str) -> bool:
    try:
        parsed = urlparse(url)
        if not parsed.hostname or SITE not in parsed.hostname:
            return False
        current = _path_key(url)
        target = _path_key(course_link)
        if not current or not target:
            return False
        return current == target or current.startswith(f"{target}/")
    except Exception:
        return False


def _is_lesson_page_url(url: str, slide_id: str | None = None) -> bool:
    try:
        parsed = urlparse(url)
        if not parsed.hostname or SITE not in parsed.hostname:
            return False
        if "/slides/slide/" not in parsed.path:
            return False
        if not slide_id:
            return True
        return slide_id in parsed.path
    except Exception:
        return False


def _parse_progress_text(text: str | None) -> float | None:
    if not text:
        return None
    t = text.strip().lower()
    if not t:
        return None
    if any(w in t for w in ("completed", "complete", "done", "finished", "hoan thanh", "hoàn thành")):
        return 100.0
    m = re.search(r"(\d{1,3})\s*%", t)
    if m:
        return float(max(0, min(100, int(m.group(1)))))
    m = re.search(r"\b(\d{1,3})\b", t)
    if m:
        return float(max(0, min(100, int(m.group(1)))))
    return None


async def _read_course_progress(page) -> float | None:
    selectors = [
        '//span[@class="o_wslides_progress_percentage"]',
        ".o_wslides_progress_percentage",
    ]
    for sel in selectors:
        try:
            loc = page.locator(sel)
            if await loc.count() == 0:
                continue
            text = await loc.first.text_content(timeout=2000)
            parsed = _parse_progress_text(text)
            if parsed is not None:
                return parsed
        except Exception:
            continue
    return None


async def _enter_course_from_profile(page, course_link: str) -> bool:
    try:
        await page.wait_for_selector(".o_wprofile_slides_course_card_body", timeout=15000)
    except Exception:
        return False

    target_key = _path_key(course_link)
    navigated = await page.evaluate(
        """
        ({ targetKey, host }) => {
            const norm = (raw) => {
                if (!raw) return '';
                try {
                    if (raw.startsWith('http')) return new URL(raw).pathname.replace(/\\/$/, '') || '/';
                    const p = (raw.startsWith('/') ? raw : '/' + raw).split('?')[0];
                    return p.replace(/\\/$/, '') || '/';
                } catch (e) { return ''; }
            };
            const cards = Array.from(document.querySelectorAll('.o_wprofile_slides_course_card_body'));
            for (const card of cards) {
                const oc = card.getAttribute('onclick') || '';
                const m = /location\\.href\\s*=\\s*['"]([^'"]+)['"]/i.exec(oc);
                let raw = m ? m[1] : '';
                if (!raw) {
                    const a = card.querySelector('a[href]');
                    raw = a ? a.getAttribute('href') : '';
                }
                if (!raw) continue;
                const key = norm(raw);
                const full = raw.startsWith('http') ? raw : 'https://' + host + (raw.startsWith('/') ? raw : '/' + raw);
                if (key === targetKey || (targetKey.length > 2 && (key.includes(targetKey) || targetKey.includes(key)))) {
                    location.href = full;
                    return true;
                }
            }
            return false;
        }
        """,
        {"targetKey": target_key, "host": SITE},
    )
    if navigated:
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=60000)
        except Exception:
            await page.wait_for_timeout(3000)
        await page.wait_for_timeout(1500)
        return True
    return False


async def _recover_if_stuck_on_profile(user_id: int, page, course_link: str) -> bool:
    if not _is_profile_user_area(page.url):
        return _is_matching_course_url(page.url, course_link)

    log_util.log(user_id, "learn", f"Phat hien profile ({page.url}), dang vao khoa...")
    if _is_incomplete_profile_user_url(page.url):
        user = await db.get_user_by_id(user_id)
        web_uid = user.get("user_id") if user else None
        if web_uid:
            await page.goto(
                f"https://{SITE}/profile/user/{web_uid}",
                wait_until="domcontentloaded",
                timeout=60000,
            )
            await page.wait_for_timeout(2000)

    if await _enter_course_from_profile(page, course_link):
        await page.wait_for_load_state("networkidle", timeout=20000)
        await page.wait_for_timeout(1500)
        if _is_matching_course_url(page.url, course_link):
            return True

    await page.goto(_course_url(course_link), wait_until="domcontentloaded", timeout=60000)
    await page.wait_for_load_state("networkidle", timeout=20000)
    await page.wait_for_timeout(2000)
    return _is_matching_course_url(page.url, course_link)


async def _wait_until_lesson_opened(page, slide_id: str | None = None, timeout_ms: int = 12000) -> bool:
    if _is_lesson_page_url(page.url, slide_id):
        return True
    try:
        await page.wait_for_selector("#next-slide-button", timeout=timeout_ms)
        return True
    except Exception:
        pass
    try:
        await page.wait_for_url(
            lambda url: _is_lesson_page_url(url, slide_id),
            timeout=timeout_ms,
        )
        return True
    except Exception:
        return _is_lesson_page_url(page.url, slide_id)


async def _parse_lessons(page) -> list[dict]:
    return await page.evaluate(
        f"""
        () => {{
            const site = 'https://{SITE}';
            const items = document.querySelectorAll('#home ul ul li[data-slide-id]');
            const lessons = [];
            items.forEach((li, idx) => {{
                const slideId = li.getAttribute('data-slide-id') || '';
                const linkEl = li.querySelector('a[href], a.o_wslides_js_slides_list_slide_link');
                let link = linkEl ? (linkEl.getAttribute('href') || '') : '';
                const onclick = (linkEl && linkEl.getAttribute('onclick')) || li.getAttribute('onclick') || '';
                const onclickMatch = onclick.match(/location\\.href\\s*=\\s*['"]([^'"]+)['"]/i);
                if (!link && onclickMatch) link = onclickMatch[1];
                const nameEl = linkEl ? linkEl.querySelector('span') : null;
                const name = (nameEl ? nameEl.textContent : (linkEl ? linkEl.textContent : li.textContent)) || ('Lesson ' + idx);
                let progress = 0;
                const badgeEl = li.querySelector('span.badge, .text-success, .o_wslides_progress_percentage');
                if (badgeEl) {{
                    const m = (badgeEl.textContent || '').match(/(\\d+)\\s*%/);
                    if (m) progress = parseInt(m[1]);
                }}
                lessons.push({{
                    name: name.trim(),
                    link: link.startsWith('http') ? link : (link ? site + link : ''),
                    slide_id: slideId,
                    progress: progress,
                    index: idx
                }});
            }});
            return lessons;
        }}
        """
    )


async def _fetch_countdown_seconds(page, slide_id: int) -> tuple[int, str]:
    result = await page.evaluate(
        """
        async ({ url, slideId }) => {
            try {
                const resp = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: 0,
                        jsonrpc: '2.0',
                        method: 'call',
                        params: { slide_id: Number(slideId) },
                    }),
                });
                if (!resp.ok) return { ok: false, seconds: 0, detail: `HTTP ${resp.status}` };
                const data = await resp.json();
                if (data?.result?.end_time) {
                    const remaining = Math.max(0, data.result.end_time - Math.floor(Date.now() / 1000));
                    return { ok: true, seconds: remaining, detail: `remaining ${remaining}s` };
                }
                return { ok: false, seconds: 0, detail: 'no end_time' };
            } catch (e) {
                return { ok: false, seconds: 0, detail: e?.message || 'fetch failed' };
            }
        }
        """,
        {"url": COUNTDOWN_URL, "slideId": slide_id},
    )
    seconds = int(result.get("seconds") or 0)
    detail = str(result.get("detail") or "")
    if result.get("ok") and seconds > 0:
        return seconds, detail
    fallback = random.randint(10, 30)
    return fallback, f"{detail} -> fallback {fallback}s"


async def _wait_for_lesson(user_id: int, page, wait_seconds: int) -> bool:
    random_extra = random.randint(5, 10)
    total_wait = max(0, wait_seconds) + random_extra
    log_util.log(user_id, "learn", f"Cho countdown ~{total_wait}s")

    chunk_size = 5
    for elapsed in range(0, total_wait, chunk_size):
        if await browser.is_stopped(user_id):
            return False
        if elapsed % 60 == 0:
            hours = await db.get_today_study_hours(user_id)
            if hours >= 10:
                log_util.log(user_id, "learn", "Dat 10 gio/ngay — dung", status="warn")
                return False
        await page.wait_for_timeout(min(chunk_size, total_wait - elapsed) * 1000)

    await db.add_study_hours(user_id, total_wait / 3600)
    return True


async def start_learning(
    user_id: int,
    course_id: int,
    course_link: str,
    start_progress: float,
) -> bool:
    if await db.get_today_study_hours(user_id) >= 10:
        log_util.log(user_id, "learn", "Dat 10 gio hoc hom nay", status="warn")
        return False

    page = await browser.get_page(user_id)
    full_url = _course_url(course_link)
    lesson_sel = 'xpath=//*[@id="home"]//ul//ul//li[@data-slide-id]'
    lesson_found = False

    for attempt in range(1, 6):
        if await browser.is_stopped(user_id):
            return False
        if attempt > 1:
            await page.wait_for_timeout(SITE_RETRY_DELAY_MS)

        log_util.log(user_id, "learn", f"Goto khoa ({attempt}/5): {full_url}")
        await page.goto(full_url, wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_load_state("networkidle", timeout=20000)
        await page.wait_for_timeout(2000)

        await _recover_if_stuck_on_profile(user_id, page, course_link)
        if _is_profile_user_area(page.url):
            await _recover_if_stuck_on_profile(user_id, page, course_link)

        try:
            await page.wait_for_selector(lesson_sel, timeout=30000)
            lesson_found = True
            break
        except Exception:
            continue

    if not lesson_found:
        log_util.log(user_id, "learn", f"Khong thay danh sach bai — URL: {page.url}", status="error")
        return False

    lessons = await _parse_lessons(page)
    actionable = [l for l in lessons if l["progress"] < 100 and l["link"]]
    log_util.log(user_id, "learn", f"{len(lessons)} bai, {len(actionable)} bai can hoc")

    if not actionable:
        if all(l["progress"] >= 100 for l in lessons):
            await db.clear_lesson_checkpoint(user_id, course_id)
            await db.update_course_progress(user_id, course_id, 100)
            return True
        return False

    start_idx = next((i for i, l in enumerate(lessons) if l["progress"] < 100), 0)
    checkpoint = await db.get_lesson_checkpoint(user_id, course_id)
    if checkpoint:
        for i, lesson in enumerate(lessons):
            if int(lesson["slide_id"]) == checkpoint["last_slide_id"]:
                checkpoint_idx = min(i + 1, len(lessons) - 1)
                if checkpoint_idx <= start_idx:
                    start_idx = checkpoint_idx
                break

    attempted = 0
    for i in range(start_idx, len(lessons)):
        if await browser.is_stopped(user_id):
            return False

        if await db.get_today_study_hours(user_id) >= 10:
            return False

        lesson = lessons[i]
        if lesson["progress"] >= 100 or not lesson["link"]:
            continue

        log_util.log(user_id, "learn", f"Mo bai {i + 1}: {lesson['name']}")
        await page.goto(lesson["link"], wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_load_state("networkidle", timeout=20000)
        await page.wait_for_timeout(4000)

        if _is_profile_user_area(page.url):
            recovered = await _recover_if_stuck_on_profile(user_id, page, course_link)
            if not recovered:
                return False
            await page.goto(lesson["link"], wait_until="domcontentloaded", timeout=60000)
            await page.wait_for_timeout(4000)

        if not await _wait_until_lesson_opened(page, lesson["slide_id"], 6000):
            continue

        slide_id = int(lesson["slide_id"] or 0)
        if not slide_id:
            continue

        countdown_sec, detail = await _fetch_countdown_seconds(page, slide_id)
        log_util.log(user_id, "learn", f"Countdown slide {slide_id}: {detail}")
        if not await _wait_for_lesson(user_id, page, countdown_sec):
            return False

        try:
            await page.wait_for_selector("#next-slide-button", timeout=10000)
            await page.click("#next-slide-button")
            await page.wait_for_timeout(3000)
            attempted += 1
        except Exception:
            continue

        current_progress = await _read_course_progress(page)
        if current_progress is not None:
            await db.update_course_progress(user_id, course_id, current_progress)
            log_util.progress(user_id, current_progress, lesson["name"], step="progress")
            if current_progress >= 100:
                await db.clear_lesson_checkpoint(user_id, course_id)
                return True

        await db.upsert_lesson_checkpoint(
            user_id,
            course_id,
            slide_id,
            lesson["name"],
            i,
        )

    if attempted == 0:
        return False

    await page.goto(full_url)
    await page.wait_for_timeout(2000)
    final_progress = await _read_course_progress(page)
    if final_progress is not None:
        await db.update_course_progress(user_id, course_id, final_progress)
        if final_progress >= 100:
            await db.clear_lesson_checkpoint(user_id, course_id)
            return True
    return final_progress is not None and final_progress > start_progress


async def run_user_learning(user_id: int) -> dict:
    user = await db.get_user_by_id(user_id)
    if not user:
        return {"success": False, "error": "User not found"}

    await browser.launch_browser(user_id)

    login_result = await login_mod.login(
        user_id,
        user["username"],
        user.get("password") or user["username"],
    )
    if not login_result.get("success"):
        return {"success": False, "error": login_result.get("error", "Login failed")}

    sync_result = await sync_courses(user_id)
    if not sync_result.get("success"):
        return {"success": False, "error": sync_result.get("error", "Sync failed")}

    incomplete = await db.get_incomplete_courses(user_id)
    incomplete = [c for c in incomplete if not should_skip_course(c.get("course_name"))]
    if not incomplete:
        return {"success": True, "message": "Khong con khoa can hoc"}

    results = []
    for course in incomplete:
        if await browser.is_stopped(user_id):
            break
        ok = await start_learning(
            user_id,
            course["course_id"],
            course["link"],
            float(course.get("progress") or 0),
        )
        results.append({"course": course["course_name"], "success": ok})

    return {"success": True, "results": results}
