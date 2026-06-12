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
  // 13-Jun · Free-text owner names — used as fallback in the header
  // when the staff aren't invited as real users yet.
  csm_owner_name: string | null;
  commercial_owner_name: string | null;
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
  // M25 — portfolio rollups
  alignment_status: "green" | "amber" | "red" | null;
  goal_count: number;
  next_checkpoint_type: "Kickoff" | "MBR" | "QBR" | "Renewal" | null;
  next_checkpoint_date: string | null;
  next_checkpoint_days_until: number | null;
  overdue_checkpoint_count: number;
  dr_outcome: "renewed" | "at_risk" | "not_renewed" | "undecided" | null;
  // 12-Jun · migration 0075 onboarding-import fields
  sector: string | null;
  revenue_bucket: string | null;
  renewal_risk: "Low" | "Medium" | "High" | null;
  category_count: number | null;
  supplier_count: number | null;
  platform_status: "Active" | "Inactive" | null;
  subscription_plan: string | null;
  is_fortune_500: boolean;
  is_focus_region: boolean;
  is_focus_industry: boolean;
  procurement_maturity: "Low" | "Medium" | "High" | null;
  genai_adoption: "Low" | "Medium" | "High" | null;
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
  // M16.1 — MoM-extraction header chips applied via PATCH /accounts/:id.
  // `headquarters` always null after migration 0075 — kept for back-compat.
  headquarters: string | null;
  annual_revenue_text: string | null;
  sf_link: string | null;
  // 12-Jun · migration 0075 onboarding-import fields
  client_priority: string | null;
  platform_status: "Active" | "Inactive" | null;
  subscription_plan: string | null;
  category_count: number | null;
  supplier_count: number | null;
  sector: string | null;
  revenue_bucket: string | null;
  renewal_risk: "Low" | "Medium" | "High" | null;
  is_fortune_500: boolean;
  is_focus_region: boolean;
  is_focus_industry: boolean;
  procurement_maturity: "Low" | "Medium" | "High" | null;
  genai_adoption: "Low" | "Medium" | "High" | null;
  // 05-Jun · Intelligence & Reports — canonical Redshift companyname.
  redshift_company_name: string | null;
  csm_user_id: string | null;
  co_user_id: string | null;
  csm_full_name: string | null;
  co_full_name: string | null;
  // 13-Jun · Free-text owner names — used as fallback in the header
  // when the staff aren't invited as real users yet.
  csm_owner_name: string | null;
  commercial_owner_name: string | null;
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
  // Signing gate snapshot (M13)
  gate_signed: boolean;
  gate_signed_date: string | null;
  gate_renewal_date: string | null;
  gate_bvd_due_date: string | null;
  gate_unlocked: boolean;
  // 03-Jun — full contract snapshot for the CS Handoff Commercial block.
  gate_confirmed_at: string | null;
  gate_contract_acv: string | null;
  gate_contract_term: string | null;
  gate_contract_modules: string[];
  gate_platform_tier: string | null;
  gate_account_segment: string | null;
  gate_subscribers: string | null;
  // 04-Jun bug 15 — Commercial extras (billing freq, payment terms,
  // discount, geography, module_caveats, audit_notes, other_terms, TCV).
  // Free-shape jsonb; CSOnboardingTab BlockCommercial reads it for the
  // missing Geography + Other Terms tiles.
  gate_contract_extras: Record<string, unknown>;
  can_view_sales_handoff: boolean;
  // CS Onboarding (M14)
  cs_entry_type: "A" | "B" | null;
  can_view_cs_onboarding: boolean;
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
