"""Business Review endpoints.

  POST   /accounts/:id/business-reviews/generate   Gather + render + persist
  GET    /accounts/:id/business-reviews            List past cycles
  GET    /business-reviews/:id                     Single row metadata (+html inline)
  GET    /business-reviews/:id/download?format=    Stream pdf|pptx|html
  DELETE /business-reviews/:id                     Admin-only

The renderer pipeline lives in services/business_review.py; routes do
the auth/scope work and hand off snapshot building.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, Query, status
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.core.rbac import (
    can_view_account,
    can_write_cs_onboarding,
    is_global_admin,
)
from app.db.session import get_db
from app.models.account import Account
from app.models.business_review import BusinessReview
from app.models.user import User
from app.routes.accounts import _team_member_ids
from app.schemas.business_review import (
    BRListResponse,
    BROut,
    GenerateBRRequest,
)
from app.services.business_review import (
    derive_period,
    gather_data,
    render_html,
    render_pdf,
    render_pptx,
)

account_router = APIRouter(prefix="/api/v1/accounts", tags=["business_reviews"])
br_router = APIRouter(prefix="/api/v1/business-reviews", tags=["business_reviews"])


async def _scope(db: AsyncSession, user, account_id: UUID) -> tuple[Account, bool, bool]:
    from app.core.scope import get_account_row

    acc = await get_account_row(db, account_id)
    is_assigned = (acc.csm_user_id == user.id) or (acc.co_user_id == user.id)
    team_ids = (
        await _team_member_ids(db, user) if user.role == "cs_team_manager" else set()
    )
    is_team = acc.csm_user_id in team_ids if team_ids else False
    if not can_view_account(user.role, is_assigned=is_assigned, is_team=is_team):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Forbidden on this account")
    return acc, is_assigned, is_team


def _serialise(row: BusinessReview, *, by_name: str | None = None) -> BROut:
    out = BROut.model_validate(row)
    out.generated_by_name = by_name
    return out


# ============================================================
# POST /accounts/:id/business-reviews/generate
# ============================================================


@account_router.post(
    "/{account_id}/business-reviews/generate",
    response_model=BROut,
    status_code=status.HTTP_201_CREATED,
)
async def generate_business_review(
    account_id: Annotated[UUID, Path()],
    body: GenerateBRRequest,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> BROut:
    acc, is_assigned, is_team = await _scope(db, user, account_id)
    # Generation gated on same write predicate as CS Onboarding (CSM on
    # own account + directors). The list/get/download endpoints stay on
    # view-gate.
    if not can_write_cs_onboarding(
        user.role, is_assigned=is_assigned, is_team=is_team
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Your role cannot generate a Business Review on this account",
        )

    try:
        period = derive_period(
            cadence=body.cadence,
            today=date.today(),
            contract_start=acc.contract_start,
            renewal_date=acc.gate_renewal_date,
            custom_start=body.period_start,
            custom_end=body.period_end,
            label_override=body.period_label,
        )
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))

    snapshot = await gather_data(
        db=db, account=acc, period=period, cadence=body.cadence
    )
    html = render_html(snapshot)
    pdf = render_pdf(html)
    pptx = render_pptx(snapshot)

    row = BusinessReview(
        account_id=account_id,
        cadence=body.cadence,
        period_label=period.label,
        period_start=period.start,
        period_end=period.end,
        generated_by=user.id,
        generated_at=datetime.now(timezone.utc),
        data_snapshot=snapshot,
        html=html,
        pdf=pdf or None,
        pptx=pptx or None,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _serialise(row, by_name=getattr(user, "full_name", None))


# ============================================================
# GET /accounts/:id/business-reviews — list past cycles
# ============================================================


@account_router.get("/{account_id}/business-reviews", response_model=BRListResponse)
async def list_business_reviews(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: int = Query(100, ge=1, le=500),
) -> BRListResponse:
    await _scope(db, user, account_id)

    rows = (
        await db.execute(
            select(BusinessReview)
            .where(BusinessReview.account_id == account_id)
            .order_by(BusinessReview.generated_at.desc())
            .limit(limit)
        )
    ).scalars().all()

    # Resolve generated_by → name in one batch query.
    user_ids = {r.generated_by for r in rows if r.generated_by}
    name_by_id: dict[UUID, str | None] = {}
    if user_ids:
        u_rows = (
            await db.execute(
                select(User.id, User.full_name).where(User.id.in_(user_ids))
            )
        ).all()
        name_by_id = {uid: name for uid, name in u_rows}

    items = [_serialise(r, by_name=name_by_id.get(r.generated_by)) for r in rows]
    return BRListResponse(items=items, total=len(items))


# ============================================================
# GET /business-reviews/:id — single row + inline html
# ============================================================


@br_router.get("/{br_id}", response_model=BROut)
async def get_business_review(
    br_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> BROut:
    row = (
        await db.execute(select(BusinessReview).where(BusinessReview.id == br_id))
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Business Review not found")
    await _scope(db, user, row.account_id)

    by_name: str | None = None
    if row.generated_by:
        u = (
            await db.execute(
                select(User.full_name).where(User.id == row.generated_by)
            )
        ).scalar_one_or_none()
        by_name = u
    return _serialise(row, by_name=by_name)


# ============================================================
# GET /business-reviews/:id/download?format=html|pdf|pptx
# ============================================================


@br_router.get("/{br_id}/download")
async def download_business_review(
    br_id: Annotated[UUID, Path()],
    format: Annotated[Literal["html", "pdf", "pptx"], Query()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    row = (
        await db.execute(select(BusinessReview).where(BusinessReview.id == br_id))
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Business Review not found")
    await _scope(db, user, row.account_id)

    safe_label = "".join(c if c.isalnum() or c in "-_." else "_" for c in row.period_label)
    base_name = f"BR_{safe_label}_{row.cadence}"

    if format == "html":
        return Response(
            content=row.html or "",
            media_type="text/html",
            headers={"Content-Disposition": f'inline; filename="{base_name}.html"'},
        )
    if format == "pdf":
        if not row.pdf:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "PDF not available — regenerate this BR (weasyprint may have been missing at the time of generation).",
            )
        return Response(
            content=bytes(row.pdf),
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{base_name}.pdf"'},
        )
    # pptx
    if not row.pptx:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "PPTX not available — regenerate this BR (python-pptx may have been missing at the time of generation).",
        )
    return Response(
        content=bytes(row.pptx),
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={"Content-Disposition": f'attachment; filename="{base_name}.pptx"'},
    )


# ============================================================
# DELETE /business-reviews/:id — admin only
# ============================================================


@br_router.delete("/{br_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_business_review(
    br_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Response:
    if not is_global_admin(user.role):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Only admins can delete a Business Review"
        )
    row = (
        await db.execute(select(BusinessReview).where(BusinessReview.id == br_id))
    ).scalar_one_or_none()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Business Review not found")
    await db.delete(row)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
