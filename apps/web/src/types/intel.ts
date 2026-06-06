// 05-Jun · Intelligence & Reports — TypeScript types for /intel/all
// payload returned by services/redshift_queries.py. One type per sheet
// of Analytics_DataPoints_v10.xlsx.
//
// KPIs that the reader role can't fetch (permission denied, missing
// table, or offline SharePoint) surface as `Unavailable` objects so
// the UI can render a "data pipeline pending" pill instead of zero.

export interface Unavailable {
  value: null;
  source_unavailable: true;
  reason: string;
}

export type Maybe<T> = T | Unavailable;

export function isUnavailable<T>(v: Maybe<T> | undefined | null): v is Unavailable {
  return !!v && typeof v === "object" && (v as Unavailable).source_unavailable === true;
}

// ----------------- bundle shapes --------------------------------

export interface LabelCount {
  label: string;
  count: number;
}

export interface AccountSubscribers {
  window: string;
  total_subscribers: number;
  active_subscribers: number;
  subscription_start: string | null;
  subscription_end: string | null;
  company_last_login: string | null;
  total_logins: number;
  total_time_spent_mins: number;
  categories_unlocked: number;
  suppliers_added: Maybe<number>;
  source: "redshift";
}

export interface MmdSection {
  subscribers: number;
  total_time_mins: number;
  avg_time_per_user_mins: number;
  unique_categories_viewed: number;
  avg_categories_per_user: number;
  grades_viewed: LabelCount[];
  regions_viewed: LabelCount[];
  monthly_trend: Array<{ month: string; subscribers: number; visits: number }>;
}

export interface CategoryWatch {
  window: string;
  category_intelligence: Record<string, Maybe<unknown> | number>;
  mmd: MmdSection;
  benchmarks: Record<string, Maybe<unknown> | number>;
  source: "redshift";
}

export interface Abi {
  window: string;
  total_queries: number;
  unique_users: number;
  by_complexity: LabelCount[];
  by_status: LabelCount[];
  bot_resolution_pct: number;
  time_per_user_top50: Array<{ email: string; hours: number }>;
  repeat_users_pct: number;
  avg_feedback: number | null;
  thumbs_up_pct: number | null;
  top_deliverable: LabelCount[];
  inside_vs_outside_split: LabelCount[];
  top_declined_deliverable: LabelCount[];
  declined_by_module: LabelCount[];
  research_referral_reasons: LabelCount[];
  by_source: LabelCount[];
  top_geographies: LabelCount[];
  source: "redshift";
}

export interface SupplierDiscovery {
  window: string;
  users: number;
  total_searches: number;
  avg_searches_per_user: number;
  total_visits: number;
  total_time_mins: number;
  top_categories_searched: LabelCount[];
  repeat_users_pct: number;
  top_regions_scoped: Maybe<unknown>;
  categories_pct_split: Maybe<unknown>;
  suppliers_shortlisted_avg: Maybe<unknown>;
  sd_downloads: Maybe<unknown>;
  source: "redshift";
}

export interface SupplierMonitoring {
  window: string;
  total_time_mins: number;
  suppliers_monitored: Maybe<number>;
  suppliers_by_risk_level: Maybe<unknown>;
  new_suppliers_in_period: Maybe<number>;
  users_adding_suppliers: Maybe<number>;
  mom_trend_suppliers_added: Maybe<unknown>;
  data_refreshes_last_30d: Maybe<number>;
  suppliers_added_vs_contracted_pct: Maybe<number>;
  usage_vs_runway: Maybe<unknown>;
  suppliers_added_list: Maybe<unknown>;
  source: "redshift";
}

export interface CustomUsage {
  window: string;
  credits_by_complexity: { L1: number; L2: number; L3: number; L4: number };
  credits_by_complexity_note?: string;
  total_credits_used: number;
  credits_estimated_active: Maybe<number>;
  credits_allocated_tier: Maybe<number>;
  credits_utilization_pct: Maybe<number>;
  commodity_dashboards: number;
  country_reports: number;
  client_feedback_score: number | null;
  ai_swat_vs_basics: LabelCount[];
  top_categories: LabelCount[];
  top_spendpools: LabelCount[];
  top_deliverables: LabelCount[];
  source: "redshift";
}

export interface ThoughtLeadership {
  window: string;
  webinar_views: number;
  articles_opened: number;
  beigebook_views: number;
  beigebook_downloads: number;
  by_type: LabelCount[];
  source: "redshift";
}

export interface DataHub {
  window: string;
  data_pulls: Maybe<number>;
  source: "redshift";
}

export interface InflationWatch {
  window: string;
  unique_visitors: number;
  total_sessions: number;
  total_time_mins: number;
  avg_sessions_per_visitor: number;
  avg_session_time_mins: number;
  avg_time_per_visitor_mins: number;
  top_features: Array<{ feature: string; visitors: number; views: number }>;
  scenario_modelling: { ran: number; saved: number };
  top_pages: Maybe<unknown>;
  source: "redshift";
}

export interface OfflineBundle {
  window: string;
  [key: string]: Maybe<unknown> | string;
  source: "offline";
}

export interface Alerts {
  window: string;
  _scope_note: string;
  types_sent: LabelCount[];
  open_rate_pct: number;
  open_rate_by_category: Array<{ label: string; open_rate_pct: number }>;
  open_rate_by_reachout: Array<{ label: string; open_rate_pct: number }>;
  source: "redshift";
}

export interface SuperUser {
  email: string;
  logins: number;
  report_downloads: number;
  pages_viewed: number;
  sd_searches: number;
  mmd_actions: number;
  supplier_actions: number;
  suppliers_added: number;
  abi_queries: number;
  mmd_time_mins: number;
  sm_time_mins: number;
  activity_score: number;
  last_login: string | null;
}

export interface SuperUsersBundle {
  users: SuperUser[];
  top_n: number;
  login_distribution_top5: Array<{ email: string; logins: number; share_pct: number }>;
  benchmark_per_user: Maybe<unknown>;
  category_intelligence_per_user: Maybe<unknown>;
  source: "redshift";
}

// ----------------- /intel/all rollup ----------------------------

export interface IntelAll {
  redshift_company_name: string;
  window: string;
  account_subscribers: AccountSubscribers;
  category_watch: CategoryWatch;
  abi: Abi;
  supplier_discovery: SupplierDiscovery;
  supplier_monitoring: SupplierMonitoring;
  custom_usage: CustomUsage;
  thought_leadership: ThoughtLeadership;
  datahub: DataHub;
  inflation_watch: InflationWatch;
  cirtuo: OfflineBundle;
  nnamu: OfflineBundle;
  upply: OfflineBundle;
  alerts: Alerts;
  training: OfflineBundle;
  nps: OfflineBundle;
  super_users: SuperUsersBundle;
}

// Period → window adapter used by every hook.
// Account header trio uses "30d" | "90d" | "FY"; backend expects
// "30d" | "90d" | "fy" | "all".
export function periodToWindow(p: "30d" | "90d" | "FY"): "30d" | "90d" | "fy" {
  return p === "FY" ? "fy" : p;
}
