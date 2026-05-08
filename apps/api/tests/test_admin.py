"""M9 — admin: account creation + user management.

Real Supabase project. We monkeypatch the Supabase Auth `invite_user_by_email`
admin call so tests don't try to send actual emails. The DB row is the contract
we exercise; the email-sending is a Supabase concern verified manually.
"""

from __future__ import annotations

import os
import time
from uuid import uuid4

import asyncpg
import pytest
from fastapi.testclient import TestClient

from .conftest import mint_jwt


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# ============================================================
# Fixtures: stub Supabase invite + cleanup
# ============================================================


@pytest.fixture
def stub_supabase_invite(monkeypatch):
    """Replace the route's `invite_user_by_email` with `admin.create_user`.

    Both create an `auth.users` row (which `public.users` FKs to). The
    difference: `create_user` doesn't send an email — perfect for tests.
    The real call path is exercised manually via the UI.
    """

    import supabase  # type: ignore
    from app.core.config import get_settings

    captured: list[str] = []
    created_auth_ids: list[str] = []

    settings = get_settings()
    real_client = supabase.create_client(
        settings.supabase_url, settings.supabase_service_role_key.get_secret_value()
    )

    class _AuthUser:
        def __init__(self, uid: str):
            self.id = uid

    class _Resp:
        def __init__(self, uid: str):
            self.user = _AuthUser(uid)

    class _Admin:
        def invite_user_by_email(self, email: str, *args, **kwargs):
            captured.append(email)
            # Use create_user instead of invite — same auth.users row, no email.
            r = real_client.auth.admin.create_user(
                {"email": email, "email_confirm": True}
            )
            created_auth_ids.append(str(r.user.id))
            return _Resp(str(r.user.id))

    class _Auth:
        admin = _Admin()

    class _Client:
        auth = _Auth()

    def stub_create_client(_url, _key):
        return _Client()

    monkeypatch.setattr(supabase, "create_client", stub_create_client)
    yield captured

    # Tear down the fake auth.users rows we created.
    for uid in created_auth_ids:
        try:
            real_client.auth.admin.delete_user(uid)
        except Exception:
            pass


def _cleanup_user_by_email(email: str) -> None:
    import asyncio

    async def _wipe():
        url = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")
        conn = await asyncpg.connect(url, statement_cache_size=0)
        await conn.execute(
            "delete from public.audit_log where new_value::text ilike $1",
            f"%{email}%",
        )
        await conn.execute("delete from public.users where lower(email) = lower($1)", email)
        await conn.close()

    asyncio.run(_wipe())


def _cleanup_account_slug(slug_prefix: str) -> None:
    import asyncio

    async def _wipe():
        url = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")
        conn = await asyncpg.connect(url, statement_cache_size=0)
        await conn.execute(
            "delete from public.accounts where slug like $1", f"{slug_prefix}%"
        )
        await conn.close()

    asyncio.run(_wipe())


# ============================================================
# POST /api/v1/accounts
# ============================================================


