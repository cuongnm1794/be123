import re

import browser
import db
import log_util

SITE = browser.SITE_HOST
SITE_RETRY_DELAY_MS = 5000


def _parse_progress(text: str | None) -> float | None:
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


async def sync_courses(user_id: int) -> dict:
    page = await browser.get_page(user_id)
    user = await db.get_user_by_id(user_id)
    web_user_id = user.get("user_id") if user else None

    if not web_user_id:
        return {"success": False, "error": "Chua co web user_id — can login truoc"}

    profile_url = f"https://{SITE}/profile/user/{web_user_id}"
    log_util.log(user_id, "sync", f"Mo profile {profile_url}")
    await page.goto(profile_url, wait_until="domcontentloaded", timeout=60000)
    await page.wait_for_timeout(SITE_RETRY_DELAY_MS)

    card_sel = ".o_wprofile_slides_course_card_body"
    try:
        await page.wait_for_selector(card_sel, timeout=15000)
    except Exception:
        return {"success": False, "error": f"Khong tim thay khoa tren profile ({page.url})"}

    cards = await page.query_selector_all(card_sel)
    created = 0
    updated = 0
    items: list[dict] = []

    for card in cards:
        onclick = await card.get_attribute("onclick") or ""
        match = re.search(r"""location\.href\s*=\s*['"]([^'"]+)['"]""", onclick)
        course_url = match.group(1) if match else ""
        if not course_url:
            link_el = await card.query_selector("a[href]")
            if link_el:
                course_url = await link_el.get_attribute("href") or ""
        if not course_url:
            continue
        if not course_url.startswith("http"):
            course_url = f"https://{SITE}{course_url}"

        name_el = await card.query_selector("h5")
        course_name = ((await name_el.text_content()) if name_el else "") or f"Course {len(items) + 1}"
        course_name = course_name.strip()

        progress = 0.0
        progress_el = await card.query_selector(".progress + small span, small span")
        if progress_el:
            parsed = _parse_progress(await progress_el.text_content())
            if parsed is not None:
                progress = parsed
        if progress == 0:
            parsed = _parse_progress(await card.text_content())
            if parsed is not None:
                progress = parsed

        existing = await db.get_course_by_link(course_url)
        if existing:
            course_id = existing["id"]
            await db.create_user_course(user_id, course_id, progress)
            updated += 1
        else:
            new_course = await db.create_course(course_name, "", course_url)
            course_id = new_course["id"]
            await db.create_user_course(user_id, course_id, progress)
            created += 1

        items.append({"course_name": course_name, "link": course_url, "progress": progress})

    log_util.log(
        user_id,
        "sync",
        f"Dong bo {len(items)} khoa ({created} moi, {updated} cap nhat)",
        status="ok",
    )
    await db.create_log(
        user_id,
        f"Synced {len(items)} courses ({created} new, {updated} updated)",
    )
    return {
        "success": True,
        "courses": len(items),
        "created": created,
        "updated": updated,
        "items": items,
    }
