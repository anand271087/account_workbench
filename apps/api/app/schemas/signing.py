"""M13 — Signing gate schemas (Sales Hand-off & Signing).

Three Pydantic models:
  * SigningGateOut   — full snapshot of the gate, returned on GET / signing actions
  * SignAccountIn    — body for POST /accounts/:id/sign
  * UnlockSigningIn  — body for POST /accounts/:id/sign/unlock
  * HandoverChecklistUpdate — body for PATCH /accounts/:id/handover-checklist

The signing event itself is irreversible from the data side — once signed,
the gate stays signed; the "unlock" action just lets admins edit the
metadata (date, ACV, term) and reverts gate_signed to false until the
metadata is re-confirmed by Sales.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import AliasChoices, BaseModel, ConfigDict, Field


class SigningGateOut(BaseModel):
    """Returned from GET /accounts/:id/sign and the sign / unlock endpoints.

    Sources from the Account ORM whose PK is `id`; we expose it as
    `account_id` to keep the public API consistent with the other
    account-keyed payloads (engagement, solutioning, meeting_brief).
    """

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    account_id: UUID = Field(
        validation_alias=AliasChoices("account_id", "id"),
    )
    gate_signed: bool

    gate_signed_date: date | None
    gate_contract_acv: Decimal | None
    gate_contract_term: str | None
    gate_renewal_date: date | None
    gate_bvd_due_date: date | None

    gate_confirmed_by: UUID | None
    gate_confirmed_at: datetime | None
    # H41 — Display name of the user who confirmed signing. Resolved by the
    # route handler from gate_confirmed_by → users.full_name; None when no
    # one has signed yet or the user has been deleted.
    gate_confirmed_by_name: str | None = None

    gate_unlocked: bool
    gate_unlock_reason: str | None
    gate_unlocked_by: UUID | None
    gate_unlocked_at: datetime | None

    gate_contract_doc: str | None
    gate_contract_doc_at: date | None

    gate_contract_modules: list[str]
    gate_platform_tier: str | None
    gate_account_segment: str | None
    gate_subscribers: str | None

    handover_quality_check: dict

    # Capabilities so the frontend can render the right buttons without
    # re-deriving RBAC.
    can_sign: bool = False
    can_unlock: bool = False


class SignAccountIn(BaseModel):
    """Sales captures the signing event."""

    gate_signed_date: date
    gate_contract_acv: Decimal = Field(..., ge=0, le=Decimal("100000000"))
    gate_contract_term: str = Field(..., min_length=1, max_length=40)

    # Optional metadata bundled with the signing event so we don't need
    # a second PATCH right after.
    gate_contract_modules: list[str] | None = None
    gate_platform_tier: str | None = Field(None, max_length=80)
    gate_account_segment: str | None = Field(None, max_length=80)
    gate_subscribers: str | None = Field(None, max_length=200)


class UnlockSigningIn(BaseModel):
    """Admin/Director re-opens the gate. Reason is mandatory for audit."""

    reason: str = Field(..., min_length=10, max_length=600)


class HandoverChecklistUpdate(BaseModel):
    """Override the auto-detected handover quality check. Body is a small
    dict like {"savings": true, "stakeholders": false, ...}."""

    items: dict[str, bool] = Field(..., max_length=16)


class ContractDocUpdate(BaseModel):
    """Capture a filename + upload date for the signed contract doc.

    Actual file bytes go through Documents/Storage; this endpoint just
    records the reference so the gate card can render it.
    """

    gate_contract_doc: str | None = Field(None, max_length=400)
