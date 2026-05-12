"""M11 — Solutioning Sales Hand-off lock (migration 0019; trial fields rolled back in 0021)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from .conftest import mint_jwt


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _find_id(client: TestClient, admin_uid, slug: str) -> str:
    r = client.get(f"/api/v1/accounts?q={slug}", headers=_auth(mint_jwt(admin_uid)))
    return r.json()["items"][0]["id"]


def _reset_solutioning(client: TestClient, admin_uid, account_id: str) -> None:
    """Unlock + clear value themes between tests so re-runs are idempotent."""
    client.post(
        f"/api/v1/accounts/{account_id}/solutioning/unlock",
        headers=_auth(mint_jwt(admin_uid)),
    )
    client.patch(
        f"/api/v1/accounts/{account_id}/solutioning",
        headers=_auth(mint_jwt(admin_uid)),
        json={"value_themes": []},
    )


# ============================================================
# Lock / Unlock lifecycle
# ============================================================


def test_solutioning_lock_requires_value_definition(
    client: TestClient, seeded_users: dict
) -> None:
    """Locking with no value_definition should 400 — don't pass an empty contract."""
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    _reset_solutioning(client, admin, siemens)

    # Wipe value_definition to simulate the empty case.
    client.patch(
        f"/api/v1/accounts/{siemens}/solutioning",
        headers=_auth(mint_jwt(admin)),
        json={"value_definition": ""},
    )

    r = client.post(
        f"/api/v1/accounts/{siemens}/solutioning/lock",
        headers=_auth(mint_jwt(admin)),
    )
    assert r.status_code == 400
    assert "value definition" in r.json()["detail"].lower()


def test_solutioning_lock_then_patch_409_then_unlock(
    client: TestClient, seeded_users: dict
) -> None:
    """Lock → PATCH returns 409 → Unlock → PATCH 200."""
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    _reset_solutioning(client, admin, siemens)

    # Ensure a value_definition exists so lock will succeed.
    client.patch(
        f"/api/v1/accounts/{siemens}/solutioning",
        headers=_auth(mint_jwt(admin)),
        json={"value_definition": "Replace 3 procurement intelligence vendors with one platform."},
    )

    # Lock.
    r = client.post(
        f"/api/v1/accounts/{siemens}/solutioning/lock",
        headers=_auth(mint_jwt(admin)),
    )
    assert r.status_code == 200, r.text
    assert r.json()["locked_at"] is not None

    # Lock status reflected in GET. Note: is_editable can be True even
    # while locked (M13) because the sh_* hand-off fields remain editable;
    # the lock only freezes the value definition fields. The 409 PATCH
    # below is the real proof that value_themes can't be saved.
    g = client.get(
        f"/api/v1/accounts/{siemens}/solutioning",
        headers=_auth(mint_jwt(admin)),
    )
    assert g.json()["locked_at"] is not None

    # PATCH must be rejected with 409.
    r2 = client.patch(
        f"/api/v1/accounts/{siemens}/solutioning",
        headers=_auth(mint_jwt(admin)),
        json={"value_themes": ["Should not save while locked"]},
    )
    assert r2.status_code == 409, r2.text

    # Unlock.
    r3 = client.post(
        f"/api/v1/accounts/{siemens}/solutioning/unlock",
        headers=_auth(mint_jwt(admin)),
    )
    assert r3.status_code == 200
    assert r3.json()["locked_at"] is None

    # PATCH works again.
    r4 = client.patch(
        f"/api/v1/accounts/{siemens}/solutioning",
        headers=_auth(mint_jwt(admin)),
        json={"value_themes": ["Saved after unlock"]},
    )
    assert r4.status_code == 200
    assert r4.json()["value_themes"] == ["Saved after unlock"]

    # Cleanup so re-runs are idempotent.
    _reset_solutioning(client, admin, siemens)


def test_solutioning_lock_idempotent(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    _reset_solutioning(client, admin, siemens)
    client.patch(
        f"/api/v1/accounts/{siemens}/solutioning",
        headers=_auth(mint_jwt(admin)),
        json={"value_definition": "Anchor value definition for lock idempotency test."},
    )

    r1 = client.post(
        f"/api/v1/accounts/{siemens}/solutioning/lock",
        headers=_auth(mint_jwt(admin)),
    )
    r2 = client.post(
        f"/api/v1/accounts/{siemens}/solutioning/lock",
        headers=_auth(mint_jwt(admin)),
    )
    assert r1.status_code == 200
    assert r2.status_code == 200
    # Lock metadata returned by both calls is the same (timestamp preserved).
    assert r1.json()["locked_at"] == r2.json()["locked_at"]

    _reset_solutioning(client, admin, siemens)


def test_solutioning_lock_forbidden_for_csm(
    client: TestClient, seeded_users: dict
) -> None:
    """Matrix Q3: CSM can view solutioning but cannot lock — write permission required."""
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    r = client.post(
        f"/api/v1/accounts/{siemens}/solutioning/lock",
        headers=_auth(mint_jwt(seeded_users["csm"])),
    )
    assert r.status_code == 403
