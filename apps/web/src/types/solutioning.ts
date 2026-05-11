// Mirrors apps/api/app/schemas/solutioning.py.

export type EngagementType = "one_time" | "retainer" | "subscription" | "pilot" | "other";
export type TrialKind = "trial" | "poc" | "pilot" | "demo" | "none";

export interface Solutioning {
  account_id: string;
  proposed_solution: string | null;
  engagement_type: EngagementType | null;
  engagement_duration_months: number | null;
  value_themes: string[];
  value_definition: string | null;
  estimated_value_musd: string | number | null;

  // Trial / POC block.
  trial_conducted: boolean | null;
  trial_type: TrialKind | null;
  trial_duration_text: string | null;
  trial_participant_count: number | null;
  trial_participants_text: string | null;
  key_users_text: string | null;
  info_tested: string | null;
  hypothesis_tested: string | null;
  trial_summary: string | null;

  ai_extracted_from_doc: string | null;
  ai_extracted_at: string | null;
  ai_edited: boolean;

  // Sales Hand-off lock.
  locked_at: string | null;
  locked_by: string | null;

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

  trial_conducted?: boolean | null;
  trial_type?: TrialKind | null;
  trial_duration_text?: string | null;
  trial_participant_count?: number | null;
  trial_participants_text?: string | null;
  key_users_text?: string | null;
  info_tested?: string | null;
  hypothesis_tested?: string | null;
  trial_summary?: string | null;

  ai_edited?: boolean | null;
}

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

export const TRIAL_KIND_LABELS: Record<TrialKind, string> = {
  trial: "Trial",
  poc: "POC",
  pilot: "Pilot",
  demo: "Demo",
  none: "None",
};
