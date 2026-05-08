// Mirrors apps/api/app/schemas/engagement.py.

export type MaturityLevel = "low" | "medium" | "high";

export interface Engagement {
  account_id: string;
  sdr_lead: string | null;
  pre_discovery_date: string | null;
  discovery_lead: string | null;
  sales_lead: string | null;
  target_categories: string[];
  engagement_objective: string | null;
  procurement_maturity: MaturityLevel | null;
  ai_penetration: MaturityLevel | null;
  procurement_spend_musd: string | null;
  geographies: string[];
  spoc_text: string | null;
  sponsor_text: string | null;
  power_users_text: string | null;
  ai_quality_score: number | null;
  ai_quality_dismissed: boolean;
  updated_at: string;
  updated_by: string | null;
  is_editable: boolean;
}

export type EngagementUpdate = Partial<
  Omit<Engagement, "account_id" | "updated_at" | "updated_by" | "is_editable" | "ai_quality_score">
>;

export interface QualityCheckResponse {
  score: number; // 1..5
  comment: string;
  word_count: number;
  is_stub: boolean;
}
