"""AK01 — /api/v1/accounts tests, aligned to Roles_Access_Matrix_Reviewed_05072026.xlsx.

Demo data state (after migrations 0004 + 0005 + 0006):
- 4 accounts (Siemens, Mondelēz, Sanofi, Novo Nordisk).
- harish (csm) is csm_user_id on Siemens, Mondelēz, Novo Nordisk (3).
- csm2  (csm) is csm_user_id on Sanofi (1).
- harish, csm2, team.lead all on team "APAC CS Team".
- santosh (vp_sales) is co_user_id on all 4.
"""

from fastapi.testclient import TestClient

from .conftest import mint_jwt


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------- Auth ----------


def test_accounts_unauth_401(client: TestClient) -> None:
    r = client.get("/api/v1/accounts")
    assert r.status_code == 401


# ---------- Visibility (every role sees ALL 4 except commercial_owner) ----------


def test_admin_sees_all(client: TestClient, seeded_users: dict) -> None:
    r = client.get("/api/v1/accounts", headers=_auth(mint_jwt(seeded_users["admin"])))
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 4
    assert all(it["is_editable"] for it in body["items"])


def test_csm_sees_all_but_edits_only_own(client: TestClient, seeded_users: dict) -> None:
    """harish (csm) is csm on 3 of 4 → sees all 4, edit on 3, read-only on Sanofi."""
    r = client.get("/api/v1/accounts", headers=_auth(mint_jwt(seeded_users["csm"])))
    body = r.json()
    assert body["total"] == 4
    editable = {it["name"] for it in body["items"] if it["is_editable"]}
    readonly = {it["name"] for it in body["items"] if not it["is_editable"]}
    assert "Sanofi S.A." in readonly
    assert "Siemens Energy AG" in editable


def test_cs_team_manager_edits_team_accounts(client: TestClient, seeded_users: dict) -> None:
    """team.lead is cs_team_manager of APAC team. Both harish and csm2 are on the team
    so the manager can edit ALL 4 accounts."""
    r = client.get("/api/v1/accounts", headers=_auth(mint_jwt(seeded_users["cs_team_manager"])))
    body = r.json()
    assert body["total"] == 4
    assert all(it["is_editable"] for it in body["items"])  # all 4 belong to team


def test_solutioning_manager_sees_all_readonly_on_account(client: TestClient, seeded_users: dict) -> None:
    """Matrix: Account List for solutioning_manager = V (all R)."""
    r = client.get(
        "/api/v1/accounts", headers=_auth(mint_jwt(seeded_users["solutioning_manager"]))
    )
    body = r.json()
    assert body["total"] == 4
    assert not any(it["is_editable"] for it in body["items"])


def test_vp_sales_sees_all_readonly(client: TestClient, seeded_users: dict) -> None:
    """Matrix realign: VP — Sales is read-only across functions."""
    r = client.get("/api/v1/accounts", headers=_auth(mint_jwt(seeded_users["vp_sales"])))
    body = r.json()
    assert body["total"] == 4
    assert not any(it["is_editable"] for it in body["items"])


def test_cs_director_sees_all_editable(client: TestClient, seeded_users: dict) -> None:
    r = client.get("/api/v1/accounts", headers=_auth(mint_jwt(seeded_users["cs_director"])))
    body = r.json()
    assert body["total"] == 4
    assert all(it["is_editable"] for it in body["items"])


# ---------- Search & filters ----------


def test_search_by_name(client: TestClient, seeded_users: dict) -> None:
    r = client.get(
        "/api/v1/accounts?q=siemens", headers=_auth(mint_jwt(seeded_users["admin"]))
    )
    items = r.json()["items"]
    assert len(items) == 1 and items[0]["name"] == "Siemens Energy AG"


def test_search_by_industry(client: TestClient, seeded_users: dict) -> None:
    r = client.get(
        "/api/v1/accounts?q=pharma", headers=_auth(mint_jwt(seeded_users["admin"]))
    )
    assert r.json()["total"] == 2


def test_filter_tier(client: TestClient, seeded_users: dict) -> None:
    r = client.get(
        "/api/v1/accounts?tier=T1", headers=_auth(mint_jwt(seeded_users["admin"]))
    )
    body = r.json()
    assert body["total"] == 1 and body["items"][0]["name"] == "Siemens Energy AG"


def test_sort_acv_desc(client: TestClient, seeded_users: dict) -> None:
    r = client.get(
        "/api/v1/accounts?sort=current_acv&sort_dir=desc",
        headers=_auth(mint_jwt(seeded_users["admin"])),
    )
    items = r.json()["items"]
    assert items[0]["name"] == "Siemens Energy AG"


