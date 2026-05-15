"""M19 — Success Contract endpoints."""

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


def _full_contract_payload() -> dict:
    return {
        "metric1": "$2M documented savings via benchmark-driven negotiations",
        "metric1_unit": "$",
        "metric2": "80% platform adoption across licensed categories",
        "measure_source": "Validated by Jordan Mills using Beroe benchmark vs actuals",
        "measure_freq": "Quarterly",
        "measure_owner": "Jordan Mills",
        "value_narrative": (
            "Beroe reduces Mondelez's commodity procurement costs through "
            "benchmark-driven should-cost models, delivering 8-12% savings on "
            "managed spend across cocoa, palm oil, wheat, and packaging."
        ),
    }


def _reset(client: TestClient, admin_uid, account_id: str) -> None:
    # Unlock first if locked (idempotent), then clear all fields.
    client.post(
        f"/api/v1/accounts/{account_id}/success-contract/unlock",
        headers=_auth(mint_jwt(admin_uid)),
    )
    client.patch(
        f"/api/v1/accounts/{account_id}/success-contract",
        headers=_auth(mint_jwt(admin_uid)),
        json={
            "metric1": None, "metric1_unit": None, "metric2": None,
            "measure_source": None, "measure_freq": None, "measure_owner": None,
            "value_narrative": None,
        },
    )


# ============================================================
# Read paths
# ============================================================


