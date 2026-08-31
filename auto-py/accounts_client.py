import json
import os
import urllib.error
import urllib.request
from pathlib import Path

ACCOUNTS_API = os.getenv("ACCOUNTS_API_URL", "http://127.0.0.1:3004")
ROOT = Path(__file__).resolve().parent.parent
SEED_FILE = ROOT / "seed" / "namcaonguyen-users.json"


def _fetch_json(url: str) -> dict | list | None:
    try:
        with urllib.request.urlopen(url, timeout=3) as res:
            return json.loads(res.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return None


def load_profiles_from_seed() -> tuple[list[dict], str]:
    if not SEED_FILE.exists():
        return []
    data = json.loads(SEED_FILE.read_text(encoding="utf-8"))
    default_password = data.get("default_password", "123456")
    profiles = []
    for i, user in enumerate(data.get("users", []), start=1):
        profiles.append(
            {
                "user_id": i,
                "name": user.get("name", ""),
                "cccd": user["username"],
            }
        )
    return profiles, default_password


def get_insights(site: str = "namcaonguyen") -> list[dict]:
    data = _fetch_json(f"{ACCOUNTS_API}/api/insights?site={site}")
    return data if isinstance(data, list) else []


def log_event(user_id: int, action: str, hours: float | None = None) -> bool:
    payload = {"action": action}
    if hours is not None:
        payload["hours"] = hours
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{ACCOUNTS_API}/api/users/{user_id}/log",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=3):
            return True
    except urllib.error.URLError:
        return False
