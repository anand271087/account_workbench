"""Pydantic schemas for user-related API responses."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, EmailStr, Field

UserStatusLiteral = Literal["pending", "active", "deactivated"]
RoleKeyLiteral = Literal[
    "csm", "cs_team_manager", "cs_director", "vp_csm",
    "commercial_owner", "vp_sales",
    "solutioning_manager", "vp_solutioning",
    "inside_sales_manager", "vp_inside_sales",
    "admin",
]


class UserOut(BaseModel):
    id: UUID
    email: EmailStr
    full_name: str | None
    role: str
    team_id: UUID | None = None
    status: UserStatusLiteral = "active"
    invited_at: datetime | None = None
    invited_by: UUID | None = None
    created_at: datetime | None = None

    model_config = {"from_attributes": True}


class UserInvite(BaseModel):
    email: EmailStr
    full_name: str = Field(..., min_length=2, max_length=200)
    role: RoleKeyLiteral
    team_id: UUID | None = None


class UserUpdate(BaseModel):
    full_name: str | None = Field(None, min_length=2, max_length=200)
    role: RoleKeyLiteral | None = None
    team_id: UUID | None = None


class Permissions(BaseModel):
    """Frontend-facing capabilities derived from role.

    The frontend uses these to hide buttons/tabs the user can't use.
    Defense-in-depth: every backend route also enforces via decorators + RLS.
    """

    is_global_admin: bool
    is_global_reader: bool
    can_view_solutioning: bool
    can_view_inside_sales: bool
    can_view_admin_panel: bool
    can_manage_users: bool
    # M24 — leadership view (cross-account portfolio dashboard).
    can_view_leadership: bool = False


class MeResponse(BaseModel):
    user: UserOut
    permissions: Permissions
