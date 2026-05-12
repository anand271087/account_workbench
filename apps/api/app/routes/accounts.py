"""AK01 — Account List + Reassign owner.

Per Roles_Access_Matrix_Reviewed_05072026.xlsx:
- CSM, CS Team Manager, Solutioning, Inside Sales, VPs, CS Director, VP — CSM, Admin: see ALL accounts.
- Commercial Owner: only their portfolio (`co_user_id == user.id`).
- Edit (`is_editable`): admin/cs_director/vp_csm always; CSM only own; CS Team Manager only team.

Performance target (BRD): <1.5s for 600 accounts.
"""

import re
from datetime import date, timedelta
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from pydantic import BaseModel
from sqlalchemy import asc, cast, desc, func, literal, or_, select, update
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.core.deps import CurrentUser
from app.core.rbac import (
    can_create_account,
    can_edit_account,
    can_reassign_account_owner,
    can_view_account,
    is_global_admin,
)
from app.db.session import get_db
from app.models.account import Account
from app.models.audit import AuditLog
from app.models.contact import ClientContact
from app.models.user import User
from app.schemas.account import AccountCreate, AccountListItem, AccountListResponse
from app.schemas.account_detail import AccountDetail, ActivityFeedResponse, ActivityItem

router = APIRouter(prefix="/api/v1/accounts", tags=["accounts"])


_SORT_COLUMNS: dict[str, object] = {
    "name": Account.name,
    "renewal_date": Account.renewal_date,
    "current_acv": Account.current_acv,
    "health_score": Account.health_score,
    "last_activity_at": Account.last_activity_at,
}


async def _team_member_ids(db: AsyncSession, user: User) -> set[UUID]:
    """Returns the set of user_ids on the same team as `user` (incl. user themselves).

    Cached for 60s — team membership rarely changes within a session and this
    runs on every request from a cs_team_manager.
    """
    from app.core.scope import get_team_member_ids_cached

    return await get_team_member_ids_cached(db, user)


