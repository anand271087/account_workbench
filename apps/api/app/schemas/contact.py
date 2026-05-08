"""AK03.b — client contact schemas. Aligned to BRD table 12."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field

ContactFunction = Literal["procurement", "supply_chain", "finance", "operations", "it", "other"]
ContactSeniority = Literal["cxo", "vp", "director", "manager", "other"]
ContactDecisionPower = Literal[
    "executive_sponsor", "influencer", "champion", "detractor", "unknown"
]


class ContactOut(BaseModel):
    id: UUID
    account_id: UUID
    name: str
    title: str | None
    email: str | None
    phone: str | None
    function: ContactFunction | None
    seniority: ContactSeniority | None
    decision_power: ContactDecisionPower | None
    notes: str | None
    is_spoc: bool
    is_sponsor: bool
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None = None

    model_config = {"from_attributes": True}


class ContactListResponse(BaseModel):
    items: list[ContactOut]
    total: int
    is_editable: bool = False


class ContactCreate(BaseModel):
    """BRD: name ≥3 chars, title ≥2, email unique-per-account, notes ≤500."""

    name: str = Field(..., min_length=3, max_length=200)
    title: str | None = Field(None, min_length=2, max_length=200)
    email: EmailStr | None = None
    phone: str | None = Field(None, max_length=64)
    function: ContactFunction | None = None
    seniority: ContactSeniority | None = None
    decision_power: ContactDecisionPower | None = None
    notes: str | None = Field(None, max_length=500)
    is_spoc: bool = False
    is_sponsor: bool = False


class ContactUpdate(BaseModel):
    """All fields optional — partial update."""

    name: str | None = Field(None, min_length=3, max_length=200)
    title: str | None = Field(None, min_length=2, max_length=200)
    email: EmailStr | None = None
    phone: str | None = Field(None, max_length=64)
    function: ContactFunction | None = None
    seniority: ContactSeniority | None = None
    decision_power: ContactDecisionPower | None = None
    notes: str | None = Field(None, max_length=500)
    is_spoc: bool | None = None
    is_sponsor: bool | None = None
