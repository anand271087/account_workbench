// Mirrors apps/api/app/schemas/account.py

export interface AccountListItem {
  id: string;
  name: string;
  slug: string;
  industry: string | null;
  country: string | null;
  region: string | null;
  csm_user_id: string | null;
  co_user_id: string | null;
  csm_full_name: string | null;
  co_full_name: string | null;
  category: string | null;
  tier: string | null;
  account_type: string | null;
  segment: string | null;
  current_acv: string | null;        // Decimal serialized as string
  target_acv: string | null;
  renewal_date: string | null;       // ISO date
  days_to_renewal: number | null;
  health_score: number | null;
  last_activity_at: string | null;   // ISO datetime
  is_editable: boolean;
}

export interface AccountListResponse {
  items: AccountListItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface AccountDetail {
  id: string;
  name: string;
  slug: string;
  industry: string | null;
  region: string | null;
  country: string | null;
  csm_user_id: string | null;
  co_user_id: string | null;
  csm_full_name: string | null;
  co_full_name: string | null;
  category: string | null;
  tier: string | null;
  account_type: string | null;
  segment: string | null;
  current_acv: string | null;
  target_acv: string | null;
  contract_start: string | null;
  contract_end: string | null;
  renewal_date: string | null;
  days_to_renewal: number | null;
  health_score: number | null;
  last_activity_at: string | null;
  created_at: string;
  updated_at: string;
  is_editable: boolean;
  can_view_pre_sales: boolean;
  can_view_contacts: boolean;
  can_view_documents: boolean;
  can_view_solutioning: boolean;
  handed_off_to_solutioning: boolean;
  handed_off_at: string | null;
  handed_off_by: string | null;
}

export interface ActivityItem {
  id: string;
  table_name: string;
  row_id: string | null;
  action: "insert" | "update" | "delete";
  changed_by_user_id: string | null;
  changed_by_full_name: string | null;
  changed_at: string;
  field_name: string | null;
  old_value: unknown;
  new_value: unknown;
}

export interface ActivityFeedResponse {
  items: ActivityItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface AccountListQuery {
  q?: string;
  csm_user_id?: string;
  industry?: string;
  tier?: string;
  category?: string;
  region?: string;
  renewal_within_days?: string | number;
  page?: number;
  page_size?: number;
  sort?: "name" | "renewal_date" | "current_acv" | "health_score" | "last_activity_at";
  sort_dir?: "asc" | "desc";
}