@router.get("", response_model=AccountListResponse)
async def list_accounts(
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    q: str | None = Query(None, description="Search across name, slug, country, industry, CSM email, primary contact"),
    csm_user_id: UUID | None = Query(None),
    industry: str | None = Query(None),
    tier: str | None = Query(None),
    category: str | None = Query(None),
    region: str | None = Query(None),
    renewal_within_days: int | None = Query(
        None, ge=1, le=730, description="Only accounts whose renewal_date is within N days from today",
    ),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    sort: str = Query("name"),
    sort_dir: str = Query("asc"),
) -> AccountListResponse:
    sort_col = _SORT_COLUMNS.get(sort, Account.name)
    direction = desc if sort_dir.lower() == "desc" else asc

    csm_alias = aliased(User)
    co_alias = aliased(User)

    base = (
        select(
            Account,
            csm_alias.full_name.label("csm_full_name"),
            csm_alias.id.label("csm_id_join"),
            csm_alias.team_id.label("csm_team_id"),
            co_alias.full_name.label("co_full_name"),
            co_alias.id.label("co_id_join"),
        )
        .where(Account.deleted_at.is_(None))
        .outerjoin(csm_alias, csm_alias.id == Account.csm_user_id)
        .outerjoin(co_alias, co_alias.id == Account.co_user_id)
    )

    # Visibility scope (matrix-aligned).
    role = user.role
    if role == "commercial_owner":
        base = base.where(Account.co_user_id == user.id)
    elif (
        is_global_admin(role)
        or role in {"vp_sales", "vp_solutioning", "vp_inside_sales"}
        or role in {"csm", "cs_team_manager", "solutioning_manager", "inside_sales_manager"}
    ):
        pass  # see all
    else:
        base = base.where(False)

    # Search — BRD: name, account_id (via slug), CSM email, primary contact name.
    if q:
        like = f"%{q.lower()}%"
        # SPOC subquery: account_ids whose SPOC contact name matches the search.
        spoc_match = (
            select(ClientContact.account_id)
            .where(
                func.lower(ClientContact.name).like(like),
                ClientContact.deleted_at.is_(None),
            )
        )
        base = base.where(
            or_(
                func.lower(Account.name).like(like),
                func.lower(Account.slug).like(like),
                func.lower(Account.country).like(like),
                func.lower(Account.industry).like(like),
                func.lower(csm_alias.email).like(like),
                Account.id.in_(spoc_match),
            )
        )
    # Filters
    if csm_user_id is not None:
        base = base.where(Account.csm_user_id == csm_user_id)
    if industry:
        base = base.where(Account.industry == industry)
    if tier:
        base = base.where(Account.tier == tier)
    if category:
        base = base.where(Account.category == category)
    if region:
        base = base.where(Account.region == region)
    if renewal_within_days is not None:
        cutoff = date.today() + timedelta(days=renewal_within_days)
        base = base.where(
            Account.renewal_date.is_not(None),
            Account.renewal_date <= cutoff,
        )

    # Count (pre-pagination)
    count_stmt = select(func.count()).select_from(base.subquery())
    total = (await db.execute(count_stmt)).scalar_one()

    # Sort + paginate
    base = base.order_by(direction(sort_col), Account.name.asc())
    base = base.offset((page - 1) * page_size).limit(page_size)
    rows = (await db.execute(base)).all()

    # Resolve team member ids once (only relevant for cs_team_manager)
    team_ids = await _team_member_ids(db, user) if role == "cs_team_manager" else set()

    today = date.today()
    items: list[AccountListItem] = []
    for r in rows:
        a: Account = r[0]
        csm_id = r[2]
        is_assigned = (a.csm_user_id == user.id) or (a.co_user_id == user.id)
        is_team = csm_id in team_ids if team_ids else False
        editable = can_edit_account(user.role, is_assigned=is_assigned, is_team=is_team)
        days = (a.renewal_date - today).days if a.renewal_date else None

        items.append(
            AccountListItem(
                id=a.id, name=a.name, slug=a.slug,
                industry=a.industry, country=a.country, region=a.region,
                csm_user_id=a.csm_user_id, co_user_id=a.co_user_id,
                csm_full_name=r[1], co_full_name=r[4],
                category=a.category, tier=a.tier,
                account_type=a.account_type, segment=a.segment,
                current_acv=a.current_acv, target_acv=a.target_acv,
                renewal_date=a.renewal_date, days_to_renewal=days,
                health_score=a.health_score, last_activity_at=a.last_activity_at,
                is_editable=editable,
            )
        )

    return AccountListResponse(items=items, total=total, page=page, page_size=page_size)


# ============================================================
# Create account (M9 — admin / cs_director / vp_csm)
# ============================================================


_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slugify(name: str) -> str:
    """name → 'name', 'Acme Co' → 'acme-co'. Trims to 60 chars."""
    s = _SLUG_RE.sub("-", name.lower()).strip("-")
    return s[:60] or "account"


async def _unique_slug(db: AsyncSession, base: str) -> str:
    """Append `-2`, `-3`, ... until the slug is free."""
    candidate = base
    n = 1
    while True:
        existing = (
            await db.execute(select(Account.id).where(Account.slug == candidate))
        ).first()
        if existing is None:
            return candidate
        n += 1
        candidate = f"{base}-{n}"
        if n > 50:  # impractical safety guard
            raise HTTPException(
                status.HTTP_409_CONFLICT, f"Could not generate unique slug for '{base}'"
            )


