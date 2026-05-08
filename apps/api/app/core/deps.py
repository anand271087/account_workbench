"""Auth dependencies.

Verifies Supabase-issued JWTs and returns the matching User from public.users.

Supabase signs JWTs with **ES256 (asymmetric ECDSA)** for new projects and rotates
keys via JWKS. Legacy projects use **HS256** with a static secret. We support both:
- ES256 → fetch + cache the project's public JWKS, look up `kid`, verify.
- HS256 → use SUPABASE_JWT_SECRET (also used by tests that mint local JWTs).

Hot-path performance:
- JWKS is cached in memory for 1h after first fetch (no network on most requests).
- DB lookup is one indexed query on users.id.
"""

import time
from typing import Annotated
from uuid import UUID

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.db.session import get_db
from app.models.user import User

_bearer = HTTPBearer(auto_error=False)


class AuthError(HTTPException):
    def __init__(self, detail: str = "Not authenticated") -> None:
        super().__init__(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=detail,
            headers={"WWW-Authenticate": "Bearer"},
        )


class ForbiddenError(HTTPException):
    def __init__(self, detail: str = "Forbidden") -> None:
        super().__init__(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


# ---- JWKS cache ------------------------------------------------------------

_JWKS_CACHE: dict[str, object] = {"keys": None, "fetched_at": 0.0}
_JWKS_TTL_SECONDS = 3600

# Per-user identity cache. Roles + assignments rarely change inside a session,
# and the user-row lookup costs ~400ms on every request against the regional
# pgbouncer pooler. 60s TTL → /me + every other endpoint becomes single-digit
# milliseconds for warm requests. On role-change/admin edits, log out + back in
# (or wait the TTL) to refresh.
_USER_CACHE: dict[UUID, tuple[float, "User"]] = {}
_USER_TTL_SECONDS = 60.0


def _fetch_jwks() -> list[dict]:
    settings = get_settings()
    url = f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
    r = httpx.get(url, timeout=5)
    r.raise_for_status()
    keys = r.json().get("keys", [])
    if not keys:
        raise AuthError("Supabase JWKS empty")
    return keys


def _get_jwks() -> list[dict]:
    now = time.time()
    keys = _JWKS_CACHE["keys"]
    if keys is not None and (now - float(_JWKS_CACHE["fetched_at"])) < _JWKS_TTL_SECONDS:
        return keys  # type: ignore[return-value]
    fresh = _fetch_jwks()
    _JWKS_CACHE["keys"] = fresh
    _JWKS_CACHE["fetched_at"] = now
    return fresh


def _decode_supabase_jwt(token: str) -> dict:
    """Verify and decode a Supabase JWT.

    Dispatches on the header's `alg`:
      - `ES256` → asymmetric, verify against JWKS by `kid`.
      - `HS256` → symmetric, verify against SUPABASE_JWT_SECRET (legacy + test mints).

    The `iss` claim is checked for ES256 (project URL); aud is `authenticated`.
    """
    try:
        headers = jwt.get_unverified_header(token)
    except JWTError as e:
        raise AuthError(f"Invalid token header: {e}") from e

    alg = headers.get("alg", "HS256")
    settings = get_settings()

    try:
        if alg == "ES256":
            kid = headers.get("kid")
            if not kid:
                raise AuthError("ES256 token missing kid")
            keys = _get_jwks()
            key = next((k for k in keys if k.get("kid") == kid), None)
            if key is None:
                # Force a refresh in case keys rotated, then retry once
                _JWKS_CACHE["keys"] = None
                keys = _get_jwks()
                key = next((k for k in keys if k.get("kid") == kid), None)
            if key is None:
                raise AuthError("Unknown signing key")
            issuer = f"{settings.supabase_url.rstrip('/')}/auth/v1"
            payload = jwt.decode(
                token,
                key,
                algorithms=["ES256"],
                audience="authenticated",
                issuer=issuer,
            )
        elif alg == "HS256":
            payload = jwt.decode(
                token,
                settings.supabase_jwt_secret.get_secret_value(),
                algorithms=["HS256"],
                audience="authenticated",
            )
        else:
            raise AuthError(f"Unsupported JWT alg: {alg}")
    except JWTError as e:
        raise AuthError(f"Invalid token: {e}") from e

    if "sub" not in payload:
        raise AuthError("Token missing subject claim")
    return payload


async def get_current_user(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    """FastAPI dependency: returns the authenticated User or raises 401/403."""
    if creds is None or creds.scheme.lower() != "bearer":
        raise AuthError()

    payload = _decode_supabase_jwt(creds.credentials)

    try:
        user_id = UUID(payload["sub"])
    except (KeyError, ValueError) as e:
        raise AuthError("Invalid subject claim") from e

    # 60s TTL cache — eliminates the ~110ms-per-request DB roundtrip to load
    # user. Was the dominant cost on /me before this.
    now = time.time()
    cached = _USER_CACHE.get(user_id)
    if cached is not None and (now - cached[0]) < _USER_TTL_SECONDS:
        user = cached[1]
    else:
        result = await db.execute(
            select(User).where(User.id == user_id, User.deleted_at.is_(None))
        )
        user = result.scalar_one_or_none()
        if user is None:
            raise ForbiddenError("User not provisioned in this workspace")
        # Detach from this request's session so the cached instance is reusable.
        db.expunge(user)
        _USER_CACHE[user_id] = (now, user)

    # Set the current user in a contextvar so the audit-log writer (a
    # SQLAlchemy event listener that has no FastAPI request context) can read it.
    from app.services.audit_writer import current_user_id_var
    current_user_id_var.set(user.id)

    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def invalidate_user_cache(user_id: UUID | None = None) -> None:
    """Drop a user (or all users) from the identity cache.

    Called by admin endpoints that change role/team/etc. so the next request
    sees the new state without waiting the 60s TTL.
    """
    if user_id is None:
        _USER_CACHE.clear()
    else:
        _USER_CACHE.pop(user_id, None)
