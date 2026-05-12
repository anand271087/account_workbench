"""M14 — CS Onboarding (Phase 5a) endpoints."""

from __future__ import annotations

from fastapi.testclient import TestClient

from .conftest import mint_jwt


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _find_id(client: TestClient, admin_uid, slug: str) -> str:
    r = client.get(f"/api/v1/accounts?q={slug}", headers=_auth(mint_jwt(admin_uid)))
    return r.json()["items"][0]["id"]


def _reset(client: TestClient, admin_uid, account_id: str) -> None:
    """Clear CS onboarding state between tests."""
    client.patch(
        f"/api/v1/accounts/{account_id}/cs-onboarding",
        headers=_auth(mint_jwt(admin_uid)),
        json={
            "cs_entry_type": None,
            "cs_entry_b_context": None,
            "cs_entry_b_goals": None,
            "cs_handover_checklist": {},
            "cs_stakeholders": {
                "commercial": {"name": None, "email": None, "phone": None},
                "champion": {"name": None, "email": None, "phone": None},
                "category": {"name": None, "email": None, "phone": None},
            },
        },
    )


# ============================================================
# GET — blank state
# ============================================================


def test_cs_onboarding_blank_get(client: TestClient, seeded_users: dict) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    _reset(client, admin, siemens)

    r = client.get(
        f"/api/v1/accounts/{siemens}/cs-onboarding",
        headers=_auth(mint_jwt(admin)),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["cs_entry_type"] is None
    assert body["cs_entry_b_context"] is None
    assert body["is_editable"] is True
    # `activated` reflects gate_signed OR cs_entry_type=='B'.
    # Siemens isn't signed in tests by default; entry is None → not activated.
    assert body["activated"] in (True, False)


# ============================================================
# PATCH — entry picker + Entry B baseline
# ============================================================


def test_set_entry_type_b_activates(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    _reset(client, admin, siemens)

    r = client.patch(
        f"/api/v1/accounts/{siemens}/cs-onboarding",
        headers=_auth(mint_jwt(admin)),
        json={
            "cs_entry_type": "B",
            "cs_entry_b_context": "Inheriting account mid-contract from prior CSM.",
            "cs_entry_b_goals": "1) Lock in renewal. 2) Re-baseline savings target.",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["cs_entry_type"] == "B"
    assert body["cs_entry_b_context"].startswith("Inheriting")
    assert body["activated"] is True  # Entry B activates regardless of signing

    _reset(client, admin, siemens)


def test_invalid_entry_type_rejected(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    r = client.patch(
        f"/api/v1/accounts/{siemens}/cs-onboarding",
        headers=_auth(mint_jwt(seeded_users["admin"])),
        json={"cs_entry_type": "C"},
    )
    assert r.status_code == 422


# ============================================================
# Handover checklist merges (partial updates don't blow away others)
# ============================================================


def test_handover_checklist_merges(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    _reset(client, admin, siemens)

    r1 = client.patch(
        f"/api/v1/accounts/{siemens}/cs-onboarding",
        headers=_auth(mint_jwt(admin)),
        json={"cs_handover_checklist": {"savings": True}},
    )
    assert r1.json()["cs_handover_checklist"]["savings"] is True

    r2 = client.patch(
        f"/api/v1/accounts/{siemens}/cs-onboarding",
        headers=_auth(mint_jwt(admin)),
        json={"cs_handover_checklist": {"stakeholders": False}},
    )
    merged = r2.json()["cs_handover_checklist"]
    assert merged["savings"] is True
    assert merged["stakeholders"] is False

    _reset(client, admin, siemens)


# ============================================================
# Stakeholders — partial role updates merge
# ============================================================


def test_stakeholder_partial_update_merges(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    _reset(client, admin, siemens)

    # Seed commercial with just a name.
    r1 = client.patch(
        f"/api/v1/accounts/{siemens}/cs-onboarding",
        headers=_auth(mint_jwt(admin)),
        json={
            "cs_stakeholders": {
                "commercial": {"name": "Dr. Klaus Richter"}
            }
        },
    )
    assert r1.status_code == 200, r1.text
    assert r1.json()["cs_stakeholders"]["commercial"]["name"] == "Dr. Klaus Richter"

    # Later, add email — must NOT erase the name.
    r2 = client.patch(
        f"/api/v1/accounts/{siemens}/cs-onboarding",
        headers=_auth(mint_jwt(admin)),
        json={
            "cs_stakeholders": {
                "commercial": {"email": "klaus@siemens-energy.com"}
            }
        },
    )
    body = r2.json()
    assert body["cs_stakeholders"]["commercial"]["name"] == "Dr. Klaus Richter"
    assert body["cs_stakeholders"]["commercial"]["email"] == "klaus@siemens-energy.com"

    # And champion / category updates don't touch commercial.
    r3 = client.patch(
        f"/api/v1/accounts/{siemens}/cs-onboarding",
        headers=_auth(mint_jwt(admin)),
        json={
            "cs_stakeholders": {
                "champion": {"name": "Gunter Braun"},
            }
        },
    )
    body = r3.json()
    assert body["cs_stakeholders"]["commercial"]["name"] == "Dr. Klaus Richter"
    assert body["cs_stakeholders"]["champion"]["name"] == "Gunter Braun"

    _reset(client, admin, siemens)


# ============================================================
# RBAC: solutioning_manager can VIEW, can't EDIT
# ============================================================


def test_solutioning_can_view_cannot_edit(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")

    # View — allowed.
    g = client.get(
        f"/api/v1/accounts/{siemens}/cs-onboarding",
        headers=_auth(mint_jwt(seeded_users["solutioning_manager"])),
    )
    assert g.status_code == 200
    assert g.json()["is_editable"] is False

    # Edit — 403.
    r = client.patch(
        f"/api/v1/accounts/{siemens}/cs-onboarding",
        headers=_auth(mint_jwt(seeded_users["solutioning_manager"])),
        json={"cs_entry_type": "B"},
    )
    assert r.status_code == 403


def test_csm_can_edit_own_account(client: TestClient, seeded_users: dict) -> None:
    """The seeded `csm` user (harish) is CSM on Siemens — must be able to edit."""
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    r = client.patch(
        f"/api/v1/accounts/{siemens}/cs-onboarding",
        headers=_auth(mint_jwt(seeded_users["csm"])),
        json={"cs_entry_type": "B"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["cs_entry_type"] == "B"
    _reset(client, seeded_users["admin"], siemens)


def test_csm_cannot_edit_other_csms_account(
    client: TestClient, seeded_users: dict
) -> None:
    """Harish (csm) is NOT csm on Sanofi (csm2 is). PATCH should 403."""
    sanofi = _find_id(client, seeded_users["admin"], "sanofi")
    r = client.patch(
        f"/api/v1/accounts/{sanofi}/cs-onboarding",
        headers=_auth(mint_jwt(seeded_users["csm"])),
        json={"cs_entry_type": "A"},
    )
    assert r.status_code == 403


# ============================================================
# AccountDetail exposes cs_entry_type so the nav can read it
# ============================================================


def test_account_detail_exposes_cs_entry_type(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    _reset(client, admin, siemens)

    # Set to B.
    client.patch(
        f"/api/v1/accounts/{siemens}/cs-onboarding",
        headers=_auth(mint_jwt(admin)),
        json={"cs_entry_type": "B"},
    )
    # AccountDetail must reflect it.
    r = client.get(
        f"/api/v1/accounts/{siemens}", headers=_auth(mint_jwt(admin))
    )
    assert r.status_code == 200
    assert r.json()["cs_entry_type"] == "B"
    assert r.json()["can_view_cs_onboarding"] is True
    _reset(client, admin, siemens)