@router.post("", response_model=AccountListItem, status_code=status.HTTP_201_CREATED)
async def create_account(
    body: AccountCreate,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AccountListItem:
    """Create a new account. Per matrix: admin / cs_director / vp_csm only.

    The slug is derived from `name` and uniqueified server-side. Frontend
    immediately navigates to `/accounts/<id>/overview` so the user can fill
    in engagement, contacts, documents, solutioning on the empty tabs.
    """
    if not can_create_account(user.role):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Your role cannot create accounts (admin / cs_director / vp_csm only)",
        )

    # Validate the assigned CSM is real + can own.
    new_csm = (
        await db.execute(
            select(User).where(User.id == body.csm_user_id, User.deleted_at.is_(None))
        )
    ).scalar_one_or_none()
    if new_csm is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Assigned CSM not found")
    if new_csm.role not in {"csm", "cs_team_manager"}:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Role '{new_csm.role}' cannot own an account; pick a CSM or CS Team Manager",
        )

    if body.co_user_id is not None:
        co = (
            await db.execute(
                select(User).where(User.id == body.co_user_id, User.deleted_at.is_(None))
            )
        ).scalar_one_or_none()
        if co is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Commercial Owner not found")

    if body.contract_start and body.contract_end and body.contract_start > body.contract_end:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "contract_start must be on or before contract_end"
        )

    slug = await _unique_slug(db, _slugify(body.name))

    acc = Account(
        name=body.name.strip(),
        slug=slug,
        industry=body.industry,
        country=body.country,
        region=body.region,
        csm_user_id=body.csm_user_id,
        co_user_id=body.co_user_id,
        category=body.category,
        tier=body.tier,
        account_type=body.account_type,
        segment=body.segment,
        current_acv=body.current_acv,
        target_acv=body.target_acv,
        contract_start=body.contract_start,
        contract_end=body.contract_end,
        renewal_date=body.renewal_date,
        health_score=body.health_score,
    )
    db.add(acc)
    await db.commit()
    await db.refresh(acc)

    # Return in list-item shape so the frontend can slot the row in directly.
    return await _get_one_as_listitem(db, acc.id, user)


# ============================================================
# Single account detail (AK02)
# ============================================================


