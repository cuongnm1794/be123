import os
from pathlib import Path
from playwright.async_api import async_playwright, BrowserContext, Page

_p = None
_contexts: dict[int, BrowserContext] = {}
_pages: dict[int, Page] = {}
_stop_flags: dict[int, bool] = {}
SITE_HOST = "hoclythuyetlaixe.eco-tek.com.vn"


def is_stuck_idle_url(url: str | None) -> bool:
    """Trang chủ / profile — browser mở nhưng không học."""
    if not url or url.startswith("about:"):
        return True
    if SITE_HOST not in url:
        return False
    from urllib.parse import urlparse
    path = (urlparse(url).path or "/").rstrip("/") or "/"
    if path == "/":
        return True
    if path in ("/my/home", "/web/login", "/web/signup"):
        return True
    if path.startswith("/profile/user") and "/slides/" not in url:
        return True
    return False


async def get_current_url(user_id: int) -> str:
    page = _pages.get(user_id)
    if page and not page.is_closed():
        try:
            return page.url or ""
        except Exception:
            pass
    ctx = _contexts.get(user_id)
    if ctx:
        for p in ctx.pages:
            try:
                if not p.is_closed() and SITE_HOST in (p.url or ""):
                    return p.url or ""
            except Exception:
                continue
    return ""


async def reset_if_idle(user_id: int) -> bool:
    """Đóng browser nếu đang kẹt trang chủ/idle. Trả về True nếu đã reset."""
    url = await get_current_url(user_id)
    if user_id in _contexts and is_stuck_idle_url(url):
        await close_browser(user_id)
        return True
    return False


async def _get_playwright():
    global _p
    if _p is None:
        _p = await async_playwright().start()
    return _p


def _ext_path(mode: str) -> str:
    base = Path(__file__).resolve().parent
    if mode == "learn":
        return os.getenv("EXTENSION_AUTO_PATH", str(base.parent.parent / "extension-auto"))
    return os.getenv("EXTENSION_NAMCAONGUYEN_PATH", str(base.parent / "extension-ncn"))


def _profile_base(mode: str) -> str:
    base = Path(__file__).resolve().parent
    if mode == "learn":
        return os.getenv("PROFILE_BASE_LEARN", str(base / "chrome-profiles"))
    return os.getenv("PROFILE_BASE_QUIZ", str(base.parent / "auto-py" / "chrome-profiles"))


async def launch_browser(user_id: int, mode: str = "learn") -> BrowserContext:
    existing = _contexts.get(user_id)
    if existing:
        try:
            _ = existing.pages
            return existing
        except Exception:
            _contexts.pop(user_id, None)
            _pages.pop(user_id, None)

    ext = _ext_path(mode)
    profile = str(Path(_profile_base(mode)) / f"user-{user_id}")
    Path(profile).mkdir(parents=True, exist_ok=True)

    pw = await _get_playwright()

    async def _launch():
        return await pw.chromium.launch_persistent_context(
            profile,
            headless=False,
            channel="chrome",
            args=[
                f"--disable-extensions-except={ext}",
                f"--load-extension={ext}",
                "--disable-blink-features=AutomationControlled",
                "--disable-dev-shm-usage",
            ],
        )

    import asyncio as _asyncio
    last_err: Exception | None = None
    for attempt in range(3):
        try:
            context = await _launch()
            _contexts[user_id] = context
            _stop_flags[user_id] = False
            return context
        except Exception as e:
            last_err = e
            msg = str(e).lower()
            # Profile bị khóa bởi Chrome cũ còn sót → dọn SingletonLock rồi thử lại
            if "singletonlock" in msg or "profile" in msg or "already in use" in msg or "process" in msg:
                for lock_name in ("SingletonLock", "SingletonCookie", "SingletonSocket"):
                    try:
                        (Path(profile) / lock_name).unlink()
                    except Exception:
                        pass
            await _asyncio.sleep(1.5)

    raise RuntimeError(
        f"Khong mo duoc Chrome cho user {user_id} sau 3 lan "
        f"(profile co the dang bi Chrome cu khoa): {last_err}"
    )


