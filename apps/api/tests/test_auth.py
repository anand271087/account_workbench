"""F01 + F02 — auth + RBAC integration tests.

Mints JWTs locally with the same secret the server verifies with, so requests are
indistinguishable from a real Supabase login.
"""

from uuid import uuid4

from fastapi.testclient import TestClient

from .conftest import mint_jwt


# ============================================================
# /api/v1/me — happy path per role
# ============================================================


def test_me_no_token_401(client: TestClient) -> None:
    r = client.get("/api/v1/me")
    assert r.status_code == 401


def test_me_bad_signature_401(client: TestClient) -> None:
    bad = mint_jwt(uuid4(), secret="not-the-real-secret")
    r = client.get("/api/v1/me", headers={"Authorization": f"Bearer {bad}"})
    assert r.status_code == 401


def test_me_unknown_user_403(client: TestClient) -> None:
    """Valid signature but the sub isn't in public.users → 403."""
    token = mint_jwt(uuid4())
    r = client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 403


def test_me_admin(client: TestClient, seeded_users: dict) -> None:
    token = mint_jwt(seeded_users["admin"])
    r = client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    body = r.json()
    assert body["user"]["role"] == "admin"
    p = body["permissions"]
    assert p["is_global_admin"] is True
    assert p["can_view_admin_panel"] is True
    assert p["can_manage_users"] is True


def test_me_csm(client: TestClient, seeded_users: dict) -> None:
    token = mint_jwt(seeded_users["csm"])
    r = client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    body = r.json()
    assert body["user"]["role"] == "csm"
    p = body["permissions"]
    assert p["is_global_admin"] is False
    assert p["can_view_admin_panel"] is False
    assert p["can_manage_users"] is False


def test_me_solutioning_manager(client: TestClient, seeded_users: dict) -> None:
    token = mint_jwt(seeded_users["solutioning_manager"])
    r = client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    body = r.json()
    assert body["user"]["role"] == "solutioning_manager"
    p = body["permissions"]
    assert p["can_view_solutioning"] is True
    assert p["is_global_admin"] is False
    assert p["can_view_admin_panel"] is False


def test_me_vp_sales(client: TestClient, seeded_users: dict) -> None:
    """Matrix realign: VP — Sales is read-only across functions, not a global admin."""
    token = mint_jwt(seeded_users["vp_sales"])
    r = client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    body = r.json()
    assert body["user"]["role"] == "vp_sales"
    p = body["permissions"]
    assert p["is_global_admin"] is False
    assert p["is_global_reader"] is True
    assert p["can_view_admin_panel"] is False


def test_me_cs_director(client: TestClient, seeded_users: dict) -> None:
    token = mint_jwt(seeded_users["cs_director"])
    r = client.get("/api/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    body = r.json()
    assert body["user"]["role"] == "cs_director"
    p = body["permissions"]
    assert p["is_global_admin"] is True


# ============================================================
# Permission matrix unit tests (no HTTP) — every role evaluated
# ============================================================


def test_permissions_matrix() -> None:
    """Aligned to Roles_Access_Matrix_Reviewed_05072026.xlsx."""
    from app.core.rbac import permissions_for

    expected = {
        # Solutioning Documents (VPD) is V for CSMs/CO/IS Manager too — they need to read VPDs.
        "csm": {
            "is_global_admin": False, "is_global_reader": False,
            "can_view_solutioning": True, "can_view_inside_sales": False,
            "can_view_admin_panel": False, "can_manage_users": False,
        },
        "cs_team_manager": {
            "is_global_admin": False, "is_global_reader": False,
            "can_view_solutioning": True, "can_view_inside_sales": False,
            "can_view_admin_panel": False, "can_manage_users": False,
        },
        "cs_director": {
            "is_global_admin": True, "is_global_reader": False,
            "can_view_solutioning": True, "can_view_inside_sales": True,
            "can_view_admin_panel": False, "can_manage_users": False,
        },
        "vp_csm": {
            "is_global_admin": True, "is_global_reader": False,
            "can_view_solutioning": True, "can_view_inside_sales": True,
            "can_view_admin_panel": False, "can_manage_users": False,
        },
        "commercial_owner": {
            "is_global_admin": False, "is_global_reader": False,
            "can_view_solutioning": True, "can_view_inside_sales": False,
            "can_view_admin_panel": False, "can_manage_users": False,
        },
        "vp_sales": {  # MATRIX REALIGN: read-only-everywhere now.
            "is_global_admin": False, "is_global_reader": True,
            "can_view_solutioning": True, "can_view_inside_sales": True,
            "can_view_admin_panel": False, "can_manage_users": False,
        },
        "solutioning_manager": {
            "is_global_admin": False, "is_global_reader": False,
            "can_view_solutioning": True, "can_view_inside_sales": False,
            "can_view_admin_panel": False, "can_manage_users": False,
        },
        "vp_solutioning": {
            "is_global_admin": False, "is_global_reader": True,
            "can_view_solutioning": True, "can_view_inside_sales": True,
            "can_view_admin_panel": False, "can_manage_users": False,
        },
        "inside_sales_manager": {
            "is_global_admin": False, "is_global_reader": False,
            "can_view_solutioning": True, "can_view_inside_sales": True,
            "can_view_admin_panel": False, "can_manage_users": False,
        },
        "vp_inside_sales": {
            "is_global_admin": False, "is_global_reader": True,
            "can_view_solutioning": True, "can_view_inside_sales": True,
            "can_view_admin_panel": False, "can_manage_users": False,
        },
        "admin": {
            "is_global_admin": True, "is_global_reader": False,
            "can_view_solutioning": True, "can_view_inside_sales": True,
            "can_view_admin_panel": True, "can_manage_users": True,
        },
    }
    for role, expect in expected.items():
        p = permissions_for(role).model_dump()
        for k, v in expect.items():
            assert p[k] is v, f"role={role} key={k} expected={v} got={p[k]}"


def test_audit_viewer_roles() -> None:
    """Matrix Q6: VPs + CS Director + Admin can view audit log; others cannot."""
    from app.core.rbac import can_view_audit_log

    can = {"admin", "cs_director", "vp_csm", "vp_sales", "vp_solutioning", "vp_inside_sales"}
    cannot = {"csm", "cs_team_manager", "commercial_owner", "solutioning_manager", "inside_sales_manager"}
    for r in can:
        assert can_view_audit_log(r), f"{r} should view audit log"
    for r in cannot:
        assert not can_view_audit_log(r), f"{r} should NOT view audit log"


def test_bulk_import_roles() -> None:
    """Matrix: CS Director + VP — CSM + Admin only."""
    from app.core.rbac import can_bulk_import

    assert can_bulk_import("admin")
    assert can_bulk_import("cs_director")
    assert can_bulk_import("vp_csm")
    for r in ("vp_sales", "csm", "cs_team_manager", "solutioning_manager"):
        assert not can_bulk_import(r), f"{r} should not bulk import"


def test_reassign_admin_only() -> None:
    """Matrix note: Re-assign owner = admin only."""
    from app.core.rbac import can_reassign_account_owner

    assert can_reassign_account_owner("admin")
    for r in ("cs_director", "vp_csm", "vp_sales", "csm", "cs_team_manager"):
        assert not can_reassign_account_owner(r)


def test_require_role_unknown_raises() -> None:
    from app.core.rbac import require_role

    try:
        require_role("not_a_real_role")
    except ValueError as e:
        assert "Unknown role" in str(e)
    else:
        raise AssertionError("Expected ValueError")
