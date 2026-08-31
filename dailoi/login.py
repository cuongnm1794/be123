from . import browser, db, steps

SITE = browser.SITE_HOST


async def login(user_id: int, username: str, password: str) -> dict:
    page = await browser.get_page(user_id)

    step = "goto_home"
    try:
        steps.record(user_id, "login", "Mở trang /my/home để kiểm tra đăng nhập", url=page.url)
        await page.goto(f"https://{SITE}/my/home", wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(3000)

        current_url = page.url
        step = "check_login"
        if "login" not in current_url and "signin" not in current_url:
            steps.record(user_id, "login", "Đã đăng nhập sẵn", url=current_url, status="ok")
            web_user_id = await _extract_user_id(page)
            name = await _extract_user_name(page)
            try:
                if web_user_id:
                    await db.update_user(user_id, **{"user_id": web_user_id})
            except Exception:
                pass
            try:
                if name:
                    await db.update_user(user_id, name=name)
            except Exception:
                pass
            return {"success": True, "web_user_id": web_user_id, "name": name, "already_logged_in": True}

        step = "wait_inputs"
        try:
            await page.wait_for_selector('input[name="login"], input[type="text"]', timeout=10000)
        except Exception:
            await page.wait_for_timeout(3000)
            await page.wait_for_selector('input[name="login"], input[type="text"]', timeout=10000)

        step = "fill_username"
        await page.fill('input[name="login"], input[type="text"]', username)

        step = "fill_password"
        await page.fill('input[name="password"], input[type="password"]', password)

        step = "click_submit"
        await page.click('button[type="submit"]')

        step = "wait_navigation"
        try:
            await page.wait_for_load_state("networkidle", timeout=15000)
        except Exception:
            await page.wait_for_timeout(5000)

        step = "verify_login"
        await page.goto(f"https://{SITE}/my/home", wait_until="domcontentloaded", timeout=30000)
        await page.wait_for_timeout(2000)

        final_url = page.url
        if "login" in final_url or "signin" in final_url:
            steps.record(user_id, "login", "Đăng nhập thất bại — vẫn ở trang login", url=final_url, status="error")
            return {"success": False, "error": f"Login failed - still on login page ({final_url})"}
        steps.record(user_id, "login", "Đăng nhập thành công", url=final_url, status="ok")

        web_user_id = await _extract_user_id(page)
        name = await _extract_user_name(page)

        try:
            if web_user_id:
                await db.update_user(user_id, **{"user_id": web_user_id})
        except Exception:
            pass
        try:
            if name:
                await db.update_user(user_id, name=name)
        except Exception:
            pass

        return {"success": True, "web_user_id": web_user_id, "name": name}

    except Exception as e:
        page_url = ""
        try:
            page_url = page.url
        except Exception:
            pass
        steps.record(user_id, "login", f"Lỗi login ở bước '{step}': {e}", url=page_url, status="error")
        return {"success": False, "error": f"Login error at step '{step}': {e} (url={page_url})"}


async def _extract_user_id(page) -> int | None:
    try:
        result = await page.evaluate("""
            (() => {
                const m = document.body.innerHTML.match(/"user_id"\\s*:\\s*(\\d+)/);
                if (m) return parseInt(m[1]);
                for (const s of document.querySelectorAll('script')) {
                    const sm = (s.textContent || '').match(/"user_id"\\s*:\\s*(\\d+)/);
                    if (sm) return parseInt(sm[1]);
                }
                return null;
            })()
        """)
        return result
    except Exception:
        return None


async def _extract_user_name(page) -> str | None:
    try:
        name = await page.evaluate("""
            (() => {
                const el = document.querySelector('span[itemprop="name"]');
                return el ? el.textContent.trim() : null;
            })()
        """)
        return name
    except Exception:
        return None
