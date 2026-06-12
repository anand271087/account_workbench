"""Account product roster — list + patch one cell.

  GET   /accounts/:id/products            list all 28 product flags
  PATCH /accounts/:id/products/:product_key  admin-only update

The shape on GET is always the full 28-row roster (filling in any
absent product_key with `purchased=None`) so the frontend can render
a uniform grid without dealing with missing keys.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Path, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.core.rbac import can_view_account, is_global_admin
from app.db.session import get_db
from app.models.account_product import AccountProduct
from app.routes.accounts import _team_member_ids
from app.services.account_import import ALL_PRODUCT_KEYS, PRODUCT_KEYS

router = APIRouter(prefix="/api/v1/accounts", tags=["account_products"])


class ProductRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    product_key: str
    label: str
    purchased: bool | None
    source: str | None = None
    updated_at: datetime | None = None


class ProductsResponse(BaseModel):
    account_id: UUID
    items: list[ProductRow]


class ProductUpdate(BaseModel):
    purchased: bool | None


# Label lookup — pretty name from the canonical Excel header.
_LABEL_BY_KEY: dict[str, str] = {pk: hdr for hdr, pk in PRODUCT_KEYS}


async def _scope(db: AsyncSession, user, account_id: UUID) -> None:
    from app.core.scope import get_account_row

    acc = await get_account_row(db, account_id)
    is_assigned = (acc.csm_user_id == user.id) or (acc.co_user_id == user.id)
    team_ids = (
        await _team_member_ids(db, user) if user.role == "cs_team_manager" else set()
    )
    is_team = acc.csm_user_id in team_ids if team_ids else False
    if not can_view_account(user.role, is_assigned=is_assigned, is_team=is_team):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Forbidden on this account")


@router.get("/{account_id}/products", response_model=ProductsResponse)
async def list_products(
    account_id: Annotated[UUID, Path()],
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ProductsResponse:
    await _scope(db, user, account_id)

    rows = (
        await db.execute(
            select(AccountProduct).where(AccountProduct.account_id == account_id)
        )
    ).scalars().all()
    by_key = {r.product_key: r for r in rows}

    # Always emit the canonical 28-row roster in catalogue order so the
    # frontend grid is deterministic.
    items: list[ProductRow] = []
    for product_key in ALL_PRODUCT_KEYS:
        row = by_key.get(product_key)
        items.append(ProductRow(
            product_key=product_key,
            label=_LABEL_BY_KEY.get(product_key, product_key),
            purchased=row.purchased if row else None,
            source=row.source if row else None,
            updated_at=row.updated_at if row else None,
        ))
    return ProductsResponse(account_id=account_id, items=items)


@router.patch(
    "/{account_id}/products/{product_key}", response_model=ProductRow
)
async def patch_product(
    account_id: Annotated[UUID, Path()],
    product_key: Annotated[str, Path()],
    body: ProductUpdate,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> ProductRow:
    """Update one product flag. Admin-only — changing what the account
    has bought is a commercial-truth edit, not a CSM-level edit."""
    await _scope(db, user, account_id)
    if not is_global_admin(user.role):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Only admin/cs_director can edit product roster",
        )
    if product_key not in ALL_PRODUCT_KEYS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Unknown product_key '{product_key}'. Known: {ALL_PRODUCT_KEYS}",
        )

    row = (
        await db.execute(
            select(AccountProduct).where(
                AccountProduct.account_id == account_id,
                AccountProduct.product_key == product_key,
            )
        )
    ).scalar_one_or_none()

    if row is None:
        row = AccountProduct(
            account_id=account_id,
            product_key=product_key,
            purchased=body.purchased,
            source="manual",
            updated_by=user.id,
            updated_at=datetime.now(timezone.utc),
        )
        db.add(row)
    else:
        row.purchased = body.purchased
        row.source = "manual"
        row.updated_by = user.id
        row.updated_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(row)
    return ProductRow(
        product_key=row.product_key,
        label=_LABEL_BY_KEY.get(row.product_key, row.product_key),
        purchased=row.purchased,
        source=row.source,
        updated_at=row.updated_at,
    )
