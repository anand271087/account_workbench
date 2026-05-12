"""M13 — Sales Hand-off & Signing endpoints."""

from __future__ import annotations

from fastapi.testclient import TestClient

from .conftest import mint_jwt


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _find_id(client: TestClient, admin_uid, slug: str) -> str:
    r = client.get(f"/api/v1/accounts?q={slug}", headers=_auth(mint_jwt(admin_uid)))
    return r.json()["items"][0]["id"]


def _reset(client: TestClient, admin_uid, account_id: str) -> None:
    """Unlock + clear so re-runs are idempotent. Done by hitting the raw DB
    via the unlock endpoint + a sentinel re-confirm with known values, then
    a fresh unlock (leaves the gate in 'signed + unlocked' so tests can
    overwrite cleanly). For simpler isolation we hit /sign/unlock directly."""
    client.post(
        f"/api/v1/accounts/{account_id}/sign/unlock",
        headers=_auth(mint_jwt(admin_uid)),
        json={"reason": "test reset between cases"},
    )


# ============================================================
# GET /sign — reflects current state with capability flags
# ============================================================


def test_signing_gate_visible_to_viewer(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    r = client.get(
        f"/api/v1/accounts/{siemens}/sign",
        headers=_auth(mint_jwt(seeded_users["admin"])),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert "gate_signed" in body
    assert "can_sign" in body
    assert body["can_sign"] is True  # admin can sign


def test_signing_gate_csm_cannot_sign(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    r = client.get(
        f"/api/v1/accounts/{siemens}/sign",
        headers=_auth(mint_jwt(seeded_users["csm"])),
    )
    assert r.status_code == 200
    # csm can view but can't sign — see can_sign_account
    assert r.json()["can_sign"] is False


# ============================================================
# POST /sign — write event
# ============================================================


def test_sign_then_renewal_dates_derived(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    _reset(client, admin, siemens)

    r = client.post(
        f"/api/v1/accounts/{siemens}/sign",
        headers=_auth(mint_jwt(admin)),
        json={
            "gate_signed_date": "2026-03-15",
            "gate_contract_acv": "420000.00",
            "gate_contract_term": "2 years",
            "gate_contract_modules": ["Live.ai", "MMD"],
            "gate_platform_tier": "EL Plus",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["gate_signed"] is True
    assert body["gate_signed_date"] == "2026-03-15"
    assert body["gate_renewal_date"] == "2028-03-15"
    assert body["gate_bvd_due_date"] is not None  # derived from +183 days
    assert body["gate_contract_modules"] == ["Live.ai", "MMD"]
    assert body["gate_platform_tier"] == "EL Plus"
    assert body["gate_unlocked"] is False


def test_sign_409_when_already_signed(
    client: TestClient, seeded_users: dict
) -> None:
    """Re-signing without unlock first should 409."""
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    _reset(client, admin, siemens)

    # First sign — should succeed (the previous unlock left it in
    # signed+unlocked state, which /sign clears).
    r1 = client.post(
        f"/api/v1/accounts/{siemens}/sign",
        headers=_auth(mint_jwt(admin)),
        json={
            "gate_signed_date": "2026-03-15",
            "gate_contract_acv": "420000",
            "gate_contract_term": "1 year",
        },
    )
    assert r1.status_code == 200, r1.text

    # Second sign without unlock — 409.
    r2 = client.post(
        f"/api/v1/accounts/{siemens}/sign",
        headers=_auth(mint_jwt(admin)),
        json={
            "gate_signed_date": "2026-04-01",
            "gate_contract_acv": "500000",
            "gate_contract_term": "1 year",
        },
    )
    assert r2.status_code == 409


def test_sign_forbidden_for_csm(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    r = client.post(
        f"/api/v1/accounts/{siemens}/sign",
        headers=_auth(mint_jwt(seeded_users["csm"])),
        json={
            "gate_signed_date": "2026-03-15",
            "gate_contract_acv": "100000",
            "gate_contract_term": "1 year",
        },
    )
    assert r.status_code == 403


# ============================================================
# POST /sign/unlock
# ============================================================


def test_unlock_then_resign_clears_unlocked_flag(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    _reset(client, admin, siemens)

    # Sign.
    client.post(
        f"/api/v1/accounts/{siemens}/sign",
        headers=_auth(mint_jwt(admin)),
        json={
            "gate_signed_date": "2026-03-15",
            "gate_contract_acv": "420000",
            "gate_contract_term": "1 year",
        },
    )

    # Unlock with reason.
    r = client.post(
        f"/api/v1/accounts/{siemens}/sign/unlock",
        headers=_auth(mint_jwt(admin)),
        json={"reason": "Sales recorded the wrong ACV — re-confirming."},
    )
    assert r.status_code == 200
    assert r.json()["gate_unlocked"] is True
    assert r.json()["gate_unlock_reason"].startswith("Sales recorded")

    # Re-sign clears the unlock flag.
    r2 = client.post(
        f"/api/v1/accounts/{siemens}/sign",
        headers=_auth(mint_jwt(admin)),
        json={
            "gate_signed_date": "2026-03-15",
            "gate_contract_acv": "440000",
            "gate_contract_term": "1 year",
        },
    )
    assert r2.status_code == 200
    assert r2.json()["gate_unlocked"] is False
    assert r2.json()["gate_contract_acv"] == "440000.00"


def test_unlock_requires_min_reason_length(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    _reset(client, admin, siemens)
    # Sign first.
    client.post(
        f"/api/v1/accounts/{siemens}/sign",
        headers=_auth(mint_jwt(admin)),
        json={
            "gate_signed_date": "2026-03-15",
            "gate_contract_acv": "420000",
            "gate_contract_term": "1 year",
        },
    )
    # Reason too short.
    r = client.post(
        f"/api/v1/accounts/{siemens}/sign/unlock",
        headers=_auth(mint_jwt(admin)),
        json={"reason": "oops"},
    )
    assert r.status_code == 422


def test_unlock_forbidden_for_non_admin(
    client: TestClient, seeded_users: dict
) -> None:
    """Solutioning manager may have edited the row but only admins can unlock."""
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    r = client.post(
        f"/api/v1/accounts/{siemens}/sign/unlock",
        headers=_auth(mint_jwt(seeded_users["solutioning_manager"])),
        json={"reason": "Trying to unlock without admin role."},
    )
    assert r.status_code == 403


# ============================================================
# PATCH /handover-checklist
# ============================================================


def test_handover_checklist_merges_overrides(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    # Two separate PATCHes — second must merge, not replace.
    r1 = client.patch(
        f"/api/v1/accounts/{siemens}/handover-checklist",
        headers=_auth(mint_jwt(admin)),
        json={"items": {"savings": True}},
    )
    assert r1.status_code == 200
    assert r1.json()["handover_quality_check"]["savings"] is True

    r2 = client.patch(
        f"/api/v1/accounts/{siemens}/handover-checklist",
        headers=_auth(mint_jwt(admin)),
        json={"items": {"stakeholders": False}},
    )
    assert r2.status_code == 200
    merged = r2.json()["handover_quality_check"]
    assert merged["savings"] is True  # preserved
    assert merged["stakeholders"] is False  # added


# ============================================================
# Solutioning lock auto-populates sh_value_from_solutioning
# ============================================================


def test_solutioning_lock_snapshots_value_into_sh(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    # Ensure solutioning is unlocked + has a fresh value definition.
    client.post(
        f"/api/v1/accounts/{siemens}/solutioning/unlock",
        headers=_auth(mint_jwt(admin)),
    )
    client.patch(
        f"/api/v1/accounts/{siemens}/solutioning",
        headers=_auth(mint_jwt(admin)),
        json={
            "value_definition": "Replace 3 vendors with one platform.",
            "value_themes": ["consolidation", "speed"],
            # wipe sh_* so the snapshot path runs fresh
            "sh_validation_notes": None,
        },
    )

    # Lock — should snapshot value_definition + themes.
    r = client.post(
        f"/api/v1/accounts/{siemens}/solutioning/lock",
        headers=_auth(mint_jwt(admin)),
    )
    assert r.status_code == 200, r.text

    # GET to confirm sh_value_from_solutioning is populated.
    g = client.get(
        f"/api/v1/accounts/{siemens}/solutioning",
        headers=_auth(mint_jwt(admin)),
    )
    body = g.json()
    assert body["sh_value_from_solutioning"] == "Replace 3 vendors with one platform."
    assert body["sh_value_themes_from_solutioning"] == "consolidation, speed"
    assert body["sh_value_received_at"] is not None

    # Cleanup: unlock for next run.
    client.post(
        f"/api/v1/accounts/{siemens}/solutioning/unlock",
        headers=_auth(mint_jwt(admin)),
    )


# ============================================================
# PATCH solutioning while locked: sh_* fields allowed, others blocked
# ============================================================


def test_sh_field_editable_while_locked(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    # Lock the row.
    client.patch(
        f"/api/v1/accounts/{siemens}/solutioning",
        headers=_auth(mint_jwt(admin)),
        json={"value_definition": "Locking anchor for this test."},
    )
    client.post(
        f"/api/v1/accounts/{siemens}/solutioning/lock",
        headers=_auth(mint_jwt(admin)),
    )

    # sh_* fields should accept PATCH while locked.
    r = client.patch(
        f"/api/v1/accounts/{siemens}/solutioning",
        headers=_auth(mint_jwt(admin)),
        json={
            "sh_value_validation": "confirmed",
            "sh_stakeholder_signoff": "Dr. Klaus Richter — verbal at QBR",
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["sh_value_validation"] == "confirmed"

    # Editing value_definition while locked should 409.
    r2 = client.patch(
        f"/api/v1/accounts/{siemens}/solutioning",
        headers=_auth(mint_jwt(admin)),
        json={"value_definition": "Should not save while locked"},
    )
    assert r2.status_code == 409

    # Cleanup.
    client.post(
        f"/api/v1/accounts/{siemens}/solutioning/unlock",
        headers=_auth(mint_jwt(admin)),
    )
