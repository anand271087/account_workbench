"""M14 — CS Onboarding (Phase 5a) schemas.

Three blocks on one record, all keyed by account_id:
  * Entry — cs_entry_type ('A'|'B'), plus the Entry-B baseline text fields
  * Handover Checklist — CSM-side 4-item dict (mirrors handover_quality_check
    on the Sales side; intentionally separate to support a two-sided handshake)
  * Stakeholder Map — 3 mandatory roles (commercial / champion / category),
    each {name, email, phone}

Goal Validation & Alignment (Phase 5b) lands in a separate module so the
relational shape there doesn't bloat this file.
"""

from __future__ import annotations

from typing import Literal
from uuid import UUID

from pydantic import AliasChoices, BaseModel, ConfigDict, Field

CSEntryType = Literal["A", "B"]

# Three canonical stakeholder roles. The dict on the wire is open-ended,
# but the UI only renders these three.
STAKEHOLDER_ROLES = ("commercial", "champion", "category")


class Stakeholder(BaseModel):
    """One person on the CS stakeholder map. All three fields optional so
    a partially-filled-in row still validates — the UI shows the missing
    pieces as warnings rather than blocking save."""

    name: str | None = Field(None, max_length=200)
    # EmailStr would be strict, but the prototype lets CSMs type partial
    # info (e.g. just a name early on). Keep it permissive at the schema
    # layer; format-validate in the UI.
    email: str | None = Field(None, max_length=320)
    phone: str | None = Field(None, max_length=40)


class CSOnboardingOut(BaseModel):
    """Returned from GET /accounts/:id/cs-onboarding."""

    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    account_id: UUID = Field(
        validation_alias=AliasChoices("account_id", "id"),
    )

    cs_entry_type: CSEntryType | None = None
    cs_entry_b_context: str | None = None
    cs_entry_b_goals: str | None = None

    cs_handover_checklist: dict[str, bool] = Field(default_factory=dict)
    cs_stakeholders: dict[str, Stakeholder] = Field(default_factory=dict)

    # Convenience derived flag — true once the CS Onboarding tab should
    # show its inner content (rather than just the Entry picker).
    activated: bool = False

    is_editable: bool = False


class CSOnboardingUpdate(BaseModel):
    """Whole-document PATCH. Caller sends only the keys it's changing.

    cs_handover_checklist + cs_stakeholders merge into the existing dict
    in the route handler (so two users editing different roles / items
    don't race). To CLEAR a stakeholder, post the role with all fields
    explicitly null.
    """

    cs_entry_type: CSEntryType | None = None
    cs_entry_b_context: str | None = Field(None, max_length=8000)
    cs_entry_b_goals: str | None = Field(None, max_length=8000)

    cs_handover_checklist: dict[str, bool] | None = None
    cs_stakeholders: dict[str, Stakeholder] | None = None
