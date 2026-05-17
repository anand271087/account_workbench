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
}

// Mirrors prototype SIG.
export const SIG_CONF: Record<
  SignalType,
  { label: string; col: string; bg: string; dot: string }
> = {
  risk:      { label: "Risk",      col: "#FD576B", bg: "#fff0e5", dot: "#FD576B" },
  positive:  { label: "Positive",  col: "#2fb87a", bg: "#d4f5e5", dot: "#2fb87a" },
  expansion: { label: "Expansion", col: "#a830b0", bg: "#f5e0f6", dot: "#a830b0" },
  neutral:   { label: "Neutral",   col: "#64748b", bg: "#f1f5f9", dot: "#94a3b8" },
  critical:  { label: "Critical",  col: "#e63950", bg: "#ffe0e5", dot: "#e63950" },
};

export const IMPACT_LABELS: Record<SignalImpact, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

// Mirrors prototype ACT.
export const ACT_CONF: Record<
  ActivityType,
  { label: string; col: string; bg: string; ic: string }
> = {
  csm_call:   { label: "CSM Call",    col: "#2fb87a", bg: "#d4f5e5", ic: "📞" },
  exec_visit: { label: "Exec Visit",  col: "#4A00F8", bg: "#ede6ff", ic: "🤝" },
  product:    { label: "Product",     col: "#a830b0", bg: "#f5e0f6", ic: "⚡" },
  research:   { label: "Research",    col: "#d88520", bg: "#fef0c0", ic: "📚" },
  qbr:        { label: "QBR",         col: "#d88520", bg: "#fef0c0", ic: "📊" },
  internal:   { label: "Internal",    col: "#64748b", bg: "#f1f5f9", ic: "📝" },
  escalation: { label: "Escalation",  col: "#e63950", bg: "#ffe0e5", ic: "🚨" },
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
