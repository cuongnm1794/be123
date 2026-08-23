import browser
import db
import log_util

SITE = browser.SITE_HOST


async def login(user_id: int, username: str, password: str) -> dict:
    page = await browser.get_page(user_id)
    step = "goto_home"

    try:
        log_util.log(user_id, "login", "Mo trang /my/home...")
        await page.goto(f"https://{SITE}/my/home", wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(2000)

        current_url = page.url
        step = "check_session"
        if "login" not in current_url and "signin" not in current_url:
            web_user_id = await _extract_user_id(page)
            name = await _extract_user_name(page)
            if web_user_id:
                await db.update_user(user_id, user_id=web_user_id)
            if name:
                await db.update_user(user_id, name=name)
            log_util.log(user_id, "login", f"Da dang nhap san (web_user_id={web_user_id})", status="ok")
            await db.create_log(user_id, f"Login cached (web user_id: {web_user_id})")
            return {
                "success": True,
                "web_user_id": web_user_id,
                "name": name,
                "already_logged_in": True,
            }

        step = "fill_form"
        await page.wait_for_selector('input[name="login"], input[type="text"]', timeout=10000)
        await page.fill('input[name="login"], input[type="text"]', username)
        await page.fill('input[name="password"], input[type="password"]', password)
        await page.click('button[type="submit"]')

        step = "wait_navigation"
        try:
            await page.wait_for_load_state("networkidle", timeout=10000)
        except Exception:
            await page.wait_for_timeout(3000)

        step = "verify"
        await page.goto(f"https://{SITE}/my/home", wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(2000)

        if "login" in page.url or "signin" in page.url:
            log_util.log(user_id, "login", "Dang nhap that bai", status="error")
            return {"success": False, "error": f"Still on login page: {page.url}"}

        web_user_id = await _extract_user_id(page)
        name = await _extract_user_name(page)
        if web_user_id:
            await db.update_user(user_id, user_id=web_user_id)
        if name:
            await db.update_user(user_id, name=name)

        log_util.log(user_id, "login", f"Dang nhap thanh cong (web_user_id={web_user_id})", status="ok")
        await db.create_log(user_id, f"Login successful (web user_id: {web_user_id})")
        return {"success": True, "web_user_id": web_user_id, "name": name}

    except Exception as exc:
        log_util.log(user_id, "login", f"Loi o buoc {step}: {exc}", status="error")
        return {"success": False, "error": f"{step}: {exc}"}


async def _extract_user_id(page) -> int | None:
    try:
        return await page.evaluate(
            """
            () => {
                const m = document.body.innerHTML.match(/"user_id"\\s*:\\s*(\\d+)/);
                if (m) return parseInt(m[1], 10);
                for (const s of document.querySelectorAll('script')) {
                    const sm = (s.textContent || '').match(/"user_id"\\s*:\\s*(\\d+)/);
                    if (sm) return parseInt(sm[1], 10);
                }
                return null;
            }
            """
        )
    except Exception:
        return None


async def _extract_user_name(page) -> str | None:
    try:
        return await page.evaluate(
            """
            () => {
                const el = document.querySelector('span[itemprop="name"]');
                return el ? el.textContent.trim() : null;
            }
            """
        )
    except Exception:
        return None
