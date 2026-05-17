"""M22 — Value Delivery Document tests (CRUD + lock asymmetry + auto-draft)."""

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


def _full_payload() -> dict:
    return {
        "client_strategic_priorities": [
            "Cost optimisation on commodities",
            "Risk mitigation on single-source suppliers",
            "Adoption of benchmark workflows across categories",
        ],
        "agreed_success_metrics": [
            {"name": "$2M savings", "target": "$2M", "current": "$1.4M"},
            {"name": "Adoption", "target": "80%", "current": "62%"},
        ],
        "beroes_approach": [
            {
                "initiative_name": "Cocoa renegotiation",
                "approach": "Benchmark-driven should-cost",
                "levers": ["cost"],
                "stage": "in_flight",
            }
        ],
        "value_delivered": [
            {
                "initiative_name": "Cocoa renegotiation",
                "identified_musd": 1.8,
                "committed_musd": 1.2,
                "implemented_musd": 0.6,
            }
        ],
        "exec_summary": "On track. 70% of committed value delivered to date.",
    }


def _reset(client: TestClient, admin_uid, account_id: str) -> None:
    client.post(
        f"/api/v1/accounts/{account_id}/value-delivery-document/unlock",
        headers=_auth(mint_jwt(admin_uid)),
    )
    client.patch(
        f"/api/v1/accounts/{account_id}/value-delivery-document",
        headers=_auth(mint_jwt(admin_uid)),
        json={
            "client_strategic_priorities": None,
            "agreed_success_metrics": None,
            "beroes_approach": None,
            "value_delivered": None,
            "exec_summary": None,
        },
    )


# ============================================================
# GET — auto-draft + roundtrip
# ============================================================


def test_get_returns_auto_draft_or_empty(
    client: TestClient, seeded_users: dict
) -> None:
    """Empty VDD → either auto-draft from existing M19/M20/M15 data, or empty."""
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    _reset(client, admin, siemens)

    r = client.get(
        f"/api/v1/accounts/{siemens}/value-delivery-document",
        headers=_auth(mint_jwt(admin)),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["account_id"] == siemens
    assert body["locked_at"] is None
    # auto_drafted may be true or false depending on seed state; both are valid.
    assert "auto_drafted" in body


def test_patch_persists_full_payload(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    _reset(client, admin, siemens)

    r = client.patch(
        f"/api/v1/accounts/{siemens}/value-delivery-document",
        headers=_auth(mint_jwt(admin)),
        json=_full_payload(),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["client_strategic_priorities"]) == 3
    assert len(body["agreed_success_metrics"]) == 2
    assert body["beroes_approach"][0]["levers"] == ["cost"]
    assert body["value_delivered"][0]["identified_musd"] == 1.8
    assert body["auto_drafted"] is False

    # Reload — must persist.
    r = client.get(
        f"/api/v1/accounts/{siemens}/value-delivery-document",
        headers=_auth(mint_jwt(admin)),
    )
    body = r.json()
    assert body["exec_summary"].startswith("On track")


# ============================================================
# Lock / unlock + 409 on PATCH-when-locked
# ============================================================


def test_lock_requires_all_four_sections(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    _reset(client, admin, siemens)

    # Empty → 422.
    r = client.post(
        f"/api/v1/accounts/{siemens}/value-delivery-document/lock",
        headers=_auth(mint_jwt(admin)),
    )
    assert r.status_code == 422

    # Fill 3 of 4 — still 422.
    client.patch(
        f"/api/v1/accounts/{siemens}/value-delivery-document",
        headers=_auth(mint_jwt(admin)),
        json={
            "client_strategic_priorities": ["X"],
            "agreed_success_metrics": [{"name": "M"}],
            "beroes_approach": [{"initiative_name": "I"}],
        },
    )
    r = client.post(
        f"/api/v1/accounts/{siemens}/value-delivery-document/lock",
        headers=_auth(mint_jwt(admin)),
    )
    assert r.status_code == 422
    assert "value delivered" in r.json()["detail"].lower()


def test_lock_full_then_409_on_patch_then_unlock(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    _reset(client, admin, siemens)

    client.patch(
        f"/api/v1/accounts/{siemens}/value-delivery-document",
        headers=_auth(mint_jwt(admin)),
        json=_full_payload(),
    )

    r = client.post(
        f"/api/v1/accounts/{siemens}/value-delivery-document/lock",
        headers=_auth(mint_jwt(admin)),
    )
    assert r.status_code == 200, r.text
    assert r.json()["locked_at"] is not None
    assert r.json()["locked_by"] is not None

    # PATCH while locked → 409.
    r = client.patch(
        f"/api/v1/accounts/{siemens}/value-delivery-document",
        headers=_auth(mint_jwt(admin)),
        json={"exec_summary": "trying to edit after lock"},
    )
    assert r.status_code == 409

    # Unlock → editable again.
    r = client.post(
        f"/api/v1/accounts/{siemens}/value-delivery-document/unlock",
        headers=_auth(mint_jwt(admin)),
    )
    assert r.status_code == 200
    assert r.json()["locked_at"] is None


# ============================================================
# RBAC
# ============================================================


def test_solutioning_manager_cannot_write(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    sol_mgr = seeded_users["solutioning_manager"]

    r = client.patch(
        f"/api/v1/accounts/{siemens}/value-delivery-document",
        headers=_auth(mint_jwt(sol_mgr)),
        json={"exec_summary": "nope"},
    )
    assert r.status_code == 403


def test_csm_on_own_account_can_write_and_lock(
    client: TestClient, seeded_users: dict
) -> None:
    mondelez = _find_id(client, seeded_users["admin"], "mondelez")
    csm = seeded_users["csm"]
    admin = seeded_users["admin"]
    _reset(client, admin, mondelez)

    r = client.patch(
        f"/api/v1/accounts/{mondelez}/value-delivery-document",
        headers=_auth(mint_jwt(csm)),
        json=_full_payload(),
    )
    assert r.status_code == 200, r.text

    r = client.post(
        f"/api/v1/accounts/{mondelez}/value-delivery-document/lock",
        headers=_auth(mint_jwt(csm)),
    )
    assert r.status_code == 200
    assert r.json()["locked_at"] is not None


def test_unlock_is_admin_only(
    client: TestClient, seeded_users: dict
) -> None:
    mondelez = _find_id(client, seeded_users["admin"], "mondelez")
    csm = seeded_users["csm"]
    admin = seeded_users["admin"]
    _reset(client, admin, mondelez)

    client.patch(
        f"/api/v1/accounts/{mondelez}/value-delivery-document",
        headers=_auth(mint_jwt(csm)),
        json=_full_payload(),
    )
    client.post(
        f"/api/v1/accounts/{mondelez}/value-delivery-document/lock",
        headers=_auth(mint_jwt(csm)),
    )

    # CSM cannot unlock → 403.
    r = client.post(
        f"/api/v1/accounts/{mondelez}/value-delivery-document/unlock",
        headers=_auth(mint_jwt(csm)),
    )
    assert r.status_code == 403

    # Admin can.
    r = client.post(
        f"/api/v1/accounts/{mondelez}/value-delivery-document/unlock",
        headers=_auth(mint_jwt(admin)),
    )
    assert r.status_code == 200
    assert r.json()["locked_at"] is None
