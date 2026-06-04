// Mirrors apps/api/app/schemas/cs_goal.py.

export type CSGoalCategory =
  // Legacy values — preserved so existing goals still load. New goals
  // use the 03-Jun vocabulary below.
  | "cost_savings"
  | "base_rationalization"
  | "risk_mitigation"
  | "adoption"
  | "other"
  // 03-Jun prototype categories.
  | "cost_reduction"
  | "negotiation_leverage"
  | "should_cost_modeling"
  | "tco_optimization"
  | "competitive_benchmarking"
  | "category_strategy_market_dynamics"
  | "supply_demand_outlook"
  | "enhanced_supplier_discovery"
  | "financial_risk_monitoring"
  | "supply_assurance"
  | "geopolitical_risk_management"
  | "lcc_ncc_sourcing_strategy"
  | "ai_driven_sourcing_transformations"
  | "esg_responsible_sourcing";

/** New-goal vocabulary (03-Jun). The dropdown in the create-goal modal
 *  surfaces ONLY these; legacy categories on existing goals still render
 *  via CATEGORY_LABELS but aren't pickable for new rows. */
export const CSGOAL_CATEGORIES_NEW: CSGoalCategory[] = [
  "cost_reduction",
  "negotiation_leverage",
  "should_cost_modeling",
  "tco_optimization",
  "competitive_benchmarking",
  "category_strategy_market_dynamics",
  "supply_demand_outlook",
  "enhanced_supplier_discovery",
  "financial_risk_monitoring",
  "supply_assurance",
  "geopolitical_risk_management",
  "lcc_ncc_sourcing_strategy",
  "ai_driven_sourcing_transformations",
  "esg_responsible_sourcing",
  "other",
];

export type CSGoalAlignment = "not_started" | "partial" | "aligned";

/** 03-Jun — CSM's per-goal sign-off, independent of alignment_status. */
export type CSGoalValidationStatus =
  | "pending"
  | "accepted"
  | "flagged"
  | "removed";

export type GroundworkStatus =
  | "done_current"
  | "done_outdated"
  | "not_done"
  | "unknown";

export type CategoryClarity = "confirmed" | "partial" | "not_discussed";
export type TargetOrigin =
  | "analysis_backed"
  | "finance_set"
  | "joint_estimate"
  | "unknown";

export interface PhaseA {
  goal_type?: string | null;
  category_clarity?: CategoryClarity | null;
  target_origin?: TargetOrigin | null;
  validation_note?: string | null;
  phase_a_complete?: boolean;
  // Open: category-specific extras flow through.
  [k: string]: unknown;
}

export interface PhaseB {
  spend_analytics?: GroundworkStatus | null;
  opportunity_assessment?: GroundworkStatus | null;
  benchmarking?: GroundworkStatus | null;
  research_requested?: boolean;
  research_request_date?: string | null;
  phase_b_complete?: boolean;
  [k: string]: unknown;
}

export interface PhaseC {
  category_focus?: string | null;
  baseline?: string | null;
  agreed_target?: string | null;
  measure_method?: string | null;
  timeline?: string | null;
  phase_c_complete?: boolean;
  [k: string]: unknown;
}

export type InitiativeStatus = "not_started" | "in_progress" | "delivered";
export type ClientAck = "pending" | "yes" | "not_yet";

export interface Initiative {
  name: string;
  sub_initiatives?: string | null;
  status: InitiativeStatus;
  value_stage?: string | null;
  value_target?: string | null;
  value_delivered?: string | null;
  client_acknowledged: ClientAck;
  evidence?: string | null;
  implementation_status?: string | null;
  implementation_note?: string | null;
  value_fields: Record<string, unknown>;
  client_data: Array<{ label: string; status: string }>;
  value_history: Array<Record<string, unknown>>;
}

export interface HistoryAction {
  at: string;
  by?: string | null;
  by_name?: string | null;
  action: string;
  field?: string | null;
  previous_value?: unknown;
  new_value?: unknown;
  reason?: string | null;
}

export interface CSGoal {
  id: string;
  account_id: string;

  title: string;
  category: CSGoalCategory;
  target_value: string | null;
  target_date: string | null;
  owner: string | null;
  alignment_status: CSGoalAlignment;

  // 03-Jun — CSM per-goal sign-off + flag note.
  validation_status: CSGoalValidationStatus;
  flag_note: string | null;

  phase_a: PhaseA;
  phase_b: PhaseB;
  phase_c: PhaseC;
  phase_a_completed_at: string | null;
  phase_b_completed_at: string | null;
  phase_c_completed_at: string | null;

  initiatives: Initiative[];
  history: HistoryAction[];

  deleted_at: string | null;
  deleted_reason: string | null;
  deleted_by: string | null;

  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;

  is_editable: boolean;
}

export interface CSGoalCreate {
  title: string;
  category?: CSGoalCategory;
  target_value?: string | null;
  target_date?: string | null;
  owner?: string | null;
}

export type CSGoalUpdate = Partial<
  Pick<
    CSGoal,
    | "title"
    | "category"
    | "target_value"
    | "target_date"
    | "owner"
    | "alignment_status"
    | "phase_a"
    | "phase_b"
    | "phase_c"
    | "initiatives"
    | "validation_status"
    | "flag_note"
    | "phase_a_completed_at"
    | "phase_b_completed_at"
    | "phase_c_completed_at"
  >
