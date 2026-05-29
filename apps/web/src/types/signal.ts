// Mirrors apps/api/app/schemas/signal.py.

export type SignalType =
  | "risk"
  | "positive"
  | "expansion"
  | "neutral"
  | "critical";
export type SignalImpact = "critical" | "high" | "medium" | "low";
export type SignalStatus = "active" | "resolved";

export type ActivityType =
  | "csm_call"
  | "exec_visit"
  | "product"
  | "research"
  | "qbr"
  | "internal"
  | "escalation";

export interface SoftSignal {
  id: string;
  account_id: string;
  type: SignalType;
  category: string | null;
  signal: string;
  description: string | null;
  impact: SignalImpact;
  status: SignalStatus;
  resolved_at: string | null;
  resolved_by: string | null;
  resolved_note: string | null;
  valid_until: string | null;
  occurred_at: string | null;
  source: string | null;
  ai_extracted: boolean;
  added_by: string | null;
  hidden: boolean;
  created_at: string;
  updated_at: string;
}

export interface SoftSignalListResponse {
  items: SoftSignal[];
  total: number;
  is_editable: boolean;
}

export interface SoftSignalCreate {
  type: SignalType;
  category?: string | null;
  signal: string;
  description?: string | null;
  impact?: SignalImpact;
  valid_until?: string | null;
  occurred_at?: string | null;
  source?: string | null;
}

export interface Activity {
  id: string;
  account_id: string;
  type: ActivityType;
  title: string;
  summary: string | null;
  items: string | null;
  attendees: string | null;
  linked_metrics: string[];
  file_name: string | null;
  occurred_at: string | null;
  added_by: string | null;
  hidden: boolean;
  created_at: string;
  updated_at: string;
}

export interface ActivityListResponse {
  items: Activity[];
  total: number;
  is_editable: boolean;
}

export interface ActivityCreate {
  type: ActivityType;
  title: string;
  summary?: string | null;
  items?: string | null;
  attendees?: string | null;
  linked_metrics?: string[];
  file_name?: string | null;
  occurred_at?: string | null;
}

// Soft-signal palette — locked to Beroe brand book (Sept 2025).
// Mapping: risk → Risk Amber · positive → Risk Green · expansion →
// Fuscia · neutral → brand mid-grey · critical → Risk Red.
export const SIG_CONF: Record<
  SignalType,
  { label: string; col: string; bg: string; dot: string }
> = {
  risk:      { label: "Risk",      col: "#F0BC41", bg: "#F0BC4115", dot: "#F0BC41" },
  positive:  { label: "Positive",  col: "#6EC457", bg: "#6EC45715", dot: "#6EC457" },
  expansion: { label: "Expansion", col: "#C344C7", bg: "#C344C715", dot: "#C344C7" },
  neutral:   { label: "Neutral",   col: "#475569", bg: "#EAF1F5",   dot: "#94a3b8" },
  critical:  { label: "Critical",  col: "#CF4548", bg: "#CF454810", dot: "#CF4548" },
};

export const IMPACT_LABELS: Record<SignalImpact, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

// Activity-type palette — brand-locked. CSM Call / QBR / Research stay
// in the brand RAG/secondary triad; escalations are Risk Red.
export const ACT_CONF: Record<
  ActivityType,
  { label: string; col: string; bg: string; ic: string }
> = {
  csm_call:   { label: "CSM Call",   col: "#6EC457", bg: "#6EC45715", ic: "📞" },
  exec_visit: { label: "Exec Visit", col: "#4A00F8", bg: "#4A00F810", ic: "🤝" },
  product:    { label: "Product",    col: "#C344C7", bg: "#C344C715", ic: "⚡" },
  research:   { label: "Research",   col: "#35E1D4", bg: "#35E1D415", ic: "📚" },
  qbr:        { label: "QBR",        col: "#F0BC41", bg: "#F0BC4115", ic: "📊" },
  internal:   { label: "Internal",   col: "#475569", bg: "#EAF1F5",   ic: "📝" },
  escalation: { label: "Escalation", col: "#CF4548", bg: "#CF454810", ic: "🚨" },
};

export const SIGNAL_TYPES: SignalType[] = [
  "expansion",
  "positive",
  "neutral",
  "risk",
  "critical",
];

export const SIGNAL_IMPACTS: SignalImpact[] = [
  "critical",
  "high",
  "medium",
  "low",
];

export const ACTIVITY_TYPES: ActivityType[] = [
  "csm_call",
  "exec_visit",
  "qbr",
  "product",
  "research",
  "internal",
  "escalation",
];
