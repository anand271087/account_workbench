"""Per-user/day AI call quota.

Matrix Q5 ("Should we cap AI usage per user per day?") — answer: yes.

This is an in-memory counter keyed on (user_id, UTC date). Process-local
and lossy across restarts. Acceptable for Sprint 1 because:
- We have a single API process today (Render free tier).
- The Anthropic key + model + cache already keep cost bounded.

When we scale horizontally, swap the dict for a Redis INCR + EXPIRE pair —
same shape, same call site. The interface here doesn't change.
"""

from __future__ import annotations

from datetime import datetime, timezone
from threading import Lock
from uuid import UUID

from fastapi import HTTPException, status

from app.core.config import get_settings

_counts: dict[tuple[UUID, str], int] = {}
_lock = Lock()


def _today_utc() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def remaining_for(user_id: UUID) -> int:
    settings = get_settings()
    with _lock:
        used = _counts.get((user_id, _today_utc()), 0)
        return max(0, settings.claude_user_daily_limit - used)


def consume(user_id: UUID, *, label: str = "ai") -> None:
    """Increment the counter or raise 429 if the daily cap is hit."""
    settings = get_settings()
    key = (user_id, _today_utc())
    with _lock:
        used = _counts.get(key, 0)
        if used >= settings.claude_user_daily_limit:
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                f"Daily AI limit reached ({settings.claude_user_daily_limit} calls). "
                "Resets at UTC midnight. Contact your admin to raise the cap.",
            )
        _counts[key] = used + 1
    # `label` is here so callers can log/metric per-feature usage later.
    return None


def reset_for_test(user_id: UUID | None = None) -> None:
    """Test-only — wipe the counter."""
    with _lock:
        if user_id is None:
            _counts.clear()
        else:
            for k in list(_counts.keys()):
                if k[0] == user_id:
                    del _counts[k]
