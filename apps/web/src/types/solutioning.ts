// Mirrors apps/api/app/schemas/solutioning.py.

export type EngagementType = "one_time" | "retainer" | "subscription" | "pilot" | "other";
export type ShValidation = "confirmed" | "partially_confirmed" | "revised";

// 03-Jun bug — Trial Summary section replaces Engagement Shape.
export type TrialClientType = "Existing" | "New";
export type TrialType = "Trial" | "Pilot";
export type TrialPaymentType = "Complimentary" | "Pro Bono" | "Paid";

export const TRIAL_CLIENT_TYPE_OPTIONS: TrialClientType[] = ["Existing", "New"];
export const TRIAL_TYPE_OPTIONS: TrialType[] = ["Trial", "Pilot"];
export const TRIAL_PAYMENT_TYPE_OPTIONS: TrialPaymentType[] = [
  "Complimentary", "Pro Bono", "Paid",
];

/** Modules the trial can cover — verbatim from the bug spec
 *  "What was Tested" list (06-03). Each module's config is a free-form
 *  object so the prototype can add fields without a schema bump. */
export const TRIAL_MODULES = [
  "LiVE.Ai",
  "Supplier Watch",
  "MMD",
  "Custom Credits",
  "Commodity Forecasting",
  "Datahub",
  "GSA",
  "Cirtuo",
  "Sourcing Optimizer",
  "Alerts and Updates",
] as const;
export type TrialModuleName = (typeof TRIAL_MODULES)[number];

export interface Solutioning {
  account_id: string;
  proposed_solution: string | null;
  engagement_type: EngagementType | null;
  engagement_duration_months: number | null;
  // 03-Jun bug — Trial Summary fields.
  trial_client_type: TrialClientType | null;
  trial_type: TrialType | null;
  trial_payment_type: TrialPaymentType | null;
  trial_date: string | null;
  trial_modules_tested: Record<string, Record<string, unknown>>;
  trial_outcome: string | null;
  trial_feedback: string | null;
  value_themes: string[];
  value_definition: string | null;
  estimated_value_musd: string | number | null;

  ai_extracted_from_doc: string | null;
  ai_extracted_at: string | null;
  ai_edited: boolean;

  // Sales Hand-off lock.
  locked_at: string | null;
  locked_by: string | null;

  // Sales Hand-off context (M13). First three are set automatically by lock.
  sh_value_from_solutioning: string | null;
  sh_value_themes_from_solutioning: string | null;
  sh_value_received_at: string | null;
  sh_value_validation: ShValidation | null;
  sh_validation_notes: string | null;
  sh_go_live_date: string | null;
  sh_first_checkpoint: string | null;
  sh_stakeholder_signoff: string | null;
  sh_commercial_context: string | null;
  sales_watchouts: string | null;
  handoff_file_name: string | null;

  updated_at: string;
  updated_by: string | null;
  is_editable: boolean;
}

export interface SolutioningUpdate {
  proposed_solution?: string | null;
  engagement_type?: EngagementType | null;
  engagement_duration_months?: number | null;
  // 03-Jun bug — Trial Summary fields.
  trial_client_type?: TrialClientType | null;
  trial_type?: TrialType | null;
  trial_payment_type?: TrialPaymentType | null;
  trial_date?: string | null;
  trial_modules_tested?: Record<string, Record<string, unknown>> | null;
  trial_outcome?: string | null;
  trial_feedback?: string | null;
  value_themes?: string[] | null;
  value_definition?: string | null;
  estimated_value_musd?: string | number | null;

  sh_value_validation?: ShValidation | null;
  sh_validation_notes?: string | null;
  sh_go_live_date?: string | null;
  sh_first_checkpoint?: string | null;
  sh_stakeholder_signoff?: string | null;
  sh_commercial_context?: string | null;
  sales_watchouts?: string | null;
  handoff_file_name?: string | null;

  ai_edited?: boolean | null;
}

export const SH_VALIDATION_LABELS: Record<ShValidation, string> = {
  confirmed: "Confirmed",
  partially_confirmed: "Partially confirmed",
  revised: "Revised",
};

export interface HandoverResponse {
  account_id: string;
  handed_off_to_solutioning: boolean;
  handed_off_at: string | null;
  handed_off_by: string | null;
}

export interface SolutioningLockResponse {
  account_id: string;
  locked_at: string | null;
  locked_by: string | null;
}

export const ENGAGEMENT_TYPE_LABELS: Record<EngagementType, string> = {
  one_time: "One-time project",
  retainer: "Retainer",
  subscription: "Subscription",
  pilot: "Pilot",
  other: "Other",
};
