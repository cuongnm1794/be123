"""Delegate to shared accounts-db package."""
import sys
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from accounts_db.db import *  # noqa: F403
