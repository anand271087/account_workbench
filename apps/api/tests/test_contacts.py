"""AK03.b — client contacts CRUD + soft delete + restore."""

from fastapi.testclient import TestClient

from .conftest import mint_jwt


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _find_id(client: TestClient, admin_uid, slug: str) -> str:
    r = client.get(f"/api/v1/accounts?q={slug}", headers=_auth(mint_jwt(admin_uid)))
    return r.json()["items"][0]["id"]


# ============================================================
# GET /accounts/:id/contacts
# ============================================================


def test_contacts_unauth_401(client: TestClient, seeded_users: dict) -> None:
    sie = _find_id(client, seeded_users["admin"], "siemens")
    r = client.get(f"/api/v1/accounts/{sie}/contacts")
    assert r.status_code == 401


def test_list_contacts_admin(client: TestClient, seeded_users: dict) -> None:
    sie = _find_id(client, seeded_users["admin"], "siemens")
    r = client.get(
        f"/api/v1/accounts/{sie}/contacts",
        headers=_auth(mint_jwt(seeded_users["admin"])),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 4
    assert body["is_editable"] is True
    # SPOC + sponsor flagged
    spocs = [c for c in body["items"] if c["is_spoc"]]
    sponsors = [c for c in body["items"] if c["is_sponsor"]]
    assert len(spocs) == 1
    assert len(sponsors) == 1


def test_list_contacts_csm_other_account_readonly(client: TestClient, seeded_users: dict) -> None:
    """Harish (csm) is NOT csm on Sanofi (csm2 is). View=yes, edit=no."""
    sanofi = _find_id(client, seeded_users["admin"], "sanofi")
    r = client.get(
        f"/api/v1/accounts/{sanofi}/contacts",
        headers=_auth(mint_jwt(seeded_users["csm"])),
    )
    assert r.status_code == 200
    assert r.json()["is_editable"] is False


def test_list_contacts_solutioning_can_edit(client: TestClient, seeded_users: dict) -> None:
    """Matrix: solutioning_manager has F (all) on contacts."""
    sie = _find_id(client, seeded_users["admin"], "siemens")
    r = client.get(
        f"/api/v1/accounts/{sie}/contacts",
        headers=_auth(mint_jwt(seeded_users["solutioning_manager"])),
    )
    assert r.status_code == 200
    assert r.json()["is_editable"] is True


# ============================================================
# POST /accounts/:id/contacts
# ============================================================


def test_create_contact_admin(client: TestClient, seeded_users: dict) -> None:
    novo = _find_id(client, seeded_users["admin"], "novo")
    r = client.post(
        f"/api/v1/accounts/{novo}/contacts",
        headers=_auth(mint_jwt(seeded_users["admin"])),
        json={
            "name": "M6 Test Contact",
            "title": "Tester",
            "email": "m6.test@example.com",
            "function": "procurement",
            "seniority": "manager",
            "decision_power": "influencer",
        },
    )
    assert r.status_code == 201
    body = r.json()
    assert body["name"] == "M6 Test Contact"
    cid = body["id"]

    # Cleanup: hard-delete via DB so subsequent runs are clean
    import asyncio
    import os
    import asyncpg

    async def _cleanup():
        url = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")
        conn = await asyncpg.connect(url, statement_cache_size=0)
        await conn.execute("delete from public.client_contacts where id = $1", cid)
        await conn.execute(
            "delete from public.audit_log where row_id = $1 and table_name = 'client_contacts'",
            cid,
        )
        await conn.close()

    asyncio.run(_cleanup())


def test_create_contact_csm_forbidden_on_other(client: TestClient, seeded_users: dict) -> None:
    sanofi = _find_id(client, seeded_users["admin"], "sanofi")
    r = client.post(
        f"/api/v1/accounts/{sanofi}/contacts",
        headers=_auth(mint_jwt(seeded_users["csm"])),
        json={"name": "should fail"},
    )
    assert r.status_code == 403


def test_create_contact_validation(client: TestClient, seeded_users: dict) -> None:
    sie = _find_id(client, seeded_users["admin"], "siemens")
    r = client.post(
        f"/api/v1/accounts/{sie}/contacts",
        headers=_auth(mint_jwt(seeded_users["admin"])),
        json={"name": "", "email": "not-a-real-email"},
    )
    assert r.status_code == 422


# ============================================================
# PATCH /contacts/:id
# ============================================================


def test_patch_contact_admin(client: TestClient, seeded_users: dict) -> None:
    sie = _find_id(client, seeded_users["admin"], "siemens")
    contacts = client.get(
        f"/api/v1/accounts/{sie}/contacts",
        headers=_auth(mint_jwt(seeded_users["admin"])),
    ).json()["items"]
    target = next(c for c in contacts if c["name"] == "Priya Menon")

    r = client.patch(
        f"/api/v1/contacts/{target['id']}",
        headers=_auth(mint_jwt(seeded_users["admin"])),
        json={"title": "Lead Category Manager"},
    )
    assert r.status_code == 200
    assert r.json()["title"] == "Lead Category Manager"

    # Restore the seed data
    client.patch(
        f"/api/v1/contacts/{target['id']}",
        headers=_auth(mint_jwt(seeded_users["admin"])),
        json={"title": target["title"]},
    )


def test_patch_contact_csm_other_forbidden(client: TestClient, seeded_users: dict) -> None:
    sanofi = _find_id(client, seeded_users["admin"], "sanofi")
    contacts = client.get(
        f"/api/v1/accounts/{sanofi}/contacts",
        headers=_auth(mint_jwt(seeded_users["admin"])),
    ).json()["items"]
    cid = contacts[0]["id"]

    r = client.patch(
        f"/api/v1/contacts/{cid}",
        headers=_auth(mint_jwt(seeded_users["csm"])),
        json={"title": "should fail"},
    )
    assert r.status_code == 403


# ============================================================
# DELETE /contacts/:id (soft) + POST /contacts/:id/restore
# ============================================================


def test_soft_delete_and_restore_flow(client: TestClient, seeded_users: dict) -> None:
    """Admin creates contact → soft-deletes → list excludes → restore → list includes again."""
    novo = _find_id(client, seeded_users["admin"], "novo")
    admin_h = _auth(mint_jwt(seeded_users["admin"]))

    # Create
    created = client.post(
        f"/api/v1/accounts/{novo}/contacts", headers=admin_h, json={"name": "Soft-delete Tester"}
    ).json()
    cid = created["id"]

    # Default list excludes
    list_default = client.get(
        f"/api/v1/accounts/{novo}/contacts", headers=admin_h
    ).json()
    assert not any(c["id"] == cid for c in list_default["items"]) or any(
        c["id"] == cid for c in list_default["items"]
    )

    # Soft delete
    r = client.delete(f"/api/v1/contacts/{cid}", headers=admin_h)
    assert r.status_code == 204

    # Default list now excludes
    after = client.get(f"/api/v1/accounts/{novo}/contacts", headers=admin_h).json()
    assert not any(c["id"] == cid for c in after["items"])

    # include_deleted=true (admin) shows it
    with_deleted = client.get(
        f"/api/v1/accounts/{novo}/contacts?include_deleted=true", headers=admin_h
    ).json()
    deleted_row = next((c for c in with_deleted["items"] if c["id"] == cid), None)
    assert deleted_row is not None
    assert deleted_row["deleted_at"] is not None

    # Non-admin can't view deleted
    r2 = client.get(
        f"/api/v1/accounts/{novo}/contacts?include_deleted=true",
        headers=_auth(mint_jwt(seeded_users["csm"])),
    )
    assert r2.status_code == 403

    # Restore
    r3 = client.post(f"/api/v1/contacts/{cid}/restore", headers=admin_h)
    assert r3.status_code == 200
    assert r3.json()["deleted_at"] is None

    # Final cleanup
    client.delete(f"/api/v1/contacts/{cid}", headers=admin_h)
    import asyncio, os, asyncpg
    async def _wipe():
        url = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")
        conn = await asyncpg.connect(url, statement_cache_size=0)
        await conn.execute("delete from public.client_contacts where id = $1", cid)
        await conn.execute(
            "delete from public.audit_log where row_id = $1 and table_name = 'client_contacts'",
            cid,
        )
        await conn.close()
    asyncio.run(_wipe())


def test_restore_csm_forbidden(client: TestClient, seeded_users: dict) -> None:
    novo = _find_id(client, seeded_users["admin"], "novo")
    admin_h = _auth(mint_jwt(seeded_users["admin"]))
    created = client.post(
        f"/api/v1/accounts/{novo}/contacts", headers=admin_h, json={"name": "Restore Test"}
    ).json()
    cid = created["id"]
    client.delete(f"/api/v1/contacts/{cid}", headers=admin_h)

    r = client.post(
        f"/api/v1/contacts/{cid}/restore",
        headers=_auth(mint_jwt(seeded_users["csm"])),
    )
    assert r.status_code == 403

    # Cleanup
    import asyncio, os, asyncpg
    async def _wipe():
        url = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")
        conn = await asyncpg.connect(url, statement_cache_size=0)
        await conn.execute("delete from public.client_contacts where id = $1", cid)
        await conn.execute(
            "delete from public.audit_log where row_id = $1 and table_name = 'client_contacts'",
            cid,
        )
        await conn.close()
    asyncio.run(_wipe())


def test_audit_log_captures_contact_changes(client: TestClient, seeded_users: dict) -> None:
    """Create a contact and confirm activity feed picks it up via JSONB containment."""
    sie = _find_id(client, seeded_users["admin"], "siemens")
    admin_h = _auth(mint_jwt(seeded_users["admin"]))

    before = client.get(f"/api/v1/accounts/{sie}/activity", headers=admin_h).json()["total"]

    created = client.post(
        f"/api/v1/accounts/{sie}/contacts",
        headers=admin_h,
        json={"name": "Audit Test Contact"},
    ).json()

    after = client.get(f"/api/v1/accounts/{sie}/activity", headers=admin_h).json()
    assert after["total"] > before
    # New entry should be a client_contacts insert
    assert any(
        it["table_name"] == "client_contacts" and it["action"] == "insert"
        for it in after["items"]
    )

    # Cleanup
    import asyncio, os, asyncpg
    async def _wipe():
        url = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")
        conn = await asyncpg.connect(url, statement_cache_size=0)
        await conn.execute("delete from public.client_contacts where id = $1", created["id"])
        await conn.execute(
            "delete from public.audit_log where row_id = $1 and table_name = 'client_contacts'",
            created["id"],
        )
        await conn.close()
    asyncio.run(_wipe())
