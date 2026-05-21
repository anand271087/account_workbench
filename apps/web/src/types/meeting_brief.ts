// Mirrors apps/api/app/schemas/meeting_brief.py.

export type BriefCallType =
  | "first_discovery"
  | "qbr"
  | "renewal"
  | "expansion"
  | "other";

export type Severity = "high" | "caution";
export type AttendeeCompany = "client" | "beroe";
export type ScenarioType = "good" | "neutral" | "poor";

export interface SnapshotStat {
  num: string;
  label: string;
  sub: string | null;
}

export interface CallTimerSlot {
  time: string;
  label: string;
}

export interface Attendee {
  initials: string;
  name: string;
  role: string | null;
  company: AttendeeCompany;
  is_self: boolean;
  avatar_color: string | null;
  objectives: string[];
  primary_objective: string | null;
  background: string[];
  opening_ask: string | null;
}

export interface Minefield {
  severity: Severity;
  type: string | null;
  text: string;
  why: string | null;
}

export interface Objective {
  rank: number;
  name: string;
  confidence: number; // 1..5
  bullets: string[];
  beroe: string | null;
  sources: string[];
}

export interface DiscoveryQuestion {
  objective: string;
  rank: number;
  person: string;
  from_email: boolean;
  text: string;
  // H46 — Category dropdown on Discovery questions.
  category?: string | null;
}

export const DISCOVERY_CATEGORIES = [
  "Commercial",
  "Risk",
  "People",
  "Process",
  "Sustainability",
  "Technology",
  "Adoption",
] as const;

export type DiscoveryCategory = (typeof DISCOVERY_CATEGORIES)[number];

export interface ValueAnchorPoint {
  text: string;
  note: string | null;
}

export interface ValueAnchor {
  objective: string;
  points: ValueAnchorPoint[];
}

export interface EmailInsight {
  meta: string;
  bullets: string[];
}

export interface PublicSignal {
  person: string | null;
  headline: string;
  text: string | null;
  url: string | null;
  tag: string | null;
}

export interface NewsItem {
  days_ago: number | null;
  headline: string;
  source: string | null;
  signal: string | null;
  url: string | null;
  tag: string | null;
}

export interface AnnualReportItem {
  title: string;
  year: number | null;
  url: string | null;
  bullets: string[];
}

export interface ClosingScenario {
  type: ScenarioType;
  label: string | null;
  text: string;
}

export interface MeetingBrief {
  account_id: string;

  call_type: BriefCallType | null;
  call_date: string | null; // ISO yyyy-mm-dd
  call_time: string | null;
  call_platform: string | null;
  call_duration_minutes: number | null;

  win_condition: string | null;
  cheat_sheet_win_condition_short: string | null;

  company_snapshot: SnapshotStat[];
  call_timer: CallTimerSlot[];
  attendees: Attendee[];
  minefields: Minefield[];
  objectives: Objective[];
  discovery_questions: DiscoveryQuestion[];
  value_anchors: ValueAnchor[];
  email_insights: EmailInsight[];
  public_signals: PublicSignal[];
  news: NewsItem[];
  annual_reports: AnnualReportItem[];
  closing_scenarios: ClosingScenario[];
  cheat_sheet_never_say: string[];
  cheat_sheet_opening_asks: string[];
  // H46 — Categories tab.
  categories: string[];

  updated_at: string;
  updated_by: string | null;
  is_editable: boolean;
}

export type MeetingBriefUpdate = Partial<
  Omit<MeetingBrief, "account_id" | "updated_at" | "updated_by" | "is_editable">
>;

export const BRIEF_CALL_TYPE_LABELS: Record<BriefCallType, string> = {
  first_discovery: "First Discovery",
  qbr: "QBR",
  renewal: "Renewal",
  expansion: "Expansion",
  other: "Other",
};

export const SEVERITY_LABELS: Record<Severity, string> = {
  high: "High",
  caution: "Caution",
};

export const SCENARIO_LABELS: Record<ScenarioType, string> = {
  good: "Strong close",
  neutral: "Warm handoff",
  poor: "Keep door open",
};

/** Empty brief used when the server returns null collections on a fresh row. */
export function emptyBrief(accountId: string): MeetingBrief {
  return {
    account_id: accountId,
    call_type: null,
    call_date: null,
    call_time: null,
    call_platform: null,
    call_duration_minutes: null,
    win_condition: null,
    cheat_sheet_win_condition_short: null,
    company_snapshot: [],
    call_timer: [],
    attendees: [],
    minefields: [],
    objectives: [],
    discovery_questions: [],
    value_anchors: [],
    email_insights: [],
    public_signals: [],
    news: [],
    annual_reports: [],
    closing_scenarios: [],
    cheat_sheet_never_say: [],
    cheat_sheet_opening_asks: [],
    categories: [],
    updated_at: new Date().toISOString(),
    updated_by: null,
    is_editable: false,
  };
}