@router.get("/{account_id}", response_model=AccountDetail)
async def get_account(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AccountDetail:
    """Single account record + computed fields for the AK02 Overview header.

    The route is open to anyone with view-scope on the account — RLS handles the
    bottom layer; we re-check via `can_view_account()` to return a friendly 403.
    """
    csm_alias = aliased(User)
    co_alias = aliased(User)

    row = (
        await db.execute(
            select(
                Account,
                csm_alias.full_name.label("csm_full_name"),
                csm_alias.id.label("csm_id_join"),
                csm_alias.team_id.label("csm_team_id"),
                co_alias.full_name.label("co_full_name"),
            )
            .where(Account.id == account_id, Account.deleted_at.is_(None))
            .outerjoin(csm_alias, csm_alias.id == Account.csm_user_id)
            .outerjoin(co_alias, co_alias.id == Account.co_user_id)
        )
    ).one_or_none()

    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")

    a: Account = row[0]
    csm_id = row[2]

    is_assigned = (a.csm_user_id == user.id) or (a.co_user_id == user.id)
    team_ids = await _team_member_ids(db, user) if user.role == "cs_team_manager" else set()
    is_team = csm_id in team_ids if team_ids else False

    if not can_view_account(user.role, is_assigned=is_assigned, is_team=is_team):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Forbidden on this account")

    today = date.today()
    return AccountDetail(
        id=a.id, name=a.name, slug=a.slug,
        industry=a.industry, region=a.region, country=a.country,
        csm_user_id=a.csm_user_id, co_user_id=a.co_user_id,
        csm_full_name=row[1], co_full_name=row[4],
        category=a.category, tier=a.tier,
        account_type=a.account_type, segment=a.segment,
        current_acv=a.current_acv, target_acv=a.target_acv,
        contract_start=a.contract_start, contract_end=a.contract_end,
        renewal_date=a.renewal_date,
        days_to_renewal=(a.renewal_date - today).days if a.renewal_date else None,
        health_score=a.health_score, last_activity_at=a.last_activity_at,
        created_at=a.created_at, updated_at=a.updated_at,
        is_editable=can_edit_account(user.role, is_assigned=is_assigned, is_team=is_team),
        # Sub-nav visibility — Sprint-1 roles can view all sub-tabs (matrix
        # Account Profile = V for everyone). Per-tab actions are still gated.
        can_view_pre_sales=True,
        can_view_contacts=True,
        can_view_documents=True,
        can_view_solutioning=True,
        handed_off_to_solutioning=a.handed_off_to_solutioning,
        handed_off_at=a.handed_off_at,
        handed_off_by=a.handed_off_by,
        # Signing gate snapshot — surfaced on AccountDetail so the frontend
        # nav can render the signed-or-not state without a second call.
        gate_signed=a.gate_signed,
        gate_signed_date=a.gate_signed_date,
        gate_renewal_date=a.gate_renewal_date,
        gate_bvd_due_date=a.gate_bvd_due_date,
        can_view_sales_handoff=True,
        # CS Onboarding (M14) — entry type drives the inner view; the tab
        # itself is always visible so the picker is reachable.
        cs_entry_type=a.cs_entry_type,
        can_view_cs_onboarding=True,
    )


# ============================================================
# Activity feed (AK02 Overview)
# ============================================================

# Tables whose audit-log rows roll up under this account in the activity feed.
_ACCOUNT_ROLLUP_TABLES = (
    "accounts",
    "account_engagement",
    "client_contacts",
    "documents",
    "account_assignments",
)


@router.get("/{account_id}/activity", response_model=ActivityFeedResponse)
async def get_account_activity(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
) -> ActivityFeedResponse:
    """Recent audit-log events scoped to a single account.

    Includes:
      - direct edits to the `accounts` row (row_id == account_id)
      - edits to child rows whose new_value/old_value JSONB carries
        `account_id == :account_id` (engagement, contacts, documents, assignments)
    Most-recent first. Page size 1-100.
    """
    # First confirm the caller can view the account at all.
    acc = (
        await db.execute(
            select(Account).where(Account.id == account_id, Account.deleted_at.is_(None))
        )
    ).scalar_one_or_none()
    if acc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")

    is_assigned = (acc.csm_user_id == user.id) or (acc.co_user_id == user.id)
    team_ids = await _team_member_ids(db, user) if user.role == "cs_team_manager" else set()
    is_team = acc.csm_user_id in team_ids if team_ids else False
    if not can_view_account(user.role, is_assigned=is_assigned, is_team=is_team):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Forbidden on this account")

    # Build the WHERE: own row OR a child-row reference via JSONB containment.
    import json as _json
    acct_jsonb = cast(literal(_json.dumps({"account_id": str(account_id)})), JSONB)
    json_match = AuditLog.new_value.op("@>")(acct_jsonb)

    user_alias = aliased(User)
    base = (
        select(AuditLog, user_alias.full_name.label("changed_by_full_name"))
        .where(
            AuditLog.table_name.in_(_ACCOUNT_ROLLUP_TABLES),
            (
                ((AuditLog.table_name == "accounts") & (AuditLog.row_id == account_id))
                | json_match
            ),
        )
        .outerjoin(user_alias, user_alias.id == AuditLog.changed_by_user_id)
    )

    # Count
    total = (await db.execute(select(func.count()).select_from(base.subquery()))).scalar_one()

    # Page + sort
    base = base.order_by(AuditLog.changed_at.desc()).offset((page - 1) * page_size).limit(page_size)
    rows = (await db.execute(base)).all()

    items = [
        ActivityItem(
            id=r[0].id,
            table_name=r[0].table_name,
            row_id=r[0].row_id,
            action=r[0].action,
            changed_by_user_id=r[0].changed_by_user_id,
            changed_by_full_name=r[1],
            changed_at=r[0].changed_at,
            field_name=r[0].field_name,
            old_value=r[0].old_value,
            new_value=r[0].new_value,
        )
        for r in rows
    ]
    return ActivityFeedResponse(items=items, total=total, page=page, page_size=page_size)


# ============================================================
# Reassign owner — admin-only (matrix: "Re-assign owner = admin only")
# ============================================================


class ReassignOwnerBody(BaseModel):
    csm_user_id: UUID


class BulkReassignBody(BaseModel):
    account_ids: list[UUID]
    csm_user_id: UUID


@router.patch("/{account_id}/owner", response_model=AccountListItem)
async def reassign_owner(
    account_id: Annotated[UUID, Path()],
    body: ReassignOwnerBody,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> AccountListItem:
    if not can_reassign_account_owner(user.role):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only admins can reassign account owners")

    # Confirm the new CSM exists, is active, and has a CSM-flavored role.
    new_csm = (
        await db.execute(select(User).where(User.id == body.csm_user_id, User.deleted_at.is_(None)))
    ).scalar_one_or_none()
    if new_csm is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Target user not found")
    if new_csm.role not in {"csm", "cs_team_manager"}:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"Target user role '{new_csm.role}' cannot own an account"
        )

    acc = (
        await db.execute(select(Account).where(Account.id == account_id, Account.deleted_at.is_(None)))
    ).scalar_one_or_none()
    if acc is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")

    await db.execute(
        update(Account).where(Account.id == account_id).values(csm_user_id=body.csm_user_id)
    )
    await db.commit()
    from app.core.scope import invalidate_account
    invalidate_account(account_id)

    # Reload + return as a list item shape for the UI to slot back into the table.
    return await _get_one_as_listitem(db, account_id, user)


@router.post("/bulk/reassign-owner")
async def bulk_reassign_owner(
    body: BulkReassignBody,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    """BRD §4.1 — admin/CS Director can bulk-reassign owners.

    Returns count of accounts updated. Validation is per-row, but the whole
    set commits in one transaction so failures abort everything.
    """
    if not can_reassign_account_owner(user.role):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only admins can reassign account owners")
    if not body.account_ids:
        return {"updated": 0}
    new_csm = (
        await db.execute(select(User).where(User.id == body.csm_user_id, User.deleted_at.is_(None)))
    ).scalar_one_or_none()
    if new_csm is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Target user not found")
    if new_csm.role not in {"csm", "cs_team_manager"}:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Target user role '{new_csm.role}' cannot own an account",
        )
    res = await db.execute(
        update(Account)
        .where(Account.id.in_(body.account_ids), Account.deleted_at.is_(None))
        .values(csm_user_id=body.csm_user_id)
    )
    await db.commit()
    from app.core.scope import invalidate_account
    for aid in body.account_ids:
        invalidate_account(aid)
    return {"updated": res.rowcount or 0}


@router.get("/export.csv")
async def export_accounts_csv(
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    q: str | None = Query(None),
    csm_user_id: UUID | None = Query(None),
    industry: str | None = Query(None),
    tier: str | None = Query(None),
    category: str | None = Query(None),
    region: str | None = Query(None),
    renewal_within_days: int | None = Query(None, ge=1, le=730),
):
    """CSV export of the current filtered list. BRD AC-5.

    Uses the same scope + filters as the list endpoint. Caps at 10k rows.
    """
    from io import StringIO
    import csv as csvlib

    from fastapi.responses import StreamingResponse

    csm_alias = aliased(User)
    co_alias = aliased(User)
    base = (
        select(
            Account,
            csm_alias.full_name.label("csm_full_name"),
            csm_alias.email.label("csm_email"),
            co_alias.full_name.label("co_full_name"),
        )
        .where(Account.deleted_at.is_(None))
        .outerjoin(csm_alias, csm_alias.id == Account.csm_user_id)
        .outerjoin(co_alias, co_alias.id == Account.co_user_id)
    )
    role = user.role
    if role == "commercial_owner":
        base = base.where(Account.co_user_id == user.id)
    elif (
        is_global_admin(role)
        or role in {"vp_sales", "vp_solutioning", "vp_inside_sales"}
        or role in {"csm", "cs_team_manager", "solutioning_manager", "inside_sales_manager"}
    ):
        pass
    else:
        base = base.where(False)

    if q:
        like = f"%{q.lower()}%"
        base = base.where(
            or_(
                func.lower(Account.name).like(like),
                func.lower(Account.slug).like(like),
                func.lower(Account.country).like(like),
                func.lower(Account.industry).like(like),
                func.lower(csm_alias.email).like(like),
            )
        )
    if csm_user_id is not None:
        base = base.where(Account.csm_user_id == csm_user_id)
    if industry:
        base = base.where(Account.industry == industry)
    if tier:
        base = base.where(Account.tier == tier)
    if category:
        base = base.where(Account.category == category)
    if region:
        base = base.where(Account.region == region)
    if renewal_within_days is not None:
        cutoff = date.today() + timedelta(days=renewal_within_days)
        base = base.where(Account.renewal_date.is_not(None), Account.renewal_date <= cutoff)

    base = base.order_by(Account.name.asc()).limit(10_000)
    rows = (await db.execute(base)).all()

    today = date.today()
    buf = StringIO()
    w = csvlib.writer(buf)
    w.writerow([
        "id", "slug", "name", "industry", "country", "region",
        "category", "tier", "account_type", "segment",
        "csm_full_name", "csm_email", "co_full_name",
        "current_acv", "target_acv",
        "renewal_date", "days_to_renewal",
        "health_score", "last_activity_at",
    ])
    for r in rows:
        a: Account = r[0]
        days = (a.renewal_date - today).days if a.renewal_date else ""
        w.writerow([
            str(a.id), a.slug or "", a.name, a.industry or "", a.country or "", a.region or "",
            a.category or "", a.tier or "", a.account_type or "", a.segment or "",
            r[1] or "", r[2] or "", r[3] or "",
            float(a.current_acv) if a.current_acv is not None else "",
            float(a.target_acv) if a.target_acv is not None else "",
            a.renewal_date.isoformat() if a.renewal_date else "",
            days,
            a.health_score if a.health_score is not None else "",
            a.last_activity_at.isoformat() if a.last_activity_at else "",
        ])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename=accounts-{today.isoformat()}.csv"
        },
    )