async def get_page(user_id: int) -> Page:
    cached = _pages.get(user_id)
    if cached and not cached.is_closed():
        return cached

    context = _contexts.get(user_id)
    if not context:
        context = await launch_browser(user_id)
        _contexts[user_id] = context

    pages = context.pages
    for p in list(pages):
        try:
            if SITE_HOST in p.url and not p.url.startswith("about:"):
                _pages[user_id] = p
                return p
        except Exception:
            pass

    page = pages[0] if pages else await context.new_page()
    _pages[user_id] = page
    return page


async def close_browser(user_id: int):
    context = _contexts.pop(user_id, None)
    _pages.pop(user_id, None)
    _stop_flags.pop(user_id, None)
    if context:
        try:
            await context.close()
        except Exception:
            pass


async def _kill_stray_chrome() -> int:
    """Kill các Chrome automation còn sót (lọc theo thư mục profile, KHÔNG đụng Chrome cá nhân)."""
    import asyncio as _asyncio
    base = _profile_base("learn").replace("/", "\\")
    base_name = "chrome-profiles"
    ps = (
        "$t = Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | "
        f"Where-Object {{ $_.CommandLine -like '*{base_name}*' }}; "
        "$n = ($t | Measure-Object).Count; "
        "$t | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; "
        "Write-Output $n"
    )
    try:
        proc = await _asyncio.create_subprocess_exec(
            "powershell", "-NoProfile", "-Command", ps,
            stdout=_asyncio.subprocess.PIPE, stderr=_asyncio.subprocess.PIPE,
        )
        out, _ = await proc.communicate()
        return int((out or b"0").decode(errors="ignore").strip() or 0)
    except Exception:
        return 0


async def close_all_browsers() -> dict:
    """Đóng mọi browser đang quản lý + kill Chrome automation zombie."""
    tracked = list(_contexts.keys())
    for uid in tracked:
        await close_browser(uid)
    import asyncio as _asyncio
    await _asyncio.sleep(0.5)
    killed = await _kill_stray_chrome()
    return {
        "success": True,
        "closed_tracked": len(tracked),
        "killed_stray": killed,
        "message": f"Da dong {len(tracked)} browser quan ly + kill {killed} Chrome zombie",
    }


async def delete_profile(user_id: int, mode: str = "learn") -> dict:
    """Đóng browser + xóa hẳn profile Chrome (dùng khi profile hỏng/crash).
    Lần mở sau sẽ tạo profile mới sạch (cần login lại)."""
    import shutil
    await close_browser(user_id)
    await __import__("asyncio").sleep(0.5)
    profile = Path(_profile_base(mode)) / f"user-{user_id}"
    if not profile.exists():
        return {"success": True, "deleted": False, "message": "Profile khong ton tai", "path": str(profile)}
    last_err = ""
    for _ in range(3):
        try:
            shutil.rmtree(profile, ignore_errors=False)
            return {"success": True, "deleted": True, "path": str(profile)}
        except Exception as e:
            last_err = str(e)
            await __import__("asyncio").sleep(1.0)
    shutil.rmtree(profile, ignore_errors=True)
    if profile.exists():
        return {"success": False, "error": f"Xoa profile that bai (co the Chrome con chay): {last_err}", "path": str(profile)}
    return {"success": True, "deleted": True, "path": str(profile)}


async def set_stop_flag(user_id: int, value: bool = True):
    _stop_flags[user_id] = value


async def is_stopped(user_id: int) -> bool:
    return _stop_flags.get(user_id, False)


async def stop_auto_slide(page, learning_active: bool = False):
    """Dừng mọi vòng auto next (extension-auto + loop inject từ hermes tools)."""
    await page.evaluate(
        """(learningActive) => {
            window._hermesAutoSlideRunning = false;
            window.__hermesLearningActive = !!learningActive;
            window.postMessage({
                type: 'web-controller-bridge',
                action: 'stopAutoSlide',
                learningActive: !!learningActive,
            }, '*');
        }""",
        learning_active,
    )


async def set_learning_active(page, active: bool = True):
    await page.evaluate(
        """(active) => {
            window.__hermesLearningActive = !!active;
            window.postMessage({
                type: 'web-controller-bridge',
                action: 'setLearningActive',
                active: !!active,
            }, '*');
        }""",
        active,
    )


async def cleanup():
    for uid in list(_contexts.keys()):
        await close_browser(uid)
    global _p
    if _p:
        await _p.stop()
        _p = None