def test_invalid_sort_falls_back(client: TestClient, seeded_users: dict) -> None:
    r = client.get(
        "/api/v1/accounts?sort=__nope__", headers=_auth(mint_jwt(seeded_users["admin"]))
    )
    assert r.status_code == 200


def test_pagination(client: TestClient, seeded_users: dict) -> None:
    r = client.get(
        "/api/v1/accounts?page=1&page_size=2&sort=name",
        headers=_auth(mint_jwt(seeded_users["admin"])),
    )
    body = r.json()
    assert body["page"] == 1 and body["page_size"] == 2 and len(body["items"]) == 2
    assert body["total"] == 4


# ---------- Reassign owner ----------


def test_reassign_owner_admin_only(client: TestClient, seeded_users: dict) -> None:
    """Non-admins get 403; admin succeeds."""
    siemens_id = _find_account(client, seeded_users["admin"], "siemens")

    r = client.patch(
        f"/api/v1/accounts/{siemens_id}/owner",
        headers=_auth(mint_jwt(seeded_users["csm"])),
        json={"csm_user_id": str(seeded_users["csm"])},
    )
    assert r.status_code == 403

    # admin reassigns Siemens to csm2 (then back to harish to leave demo state intact)
    target_csm2 = seeded_users["csm"] if False else _user_by_email(client, seeded_users, "csm2@beroe-inc.com")
    target_harish = _user_by_email(client, seeded_users, "harish@beroe-inc.com")

    r = client.patch(
        f"/api/v1/accounts/{siemens_id}/owner",
        headers=_auth(mint_jwt(seeded_users["admin"])),
        json={"csm_user_id": str(target_csm2)},
    )
    assert r.status_code == 200
    assert r.json()["csm_user_id"] == str(target_csm2)

    # Restore demo state
    r = client.patch(
        f"/api/v1/accounts/{siemens_id}/owner",
        headers=_auth(mint_jwt(seeded_users["admin"])),
        json={"csm_user_id": str(target_harish)},
    )
    assert r.status_code == 200


def test_reassign_invalid_target_role(client: TestClient, seeded_users: dict) -> None:
    """Cannot reassign to an admin (not a CSM-flavored role)."""
    siemens_id = _find_account(client, seeded_users["admin"], "siemens")
    r = client.patch(
        f"/api/v1/accounts/{siemens_id}/owner",
        headers=_auth(mint_jwt(seeded_users["admin"])),
        json={"csm_user_id": str(seeded_users["admin"])},
    )
    assert r.status_code == 400


def test_reassign_unknown_account(client: TestClient, seeded_users: dict) -> None:
    target = _user_by_email(client, seeded_users, "harish@beroe-inc.com")
    r = client.patch(
        f"/api/v1/accounts/00000000-0000-0000-0000-000000000000/owner",
        headers=_auth(mint_jwt(seeded_users["admin"])),
        json={"csm_user_id": str(target)},
    )
    assert r.status_code == 404


# ---------- /api/v1/users — admin only ----------


def test_list_users_admin_only(client: TestClient, seeded_users: dict) -> None:
    r = client.get("/api/v1/users", headers=_auth(mint_jwt(seeded_users["admin"])))
    assert r.status_code == 200
    body = r.json()
    assert any(u["email"] == "harish@beroe-inc.com" for u in body)

    r = client.get("/api/v1/users", headers=_auth(mint_jwt(seeded_users["csm"])))
    assert r.status_code == 403


def test_list_users_filter_by_role(client: TestClient, seeded_users: dict) -> None:
    r = client.get(
        "/api/v1/users?role=csm", headers=_auth(mint_jwt(seeded_users["admin"]))
    )
    assert r.status_code == 200
    body = r.json()
    assert all(u["role"] == "csm" for u in body)
    assert len(body) >= 2  # harish + csm2


# ---------- Helpers ----------


def _find_account(client: TestClient, admin_uid, slug: str) -> str:
    r = client.get(f"/api/v1/accounts?q={slug}", headers=_auth(mint_jwt(admin_uid)))
    return r.json()["items"][0]["id"]


def _user_by_email(client: TestClient, seeded_users: dict, email: str) -> str:
    r = client.get("/api/v1/users", headers=_auth(mint_jwt(seeded_users["admin"])))
    for u in r.json():
        if u["email"] == email:
            return u["id"]
    raise AssertionError(f"User {email} not found")
