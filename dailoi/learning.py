import random
import re
import time
from . import browser, db, steps

SITE = browser.SITE_HOST
COUNTDOWN_URL = f"https://{SITE}/slide/countdown-start/"


def _course_url(link: str) -> str:
    if link.startswith("http"):
        return link
    p = link if link.startswith("/") else f"/{link}"
    return f"https://{SITE}{p}"


def _path_key(url_or_link: str) -> str:
    """Chuẩn hóa path để so khớp khóa (giống Electron coursePathKey)."""
    if not url_or_link:
        return ""
    try:
        if url_or_link.startswith("http"):
            from urllib.parse import urlparse
            path = urlparse(url_or_link).path
        else:
            path = url_or_link if url_or_link.startswith("/") else f"/{url_or_link}"
            path = path.split("?")[0]
        return path.rstrip("/") or "/"
    except Exception:
        return ""


def _is_login_url(url: str) -> bool:
    return bool(url) and ("/web/login" in url or "/web/signin" in url or "/web/signup" in url)


def _is_home_or_profile_url(url: str) -> bool:
    if not url or url.startswith("about:"):
        return True
    if SITE not in url:
        return False
    from urllib.parse import urlparse
    path = (urlparse(url).path or "/").rstrip("/") or "/"
    if path in ("/", "/my/home"):
        return True
    if path.startswith("/profile/user") and "/slides/" not in url:
        return True
    return False


def _is_course_url(url: str, course_link: str) -> bool:
    if not url or SITE not in url:
        return False
    if "/slides/slide/" in url:
        return True
    key = _path_key(course_link)
    cur = _path_key(url)
    if not key or not cur:
        return False
    return cur == key or (len(key) > 2 and (key in cur or cur in key))


async def _ensure_logged_in(user_id: int, page) -> bool:
    """Nếu bị đá về trang login → tự đăng nhập lại bằng credential trong DB."""
    if not _is_login_url(page.url):
        return True
    u = await db.get_user_by_id(user_id)
    if not u or not u.get("username"):
        steps.record(user_id, "login", "Kẹt trang login nhưng không có credential", url=page.url, status="error")
        await db.create_log(user_id, "Kẹt trang login nhưng không có credential để đăng nhập lại")
        return False
    from . import login as dl_login
    steps.record(user_id, "login", "Session hết hạn — đang đăng nhập lại...", url=page.url, status="warn")
    await db.create_log(user_id, "Session het han — dang dang nhap lai...")
    result = await dl_login.login(user_id, u["username"], u.get("password") or u["username"])
    ok = bool(result.get("success"))
    steps.record(
        user_id, "login",
        "Đăng nhập lại thành công" if ok else f"Đăng nhập lại thất bại: {result.get('error', '')}",
        status="ok" if ok else "error",
    )
    return ok


