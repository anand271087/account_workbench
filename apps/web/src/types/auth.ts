// Mirrors apps/api/app/schemas/user.py — keep in sync until OpenAPI codegen lands.

export type RoleKey =
  | "csm"
  | "cs_team_manager"
  | "cs_director"
  | "vp_csm"
  | "commercial_owner"
  | "vp_sales"
  | "solutioning_manager"
  | "vp_solutioning"
  | "inside_sales_manager"
  | "vp_inside_sales"
  | "admin";

export type UserStatus = "pending" | "active" | "deactivated";

export interface UserOut {
  id: string;
  email: string;
  full_name: string | null;
  role: RoleKey;
  team_id?: string | null;
  status?: UserStatus;
  invited_at?: string | null;
  invited_by?: string | null;
  created_at?: string | null;
}

export interface UserInvite {
  email: string;
  full_name: string;
  role: RoleKey;
  team_id?: string | null;
}

export interface UserUpdate {
  full_name?: string | null;
  role?: RoleKey | null;
  team_id?: string | null;
}

export interface Permissions {
  is_global_admin: boolean;
  is_global_reader: boolean;
  can_view_solutioning: boolean;
  can_view_inside_sales: boolean;
  can_view_admin_panel: boolean;
  can_manage_users: boolean;
  can_view_leadership: boolean;
}

export interface MeResponse {
  user: UserOut;
  permissions: Permissions;
}

export const ROLE_LABELS: Record<RoleKey, string> = {
  csm: "CSM",
  cs_team_manager: "CS Team Manager",
  cs_director: "CS Director",
  vp_csm: "VP — CSM",
  commercial_owner: "Commercial Owner",
  vp_sales: "VP — Sales",
  solutioning_manager: "Solutioning Manager",
  vp_solutioning: "VP — Solutioning",
  inside_sales_manager: "Inside Sales Manager",
  vp_inside_sales: "VP — Inside Sales",
  admin: "Admin",
};
