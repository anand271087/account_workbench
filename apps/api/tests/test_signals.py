"""M27 — Signals + Activities + appetite hookup tests."""

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


def _wipe(client: TestClient, admin_uid, account_id: str) -> None:
    r = client.get(
        f"/api/v1/accounts/{account_id}/signals",
        headers=_auth(mint_jwt(admin_uid)),
    )
    for s in r.json()["items"]:
        client.delete(
            f"/api/v1/signals/{s['id']}", headers=_auth(mint_jwt(admin_uid))
        )
    r = client.get(
        f"/api/v1/accounts/{account_id}/activities",
        headers=_auth(mint_jwt(admin_uid)),
    )
    for a in r.json()["items"]:
        client.delete(
            f"/api/v1/activities/{a['id']}", headers=_auth(mint_jwt(admin_uid))
        )


# ============================================================
# Signals CRUD
# ============================================================


def test_create_and_list_signal(client: TestClient, seeded_users: dict) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    _wipe(client, admin, siemens)

    r = client.post(
        f"/api/v1/accounts/{siemens}/signals",
        headers=_auth(mint_jwt(admin)),
        json={
            "type": "expansion",
            "category": "commercial",
            "signal": "Phase 2 budget confirmed",
            "description": "VP confirmed Phase 2 budget for Q3",
            "impact": "high",
        },
    )
    assert r.status_code == 201, r.text
    sid = r.json()["id"]
    assert r.json()["status"] == "active"
    assert r.json()["resolved_at"] is None

    r = client.get(
        f"/api/v1/accounts/{siemens}/signals",
        headers=_auth(mint_jwt(admin)),
    )
    items = r.json()["items"]
    assert any(s["id"] == sid for s in items)


