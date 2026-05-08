"""AK02 — single account + activity feed tests."""

from fastapi.testclient import TestClient

from .conftest import mint_jwt


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _find_id(client: TestClient, admin_uid, slug: str) -> str:
    r = client.get(f"/api/v1/accounts?q={slug}", headers=_auth(mint_jwt(admin_uid)))
    return r.json()["items"][0]["id"]


# ---------- GET /accounts/:id ----------


def test_detail_unauth_401(client: TestClient, seeded_users: dict) -> None:
    siemens_id = _find_id(client, seeded_users["admin"], "siemens")
    r = client.get(f"/api/v1/accounts/{siemens_id}")
    assert r.status_code == 401


def test_detail_admin_200(client: TestClient, seeded_users: dict) -> None:
    siemens_id = _find_id(client, seeded_users["admin"], "siemens")
    r = client.get(f"/api/v1/accounts/{siemens_id}", headers=_auth(mint_jwt(seeded_users["admin"])))
    assert r.status_code == 200
    body = r.json()
    assert body["name"] == "Siemens Energy AG"
    assert body["is_editable"] is True
    assert body["can_view_pre_sales"] is True
    assert "csm_full_name" in body
    assert body["csm_full_name"] == "Harish S"


def test_detail_csm_can_view_other_csms_account_readonly(client: TestClient, seeded_users: dict) -> None:
    """Harish (csm) is NOT csm on Sanofi (csm2 is). Per matrix he sees it read-only."""
    sanofi_id = _find_id(client, seeded_users["admin"], "sanofi")
    r = client.get(f"/api/v1/accounts/{sanofi_id}", headers=_auth(mint_jwt(seeded_users["csm"])))
    assert r.status_code == 200
    assert r.json()["is_editable"] is False


def test_detail_404(client: TestClient, seeded_users: dict) -> None:
    r = client.get(
        "/api/v1/accounts/00000000-0000-0000-0000-000000000000",
        headers=_auth(mint_jwt(seeded_users["admin"])),
    )
    assert r.status_code == 404


# ---------- GET /accounts/:id/activity ----------


def test_activity_admin_sees_seeded_entries(client: TestClient, seeded_users: dict) -> None:
    siemens_id = _find_id(client, seeded_users["admin"], "siemens")
    r = client.get(
        f"/api/v1/accounts/{siemens_id}/activity",
        headers=_auth(mint_jwt(seeded_users["admin"])),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["total"] >= 2  # 0007 seed inserts at least 2 for Siemens
    # Sorted desc by changed_at
    items = body["items"]
    if len(items) >= 2:
        assert items[0]["changed_at"] >= items[1]["changed_at"]


def test_activity_returns_changed_by_full_name(client: TestClient, seeded_users: dict) -> None:
    siemens_id = _find_id(client, seeded_users["admin"], "siemens")
    r = client.get(
        f"/api/v1/accounts/{siemens_id}/activity",
        headers=_auth(mint_jwt(seeded_users["admin"])),
    )
    body = r.json()
    # At least one entry should resolve a full_name (the megha+harish edits)
    assert any(it["changed_by_full_name"] for it in body["items"])


def test_activity_pagination(client: TestClient, seeded_users: dict) -> None:
    siemens_id = _find_id(client, seeded_users["admin"], "siemens")
    r = client.get(
        f"/api/v1/accounts/{siemens_id}/activity?page=1&page_size=1",
        headers=_auth(mint_jwt(seeded_users["admin"])),
    )
    body = r.json()
    assert body["page"] == 1 and body["page_size"] == 1
    assert len(body["items"]) <= 1


def test_activity_nonexistent_account_404(client: TestClient, seeded_users: dict) -> None:
    r = client.get(
        "/api/v1/accounts/00000000-0000-0000-0000-000000000000/activity",
        headers=_auth(mint_jwt(seeded_users["admin"])),
    )
    assert r.status_code == 404
