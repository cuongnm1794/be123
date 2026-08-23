import os
import asyncio
from pathlib import Path
from typing import TYPE_CHECKING

from dotenv import load_dotenv

if TYPE_CHECKING:
    from playwright.async_api import BrowserContext, Page

load_dotenv()

SITE_HOST = "hoclythuyetlaixe.eco-tek.com.vn"
BASE_DIR = Path(__file__).resolve().parent
PROFILE_BASE = Path(os.getenv("PROFILE_BASE", BASE_DIR / "chrome-profiles"))

_pw = None
_contexts: dict[int, "BrowserContext"] = {}
_pages: dict[int, "Page"] = {}
_stop_flags: dict[int, bool] = {}


def profile_path(user_id: int) -> Path:
    path = PROFILE_BASE / f"user-{user_id}"
    path.mkdir(parents=True, exist_ok=True)
    return path


async def _get_playwright():
    global _pw
    if _pw is None:
        from playwright.async_api import async_playwright

        _pw = await async_playwright().start()
    return _pw


def _pick_initial_page(context) -> "Page | None":
    pages = context.pages
    on_site = []
    for page in pages:
        try:
            url = page.url
            if SITE_HOST in url and not url.startswith("about:"):
                on_site.append(page)
        except Exception:
            continue
    if len(on_site) == 1:
        return on_site[0]
    if len(on_site) > 1:
        return sorted(on_site, key=lambda p: len(p.url), reverse=True)[0]
    return None


async def launch_browser(user_id: int):
    existing = _contexts.get(user_id)
    if existing:
        try:
            _ = existing.pages
            return existing
        except Exception:
            _contexts.pop(user_id, None)
            _pages.pop(user_id, None)

    profile = str(profile_path(user_id))
    pw = await _get_playwright()

    last_err: Exception | None = None
    for attempt in range(3):
        try:
            context = await pw.chromium.launch_persistent_context(
                profile,
                headless=False,
                channel="chrome",
                args=[
                    "--disable-blink-features=AutomationControlled",
                    "--disable-dev-shm-usage",
                ],
            )
            _contexts[user_id] = context
            _stop_flags[user_id] = False
            return context
        except Exception as exc:
            last_err = exc
            msg = str(exc).lower()
            if any(k in msg for k in ("singletonlock", "profile", "already in use", "process")):
                for lock_name in ("SingletonLock", "SingletonCookie", "SingletonSocket"):
                    try:
                        (Path(profile) / lock_name).unlink()
                    except Exception:
                        pass
            await asyncio.sleep(1.5)

    raise RuntimeError(f"Khong mo duoc Chrome cho user {user_id}: {last_err}")


async def get_page(user_id: int) -> "Page":
    cached = _pages.get(user_id)
    if cached and not cached.is_closed():
        return cached

    context = _contexts.get(user_id)
    if not context:
        context = await launch_browser(user_id)

    preferred = _pick_initial_page(context)
    if preferred:
        page = preferred
    elif context.pages:
        page = context.pages[0]
    else:
        page = await context.new_page()

    _pages[user_id] = page
    return page


async def close_browser(user_id: int) -> None:
    _stop_flags[user_id] = True
    _pages.pop(user_id, None)
    context = _contexts.pop(user_id, None)
    if context:
        try:
            await context.close()
        except Exception:
            pass


async def close_all_browsers() -> None:
    for uid in list(_contexts.keys()):
        await close_browser(uid)
    global _pw
    if _pw:
        await _pw.stop()
        _pw = None


def stop_learning(user_id: int) -> None:
    _stop_flags[user_id] = True


async def is_stopped(user_id: int) -> bool:
    return _stop_flags.get(user_id, False)
