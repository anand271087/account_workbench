"""M15.1 — Candidate-goals extraction from VPD documents.

Mirrors the M16 MoM-extraction shape. The frontend takes the result,
presents a review modal with per-row checkboxes + inline edit, and on
confirm fans out POST /accounts/:id/cs-goals × N (followed by a PATCH
that attaches the suggested initiatives).

`extra="allow"` so the prompt can surface fields we haven't modelled
yet (e.g. confidence scores per goal) without a schema bump.
"""

from __future__ import annotations

from datetime import date
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

# Mirrors apps/api/app/schemas/cs_goal.py CSGoalCategory + Initiative.stage.
CSGoalCategory = Literal[
    "cost_savings",
    "base_rationalization",
    "risk_mitigation",
    "adoption",
    "other",
]
InitiativeStage = Literal[
    "proposed", "committed", "in_flight", "implemented", "blocked", "cancelled"
]


class ExtractedInitiative(BaseModel):
    """One initiative under a goal. Maps 1:1 to cs_goal.Initiative."""

    model_config = ConfigDict(extra="allow")

    name: str
    description: str | None = Field(None, max_length=2000)
    stage: InitiativeStage | None = None
    levers: list[str] = Field(default_factory=list)


class ExtractedGoal(BaseModel):
    """One candidate goal. The first five fields map to CSGoalCreate;
    initiatives ship as a PATCH after create."""

    model_config = ConfigDict(extra="allow")

    title: str = Field(..., min_length=1, max_length=200)
    category: CSGoalCategory = "other"
    target_value: str | None = Field(None, max_length=200)
    target_date: date | None = None
    owner: str | None = Field(None, max_length=200)

    initiatives: list[ExtractedInitiative] = Field(default_factory=list)

    # Surfaced to the UI for the per-row tag (high/medium/low).
    confidence: Literal["high", "medium", "low"] | None = None
    rationale: str | None = Field(None, max_length=600)


class CsGoalsExtractionResult(BaseModel):
    model_config = ConfigDict(extra="allow")

    document_id: UUID | None = None
    goals: list[ExtractedGoal] = Field(default_factory=list)
    is_stub: bool = False
