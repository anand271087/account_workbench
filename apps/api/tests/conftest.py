"""Shared pytest fixtures.

Loads `.env` from `apps/api/` so tests run against the real Supabase project.
Tests are scoped to read-only or self-cleanup actions.
"""

from __future__ import annotations

import os
import time
from collections.abc import Iterator
from pathlib import Path
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from jose import jwt


def _load_env() -> None:
    """Load apps/api/.env into os.environ if present, without overriding existing vars."""
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())


_load_env()

# Force the AI quality-check to use the deterministic stub during tests.
# Tests should be fast, free, and not flaky on Anthropic availability.
# (The real Claude path is exercised by manual end-to-end runs.)
os.environ["ANTHROPIC_API_KEY"] = "sk-ant-stub-test-key"


# ---------- App + client ----------


@pytest.fixture(scope="session")
def app():
    from app.main import app as _app
    return _app


@pytest.fixture(scope="session")
def client(app) -> Iterator[TestClient]:
    with TestClient(app) as c:
        yield c


@pytest.fixture(autouse=True)
def _reset_ai_quota():
    """Per-user/day AI quota — wipe between tests so the cap doesn't accumulate."""
    from app.services import ai_quota

    ai_quota.reset_for_test()
    yield
    ai_quota.reset_for_test()


# ---------- JWT minting ----------


def mint_jwt(user_id: UUID, role: str = "authenticated", *, secret: str | None = None,
             expires_in: int = 3600, extras: dict | None = None) -> str:
    """Mint a Supabase-compatible JWT signed with the project's JWT secret.

    Use only in tests. The same secret production verifies with — so the resulting
    token is treated identically by the server.
    """
    secret = secret or os.environ["SUPABASE_JWT_SECRET"]
    now = int(time.time())
    payload = {
        "iss": "supabase",
        "sub": str(user_id),
        "aud": "authenticated",
        "role": role,
        "iat": now,
        "exp": now + expires_in,
    }
    if extras:
        payload.update(extras)
    return jwt.encode(payload, secret, algorithm="HS256")


# ---------- Seeded user ids (resolved at fixture time) ----------


@pytest.fixture(scope="session")
def seeded_users() -> dict[str, UUID]:
    """Look up seeded users by email and return {role: UUID}.

    For roles where multiple users share the role (e.g. two `csm` users), the
    first one ordered by email wins. The fixture name maps role_key → UUID.
    """
    import asyncio

    import asyncpg

    # Canonical email per role for testing — pinned so the fixture is deterministic
    # regardless of how many users share a role.
    PREFERRED = {
        "admin": "anand@beroe-inc.com",
        "vp_sales": "santosh@beroe-inc.com",
        "cs_director": "megha@beroe-inc.com",
        "csm": "harish@beroe-inc.com",
        "cs_team_manager": "team.lead@beroe-inc.com",
        "solutioning_manager": "purnima@beroe-inc.com",
    }

    async def _fetch() -> dict[str, UUID]:
        url = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")
        conn = await asyncpg.connect(url, statement_cache_size=0)
        rows = await conn.fetch(
            "select id, role, email from public.users "
            "where email like '%@beroe-inc.com' and deleted_at is null"
        )
        await conn.close()
        by_email = {r["email"]: r["id"] for r in rows}
        out: dict[str, UUID] = {}
        for role, preferred_email in PREFERRED.items():
            if preferred_email in by_email:
                out[role] = by_email[preferred_email]
        # Fill any missing roles with whatever user has that role
        for r in rows:
            out.setdefault(r["role"], r["id"])
        return out

    return asyncio.run(_fetch())
