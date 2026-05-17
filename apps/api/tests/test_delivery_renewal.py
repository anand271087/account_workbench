"""M23 — Delivery & Renewal tests."""

from __future__ import annotations

from fastapi.testclient import TestClient

from .conftest import mint_jwt


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _find_id(client: TestClient, admin_uid, slug: str) -> str:
    r = client.get(
        f"/api/v1/accounts?q={slug}", headers=_auth(mint_jwt(admin_uid))
    )
    return r.json()["items"][0]["id"]


def _reset(client: TestClient, admin_uid, account_id: str) -> None:
    """Re-open outcome (idempotent) then clear all sections."""
    client.post(
        f"/api/v1/accounts/{account_id}/delivery-renewal/reopen",
        headers=_auth(mint_jwt(admin_uid)),
    )
    client.patch(
        f"/api/v1/accounts/{account_id}/delivery-renewal",
        headers=_auth(mint_jwt(admin_uid)),
        json={
            "expand_value_proof": None,
            "expand_expand_ask": None,
            "expand_new_scope": None,
            "expand_close": None,
            "readiness": None,
        },
    )
    # red_flags are written by POST, not PATCH — wipe via raw PATCH override.
    client.patch(
        f"/api/v1/accounts/{account_id}/delivery-renewal",
        headers=_auth(mint_jwt(admin_uid)),
        json={"red_flags": []},  # accepted via extra="allow"
    )


# ============================================================
# GET + PATCH roundtrip + derivations
# ============================================================


def test_get_returns_empty_state(client: TestClient, seeded_users: dict) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    _reset(client, admin, siemens)

    r = client.get(
        f"/api/v1/accounts/{siemens}/delivery-renewal",
        headers=_auth(mint_jwt(admin)),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["expand_paused"] is False
    assert body["readiness_score"] == 0
    assert body["outcome"] is None
    # track1 should hydrate from checkpoints (may be 0 or more)
    assert "total" in body["track1"]


def test_patch_persists_expand_and_readiness(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    _reset(client, admin, siemens)

    r = client.patch(
        f"/api/v1/accounts/{siemens}/delivery-renewal",
        headers=_auth(mint_jwt(admin)),
        json={
            "expand_value_proof": [
                {"name": "Cocoa expansion", "stage": "value_proof", "amount_musd": 1.2},
            ],
            "expand_expand_ask": [
                {"name": "Wheat add-on", "stage": "expand_ask", "amount_musd": 0.6},
            ],
            "readiness": {
                "delivered_metric": {"answer": "yes", "proof_note": "saved $2M"},
                "proof_data": {"answer": "yes", "proof_note": "Power BI dashboard"},
                "client_acknowledged": {"answer": "no", "proof_note": "pending email"},
            },
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["expand_value_proof"]) == 1
    assert body["readiness_score"] == 2


# ============================================================
# Red flags + expand auto-pause
# ============================================================


def test_red_flag_pauses_expand_and_resolves(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    _reset(client, admin, siemens)

    r = client.post(
        f"/api/v1/accounts/{siemens}/delivery-renewal/red-flags",
        headers=_auth(mint_jwt(admin)),
        json={"type": "spoc_unresponsive", "note": "Jordan offline 3 weeks"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["expand_paused"] is True
    assert len(body["red_flags"]) == 1
    flag_id = body["red_flags"][0]["id"]

    # Resolve.
    r = client.post(
        f"/api/v1/accounts/{siemens}/delivery-renewal/red-flags/{flag_id}/resolve",
        headers=_auth(mint_jwt(admin)),
    )
    assert r.status_code == 200
    assert r.json()["expand_paused"] is False


# ============================================================
# Outcome + immutability + admin re-open
# ============================================================


def test_set_outcome_then_409_on_patch_then_admin_reopens(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    _reset(client, admin, siemens)

    r = client.post(
        f"/api/v1/accounts/{siemens}/delivery-renewal/outcome",
        headers=_auth(mint_jwt(admin)),
        json={"outcome": "renewed"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["outcome"] == "renewed"
    assert body["outcome_set_at"] is not None
    assert body["is_editable"] is False

    # Second set → 409.
    r = client.post(
        f"/api/v1/accounts/{siemens}/delivery-renewal/outcome",
        headers=_auth(mint_jwt(admin)),
        json={"outcome": "at_risk"},
    )
    assert r.status_code == 409

    # PATCH while outcome set → 409.
    r = client.patch(
        f"/api/v1/accounts/{siemens}/delivery-renewal",
        headers=_auth(mint_jwt(admin)),
        json={"readiness": {}},
    )
    assert r.status_code == 409

    # Admin re-opens.
    r = client.post(
        f"/api/v1/accounts/{siemens}/delivery-renewal/reopen",
        headers=_auth(mint_jwt(admin)),
    )
    assert r.status_code == 200
    assert r.json()["outcome"] is None


# ============================================================
# RBAC
# ============================================================


def test_solutioning_manager_cannot_write(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    sol_mgr = seeded_users["solutioning_manager"]
    r = client.patch(
        f"/api/v1/accounts/{siemens}/delivery-renewal",
        headers=_auth(mint_jwt(sol_mgr)),
        json={"expand_value_proof": []},
    )
    assert r.status_code == 403


def test_reopen_is_admin_only(
    client: TestClient, seeded_users: dict
) -> None:
    mondelez = _find_id(client, seeded_users["admin"], "mondelez")
    csm = seeded_users["csm"]
    admin = seeded_users["admin"]
    _reset(client, admin, mondelez)

    client.post(
        f"/api/v1/accounts/{mondelez}/delivery-renewal/outcome",
        headers=_auth(mint_jwt(csm)),
        json={"outcome": "at_risk"},
    )

    # CSM cannot re-open.
    r = client.post(
        f"/api/v1/accounts/{mondelez}/delivery-renewal/reopen",
        headers=_auth(mint_jwt(csm)),
    )
    assert r.status_code == 403

    # Admin can.
    r = client.post(
        f"/api/v1/accounts/{mondelez}/delivery-renewal/reopen",
        headers=_auth(mint_jwt(admin)),
    )
    assert r.status_code == 200