def test_resolve_requires_note_and_flips_status(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    _wipe(client, admin, siemens)

    r = client.post(
        f"/api/v1/accounts/{siemens}/signals",
        headers=_auth(mint_jwt(admin)),
        json={"type": "risk", "signal": "SSO pending 6 weeks"},
    )
    sid = r.json()["id"]

    # Too-short note → 422.
    r = client.post(
        f"/api/v1/signals/{sid}/resolve",
        headers=_auth(mint_jwt(admin)),
        json={"resolved_note": "ok"},
    )
    assert r.status_code == 422

    # Valid note.
    r = client.post(
        f"/api/v1/signals/{sid}/resolve",
        headers=_auth(mint_jwt(admin)),
        json={"resolved_note": "IT configured SSO 14 Nov; 32 users active."},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "resolved"
    assert body["resolved_at"] is not None
    assert body["resolved_by"] is not None

    # Second resolve → 409.
    r = client.post(
        f"/api/v1/signals/{sid}/resolve",
        headers=_auth(mint_jwt(admin)),
        json={"resolved_note": "still resolved"},
    )
    assert r.status_code == 409


def test_reopen_is_admin_only(client: TestClient, seeded_users: dict) -> None:
    mondelez = _find_id(client, seeded_users["admin"], "mondelez")
    csm = seeded_users["csm"]
    admin = seeded_users["admin"]
    _wipe(client, admin, mondelez)

    r = client.post(
        f"/api/v1/accounts/{mondelez}/signals",
        headers=_auth(mint_jwt(csm)),
        json={"type": "positive", "signal": "Champion advocating"},
    )
    sid = r.json()["id"]
    client.post(
        f"/api/v1/signals/{sid}/resolve",
        headers=_auth(mint_jwt(csm)),
        json={"resolved_note": "Captured as case study + posted internally"},
    )

    # CSM cannot reopen.
    r = client.post(
        f"/api/v1/signals/{sid}/reopen", headers=_auth(mint_jwt(csm))
    )
    assert r.status_code == 403

    # Admin can.
    r = client.post(
        f"/api/v1/signals/{sid}/reopen", headers=_auth(mint_jwt(admin))
    )
    assert r.status_code == 200
    assert r.json()["status"] == "active"


# ============================================================
# Appetite hookup — signals shift sig_pts component
# ============================================================


def test_appetite_sig_pts_responds_to_signal_mix(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    _wipe(client, admin, siemens)

    # Baseline (no signals).
    baseline = client.get(
        f"/api/v1/accounts/{siemens}/appetite-score",
        headers=_auth(mint_jwt(admin)),
    ).json()
    assert baseline["breakdown"]["sig_pts"] == 15

    # 2x expansion + 1x positive → pos_share > 50% → 25 pts.
    for sig in (
        {"type": "expansion", "signal": "Phase 2 commitment", "impact": "high"},
        {"type": "expansion", "signal": "Champion ask", "impact": "high"},
        {"type": "positive", "signal": "ROI doc validated", "impact": "high"},
    ):
        client.post(
            f"/api/v1/accounts/{siemens}/signals",
            headers=_auth(mint_jwt(admin)),
            json=sig,
        )

    boosted = client.get(
        f"/api/v1/accounts/{siemens}/appetite-score",
        headers=_auth(mint_jwt(admin)),
    ).json()
    assert boosted["breakdown"]["sig_pts"] == 25
    assert boosted["score"] >= baseline["score"]

    # Pile on critical signals → 0 pts.
    for sig in (
        {"type": "critical", "signal": "Escalation A", "impact": "critical"},
        {"type": "critical", "signal": "Escalation B", "impact": "critical"},
        {"type": "critical", "signal": "Escalation C", "impact": "critical"},
        {"type": "critical", "signal": "Escalation D", "impact": "critical"},
        {"type": "critical", "signal": "Escalation E", "impact": "critical"},
        {"type": "critical", "signal": "Escalation F", "impact": "critical"},
    ):
        client.post(
            f"/api/v1/accounts/{siemens}/signals",
            headers=_auth(mint_jwt(admin)),
            json=sig,
        )

    crisis = client.get(
        f"/api/v1/accounts/{siemens}/appetite-score",
        headers=_auth(mint_jwt(admin)),
    ).json()
    assert crisis["breakdown"]["sig_pts"] == 0


# ============================================================
# Activities CRUD + soft delete
# ============================================================


def test_activity_log_and_delete_hides(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    admin = seeded_users["admin"]
    _wipe(client, admin, siemens)

    r = client.post(
        f"/api/v1/accounts/{siemens}/activities",
        headers=_auth(mint_jwt(admin)),
        json={
            "type": "csm_call",
            "title": "QBR check-in",
            "summary": "Walked through Phase 1 metrics. Next QBR in 4 weeks.",
        },
    )
    assert r.status_code == 201
    aid = r.json()["id"]

    r = client.delete(
        f"/api/v1/activities/{aid}", headers=_auth(mint_jwt(admin))
    )
    assert r.status_code == 204

    r = client.get(
        f"/api/v1/accounts/{siemens}/activities",
        headers=_auth(mint_jwt(admin)),
    )
    assert not any(a["id"] == aid for a in r.json()["items"])


# ============================================================
# RBAC
# ============================================================


def test_solutioning_manager_cannot_write_signals(
    client: TestClient, seeded_users: dict
) -> None:
    siemens = _find_id(client, seeded_users["admin"], "siemens")
    sol = seeded_users["solutioning_manager"]
    r = client.post(
        f"/api/v1/accounts/{siemens}/signals",
        headers=_auth(mint_jwt(sol)),
        json={"type": "neutral", "signal": "nope"},
    )
    assert r.status_code == 403


def test_csm_can_log_activity_on_own_account(
    client: TestClient, seeded_users: dict
) -> None:
    mondelez = _find_id(client, seeded_users["admin"], "mondelez")
    csm = seeded_users["csm"]
    r = client.post(
        f"/api/v1/accounts/{mondelez}/activities",
        headers=_auth(mint_jwt(csm)),
        json={"type": "csm_call", "title": "Weekly sync"},
    )
    assert r.status_code == 201
