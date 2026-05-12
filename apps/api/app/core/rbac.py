"""Role-based access control — aligned to Roles_Access_Matrix_Reviewed_05072026.xlsx.

The Excel file is the single source of truth. When BRD §3.2 narrative conflicts
with the matrix, the matrix wins.

Three walls of enforcement:
  1) Frontend hides actions the user can't perform (via /me permissions).
  2) FastAPI route deps re-check (`require_role`, `require_account_access`).
  3) Postgres RLS policies (third wall — even with bugs above, DB rejects).
"""

from typing import Annotated

from fastapi import Depends

from app.core.deps import CurrentUser, ForbiddenError
from app.models.user import User
from app.schemas.user import Permissions

# ============================================================
# Role groups
# ============================================================

# Admins with edit-anywhere access (matrix: F on Account List, F on most functions).
GLOBAL_ADMIN_ROLES: frozenset[str] = frozenset({"admin", "cs_director", "vp_csm"})

# Read-only-everywhere roles (matrix: V across most functions).
GLOBAL_READER_ROLES: frozenset[str] = frozenset({"vp_sales", "vp_solutioning", "vp_inside_sales"})

# Solutioning roles — F (all) on Contacts, MOM, VPD; V on Engagement Info / Value Def / Goals.
SOLUTIONING_ROLES: frozenset[str] = frozenset({"solutioning_manager", "vp_solutioning"})

# Inside-sales roles — F (own) on most functions for the manager; VP is read-only.
INSIDE_SALES_ROLES: frozenset[str] = frozenset({"inside_sales_manager", "vp_inside_sales"})

CSM_ROLES: frozenset[str] = frozenset({"csm", "cs_team_manager"})

ALL_ROLES: frozenset[str] = frozenset({
    "csm", "cs_team_manager", "cs_director", "vp_csm",
    "commercial_owner", "vp_sales",
    "solutioning_manager", "vp_solutioning",
    "inside_sales_manager", "vp_inside_sales",
    "admin",
})

# Roles that can view the audit log (matrix: CS Director, VP — CSM, VP — Sales,
# VP — Solutioning, VP — Inside Sales, Admin). Q6 confirmed: "all".
AUDIT_VIEWER_ROLES: frozenset[str] = frozenset({
    "admin", "cs_director", "vp_csm", "vp_sales", "vp_solutioning", "vp_inside_sales",
})


# ============================================================
# Predicates (boolean helpers — used in routes + /me permissions)
# ============================================================


def is_global_admin(role: str) -> bool:
    return role in GLOBAL_ADMIN_ROLES


def is_global_reader(role: str) -> bool:
    return role in GLOBAL_READER_ROLES


# Section-specific view predicates — mirror the matrix exactly.

def can_view_solutioning(role: str) -> bool:
    """Solutioning Documents (VPD)."""
    return role in (
        GLOBAL_ADMIN_ROLES
        | GLOBAL_READER_ROLES
        | SOLUTIONING_ROLES
        | CSM_ROLES
        | {"commercial_owner", "inside_sales_manager"}
    )


def can_view_inside_sales(role: str) -> bool:
    return role in (
        GLOBAL_ADMIN_ROLES | GLOBAL_READER_ROLES | INSIDE_SALES_ROLES
    )


def can_view_admin_panel(role: str) -> bool:
    return role == "admin"


def can_manage_users(role: str) -> bool:
    return role == "admin"


def can_view_audit_log(role: str) -> bool:
    return role in AUDIT_VIEWER_ROLES


def can_bulk_import(role: str) -> bool:
    """Bulk Import (CSV) — matrix: CS Director + VP — CSM + Admin only."""
    return role in {"admin", "cs_director", "vp_csm"}


def can_reassign_account_owner(role: str) -> bool:
    """Re-assign owner = admin only (matrix note)."""
    return role == "admin"


def can_create_account(role: str) -> bool:
    """Create new account — global admins only (admin / cs_director / vp_csm).

    Matrix doesn't list "Create Account" explicitly; we match the closest
    bucket ("Manage Accounts" → F for global admins, V for everyone else).
    """
    return role in GLOBAL_ADMIN_ROLES


def can_manage_users_role(role: str) -> bool:
    """Invite/edit/deactivate users — admin only (matrix Manage Users = admin)."""
    return role == "admin"


# ============================================================
# Section-specific WRITE predicates
#
# Matrix legend:
#   F = full access; V = view-only; - = no access.
# (own) means: the row's csm_user_id (or co_user_id) is the caller.
# (team) means: the row's csm is in caller's team (users.team_id).
# (all) means: any row.
# ============================================================


def can_write_engagement(role: str, *, is_assigned: bool, is_team: bool) -> bool:
    """Pre-Sales Engagement Info — matrix: F (own) | F (team) | F (all) for CS / Inside Sales."""
    if is_global_admin(role):
        return True
    if role == "csm":
        return is_assigned
    if role == "cs_team_manager":
        return is_team
    if role == "inside_sales_manager":
        return is_assigned   # F (own) per matrix
    return False  # solutioning_manager: V; commercial_owner: V; VPs: V; etc.


def can_write_contacts(role: str, *, is_assigned: bool, is_team: bool) -> bool:
    """Client Contacts — matrix: solutioning_manager F (all)."""
    if is_global_admin(role):
        return True
    if role == "solutioning_manager":
        return True
    if role == "csm":
        return is_assigned
    if role == "cs_team_manager":
        return is_team
    if role == "inside_sales_manager":
        return is_assigned
    return False


