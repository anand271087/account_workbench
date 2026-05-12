"""M14b — CS Goal Validation & Alignment endpoints."""

from __future__ import annotations

from fastapi.testclient import TestClient

from .conftest import mint_jwt


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _find_id(client: TestClient, admin_uid, slug: str) -> str:
    r = client.get(f"/api/v1/accounts?q={slug}", headers=_auth(mint_jwt(admin_uid)))
    return r.json()["items"][0]["id"]


def _hard_clear(client: TestClient, admin_uid, account_id: str) -> None:
    """Soft-delete every goal on the account so subsequent tests start
    from a known shape. We never hard-delete in tests; previously-created
    goals stay in the DB with deleted_at set."""
    r = client.get(
        f"/api/v1/accounts/{account_id}/cs-goals?include_deleted=false",
        headers=_auth(mint_jwt(admin_uid)),
    )
    for g in r.json()["items"]:
        client.request(
            "DELETE",
            f"/api/v1/cs-goals/{g['id']}",
            headers=_auth(mint_jwt(admin_uid)),
            json={"reason": "test isolation between cases"},
        )


# ============================================================
# CRUD
# ============================================================


def test_create_then_list_excludes_deleted_by_default(
    client: TestClient, seeded_users: dict
) -> None:
    """Robust against pre-existing goals on the account: we only assert
    that THIS test's goal is/isn't present in the list, not the total
    count. Prior tests leave goals in the table by design (soft-delete
    keeps history)."""
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]

    r = client.post(
        f"/api/v1/accounts/{siemens}/cs-goals",
        headers=_auth(mint_jwt(admin)),
        json={"title": "Cut copper spend by 8%", "category": "cost_savings"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["title"] == "Cut copper spend by 8%"
    assert body["category"] == "cost_savings"
    assert body["alignment_status"] == "not_started"
    assert body["is_editable"] is True
    assert any(h["action"] == "created" for h in body["history"])
    goal_id = body["id"]

    def _ids(items: list) -> set[str]:
        return {g["id"] for g in items}

    # Default list (active only) includes the new goal.
    r2 = client.get(
        f"/api/v1/accounts/{siemens}/cs-goals",
        headers=_auth(mint_jwt(admin)),
    )
    assert r2.status_code == 200
    assert goal_id in _ids(r2.json()["items"])

    # Soft-delete it.
    rd = client.request(
        "DELETE",
        f"/api/v1/cs-goals/{goal_id}",
        headers=_auth(mint_jwt(admin)),
        json={"reason": "Re-scoped during planning"},
    )
    assert rd.status_code == 200, rd.text

    # Default list now excludes our deleted goal (other accounts' goals
    # may still be there).
    r3 = client.get(
        f"/api/v1/accounts/{siemens}/cs-goals",
        headers=_auth(mint_jwt(admin)),
    )
    assert goal_id not in _ids(r3.json()["items"])

    # With include_deleted=true, it reappears with its delete metadata.
    r4 = client.get(
        f"/api/v1/accounts/{siemens}/cs-goals?include_deleted=true",
        headers=_auth(mint_jwt(admin)),
    )
    items = r4.json()["items"]
    deleted_match = [g for g in items if g["id"] == goal_id]
    assert len(deleted_match) == 1
    assert deleted_match[0]["deleted_at"] is not None
    assert deleted_match[0]["deleted_reason"] == "Re-scoped during planning"


# ============================================================
# Phase auto-derives alignment_status
# ============================================================


def test_phase_completion_derives_alignment(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    _hard_clear(client, admin, siemens)

    r = client.post(
        f"/api/v1/accounts/{siemens}/cs-goals",
        headers=_auth(mint_jwt(admin)),
        json={"title": "Phase derivation test", "category": "adoption"},
    )
    goal_id = r.json()["id"]

    # No phases complete → not_started.
    g0 = client.get(
        f"/api/v1/cs-goals/{goal_id}", headers=_auth(mint_jwt(admin))
    )
    assert g0.json()["alignment_status"] == "not_started"

    # One phase complete → partial.
    r1 = client.patch(
        f"/api/v1/cs-goals/{goal_id}",
        headers=_auth(mint_jwt(admin)),
        json={"phase_a": {"phase_a_complete": True, "validation_note": "OK"}},
    )
    assert r1.status_code == 200
    assert r1.json()["alignment_status"] == "partial"
    # Phase completion logged in history.
    assert any(
        h["action"] == "phase_a_completed" for h in r1.json()["history"]
    )

    # All three complete → aligned.
    r2 = client.patch(
        f"/api/v1/cs-goals/{goal_id}",
        headers=_auth(mint_jwt(admin)),
        json={
            "phase_b": {"phase_b_complete": True},
            "phase_c": {"phase_c_complete": True, "agreed_target": "8%"},
        },
    )
    assert r2.status_code == 200
    assert r2.json()["alignment_status"] == "aligned"


def test_explicit_alignment_overrides_derivation(
    client: TestClient, seeded_users: dict
) -> None:
    """If the caller sends alignment_status explicitly, we don't re-derive."""
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    _hard_clear(client, admin, siemens)

    r = client.post(
        f"/api/v1/accounts/{siemens}/cs-goals",
        headers=_auth(mint_jwt(admin)),
        json={"title": "Explicit alignment", "category": "other"},
    )
    goal_id = r.json()["id"]

    # Send phase_a_complete AND an explicit status — explicit wins.
    r2 = client.patch(
        f"/api/v1/cs-goals/{goal_id}",
        headers=_auth(mint_jwt(admin)),
        json={
            "phase_a": {"phase_a_complete": True},
            "alignment_status": "aligned",
        },
    )
    assert r2.json()["alignment_status"] == "aligned"


# ============================================================
# Initiatives roundtrip
# ============================================================


def test_initiative_roundtrip(client: TestClient, seeded_users: dict) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    _hard_clear(client, admin, siemens)

    r = client.post(
        f"/api/v1/accounts/{siemens}/cs-goals",
        headers=_auth(mint_jwt(admin)),
        json={"title": "Initiatives", "category": "cost_savings"},
    )
    goal_id = r.json()["id"]

    initiatives = [
        {
            "name": "Renegotiate copper contracts Q3",
            "sub_initiatives": "Three suppliers in scope.",
            "status": "in_progress",
            "value_stage": "committed",
            "value_target": "$300K",
            "value_delivered": "$120K",
            "client_acknowledged": "yes",
            "evidence": "Email from procurement lead, 2026-02-14.",
            "implementation_status": "On track",
            "implementation_note": "Final round next week.",
            "value_fields": {
                "identified_value": "$300K",
                "committed_value": "$150K",
            },
            "client_data": [
                {"label": "Spend report H1", "status": "received"},
                {"label": "Forecast H2", "status": "pending"},
            ],
            "value_history": [],
        }
    ]
    r2 = client.patch(
        f"/api/v1/cs-goals/{goal_id}",
        headers=_auth(mint_jwt(admin)),
        json={"initiatives": initiatives},
    )
    assert r2.status_code == 200, r2.text
    saved = r2.json()["initiatives"]
    assert len(saved) == 1
    assert saved[0]["name"] == "Renegotiate copper contracts Q3"
    assert saved[0]["client_acknowledged"] == "yes"
    assert saved[0]["value_fields"]["identified_value"] == "$300K"


# ============================================================
# Soft delete + restore
# ============================================================


def test_soft_delete_requires_reason(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    _hard_clear(client, admin, siemens)

    r = client.post(
        f"/api/v1/accounts/{siemens}/cs-goals",
        headers=_auth(mint_jwt(admin)),
        json={"title": "Reason check", "category": "other"},
    )
    goal_id = r.json()["id"]

    # Too short.
    rd = client.request(
        "DELETE",
        f"/api/v1/cs-goals/{goal_id}",
        headers=_auth(mint_jwt(admin)),
        json={"reason": "no"},
    )
    assert rd.status_code == 422

    # Missing entirely.
    rd2 = client.request(
        "DELETE",
        f"/api/v1/cs-goals/{goal_id}",
        headers=_auth(mint_jwt(admin)),
        json={},
    )
    assert rd2.status_code == 422


def test_restore_admin_only(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    _hard_clear(client, admin, siemens)

    r = client.post(
        f"/api/v1/accounts/{siemens}/cs-goals",
        headers=_auth(mint_jwt(admin)),
        json={"title": "Restore test", "category": "other"},
    )
    goal_id = r.json()["id"]
    client.request(
        "DELETE",
        f"/api/v1/cs-goals/{goal_id}",
        headers=_auth(mint_jwt(admin)),
        json={"reason": "test scenario for restore RBAC"},
    )

    # CSM cannot restore.
    rc = client.post(
        f"/api/v1/cs-goals/{goal_id}/restore",
        headers=_auth(mint_jwt(seeded_users["csm"])),
    )
    assert rc.status_code == 403

    # Admin can.
    ra = client.post(
        f"/api/v1/cs-goals/{goal_id}/restore",
        headers=_auth(mint_jwt(admin)),
    )
    assert ra.status_code == 200
    assert ra.json()["deleted_at"] is None
    assert any(h["action"] == "restored" for h in ra.json()["history"])


# ============================================================
# Patching a soft-deleted goal is blocked (409)
# ============================================================


def test_patch_soft_deleted_409(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    _hard_clear(client, admin, siemens)

    r = client.post(
        f"/api/v1/accounts/{siemens}/cs-goals",
        headers=_auth(mint_jwt(admin)),
        json={"title": "PATCH on deleted", "category": "other"},
    )
    goal_id = r.json()["id"]
    client.request(
        "DELETE",
        f"/api/v1/cs-goals/{goal_id}",
        headers=_auth(mint_jwt(admin)),
        json={"reason": "blocking PATCH after delete"},
    )

    r2 = client.patch(
        f"/api/v1/cs-goals/{goal_id}",
        headers=_auth(mint_jwt(admin)),
        json={"title": "Should fail"},
    )
    assert r2.status_code == 409


# ============================================================
# RBAC
# ============================================================


def test_csm_can_edit_own_account_goal(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    csm = seeded_users["csm"]
    admin = seeded_users["admin"]
    _hard_clear(client, admin, siemens)

    r = client.post(
        f"/api/v1/accounts/{siemens}/cs-goals",
        headers=_auth(mint_jwt(csm)),
        json={"title": "CSM-owned goal", "category": "adoption"},
    )
    assert r.status_code == 201, r.text


def test_csm_cannot_edit_other_csms_goal(
    client: TestClient, seeded_users: dict
) -> None:
    sanofi = _find_id(client, seeded_users["admin"], "sanofi")
    r = client.post(
        f"/api/v1/accounts/{sanofi}/cs-goals",
        headers=_auth(mint_jwt(seeded_users["csm"])),
        json={"title": "Should be forbidden", "category": "other"},
    )
    assert r.status_code == 403


def test_solutioning_can_view_cannot_create(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    # View — allowed (account view scope).
    g = client.get(
        f"/api/v1/accounts/{siemens}/cs-goals",
        headers=_auth(mint_jwt(seeded_users["solutioning_manager"])),
    )
    assert g.status_code == 200
    # Create — denied (solutioning is not in the CS write set).
    r = client.post(
        f"/api/v1/accounts/{siemens}/cs-goals",
        headers=_auth(mint_jwt(seeded_users["solutioning_manager"])),
        json={"title": "Nope", "category": "other"},
    )
    assert r.status_code == 403
