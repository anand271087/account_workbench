// Mirrors apps/api/app/schemas/solutioning.py.

export type EngagementType = "one_time" | "retainer" | "subscription" | "pilot" | "other";
export type ShValidation = "confirmed" | "partially_confirmed" | "revised";

export interface Solutioning {
  account_id: string;
  proposed_solution: string | null;
  engagement_type: EngagementType | null;
  engagement_duration_months: number | null;
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
