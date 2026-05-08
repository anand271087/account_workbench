"""F01 — Authentication-related endpoints.

Login itself is handled client-side by Supabase Auth. The backend's job is to:
  1) Verify the resulting JWT (`/me`)
  2) Track failed login attempts and reject locked-out emails (BRD AC-3)

The lockout flow:
  - Frontend calls /auth/login-status BEFORE submitting the password.
  - On failure, frontend calls /auth/login-record-failure.
  - 5 failures within 15 minutes → /login-status returns `blocked: true`.
"""

from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.core.rbac import permissions_for
from app.db.session import get_db
from app.schemas.user import MeResponse, UserOut

router = APIRouter(prefix="/api/v1", tags=["auth"])

LOCKOUT_THRESHOLD = 5
LOCKOUT_WINDOW = timedelta(minutes=15)


@router.get("/me", response_model=MeResponse)
async def me(user: CurrentUser) -> MeResponse:
    """Return the current user + capabilities derived from role."""
    return MeResponse(
        user=UserOut.model_validate(user),
        permissions=permissions_for(user.role),
    )


# ============================================================
# Login-attempt tracking — BRD AC-3 (5/15 min)
# ============================================================


class LoginEmailIn(BaseModel):
    email: EmailStr


class LoginStatusOut(BaseModel):
    blocked: bool
    fails_in_window: int
    minutes_remaining: int = 0
    threshold: int = LOCKOUT_THRESHOLD


@router.post("/auth/login-status", response_model=LoginStatusOut)
async def login_status(
    body: LoginEmailIn,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> LoginStatusOut:
    cutoff = datetime.now(timezone.utc) - LOCKOUT_WINDOW
    rows = (
        await db.execute(
            text(
                "select attempted_at from public.login_attempts "
                "where lower(email) = lower(:email) and attempted_at >= :cutoff "
                "order by attempted_at desc"
            ),
            {"email": body.email, "cutoff": cutoff},
        )
    ).all()
    fails = len(rows)
    if fails < LOCKOUT_THRESHOLD:
        return LoginStatusOut(blocked=False, fails_in_window=fails)
    # Window resets relative to the oldest fail in the window.
    oldest = rows[-1][0]
    unlock_at = oldest + LOCKOUT_WINDOW
    minutes_remaining = max(1, int((unlock_at - datetime.now(timezone.utc)).total_seconds() // 60))
    return LoginStatusOut(blocked=True, fails_in_window=fails, minutes_remaining=minutes_remaining)


@router.post("/auth/login-record-failure", status_code=status.HTTP_204_NO_CONTENT)
async def login_record_failure(
    body: LoginEmailIn,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    """Frontend calls this after Supabase rejects the password.

    We don't trust the frontend blindly — Supabase still has its own internal
    rate-limit. This is the *user-visible* lockout layer per BRD AC-3.
    """
    # Re-check status server-side; if already blocked, 423.
    cutoff = datetime.now(timezone.utc) - LOCKOUT_WINDOW
    fails = (
        await db.execute(
            text(
                "select count(*) from public.login_attempts "
                "where lower(email) = lower(:email) and attempted_at >= :cutoff"
            ),
            {"email": body.email, "cutoff": cutoff},
        )
    ).scalar_one()
    if fails >= LOCKOUT_THRESHOLD:
        raise HTTPException(status.HTTP_423_LOCKED, "Account temporarily locked.")

    ip = request.headers.get("x-forwarded-for") or (request.client.host if request.client else None)
    ua = request.headers.get("user-agent")
    await db.execute(
        text(
            "insert into public.login_attempts (email, ip, user_agent) "
            "values (:email, :ip, :ua)"
        ),
        {"email": body.email, "ip": ip, "ua": (ua or "")[:300]},
    )
    await db.commit()
