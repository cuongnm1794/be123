"""Mở Chrome với profile user-{id} + extension NCN."""

import argparse
import os
import subprocess
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
REPO_ROOT = BASE_DIR.parent
DEFAULT_EXT = REPO_ROOT / "extension-ncn"
DEFAULT_PROFILE_BASE = Path(
    os.getenv("PROFILE_BASE", str(BASE_DIR / "chrome-profiles"))
)
DEFAULT_URL = "https://namcaonguyen.huelms.com/user/login"


def find_chrome() -> str | None:
    candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
    ]
    for p in candidates:
        if os.path.exists(p):
            return p
    return None


def launch(user_id: int, url: str, profile_base: Path, ext_path: Path) -> dict:
    chrome = find_chrome()
    if not chrome:
        return {"ok": False, "error": "Không tìm thấy chrome.exe"}

    profile_dir = profile_base / f"user-{user_id}"
    profile_dir.mkdir(parents=True, exist_ok=True)

    if not ext_path.is_dir():
        return {"ok": False, "error": f"Không thấy extension: {ext_path}"}

    cmd = [
        chrome,
        f"--user-data-dir={profile_dir}",
        f"--load-extension={ext_path.resolve()}",
        "--no-first-run",
        "--no-default-browser-check",
        url,
    ]

    print(f"Launch user-{user_id}")
    print(f"  profile: {profile_dir}")
    print(f"  extension: {ext_path.resolve()}")
    print(f"  url: {url}")

    subprocess.Popen(
        cmd,
        creationflags=subprocess.CREATE_NEW_CONSOLE if os.name == "nt" else 0,
    )
    return {
        "ok": True,
        "user_id": user_id,
        "profile": str(profile_dir),
        "extension": str(ext_path.resolve()),
        "url": url,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Mở Chrome NCN theo profile học viên")
    parser.add_argument("--user-id", type=int, required=True, help="ID học viên (user-{id})")
    parser.add_argument("--url", default=DEFAULT_URL, help="URL mở đầu")
    parser.add_argument(
        "--profile-base",
        default=str(DEFAULT_PROFILE_BASE),
        help="Thư mục gốc chứa user-{id}",
    )
    parser.add_argument(
        "--extension",
        default=str(DEFAULT_EXT),
        help="Đường dẫn extension-ncn",
    )
    args = parser.parse_args(argv)
    result = launch(
        args.user_id,
        args.url,
        Path(args.profile_base),
        Path(args.extension),
    )
    if not result.get("ok"):
        print(result.get("error", "Launch failed"), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
