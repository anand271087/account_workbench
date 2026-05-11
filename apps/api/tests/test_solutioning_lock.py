"""M11 — Solutioning trial fields + Sales Hand-off lock (migration 0019)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from .conftest import mint_jwt


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _find_id(client: TestClient, admin_uid, slug: str) -> str:
    r = client.get(f"/api/v1/accounts?q={slug}", headers=_auth(mint_jwt(admin_uid)))
    return r.json()["items"][0]["id"]


def _reset_solutioning(client: TestClient, admin_uid, account_id: str) -> None:
    """Unlock + clear trial fields between tests so re-runs are idempotent."""
    client.post(
        f"/api/v1/accounts/{account_id}/solutioning/unlock",
        headers=_auth(mint_jwt(admin_uid)),
    )
    client.patch(
        f"/api/v1/accounts/{account_id}/solutioning",
        headers=_auth(mint_jwt(admin_uid)),
        json={
            "trial_conducted": None,
            "trial_type": None,
            "trial_duration_text": None,
            "trial_participant_count": None,
            "trial_participants_text": None,
            "key_users_text": None,
            "info_tested": None,
            "hypothesis_tested": None,
            "trial_summary": None,
        },
    )


# ============================================================
# Trial / POC structured fields surface through GET + PATCH
# ============================================================


def test_solutioning_trial_fields_roundtrip(
    client: TestClient, seeded_users: dict
) -> None:
    """PATCH writes all trial fields and GET reads them back unchanged."""
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    _reset_solutioning(client, admin, siemens)

    payload = {
        "trial_conducted": True,
        "trial_type": "poc",
        "trial_duration_text": "3 weeks",
        "trial_participant_count": 12,
        "trial_participants_text": "Gunter Braun (VP)\nKlaus Richter (CPO)",
        "key_users_text": "Category managers, sourcing analysts",
        "info_tested": "Copper price intelligence + supplier risk monitoring",
        "hypothesis_tested": "Beroe can replace 3 vendors with one platform",
        "trial_summary": "Trial confirmed coverage on copper + aluminium.",
    }
    r = client.patch(
        f"/api/v1/accounts/{siemens}/solutioning",
        headers=_auth(mint_jwt(admin)),
        json=payload,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    for k, v in payload.items():
        assert body[k] == v, f"{k}: expected {v!r}, got {body[k]!r}"

    # Re-fetch to confirm persistence (not just echo).
    g = client.get(
        f"/api/v1/accounts/{siemens}/solutioning",
        headers=_auth(mint_jwt(admin)),
    )
    assert g.status_code == 200
    body = g.json()
    for k, v in payload.items():
        assert body[k] == v


def test_solutioning_trial_participant_count_rejects_negative(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    r = client.patch(
        f"/api/v1/accounts/{siemens}/solutioning",
        headers=_auth(mint_jwt(seeded_users["admin"])),
        json={"trial_participant_count": -1},
    )
    # Pydantic validation kicks in before the DB constraint.
    assert r.status_code == 422


def test_solutioning_invalid_trial_type_rejected(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    r = client.patch(
        f"/api/v1/accounts/{siemens}/solutioning",
        headers=_auth(mint_jwt(seeded_users["admin"])),
        json={"trial_type": "spike"},  # not in enum
    )
    assert r.status_code == 422


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

    # GET should expose is_editable = False while locked.
    g = client.get(
        f"/api/v1/accounts/{siemens}/solutioning",
        headers=_auth(mint_jwt(admin)),
    )
    assert g.json()["is_editable"] is False
    assert g.json()["locked_at"] is not None

    # PATCH must be rejected with 409.
    r2 = client.patch(
        f"/api/v1/accounts/{siemens}/solutioning",
        headers=_auth(mint_jwt(admin)),
        json={"trial_summary": "Should not save while locked"},
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
        json={"trial_summary": "Saved after unlock"},
    )
    assert r4.status_code == 200
    assert r4.json()["trial_summary"] == "Saved after unlock"

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
