"""Schemas for the AK02 single-account view."""

from datetime import date, datetime
from decimal import Decimal
from typing import Any
from uuid import UUID

from pydantic import BaseModel


class AccountDetail(BaseModel):
    """Full account record for AK02 Overview tab.

    Includes the enriched fields (csm/co names, days_to_renewal, is_editable,
    is_visible_*) that the frontend needs to render the header + sub-nav.
    """

    id: UUID
    name: str
    slug: str

    industry: str | None
    region: str | None
    country: str | None

    csm_user_id: UUID | None
    co_user_id: UUID | None
    csm_full_name: str | None = None
    co_full_name: str | None = None

    category: str | None
    tier: str | None
    account_type: str | None
    segment: str | None

    current_acv: Decimal | None
    target_acv: Decimal | None

    contract_start: date | None
    contract_end: date | None
    renewal_date: date | None
    days_to_renewal: int | None = None

    health_score: int | None
    last_activity_at: datetime | None

    created_at: datetime
    updated_at: datetime

    is_editable: bool = False

    # Per-tab visibility — drives the sub-nav (matrix-driven)
    can_view_pre_sales: bool = True
    can_view_contacts: bool = True
    can_view_documents: bool = True
    can_view_solutioning: bool = True

    # Pre-Sales → Solutioning gate (BRD §4.3.c)
    handed_off_to_solutioning: bool = False
    handed_off_at: datetime | None = None
    handed_off_by: UUID | None = None

    model_config = {"from_attributes": True}


class ActivityItem(BaseModel):
    """One entry in an account's activity feed (derived from audit_log).

    BRD: "recent activity feed (last 5 events from audit_log)".
    """

    id: UUID
    table_name: str
    row_id: UUID | None
    action: str  # 'insert' | 'update' | 'delete'
    changed_by_user_id: UUID | None
    changed_by_full_name: str | None = None
    changed_at: datetime
    field_name: str | None
    old_value: Any | None
    new_value: Any | None

    model_config = {"from_attributes": True}


class ActivityFeedResponse(BaseModel):
    items: list[ActivityItem]
    total: int
    page: int
    page_size: int
