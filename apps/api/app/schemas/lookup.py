"""Lookup-table schemas (categories + geographies)."""

from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class CategoryOut(BaseModel):
    id: UUID
    name: str
    parent_id: UUID | None
    approved: bool
    # Added in 0050 — Beroe canonical category list. Both nullable so
    # legacy stub/test seeds without these fields still validate.
    domain: str | None = None
    availability: str | None = None

    model_config = {"from_attributes": True}


class CategoryProposeRequest(BaseModel):
    """User proposes a new category. Lands as `approved=false`; admin approves later."""

    name: str = Field(..., min_length=2, max_length=100)

    @field_validator("name")
    @classmethod
    def normalise(cls, v: str) -> str:
        return v.strip()


class GeographyOut(BaseModel):
    id: UUID
    name: str
    region: str

    model_config = {"from_attributes": True}