async def _get_one_as_listitem(db: AsyncSession, account_id: UUID, user: User) -> AccountListItem:
    csm_alias = aliased(User)
    co_alias = aliased(User)
    row = (
        await db.execute(
            select(
                Account,
                csm_alias.full_name.label("csm_full_name"),
                csm_alias.id.label("csm_id_join"),
                csm_alias.team_id.label("csm_team_id"),
                co_alias.full_name.label("co_full_name"),
            )
            .where(Account.id == account_id)
            .outerjoin(csm_alias, csm_alias.id == Account.csm_user_id)
            .outerjoin(co_alias, co_alias.id == Account.co_user_id)
        )
    ).one()
    a: Account = row[0]
    csm_id = row[2]
    today = date.today()
    is_assigned = (a.csm_user_id == user.id) or (a.co_user_id == user.id)
    team_ids = await _team_member_ids(db, user) if user.role == "cs_team_manager" else set()
    is_team = csm_id in team_ids if team_ids else False
    return AccountListItem(
        id=a.id, name=a.name, slug=a.slug,
        industry=a.industry, country=a.country, region=a.region,
        csm_user_id=a.csm_user_id, co_user_id=a.co_user_id,
        csm_full_name=row[1], co_full_name=row[4],
        category=a.category, tier=a.tier,
        account_type=a.account_type, segment=a.segment,
        current_acv=a.current_acv, target_acv=a.target_acv,
        renewal_date=a.renewal_date,
        days_to_renewal=(a.renewal_date - today).days if a.renewal_date else None,
        health_score=a.health_score, last_activity_at=a.last_activity_at,
        is_editable=can_edit_account(user.role, is_assigned=is_assigned, is_team=is_team),
    )


# ============================================================
# require_account_access (M4+)
# ============================================================


def require_account_access(*, write: bool = False):
    async def _dep(
        account_id: Annotated[UUID, Path()],
        user: CurrentUser,
        db: Annotated[AsyncSession, Depends(get_db)],
    ) -> Account:
        result = await db.execute(
            select(Account).where(Account.id == account_id, Account.deleted_at.is_(None))
        )
        acc = result.scalar_one_or_none()
        if acc is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Account not found")

        is_assigned = (acc.csm_user_id == user.id) or (acc.co_user_id == user.id)
        team_ids = await _team_member_ids(db, user) if user.role == "cs_team_manager" else set()
        is_team = acc.csm_user_id in team_ids if team_ids else False

        ok = (
            can_edit_account(user.role, is_assigned=is_assigned, is_team=is_team)
            if write
            else can_view_account(user.role, is_assigned=is_assigned, is_team=is_team)
        )
        if not ok:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Forbidden on this account")
        return acc

    return _dep