def test_get_returns_auto_draft_when_empty(
    client: TestClient, seeded_users: dict
) -> None:
    """Mondelez has a populated AccountSolutioning row from seed — empty
    success_contract should return a draft synthesized from it."""
    mondelez = _find_id(client, seeded_users["admin"], "mondelez")
    admin = seeded_users["admin"]
    _reset(client, admin, mondelez)

    r = client.get(
        f"/api/v1/accounts/{mondelez}/success-contract",
        headers=_auth(mint_jwt(admin)),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["auto_drafted"] is True
    # At least the value_narrative should come from solutioning.value_definition.
    assert body["value_narrative"] is not None
    assert body["locked_at"] is None
    assert body["is_editable"] is True


def test_get_returns_persisted_when_set(
    client: TestClient, seeded_users: dict
) -> None:
    """Once the user PATCHes, subsequent GETs return persisted, not draft."""
    mondelez = _find_id(client, seeded_users["admin"], "mondelez")
    admin = seeded_users["admin"]
    _reset(client, admin, mondelez)

    client.patch(
        f"/api/v1/accounts/{mondelez}/success-contract",
        headers=_auth(mint_jwt(admin)),
        json={"metric1": "Explicit user-set metric", "metric1_unit": "$"},
    )

    r = client.get(
        f"/api/v1/accounts/{mondelez}/success-contract",
        headers=_auth(mint_jwt(admin)),
    )
    assert r.status_code == 200
    body = r.json()
    assert body["auto_drafted"] is False
    assert body["metric1"] == "Explicit user-set metric"


# ============================================================
# Lock semantics
# ============================================================


def test_lock_rejects_missing_locks(
    client: TestClient, seeded_users: dict
) -> None:
    mondelez = _find_id(client, seeded_users["admin"], "mondelez")
    admin = seeded_users["admin"]
    _reset(client, admin, mondelez)
    # Set only metric1, leave 2/3 missing.
    client.patch(
        f"/api/v1/accounts/{mondelez}/success-contract",
        headers=_auth(mint_jwt(admin)),
        json={"metric1": "Partial", "metric1_unit": "$"},
    )
    r = client.post(
        f"/api/v1/accounts/{mondelez}/success-contract/lock",
        headers=_auth(mint_jwt(admin)),
    )
    assert r.status_code == 422, r.text
    detail = r.json()["detail"]
    assert "measurement" in detail.lower()
    assert "narrative" in detail.lower()


def test_lock_succeeds_when_all_three(
    client: TestClient, seeded_users: dict
) -> None:
    mondelez = _find_id(client, seeded_users["admin"], "mondelez")
    admin = seeded_users["admin"]
    _reset(client, admin, mondelez)
    client.patch(
        f"/api/v1/accounts/{mondelez}/success-contract",
        headers=_auth(mint_jwt(admin)),
        json=_full_contract_payload(),
    )
    r = client.post(
        f"/api/v1/accounts/{mondelez}/success-contract/lock",
        headers=_auth(mint_jwt(admin)),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["locked_at"] is not None
    assert body["locked_by"] is not None


def test_patch_on_locked_returns_409(
    client: TestClient, seeded_users: dict
) -> None:
    mondelez = _find_id(client, seeded_users["admin"], "mondelez")
    admin = seeded_users["admin"]
    _reset(client, admin, mondelez)
    client.patch(
        f"/api/v1/accounts/{mondelez}/success-contract",
        headers=_auth(mint_jwt(admin)),
        json=_full_contract_payload(),
    )
    client.post(
        f"/api/v1/accounts/{mondelez}/success-contract/lock",
        headers=_auth(mint_jwt(admin)),
    )
    r = client.patch(
        f"/api/v1/accounts/{mondelez}/success-contract",
        headers=_auth(mint_jwt(admin)),
        json={"metric1": "tried to change"},
    )
    assert r.status_code == 409, r.text


def test_unlock_is_admin_only(
    client: TestClient, seeded_users: dict
) -> None:
    mondelez = _find_id(client, seeded_users["admin"], "mondelez")
    admin = seeded_users["admin"]
    csm = seeded_users["csm"]  # harish — CSM on Mondelez
    _reset(client, admin, mondelez)

    client.patch(
        f"/api/v1/accounts/{mondelez}/success-contract",
        headers=_auth(mint_jwt(admin)),
        json=_full_contract_payload(),
    )
    client.post(
        f"/api/v1/accounts/{mondelez}/success-contract/lock",
        headers=_auth(mint_jwt(admin)),
    )

    # CSM cannot unlock — admin asymmetry (matches M13 signing-unlock).
    r = client.post(
        f"/api/v1/accounts/{mondelez}/success-contract/unlock",
        headers=_auth(mint_jwt(csm)),
    )
    assert r.status_code == 403

    # Admin can.
    r = client.post(
        f"/api/v1/accounts/{mondelez}/success-contract/unlock",
        headers=_auth(mint_jwt(admin)),
    )
    assert r.status_code == 200, r.text
    assert r.json()["locked_at"] is None


def test_unlock_idempotent_on_unlocked(
    client: TestClient, seeded_users: dict
) -> None:
    mondelez = _find_id(client, seeded_users["admin"], "mondelez")
    admin = seeded_users["admin"]
    _reset(client, admin, mondelez)
    r = client.post(
        f"/api/v1/accounts/{mondelez}/success-contract/unlock",
        headers=_auth(mint_jwt(admin)),
    )
    # No-op, just returns the current state.
    assert r.status_code == 200
    assert r.json()["locked_at"] is None


# ============================================================
# RBAC
# ============================================================


def test_solutioning_manager_cannot_edit_or_lock(
    client: TestClient, seeded_users: dict
) -> None:
    mondelez = _find_id(client, seeded_users["admin"], "mondelez")
    sol_mgr = seeded_users["solutioning_manager"]
    admin = seeded_users["admin"]
    _reset(client, admin, mondelez)

    # Can view.
    r = client.get(
        f"/api/v1/accounts/{mondelez}/success-contract",
        headers=_auth(mint_jwt(sol_mgr)),
    )
    assert r.status_code == 200
    assert r.json()["is_editable"] is False

    # Cannot PATCH.
    r = client.patch(
        f"/api/v1/accounts/{mondelez}/success-contract",
        headers=_auth(mint_jwt(sol_mgr)),
        json={"metric1": "Solutioning shouldn't write this"},
    )
    assert r.status_code == 403


def test_csm_on_own_account_can_edit(
    client: TestClient, seeded_users: dict
) -> None:
    mondelez = _find_id(client, seeded_users["admin"], "mondelez")
    csm = seeded_users["csm"]
    admin = seeded_users["admin"]
    _reset(client, admin, mondelez)

    r = client.patch(
        f"/api/v1/accounts/{mondelez}/success-contract",
        headers=_auth(mint_jwt(csm)),
        json={"metric1": "CSM-set metric", "metric1_unit": "$"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["metric1"] == "CSM-set metric"
