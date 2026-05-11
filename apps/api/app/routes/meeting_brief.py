"""M12 — Pre-Meeting Brief (MOM) endpoints.

GET returns a blank brief if no row exists yet, so the form renders before
the first save. PATCH is whole-document (caller sends only changed keys).
DELETE clears the entire brief — used by the "reset / new meeting" action.

Write permission mirrors engagement edits (Pre-Sales / SDR / Solutioning /
admins). View follows the standard account view-scope.
"""

from datetime import date, datetime, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.core.rbac import can_view_account, can_write_engagement, can_write_solutioning
from app.db.session import get_db
from app.models.account import Account
from app.models.meeting_brief import MeetingBrief
from app.routes.accounts import _team_member_ids
from app.schemas.meeting_brief import MeetingBriefOut, MeetingBriefUpdate

router = APIRouter(prefix="/api/v1/accounts", tags=["meeting_brief"])


def _can_write_brief(role: str, *, is_assigned: bool, is_team: bool) -> bool:
    """Brief writes follow Pre-Sales OR Solutioning rules — both teams
    prep meetings. Matches the v20 prototype where the brief is on the
    Pre-Sales tab but the Solutioning team also fills it in."""
    return (
        can_write_engagement(role, is_assigned=is_assigned, is_team=is_team)
        or can_write_solutioning(role, is_assigned=is_assigned, is_team=is_team)
    )


async def _scope(db: AsyncSession, user, account_id: UUID) -> tuple[Account, bool, bool]:
    from app.core.scope import get_account_row

    acc = await get_account_row(db, account_id)
    is_assigned = (acc.csm_user_id == user.id) or (acc.co_user_id == user.id)
    team_ids = await _team_member_ids(db, user) if user.role == "cs_team_manager" else set()
    is_team = acc.csm_user_id in team_ids if team_ids else False
    if not can_view_account(user.role, is_assigned=is_assigned, is_team=is_team):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Forbidden on this account")
    return acc, is_assigned, is_team


def _blank_brief(account_id: UUID) -> MeetingBrief:
    """Return an in-memory blank brief — used for the first-render GET."""
    return MeetingBrief(
        account_id=account_id,
        company_snapshot=[],
        call_timer=[],
        attendees=[],
        minefields=[],
        objectives=[],
        discovery_questions=[],
        value_anchors=[],
        email_insights=[],
        public_signals=[],
        news=[],
        annual_reports=[],
        closing_scenarios=[],
        cheat_sheet_never_say=[],
        cheat_sheet_opening_asks=[],
        updated_at=datetime.now(timezone.utc),
    )


@router.get("/{account_id}/meeting-brief", response_model=MeetingBriefOut)
async def get_brief(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> MeetingBriefOut:
    _, is_assigned, is_team = await _scope(db, user, account_id)

    row = (
        await db.execute(
            select(MeetingBrief).where(MeetingBrief.account_id == account_id)
        )
    ).scalar_one_or_none()
    if row is None:
        row = _blank_brief(account_id)

    out = MeetingBriefOut.model_validate(row)
    out.is_editable = _can_write_brief(
        user.role, is_assigned=is_assigned, is_team=is_team
    )
    return out


@router.patch("/{account_id}/meeting-brief", response_model=MeetingBriefOut)
async def patch_brief(
    account_id: Annotated[UUID, Path()],
    body: MeetingBriefUpdate,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> MeetingBriefOut:
    _, is_assigned, is_team = await _scope(db, user, account_id)
    if not _can_write_brief(user.role, is_assigned=is_assigned, is_team=is_team):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Your role cannot edit the meeting brief"
        )

    row = (
        await db.execute(
            select(MeetingBrief).where(MeetingBrief.account_id == account_id)
        )
    ).scalar_one_or_none()
    if row is None:
        row = MeetingBrief(account_id=account_id)
        db.add(row)

    # mode="json" so nested pydantic models become plain dicts/lists ready
    # for JSONB. Side effect: scalar dates become ISO strings — convert
    # back before letting asyncpg bind them to the DATE column.
    payload = body.model_dump(exclude_unset=True, mode="json")
    if "call_date" in payload and isinstance(payload["call_date"], str):
        payload["call_date"] = date.fromisoformat(payload["call_date"])
    for field, value in payload.items():
        setattr(row, field, value)
    row.updated_at = datetime.now(timezone.utc)
    row.updated_by = user.id

    await db.commit()
    await db.refresh(row)

    out = MeetingBriefOut.model_validate(row)
    out.is_editable = True
    return out


@router.delete("/{account_id}/meeting-brief", status_code=204)
async def delete_brief(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    """Drop the brief entirely — used by the 'new meeting' / reset button."""
    _, is_assigned, is_team = await _scope(db, user, account_id)
    if not _can_write_brief(user.role, is_assigned=is_assigned, is_team=is_team):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Your role cannot delete the meeting brief"
        )

    row = (
        await db.execute(
            select(MeetingBrief).where(MeetingBrief.account_id == account_id)
        )
    ).scalar_one_or_none()
    if row is not None:
        await db.delete(row)
        await db.commit()
    return Response(status_code=204)
