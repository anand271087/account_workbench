// Mirrors apps/api/app/schemas/cs_goal.py.

export type CSGoalCategory =
  | "cost_savings"
  | "base_rationalization"
  | "risk_mitigation"
  | "adoption"
  | "other";

export type CSGoalAlignment = "not_started" | "partial" | "aligned";

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

  phase_a: PhaseA;
  phase_b: PhaseB;
  phase_c: PhaseC;

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
  >
>;

export const CATEGORY_LABELS: Record<CSGoalCategory, string> = {
  cost_savings: "Cost Savings",
  base_rationalization: "Supplier Base Rationalisation",
  risk_mitigation: "Risk Mitigation",
  adoption: "Adoption",
  other: "Other",
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

/** Per-category goal_type choices for Phase A. */
export const PHASE_A_GOAL_TYPE_OPTIONS: Record<CSGoalCategory, string[]> = {
  cost_savings: ["cost_savings", "cost_avoidance", "spend_reduction", "cost_efficiency"],
  base_rationalization: ["confirmed", "partial", "no"],
  risk_mitigation: ["supply_disruption", "regulatory", "geopolitical", "financial", "all"],
  adoption: ["mau_growth", "module_activation", "stakeholder_breadth"],
  other: [],
};

/** Per-category initiative value_stage progressions. */
export const VALUE_STAGES: Record<CSGoalCategory, string[]> = {
  cost_savings: ["identified", "committed", "implemented", "deferred", "not_pursued"],
  base_rationalization: ["baselined", "in_progress", "achieved"],
  risk_mitigation: ["risk_baseline", "alert_generated", "disruption_avoided"],
  adoption: ["pilot", "active", "embedded"],
  other: [],
};