def can_write_solutioning(role: str, *, is_assigned: bool, is_team: bool) -> bool:
    """AK03.d Solutioning structured fields — matrix table row "Solutioning Documents":
    F (all) for Solutioning Manager + global admins; everyone else V.
    """
    if is_global_admin(role):
        return True
    if role == "solutioning_manager":
        return True
    return False


def can_write_cs_onboarding(role: str, *, is_assigned: bool, is_team: bool) -> bool:
    """CS Onboarding (Entry type + stakeholder map + handover checklist).

    Same write set as engagement — this is CSM territory. The Sales Hand-off
    role (commercial_owner / vp_sales) can VIEW but doesn't fill these in;
    pre-signed accounts haven't been handed to a CSM yet anyway.
    """
    if is_global_admin(role):
        return True
    if role == "csm":
        return is_assigned
    if role == "cs_team_manager":
        return is_team
    if role == "inside_sales_manager":
        return is_assigned
    return False


def can_write_sales_handoff(role: str, *, is_assigned: bool, is_team: bool) -> bool:
    """Sales Hand-off context (sh_* fields + handoff doc upload).

    Pre-signing: editable by anyone with engagement-write OR solutioning-write
    OR the Commercial Owner on this account OR VP Sales. The handoff is a
    collaborative artifact between Pre-Sales, Solutioning, and Sales.
    """
    if is_global_admin(role):
        return True
    if role in {"solutioning_manager", "vp_sales", "vp_inside_sales", "inside_sales_manager"}:
        return True
    if role == "commercial_owner":
        return is_assigned
    if role == "csm":
        return is_assigned
    if role == "cs_team_manager":
        return is_team
    return False


def can_sign_account(role: str, *, is_assigned: bool, is_team: bool) -> bool:
    """Capture the signing event (POST /accounts/:id/sign).

    Tighter than handoff edits: only Commercial Owner on this account, VP
    Sales / VP Inside Sales, Inside Sales Manager (own), and global admins.
    Solutioning + CSM cannot sign — that's a Sales / CO responsibility.
    """
    if is_global_admin(role):
        return True
    if role in {"vp_sales", "vp_inside_sales"}:
        return True
    if role == "commercial_owner":
        return is_assigned
    if role == "inside_sales_manager":
        return is_assigned
    return False


def can_unlock_signing(role: str) -> bool:
    """Re-open the signing gate. Restricted to global admins so changes to
    a signed contract are visible in the audit log under an admin user."""
    return is_global_admin(role)


def can_write_documents(role: str, *, is_assigned: bool, is_team: bool, kind: str) -> bool:
    """Meeting Records (MOM) and Solutioning Documents (VPD).

    MOM matrix: F (own/team/all) for CS roles + Solutioning Manager F (all).
    VPD matrix: only CS Director / VP — CSM / Solutioning Manager / Admin write.
                CSM = V; CS Team Manager = V (team); Inside Sales = V.
    """
    if is_global_admin(role):
        return True
    if role == "solutioning_manager":
        return True
    if kind == "vpd":
        # Only globals + solutioning_manager can write VPDs (matrix V for everyone else).
        return False
    # MOM and other doc kinds — same as MOM rules.
    if role == "csm":
        return is_assigned
    if role == "cs_team_manager":
        return is_team
    if role == "inside_sales_manager":
        return is_assigned
    return False


# Account-level visibility / editability (used by AK01 list rendering).

def can_view_account(role: str, *, is_assigned: bool, is_team: bool) -> bool:
    if role == "commercial_owner":
        return is_assigned   # CO sees only own portfolio (matrix: V (own portfolio))
    return role in (
        GLOBAL_ADMIN_ROLES | GLOBAL_READER_ROLES | CSM_ROLES
        | SOLUTIONING_ROLES | INSIDE_SALES_ROLES
    )


def can_edit_account(role: str, *, is_assigned: bool, is_team: bool) -> bool:
    """Edit on the Account row itself (renames, owner change, etc.).

    Matrix: only admin "F (all + reassign)" plus cs_director / vp_csm "F (all)".
    CSM/CS-TM also flagged as F on their scope, so they can edit-as-owner.
    """
    if is_global_admin(role):
        return True
    if role == "csm":
        return is_assigned
    if role == "cs_team_manager":
        return is_team
    return False


def permissions_for(role: str) -> Permissions:
    """Capability snapshot returned by /api/v1/me — used by frontend to gate UI."""
    return Permissions(
        is_global_admin=is_global_admin(role),
        is_global_reader=is_global_reader(role),
        can_view_solutioning=can_view_solutioning(role),
        can_view_inside_sales=can_view_inside_sales(role),
        can_view_admin_panel=can_view_admin_panel(role),
        can_manage_users=can_manage_users(role),
    )


# ============================================================
# FastAPI dependency factories
# ============================================================


def require_role(*allowed_roles: str):
    """Dependency factory — 403 unless caller's role is in allowed_roles."""
    allowed = frozenset(allowed_roles)
    if not allowed.issubset(ALL_ROLES):
        unknown = allowed - ALL_ROLES
        raise ValueError(f"Unknown role(s) in require_role: {unknown}")

    async def _dep(user: CurrentUser) -> User:
        if user.role not in allowed:
            raise ForbiddenError(f"Role '{user.role}' is not permitted on this resource")
        return user

    return _dep


def require_global_admin():
    return require_role(*GLOBAL_ADMIN_ROLES)


def require_admin():
    return require_role("admin")
