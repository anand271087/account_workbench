"""M20 — Success Metric tests (CRUD + value log + status engine + RBAC)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.schemas.metric import derive_status

from .conftest import mint_jwt


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _find_id(client: TestClient, admin_uid, slug: str) -> str:
    r = client.get(
        f"/api/v1/accounts?q={slug}", headers=_auth(mint_jwt(admin_uid))
    )
    return r.json()["items"][0]["id"]


def _clear_metrics(client: TestClient, admin_uid, account_id: str) -> None:
    """Soft-delete every active metric on the account so tests start clean."""
    r = client.get(
        f"/api/v1/accounts/{account_id}/metrics",
        headers=_auth(mint_jwt(admin_uid)),
    )
    for m in r.json().get("items", []):
        client.request(
            "DELETE",
            f"/api/v1/metrics/{m['id']}",
            headers=_auth(mint_jwt(admin_uid)),
            json={"reason": "test cleanup"},
        )


# ============================================================
# Status engine — pure unit tests
# ============================================================


def test_status_engine_quantitative():
    # ≥80% → green
    assert (
        derive_status(
            metric_type="quantitative",
            target_value="1000",
            current_value="900",
            status_override=None,
        )
        == "green"
    )
    # 50-79% → amber
    assert (
        derive_status(
            metric_type="quantitative",
            target_value="1000",
            current_value="600",
            status_override=None,
        )
        == "amber"
    )
    # <50% → red
    assert (
        derive_status(
            metric_type="quantitative",
            target_value="1000",
            current_value="200",
            status_override=None,
        )
        == "red"
    )
    # No current → grey
    assert (
        derive_status(
            metric_type="quantitative",
            target_value="1000",
            current_value=None,
            status_override=None,
        )
        == "grey"
    )
    # $-formatted values parse correctly
    assert (
        derive_status(
            metric_type="quantitative",
            target_value="$2M",
            current_value="$1.8M",
            status_override=None,
        )
        == "green"
    )


def test_status_engine_qualitative():
    for v, expected in [("High", "green"), ("Medium", "amber"), ("Low", "red")]:
        assert (
            derive_status(
                metric_type="qualitative",
                target_value="High",
                current_value=v,
                status_override=None,
            )
            == expected
        )


def test_status_engine_override_wins():
    assert (
        derive_status(
            metric_type="quantitative",
            target_value="1000",
            current_value="900",
            status_override="red",
        )
        == "red"
    )


# ============================================================
# CRUD + value log
# ============================================================


def test_create_and_list_metric(
    client: TestClient, seeded_users: dict
) -> None:
    mondelez = _find_id(client, seeded_users["admin"], "mondelez")
    admin = seeded_users["admin"]
    _clear_metrics(client, admin, mondelez)

    r = client.post(
        f"/api/v1/accounts/{mondelez}/metrics",
        headers=_auth(mint_jwt(admin)),
        json={
            "name": "Documented savings",
            "metric_type": "quantitative",
            "unit": "$",
            "target_value": "2000000",
        },
    )
    assert r.status_code == 201, r.text
    metric_id = r.json()["id"]
    assert r.json()["status"] == "grey"  # no current_value yet

    r = client.get(
        f"/api/v1/accounts/{mondelez}/metrics",
        headers=_auth(mint_jwt(admin)),
    )
    assert r.status_code == 200
    items = r.json()["items"]
    assert any(m["id"] == metric_id for m in items)


def test_log_value_updates_status_and_history(
    client: TestClient, seeded_users: dict
) -> None:
    mondelez = _find_id(client, seeded_users["admin"], "mondelez")
    admin = seeded_users["admin"]
    _clear_metrics(client, admin, mondelez)
    r = client.post(
        f"/api/v1/accounts/{mondelez}/metrics",
        headers=_auth(mint_jwt(admin)),
        json={
            "name": "Documented savings",
            "metric_type": "quantitative",
            "unit": "$",
            "target_value": "2000000",
        },
    )
    metric_id = r.json()["id"]

    # First log → green (1.8M of 2M target)
    r = client.post(
        f"/api/v1/metrics/{metric_id}/log",
        headers=_auth(mint_jwt(admin)),
        json={
            "value": "1800000",
            "source": "PO actuals validated by Jordan Mills",
            "note": "Q3 close",
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["current_value"] == "1800000"
    assert body["status"] == "green"
    assert len(body["log_entries"]) == 1
    assert body["log_entries"][0]["source"] == "PO actuals validated by Jordan Mills"

    # Second log → amber
    r = client.post(
        f"/api/v1/metrics/{metric_id}/log",
        headers=_auth(mint_jwt(admin)),
        json={"value": "1100000", "source": "Q4 revision"},
    )
    assert r.json()["status"] == "amber"
    assert len(r.json()["log_entries"]) == 2


def test_status_override_via_patch(
    client: TestClient, seeded_users: dict
) -> None:
    mondelez = _find_id(client, seeded_users["admin"], "mondelez")
    admin = seeded_users["admin"]
    _clear_metrics(client, admin, mondelez)
    r = client.post(
        f"/api/v1/accounts/{mondelez}/metrics",
        headers=_auth(mint_jwt(admin)),
        json={"name": "Adoption", "metric_type": "qualitative", "target_value": "High"},
    )
    metric_id = r.json()["id"]

    r = client.patch(
        f"/api/v1/metrics/{metric_id}",
        headers=_auth(mint_jwt(admin)),
        json={"status_override": "red"},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "red"


def test_soft_delete_requires_reason(
    client: TestClient, seeded_users: dict
) -> None:
    mondelez = _find_id(client, seeded_users["admin"], "mondelez")
    admin = seeded_users["admin"]
    _clear_metrics(client, admin, mondelez)
    r = client.post(
        f"/api/v1/accounts/{mondelez}/metrics",
        headers=_auth(mint_jwt(admin)),
        json={"name": "Tmp", "metric_type": "quantitative", "target_value": "100"},
    )
    metric_id = r.json()["id"]

    # Empty reason → 422 (Pydantic min_length=5)
    r = client.request(
        "DELETE",
        f"/api/v1/metrics/{metric_id}",
        headers=_auth(mint_jwt(admin)),
        json={"reason": ""},
    )
    assert r.status_code == 422

    # Real reason → 200
    r = client.request(
        "DELETE",
        f"/api/v1/metrics/{metric_id}",
        headers=_auth(mint_jwt(admin)),
        json={"reason": "duplicate of another metric"},
    )
    assert r.status_code == 200
    assert r.json()["deleted_reason"] == "duplicate of another metric"

    # Soft-deleted → not in default list
    r = client.get(
        f"/api/v1/accounts/{mondelez}/metrics",
        headers=_auth(mint_jwt(admin)),
    )
    assert not any(m["id"] == metric_id for m in r.json()["items"])


# ============================================================
# RBAC
# ============================================================


def test_solutioning_manager_cannot_create_metric(
    client: TestClient, seeded_users: dict
) -> None:
    mondelez = _find_id(client, seeded_users["admin"], "mondelez")
    sol_mgr = seeded_users["solutioning_manager"]
    r = client.post(
        f"/api/v1/accounts/{mondelez}/metrics",
        headers=_auth(mint_jwt(sol_mgr)),
        json={"name": "x", "metric_type": "quantitative", "target_value": "100"},
    )
    assert r.status_code == 403


def test_restore_is_admin_only(
    client: TestClient, seeded_users: dict
) -> None:
    mondelez = _find_id(client, seeded_users["admin"], "mondelez")
    admin = seeded_users["admin"]
    csm = seeded_users["csm"]
    _clear_metrics(client, admin, mondelez)
    r = client.post(
        f"/api/v1/accounts/{mondelez}/metrics",
        headers=_auth(mint_jwt(admin)),
        json={"name": "RestoreMe", "metric_type": "quantitative", "target_value": "100"},
    )
    metric_id = r.json()["id"]
    client.request(
        "DELETE",
        f"/api/v1/metrics/{metric_id}",
        headers=_auth(mint_jwt(admin)),
        json={"reason": "test"},
    )

    # CSM cannot restore
    r = client.post(
        f"/api/v1/metrics/{metric_id}/restore",
        headers=_auth(mint_jwt(csm)),
    )
    assert r.status_code == 403

    # Admin can
    r = client.post(
        f"/api/v1/metrics/{metric_id}/restore",
        headers=_auth(mint_jwt(admin)),
    )
    assert r.status_code == 200, r.text
    assert r.json()["deleted_at"] is None