def test_create_account_admin_succeeds(client: TestClient, seeded_users: dict) -> None:
    name = f"M9 Test Acme {int(time.time()*1000)}"
    r = client.post(
        "/api/v1/accounts",
        headers=_auth(mint_jwt(seeded_users["admin"])),
        json={
            "name": name,
            "industry": "Test",
            "country": "IN",
            "region": "APAC",
            "csm_user_id": str(seeded_users["csm"]),
            "tier": "Strategic",
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["name"] == name
    assert body["slug"].startswith("m9-test-acme-")
    assert body["is_editable"] is True
    _cleanup_account_slug(body["slug"])


def test_create_account_csm_forbidden(client: TestClient, seeded_users: dict) -> None:
    r = client.post(
        "/api/v1/accounts",
        headers=_auth(mint_jwt(seeded_users["csm"])),
        json={"name": "Should fail", "csm_user_id": str(seeded_users["csm"])},
    )
    assert r.status_code == 403


def test_create_account_rejects_admin_as_csm(client: TestClient, seeded_users: dict) -> None:
    r = client.post(
        "/api/v1/accounts",
        headers=_auth(mint_jwt(seeded_users["admin"])),
        json={"name": "Bad CSM Test", "csm_user_id": str(seeded_users["admin"])},
    )
    assert r.status_code == 400


def test_create_account_slug_collision_appends_suffix(client: TestClient, seeded_users: dict) -> None:
    name = f"M9 Slug Coll {int(time.time()*1000)}"
    r1 = client.post(
        "/api/v1/accounts",
        headers=_auth(mint_jwt(seeded_users["admin"])),
        json={"name": name, "csm_user_id": str(seeded_users["csm"])},
    )
    r2 = client.post(
        "/api/v1/accounts",
        headers=_auth(mint_jwt(seeded_users["admin"])),
        json={"name": name, "csm_user_id": str(seeded_users["csm"])},
    )
    assert r1.status_code == 201 and r2.status_code == 201
    s1, s2 = r1.json()["slug"], r2.json()["slug"]
    assert s1 != s2
    assert s2.endswith("-2")
    _cleanup_account_slug(s1)
    _cleanup_account_slug(s2)


# ============================================================
# POST /api/v1/users  (admin-invite)
# ============================================================


def test_invite_user_admin_succeeds(
    client: TestClient, seeded_users: dict, stub_supabase_invite
) -> None:
    email = f"m9-invitee-{int(time.time()*1000)}@beroe-inc.com"
    try:
        r = client.post(
            "/api/v1/users",
            headers=_auth(mint_jwt(seeded_users["admin"])),
            json={"email": email, "full_name": "M9 Invitee", "role": "csm"},
        )
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["email"] == email
        assert body["status"] == "pending"
        assert body["role"] == "csm"
        assert email in stub_supabase_invite
    finally:
        _cleanup_user_by_email(email)


def test_invite_user_csm_forbidden(client: TestClient, seeded_users: dict) -> None:
    r = client.post(
        "/api/v1/users",
        headers=_auth(mint_jwt(seeded_users["csm"])),
        json={"email": "x@beroe-inc.com", "full_name": "X", "role": "csm"},
    )
    assert r.status_code == 403


# ============================================================
# PATCH /api/v1/users/:id
# ============================================================


def test_admin_self_demote_blocked(client: TestClient, seeded_users: dict) -> None:
    r = client.patch(
        f"/api/v1/users/{seeded_users['admin']}",
        headers=_auth(mint_jwt(seeded_users["admin"])),
        json={"role": "csm"},
    )
    assert r.status_code == 400
    assert "demote" in r.json()["detail"].lower()


def test_admin_can_edit_other_user_full_name(
    client: TestClient, seeded_users: dict, stub_supabase_invite
) -> None:
    email = f"m9-edit-{int(time.time()*1000)}@beroe-inc.com"
    try:
        created = client.post(
            "/api/v1/users",
            headers=_auth(mint_jwt(seeded_users["admin"])),
            json={"email": email, "full_name": "Initial Name", "role": "csm"},
        ).json()
        new_id = created["id"]
        r = client.patch(
            f"/api/v1/users/{new_id}",
            headers=_auth(mint_jwt(seeded_users["admin"])),
            json={"full_name": "Edited Name"},
        )
        assert r.status_code == 200
        assert r.json()["full_name"] == "Edited Name"
    finally:
        _cleanup_user_by_email(email)


# ============================================================
# DELETE /api/v1/users/:id
# ============================================================


def test_admin_self_deactivate_blocked(client: TestClient, seeded_users: dict) -> None:
    r = client.delete(
        f"/api/v1/users/{seeded_users['admin']}",
        headers=_auth(mint_jwt(seeded_users["admin"])),
    )
    assert r.status_code == 400


def test_admin_can_deactivate_other_user(
    client: TestClient, seeded_users: dict, stub_supabase_invite
) -> None:
    email = f"m9-deactivate-{int(time.time()*1000)}@beroe-inc.com"
    try:
        created = client.post(
            "/api/v1/users",
            headers=_auth(mint_jwt(seeded_users["admin"])),
            json={"email": email, "full_name": "To Be Deactivated", "role": "csm"},
        ).json()
        new_id = created["id"]
        r = client.delete(
            f"/api/v1/users/{new_id}",
            headers=_auth(mint_jwt(seeded_users["admin"])),
        )
        assert r.status_code == 204
        # List should exclude unless include_deactivated=true
        active = client.get(
            "/api/v1/users", headers=_auth(mint_jwt(seeded_users["admin"]))
        ).json()
        assert not any(u["id"] == new_id for u in active)
        with_inactive = client.get(
            "/api/v1/users?include_deactivated=true",
            headers=_auth(mint_jwt(seeded_users["admin"])),
        ).json()
        deactivated = next((u for u in with_inactive if u["id"] == new_id), None)
        assert deactivated is not None
        assert deactivated["status"] == "deactivated"
    finally:
        _cleanup_user_by_email(email)
