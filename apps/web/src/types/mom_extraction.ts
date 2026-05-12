// Mirrors apps/api/app/schemas/mom_extraction.py.

import type { ContactDecisionPower, ContactFunction, ContactSeniority } from "./contact";
import type { BriefCallType, MeetingBriefUpdate } from "./meeting_brief";

export type MaturityLevel = "low" | "medium" | "high";

export interface ExtractedAccountFields {
  industry: string | null;
  country: string | null;
  headquarters: string | null;
  annual_revenue_text: string | null;
  tier_band: string | null;
  sf_link: string | null;
}

export interface ExtractedEngagement {
  meeting_type: string | null;
  engagement_objective: string | null;
  target_categories: string[];
  geographies: string[];
  spoc_text: string | null;
  sponsor_text: string | null;
  procurement_maturity: MaturityLevel | null;
}

export interface ExtractedContact {
  name: string;
  title: string | null;
  linkedin_url: string | null;
  function: ContactFunction | null;
  seniority: ContactSeniority | null;
  decision_power: ContactDecisionPower | null;
  is_spoc: boolean;
  is_sponsor: boolean;
  is_internal_beroe: boolean;
}

// Subset of MeetingBriefUpdate the extraction populates.
export interface ExtractedBrief
  extends Pick<
    MeetingBriefUpdate,
    | "call_date"
    | "call_duration_minutes"
    | "win_condition"
    | "company_snapshot"
    | "attendees"
    | "news"
    | "public_signals"
    | "value_anchors"
    | "email_insights"
    | "cheat_sheet_never_say"
    | "cheat_sheet_opening_asks"
  > {
  call_type: BriefCallType | null;
}

export interface MomExtractionResult {
  document_id: string;
  is_stub: boolean;
  notes: string | null;
  account_fields: ExtractedAccountFields;
  engagement: ExtractedEngagement;
  contacts: ExtractedContact[];
  brief: ExtractedBrief;
}
