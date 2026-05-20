"""M24 — Leadership view smoke tests.

Covers:
  * RBAC — CSM forbidden, admin allowed.
  * Shape — payload includes the 4 sections with the documented keys.
  * Renewal counts: total == sum of buckets.
"""

from fastapi.testclient import TestClient

from .conftest import mint_jwt


def _auth(tok: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {tok}"}


def test_leadership_view_forbidden_for_csm(
    client: TestClient, seeded_users: dict
) -> None:
    token = mint_jwt(seeded_users["csm"])
    r = client.get("/api/v1/leadership/portfolio", headers=_auth(token))
    assert r.status_code == 403, r.text


def test_leadership_view_admin_shape(
    client: TestClient, seeded_users: dict
) -> None:
    token = mint_jwt(seeded_users["admin"])
    r = client.get("/api/v1/leadership/portfolio", headers=_auth(token))
    assert r.status_code == 200, r.text
    body = r.json()

    # All four roll-ups present.
    for key in ("renewals", "value_delivered", "overdue_checkpoints", "open_red_flags"):
        assert key in body, f"missing {key} in payload"

    # Renewal counts sum to total.
    r_counts = body["renewals"]
    assert (
        r_counts["renewed"]
        + r_counts["at_risk"]
        + r_counts["not_renewed"]
        + r_counts["undecided"]
        == r_counts["total"]
    )

    # Value-delivered totals are numeric.
    vd = body["value_delivered"]
    for k in ("identified_musd", "committed_musd", "implemented_musd"):
        assert isinstance(vd[k], (int, float))

    # Open red flags is a list.
    assert isinstance(body["open_red_flags"], list)


def test_leadership_me_permission_flag(
    client: TestClient, seeded_users: dict
) -> None:
    """can_view_leadership flips with role — admin yes, csm no."""
    admin_token = mint_jwt(seeded_users["admin"])
    csm_token = mint_jwt(seeded_users["csm"])

    admin_me = client.get("/api/v1/me", headers=_auth(admin_token)).json()
    assert admin_me["permissions"]["can_view_leadership"] is True

    csm_me = client.get("/api/v1/me", headers=_auth(csm_token)).json()
    assert csm_me["permissions"]["can_view_leadership"] is False