>;

export const CATEGORY_LABELS: Record<CSGoalCategory, string> = {
  // Legacy
  cost_savings: "Cost Savings",
  base_rationalization: "Supplier Base Rationalisation",
  risk_mitigation: "Risk Mitigation",
  adoption: "Adoption",
  other: "Other",
  // 03-Jun prototype
  cost_reduction: "Cost Reduction",
  negotiation_leverage: "Negotiation Leverage",
  should_cost_modeling: "Should-Cost Modeling",
  tco_optimization: "Total Cost of Ownership (TCO) Optimization",
  competitive_benchmarking: "Competitive Benchmarking",
  category_strategy_market_dynamics: "Category Strategy & Market Dynamics",
  supply_demand_outlook: "Supply-Demand Outlook",
  enhanced_supplier_discovery: "Enhanced Supplier Discovery",
  financial_risk_monitoring: "Financial Risk Monitoring & Risk Mitigation",
  supply_assurance: "Supply Assurance / Business Continuity",
  geopolitical_risk_management: "Geopolitical Risk Management",
  lcc_ncc_sourcing_strategy: "LCC and NCC Sourcing Strategy",
  ai_driven_sourcing_transformations: "AI-Driven Sourcing Transformations",
  esg_responsible_sourcing: "ESG / Responsible Sourcing",
};

export const ALIGNMENT_LABELS: Record<CSGoalAlignment, string> = {
  not_started: "Not started",
  partial: "Partial",
  aligned: "Aligned",
};

export const GROUNDWORK_LABELS: Record<GroundworkStatus, string> = {
  done_current: "Done — current",
  done_outdated: "Done — outdated",
  not_done: "Not done",
  unknown: "Unknown",
};

/** Per-category goal_type choices for Phase A. New 03-Jun categories
 *  fall back to a generic "Confirmed / Partial / Unclear" set until
 *  bespoke per-category vocab lands. */
const GENERIC_PHASE_A = ["Confirmed", "Partial", "Unclear"];
const GENERIC_STAGES = ["identified", "in_progress", "achieved"];

export const PHASE_A_GOAL_TYPE_OPTIONS: Record<CSGoalCategory, string[]> = {
  // Legacy
  cost_savings: ["cost_savings", "cost_avoidance", "spend_reduction", "cost_efficiency"],
  base_rationalization: ["confirmed", "partial", "no"],
  risk_mitigation: ["supply_disruption", "regulatory", "geopolitical", "financial", "all"],
  adoption: ["mau_growth", "module_activation", "stakeholder_breadth"],
  other: [],
  // 03-Jun prototype — fall back to generic vocab until per-category
  // bespoke options are designed.
  cost_reduction: GENERIC_PHASE_A,
  negotiation_leverage: GENERIC_PHASE_A,
  should_cost_modeling: GENERIC_PHASE_A,
  tco_optimization: GENERIC_PHASE_A,
  competitive_benchmarking: GENERIC_PHASE_A,
  category_strategy_market_dynamics: GENERIC_PHASE_A,
  supply_demand_outlook: GENERIC_PHASE_A,
  enhanced_supplier_discovery: GENERIC_PHASE_A,
  financial_risk_monitoring: GENERIC_PHASE_A,
  supply_assurance: GENERIC_PHASE_A,
  geopolitical_risk_management: GENERIC_PHASE_A,
  lcc_ncc_sourcing_strategy: GENERIC_PHASE_A,
  ai_driven_sourcing_transformations: GENERIC_PHASE_A,
  esg_responsible_sourcing: GENERIC_PHASE_A,
};

/** Per-category initiative value_stage progressions. */
export const VALUE_STAGES: Record<CSGoalCategory, string[]> = {
  // Legacy
  cost_savings: ["identified", "committed", "implemented", "deferred", "not_pursued"],
  base_rationalization: ["baselined", "in_progress", "achieved"],
  risk_mitigation: ["risk_baseline", "alert_generated", "disruption_avoided"],
  adoption: ["pilot", "active", "embedded"],
  other: [],
  // 03-Jun
  cost_reduction: ["identified", "committed", "implemented", "deferred", "not_pursued"],
  negotiation_leverage: GENERIC_STAGES,
  should_cost_modeling: GENERIC_STAGES,
  tco_optimization: GENERIC_STAGES,
  competitive_benchmarking: GENERIC_STAGES,
  category_strategy_market_dynamics: GENERIC_STAGES,
  supply_demand_outlook: GENERIC_STAGES,
  enhanced_supplier_discovery: GENERIC_STAGES,
  financial_risk_monitoring: ["risk_baseline", "alert_generated", "disruption_avoided"],
  supply_assurance: ["risk_baseline", "alert_generated", "disruption_avoided"],
  geopolitical_risk_management: ["risk_baseline", "alert_generated", "disruption_avoided"],
  lcc_ncc_sourcing_strategy: GENERIC_STAGES,
  ai_driven_sourcing_transformations: ["pilot", "active", "embedded"],
  esg_responsible_sourcing: GENERIC_STAGES,
};
