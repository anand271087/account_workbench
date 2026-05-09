"""Lookups for AK03.a — categories + geographies.

Per BRD §4.3.a: "if a category is missing, allow free-text 'Add new' — but must
be approved by Admin before it appears in the lookup."

Implementation:
- GET  /lookups/categories       — every authed user; includes pending (approved=false)
- POST /lookups/categories       — every authed user proposes; lands as approved=false
- POST /lookups/categories/:id/approve — admin only; flips to approved=true
- GET  /lookups/geographies      — every authed user
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import CurrentUser
from app.core.rbac import require_admin
from app.db.session import get_db
from app.schemas.lookup import CategoryOut, CategoryProposeRequest, GeographyOut

router = APIRouter(prefix="/api/v1/lookups", tags=["lookups"])

# Lookup tables don't have ORM models yet — small, read-mostly. Use core SQL.
from sqlalchemy import Column, MetaData, Table, Boolean, String, ForeignKey, text as sa_text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

_metadata = MetaData()
lookup_categories = Table(
    "lookup_categories", _metadata,
    Column("id", PG_UUID(as_uuid=True), primary_key=True),
    Column("name", String, unique=True, nullable=False),
    Column("parent_id", PG_UUID(as_uuid=True), ForeignKey("lookup_categories.id"), nullable=True),
    Column("approved", Boolean, nullable=False, server_default=sa_text("false")),
)

lookup_geographies = Table(
    "lookup_geographies", _metadata,
    Column("id", PG_UUID(as_uuid=True), primary_key=True),
    Column("name", String, unique=True, nullable=False),
    Column("region", String, nullable=False),
)


@router.get("/categories", response_model=list[CategoryOut])
async def list_categories(
    _user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    include_pending: bool = True,
) -> list[CategoryOut]:
    stmt = select(lookup_categories).order_by(lookup_categories.c.name.asc())
    if not include_pending:
        stmt = stmt.where(lookup_categories.c.approved.is_(True))
    rows = (await db.execute(stmt)).mappings().all()
    return [CategoryOut.model_validate(dict(r)) for r in rows]


@router.post("/categories", response_model=CategoryOut, status_code=status.HTTP_201_CREATED)
async def propose_category(
    body: CategoryProposeRequest,
    _user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CategoryOut:
    """Anyone authenticated can propose a category. Lands as approved=false."""
    # Reject if a category with the same name already exists (case-insensitive).
    existing = (
        await db.execute(
            select(lookup_categories).where(
                func_lower(lookup_categories.c.name) == body.name.lower()
            )
        )
    ).mappings().first()
    if existing:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Category '{body.name}' already exists (approved={existing['approved']})",
        )

    new_row = (
        await db.execute(
            lookup_categories.insert()
            .values(name=body.name, approved=False)
            .returning(*lookup_categories.c)
        )
    ).mappings().one()
    await db.commit()
    return CategoryOut.model_validate(dict(new_row))


@router.post(
    "/categories/{category_id}/approve",
    response_model=CategoryOut,
    dependencies=[Depends(require_admin())],
)
async def approve_category(
    category_id: UUID,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> CategoryOut:
    row = (
        await db.execute(
            lookup_categories.update()
            .where(lookup_categories.c.id == category_id)
            .values(approved=True)
            .returning(*lookup_categories.c)
        )
    ).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Category not found")
    await db.commit()
    return CategoryOut.model_validate(dict(row))


@router.delete(
    "/categories/{category_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_admin())],
)
async def reject_category(
    category_id: UUID,
    user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
    reason: str | None = None,
) -> None:
    """Reject (delete) a proposed category. Admin only.

    Only PENDING (approved=false) categories can be deleted — approved ones
    are referenced by `account_engagement.target_categories` and shouldn't
    silently disappear.

    The optional `reason` query param is written to `audit_log` so admins can
    later see why a proposal was killed (and who did it).
    """
    row = (
        await db.execute(
            select(lookup_categories).where(lookup_categories.c.id == category_id)
        )
    ).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Category not found")
    if row["approved"]:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Approved categories cannot be deleted (engagement rows may reference them).",
        )
    # Audit the rejection before we drop the row.
    from app.models.audit import AuditLog

    db.add(
        AuditLog(
            table_name="lookup_categories",
            row_id=category_id,
            action="delete",
            changed_by_user_id=user.id,
            field_name=None,
            old_value={"name": row["name"], "approved": False},
            new_value={
                "rejected": True,
                "name": row["name"],
                "reason": (reason or "").strip()[:500] or None,
            },
        )
    )
    await db.execute(
        lookup_categories.delete().where(lookup_categories.c.id == category_id)
    )
    await db.commit()


@router.get("/geographies", response_model=list[GeographyOut])
async def list_geographies(
    _user: CurrentUser,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> list[GeographyOut]:
    rows = (
        await db.execute(
            select(lookup_geographies).order_by(lookup_geographies.c.name.asc())
        )
    ).mappings().all()
    return [GeographyOut.model_validate(dict(r)) for r in rows]


# Tiny SQLA shim: lower(name) for case-insensitive uniqueness check
from sqlalchemy import func
def func_lower(col):
    return func.lower(col)
