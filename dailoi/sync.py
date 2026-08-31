from . import browser, db

SITE = browser.SITE_HOST


def _parse_progress(text: str | None) -> float | None:
    if not text:
        return None
    t = text.strip().lower()
    if not t:
        return None
    if any(w in t for w in ["completed", "complete", "done", "finished", "hoan thanh", "hoàn thành"]):
        return 100.0
    import re
    m = re.search(r"(\d{1,3})\s*%", t)
    if m:
        return max(0, min(100, int(m.group(1))))
    m = re.search(r"\b(\d{1,3})\b", t)
    if m:
        return max(0, min(100, int(m.group(1))))
    return None


async def sync_courses(user_id: int) -> dict:
    page = await browser.get_page(user_id)
    user = await db.get_user_by_id(user_id)
    web_user_id = user.get("user_id") if user else None

    if not web_user_id:
        return {"error": "User chua login, can browser_login truoc"}

    profile_url = f"https://{SITE}/profile/user/{web_user_id}"
    await page.goto(profile_url, wait_until="domcontentloaded", timeout=60000)
    await page.wait_for_timeout(5000)

    card_sel = ".o_wprofile_slides_course_card_body"
    try:
        await page.wait_for_selector(card_sel, timeout=15000)
    except Exception:
        return {"error": "Khong tim thay danh sach khoa tren profile"}

    cards = await page.query_selector_all(card_sel)
    courses = []
    created = 0
    updated = 0

    for card in cards:
        onclick = await card.get_attribute("onclick") or ""
        m = __import__("re").search(r"""location\.href\s*=\s*['"]([^'"]+)['"]""", onclick)
        course_url = m.group(1) if m else ""
        if not course_url:
            a_el = await card.query_selector("a[href]")
            if a_el:
                course_url = await a_el.get_attribute("href") or ""
        if not course_url:
            continue

        if not course_url.startswith("http"):
            course_url = f"https://{SITE}{course_url}"

        name_el = await card.query_selector("h5")
        course_name = (await name_el.text_content() if name_el else f"Course {len(courses) + 1}") or ""
        course_name = course_name.strip()

        progress_el = await card.query_selector(".progress + small span, small span")
        progress = 0.0
        if progress_el:
            pt = await progress_el.text_content()
            p = _parse_progress(pt)
            if p is not None:
                progress = p
        if progress == 0:
            card_text = await card.text_content()
            p = _parse_progress(card_text)
            if p is not None:
                progress = p

        existing = await _find_course_by_link(course_url)
        if existing:
            course_id = existing["id"]
            await db.create_user_course(user_id, course_id, progress)
            updated += 1
        else:
            new_course = await db.create_course(course_name, "", course_url)
            course_id = new_course["id"]
            await db.create_user_course(user_id, course_id, progress)
            created += 1

        courses.append({"course_name": course_name, "link": course_url, "progress": progress})

    result = {
        "success": True,
        "courses": len(courses),
        "created": created,
        "updated": updated,
        "items": courses,
    }

    # Verify actual completion from slides/all?my=1
    try:
        verify_result = await verify_completion(user_id)
        result["verify"] = verify_result
    except Exception as e:
        result["verify"] = {"error": str(e)}

    return result


async def _find_course_by_link(link: str) -> dict | None:
    courses = await db.get_all_courses()
    for c in courses:
        if c["link"] == link:
            return c
    return None


async def screenshot_completion(user_id: int) -> dict:
    """Chụp toàn bộ trang /slides/all?my=1 để làm bằng chứng hoàn thành."""
    from pathlib import Path
    from datetime import datetime

    page = await browser.get_page(user_id)
    user = await db.get_user_by_id(user_id)

    if not user:
        return {"error": "User not found"}

    my_courses_url = f"https://{SITE}/slides/all?my=1"
    await page.goto(my_courses_url, wait_until="domcontentloaded", timeout=60000)
    await page.wait_for_timeout(3000)

    # Scroll container khóa học vào view để trigger lazy-load
    await page.evaluate("""
        const container = document.querySelector('.o_wslides_home_main.pb-5');
        if (container) {
            container.style.scrollMarginTop = '70px';
            container.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    """)
    await page.wait_for_timeout(1500)

    ss_dir = Path("D:/2025/Linh/hermes-bridge/screenshots")
    ss_dir.mkdir(exist_ok=True)

    username = user.get("username", str(user_id))
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{username}-completed-{ts}.png"
    filepath = str(ss_dir / filename)

    await page.screenshot(path=filepath, full_page=True)
    await db.create_log(user_id, f"Screenshot completion saved: {filename}")

    return {"success": True, "path": filepath, "filename": filename}


async def verify_completion(user_id: int) -> dict:
    """Visit /slides/all?my=1 and mark courses with 'Đã hoàn thành' as completed."""
    page = await browser.get_page(user_id)
    user = await db.get_user_by_id(user_id)

    if not user:
        return {"error": "User not found"}

    my_courses_url = f"https://{SITE}/slides/all?my=1"
    await page.goto(my_courses_url, wait_until="domcontentloaded", timeout=60000)
    await page.wait_for_timeout(5000)

    # Try multiple selectors for course cards on slides/all page
    card_selectors = [
        ".o_wslides_course_card_body",
        ".o_wslides_course_card",
        ".o_slides_course_card",
        ".course-card-body",
        '[class*="course_card"]',
    ]
    cards = []
    for sel in card_selectors:
        try:
            c = await page.query_selector_all(sel)
            if c:
                cards = c
                break
        except Exception:
            continue

    if not cards:
        return {"error": "Khong tim thay danh sach khoa tren slides/all", "url": page.url}

    updated = 0
    for card in cards:
        card_text = await card.text_content() or ""
        card_html = await card.inner_html() or ""

        # Get course link for matching
        onclick = await card.get_attribute("onclick") or ""
        m = __import__("re").search(r"""location\.href\s*=\s*['"]([^'"]+)['"]""", onclick)
        course_url = m.group(1) if m else ""
        if not course_url:
            a_el = await card.query_selector("a[href]")
            if a_el:
                course_url = await a_el.get_attribute("href") or ""
        if not course_url:
            continue

        if not course_url.startswith("http"):
            course_url = f"https://{SITE}{course_url}"

        # Check for completion badge
        completed_keywords = ["completed", "complete", "hoan thanh", "hoàn thành", "đã hoàn thành"]
        is_completed = any(w in card_text.lower() for w in completed_keywords)

        existing = await _find_course_by_link(course_url)
        if existing:
            await db.update_course_completed(user_id, existing["id"], is_completed)
            updated += 1

    result = {"success": True, "checked": len(cards), "updated": updated}
    await db.create_log(user_id, f"Verify completion: checked {len(cards)} courses, updated {updated}")

    # Auto screenshot if all courses completed
    try:
        courses = await db.get_user_courses(user_id)
        if courses and all(c.get("completed", False) for c in courses):
            ss = await screenshot_completion(user_id)
            result["screenshot"] = ss
    except Exception as e:
        result["screenshot"] = {"error": str(e)}

    return result