async def _enter_course_from_profile(page, course_link: str) -> bool:
    """Trên trang profile, click thẻ khóa khớp với link đã lưu (giống Electron)."""
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
                if (!raw) { const a = card.querySelector('a[href]'); raw = a ? a.getAttribute('href') : ''; }
                if (!raw) continue;
                const key = norm(raw);
                const full = raw.startsWith('http') ? raw : 'https://' + host + (raw.startsWith('/') ? raw : '/' + raw);
                if (key === targetKey || (targetKey.length > 2 && (key.includes(targetKey) || targetKey.includes(key))) || norm(full) === targetKey) {
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


async def _recover_into_course(user_id: int, page, course_link: str) -> bool:
    """Thoát khỏi trang chủ/profile/login để vào đúng khóa. Trả True nếu đã vào khóa."""
    # 1) Session hết hạn → login lại
    if _is_login_url(page.url):
        if not await _ensure_logged_in(user_id, page):
            return False
        await page.goto(_course_url(course_link), wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_timeout(2000)
        if _is_course_url(page.url, course_link):
            steps.record(user_id, "enter_course", "Vào khóa sau khi login lại", url=page.url, status="ok")
            return True

    # 2) Kẹt trang chủ/profile → vào qua profile rồi click thẻ khóa
    if _is_home_or_profile_url(page.url):
        u = await db.get_user_by_id(user_id)
        web_uid = u.get("user_id") if u else None
        steps.record(
            user_id, "recover",
            f"Kẹt trang chủ/profile → mở profile/user/{web_uid} rồi click thẻ khóa",
            url=page.url, status="warn",
        )
        if web_uid:
            try:
                await page.goto(
                    f"https://{SITE}/profile/user/{web_uid}",
                    wait_until="domcontentloaded", timeout=60000,
                )
                await page.wait_for_timeout(2000)
            except Exception:
                pass
        if await _enter_course_from_profile(page, course_link):
            await page.wait_for_load_state("networkidle", timeout=20000)
            await page.wait_for_timeout(1500)
            if _is_course_url(page.url, course_link):
                steps.record(user_id, "enter_course", "Vào khóa qua thẻ profile", url=page.url, status="ok")
                return True
            steps.record(user_id, "recover", "Click thẻ nhưng URL vẫn chưa khớp khóa", url=page.url, status="warn")

    # 3) Fallback: goto trực tiếp lần cuối
    steps.record(user_id, "recover", "Fallback: goto trực tiếp link khóa", url=page.url, status="warn")
    try:
        await page.goto(_course_url(course_link), wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_load_state("networkidle", timeout=20000)
        await page.wait_for_timeout(2000)
    except Exception:
        pass
    ok = _is_course_url(page.url, course_link)
    steps.record(
        user_id, "enter_course" if ok else "recover",
        "Goto trực tiếp vào được khóa" if ok else "Goto trực tiếp vẫn không khớp khóa",
        url=page.url, status="ok" if ok else "error",
    )
    return ok


async def _resolve_slide_id(page, fallback_id: str) -> int:
    """Lấy slide_id thật từ trang slide (giống extension-auto), không chỉ từ danh sách khóa."""
    resolved = await page.evaluate("""
        () => {
            const findEl = (root) => root.querySelector('[data-main-object*="slide.slide"]');
            let el = findEl(document);
            if (!el) {
                for (const iframe of document.querySelectorAll('iframe')) {
                    try {
                        const doc = iframe.contentDocument;
                        if (doc) {
                            el = findEl(doc);
                            if (el) break;
                        }
                    } catch (e) {}
                }
            }
            if (el) {
                const m = (el.getAttribute('data-main-object') || '').match(/slide\\.slide\\((\\d+),/);
                if (m) return parseInt(m[1], 10);
            }
            const parts = location.pathname.split('/');
            const last = parts[parts.length - 1] || '';
            const fromUrl = last.match(/-(\\d+)(?:\\?|$)/);
            if (fromUrl) return parseInt(fromUrl[1], 10);
            return null;
        }
    """)
    if resolved:
        return int(resolved)
    if fallback_id and str(fallback_id).isdigit():
        return int(fallback_id)
    return 0


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
                if (!resp.ok) {
                    return { ok: false, seconds: 0, detail: `HTTP ${resp.status}` };
                }
                const data = await resp.json();
                if (data?.result?.end_time) {
                    const remaining = Math.max(
                        0,
                        data.result.end_time - Math.floor(Date.now() / 1000),
                    );
                    return { ok: true, seconds: remaining, detail: `end_time remaining ${remaining}s` };
                }
                return { ok: false, seconds: 0, detail: 'no end_time in response' };
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
    # Fallback giống extension-auto khi API lỗi hoặc countdown = 0
    fallback = random.randint(10, 30)
    return fallback, f"{detail} -> fallback {fallback}s"


async def _wait_countdown(user_id: int, page, total_wait: int) -> bool:
    for chunk in range(0, total_wait, 5):
        if await browser.is_stopped(user_id):
            return False
        wait = min(5, total_wait - chunk)
        await page.wait_for_timeout(wait * 1000)
        if chunk % 60 == 0:
            h = await db.get_today_study_hours(user_id)
            if h >= 10:
                await browser.close_browser(user_id)
                return False
    return True


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
    """Đọc % tiến độ khóa từ trang hiện tại (giống Electron readCourseProgress)."""
    selectors = [
        '//span[@class="o_wslides_progress_percentage"]',
        ".o_wslides_progress_percentage",
        '[class*="progress_percentage"]',
        ".progress-bar + small span",
        ".progress + small span",
    ]
    for sel in selectors:
        try:
            loc = page.locator(sel)
            if await loc.count() == 0:
                continue
            text = await loc.first.text_content(timeout=2000)
            p = _parse_progress_text(text)
            if p is not None:
                return p
        except Exception:
            continue
    return None


async def _save_progress(user_id: int, course_id: int, progress: float, lesson_name: str = "") -> float:
    """Ghi progress vào DB (upsert). Trả về giá trị đã lưu."""
    saved = max(0.0, min(100.0, float(progress)))
    try:
        row = await db.update_course_progress(user_id, course_id, saved)
        if row:
            msg = f"Progress {saved:.0f}%"
            if lesson_name:
                msg += f" — {lesson_name}"
            await db.create_log(user_id, msg)
            return float(row.get("progress", saved))
    except Exception as e:
        await db.create_log(user_id, f"Progress update failed: {e}")
    return saved


async def _refresh_progress_from_course_page(
    page, user_id: int, course_id: int, course_url: str,
) -> float | None:
    """Về trang khóa và đọc % chính xác từ web."""
    try:
        await page.goto(_course_url(course_url), wait_until="domcontentloaded", timeout=60000)
        await page.wait_for_timeout(2000)
        p = await _read_course_progress(page)
        if p is not None:
            await _save_progress(user_id, course_id, p, "sync tu trang khoa")
        return p
    except Exception as e:
        await db.create_log(user_id, f"Doc progress trang khoa loi: {e}")
        return None


async def start_learning(user_id: int, course_id: int, course_link: str, start_progress: float) -> bool:
    page = await browser.get_page(user_id)
    await browser.stop_auto_slide(page, learning_active=True)

    full_url = _course_url(course_link)
    steps.record(user_id, "enter_course", f"Mở khóa học: {full_url}", url=page.url, course=course_link)
    await page.goto(full_url, wait_until="domcontentloaded", timeout=60000)
    await page.wait_for_load_state("networkidle", timeout=20000)
    await page.wait_for_timeout(2000)

    lesson_sel = '//*[@id="home"]//ul//ul//li[@data-slide-id]'
    lesson_found = False
    for attempt in range(1, 6):
        if await browser.is_stopped(user_id):
            steps.record(user_id, "stop", "Dừng trước khi tìm danh sách bài", url=page.url, status="warn")
            return False
        if attempt > 1:
            steps.record(user_id, "enter_course", f"Thử lại lần {attempt}/5 — tải lại khóa", url=page.url, status="warn")
            await page.wait_for_timeout(5000)
            await page.goto(full_url, wait_until="domcontentloaded", timeout=60000)
            await page.wait_for_load_state("networkidle", timeout=20000)
            await page.wait_for_timeout(2000)

        # Recovery: nếu bị đá về trang chủ / profile / login → xử lý dứt điểm
        if _is_login_url(page.url) or _is_home_or_profile_url(page.url) or not _is_course_url(page.url, course_link):
            steps.record(
                user_id, "home",
                f"Lần {attempt}: URL không khớp khóa → recovery",
                url=page.url, status="warn",
            )
            await db.create_log(
                user_id,
                f"Lan {attempt}: URL khong khop khoa ({page.url}) — dang recovery...",
            )
            recovered = await _recover_into_course(user_id, page, course_link)
            if not recovered:
                steps.record(user_id, "recover", f"Lần {attempt}: recovery chưa vào được khóa", url=page.url, status="error")
                await db.create_log(user_id, f"Lan {attempt}: recovery chua vao duoc khoa")

        try:
            await page.wait_for_selector(lesson_sel, timeout=30000)
            lesson_found = True
            steps.record(user_id, "enter_course", "Đã thấy danh sách bài học", url=page.url, status="ok")
            break
        except Exception:
            if attempt == 5:
                steps.record(user_id, "error", f"Không thấy danh sách bài sau 5 lần (URL cuối: {page.url})", url=page.url, status="error")
                await db.create_log(
                    user_id,
                    f"Khong tim thay danh sach bai sau 5 lan (URL cuoi: {page.url})",
                )
                return False
    if not lesson_found:
        return False

    lessons = await _parse_lessons(page)
    if not lessons:
        steps.record(user_id, "error", "Parse danh sách bài trả về rỗng", url=page.url, status="error")
        return False
    steps.record(user_id, "enter_course", f"Có {len(lessons)} bài trong khóa", url=page.url, status="ok")

    done_cnt = sum(1 for l in lessons if l["progress"] >= 100)
    nolink_cnt = sum(1 for l in lessons if not l["link"])
    actionable = len(lessons) - done_cnt
    steps.record(
        user_id, "enter_course",
        f"Bài: {done_cnt} đã xong / {actionable} còn học / {nolink_cnt} thiếu link",
        url=page.url,
        status="warn" if actionable == 0 else "info",
        extra={"done": done_cnt, "actionable": actionable, "no_link": nolink_cnt,
               "progress_sample": [l["progress"] for l in lessons[:5]]},
    )

    start_idx = 0
    for i, l in enumerate(lessons):
        if l["progress"] < 100:
            start_idx = i
            break

    first_actionable_idx = start_idx
    checkpoint = await db.get_lesson_checkpoint(user_id, course_id)
    checkpoint_idx = None
    if checkpoint:
        for i, l in enumerate(lessons):
            if int(l["slide_id"]) == checkpoint["last_slide_id"]:
                checkpoint_idx = min(i + 1, len(lessons) - 1)
                break
    # Chỉ dùng checkpoint nếu nó KHÔNG bỏ qua bài chưa học phía trước
    if checkpoint_idx is not None and checkpoint_idx <= first_actionable_idx:
        start_idx = checkpoint_idx
        steps.record(user_id, "study", f"Resume từ checkpoint tại bài #{start_idx}", status="info")
    elif checkpoint_idx is not None:
        steps.record(
            user_id, "study",
            f"Bỏ qua checkpoint (#{checkpoint_idx}) vì còn bài chưa học từ #{first_actionable_idx}",
            status="warn",
        )
        start_idx = first_actionable_idx
    else:
        start_idx = first_actionable_idx

    attempted = 0
    last_saved_progress = float(start_progress or 0)
    total_lessons = len(lessons)
    steps.record(user_id, "study", f"Bắt đầu vòng học từ bài #{start_idx}/{total_lessons}", status="info")
    try:
        for i in range(start_idx, len(lessons)):
            if await browser.is_stopped(user_id):
                steps.record(user_id, "stop", f"Cờ dừng bật ở bài #{i} → thoát", status="warn")
                return False

            today_hours = await db.get_today_study_hours(user_id)
            if today_hours >= 10:
                steps.record(user_id, "stop", f"Đạt 10h/ngày ({today_hours:.1f}h) → dừng", status="warn")
                await browser.close_browser(user_id)
                return False

            lesson = lessons[i]
            if lesson["progress"] >= 100 or not lesson["link"]:
                continue

            steps.record(user_id, "enter_lesson", f"Vào bài: {lesson['name']}", url=lesson["link"], lesson=lesson["name"])
            await browser.stop_auto_slide(page, learning_active=True)
            await page.goto(lesson["link"], wait_until="domcontentloaded", timeout=60000)
            await page.wait_for_load_state("networkidle", timeout=20000)
            await page.wait_for_timeout(4000)

            slide_id = await _resolve_slide_id(page, lesson["slide_id"])
            if not slide_id:
                steps.record(user_id, "enter_lesson", f"Không tìm thấy slide_id cho bài {lesson['name']}", url=page.url, status="warn", lesson=lesson["name"])
                await db.create_log(
                    user_id,
                    f"Learning skip: khong tim thay slide_id cho bai {lesson['name']}",
                )
                continue

            # Start study session tracking (wall-clock)
            session_start = time.time()
            session_id = await db.start_study_session(
                user_id, course_id, lesson["name"], slide_id,
            )

            countdown_sec, countdown_detail = await _fetch_countdown_seconds(page, slide_id)
            extra = random.randint(5, 15)
            total_wait = countdown_sec + extra
            steps.record(
                user_id, "study",
                f"Học bài '{lesson['name']}' — chờ {total_wait}s",
                url=page.url, lesson=lesson["name"],
                extra={"slide_id": slide_id, "wait_s": total_wait, "detail": countdown_detail},
            )
            await db.create_log(
                user_id,
                f"Countdown bai {lesson['name']}: slide_id={slide_id}, cho {total_wait}s ({countdown_detail})",
            )

            if not await _wait_countdown(user_id, page, total_wait):
                steps.record(user_id, "stop", f"Dừng giữa chừng khi đang học '{lesson['name']}'", url=page.url, status="warn", lesson=lesson["name"])
                # Interrupted — record session with 0 progress
                dur = int(time.time() - session_start)
                await db.end_study_session(session_id, dur, None)
                return False

            try:
                await db.add_study_hours(user_id, total_wait / 3600)
            except Exception as e:
                await db.create_log(user_id, f"Study hours update failed: {e}")

            # Chỉ hermes click next — extension auto-slide đã bị dừng ở đầu vòng
            try:
                await page.wait_for_selector("#next-slide-button", timeout=10000)
                await page.wait_for_timeout(500)
                await page.click("#next-slide-button")
                await page.wait_for_timeout(3000)
                attempted += 1
                steps.record(user_id, "study", f"Đã hoàn tất bài '{lesson['name']}' (next)", url=page.url, status="ok", lesson=lesson["name"])
            except Exception:
                steps.record(user_id, "study", f"Không bấm được nút next cho bài '{lesson['name']}'", url=page.url, status="warn", lesson=lesson["name"])
                continue

            # Cập nhật progress sau mỗi bài (giống Electron goNextAndReport)
            p = await _read_course_progress(page)
            if p is None and total_lessons > 0:
                p = max(
                    last_saved_progress,
                    round(((i + 1) / total_lessons) * 100, 1),
                )

            # End study session with real wall-clock duration & final progress
            real_dur = int(time.time() - session_start)
            await db.end_study_session(session_id, real_dur, p)

            if p is not None and p >= last_saved_progress:
                last_saved_progress = await _save_progress(
                    user_id, course_id, p, lesson["name"],
                )
                if last_saved_progress >= 100:
                    await db.clear_lesson_checkpoint(user_id, course_id)
                    await db.update_course_completed(user_id, course_id, True)
                    return True

            await db.upsert_lesson_checkpoint(
                user_id, course_id,
                int(lesson["slide_id"]),
                lesson["name"],
                i,
            )
    finally:
        await browser.set_learning_active(page, active=False)

    if attempted == 0:
        return False

    final_p = await _refresh_progress_from_course_page(
        page, user_id, course_id, course_link,
    )
    if final_p is not None:
        if final_p >= 100:
            await db.clear_lesson_checkpoint(user_id, course_id)
            await db.update_course_completed(user_id, course_id, True)
            return True
        return final_p > last_saved_progress or final_p >= 50

    if last_saved_progress >= 100:
        await db.clear_lesson_checkpoint(user_id, course_id)
        await db.update_course_completed(user_id, course_id, True)
        return True
    return last_saved_progress > float(start_progress or 0)


async def _parse_lessons(page) -> list[dict]:
    return await page.evaluate(f"""
        (() => {{
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
                const name = (linkEl ? linkEl.textContent : li.textContent) || ('Lesson ' + idx);
                let progress = 0;
                const pctEl = li.querySelector('.text-success, .o_wslides_progress_percentage, span.badge');
                if (pctEl) {{
                    const m = (pctEl.textContent || '').match(/(\\d+)\\s*%/);
                    if (m) progress = parseInt(m[1]);
                }}
                if (!link && slideId) {{
                    link = '/slides/slide/' + slideId;
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
        }})()
    """)
