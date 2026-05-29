// Mirrors apps/api/app/schemas/play.py.

export type PlayMode = "rescue" | "retain" | "expand";

export interface Play {
  id: string;
  account_id: string;
  title: string;
  value_usd: string;        // Decimal serialized as string
  prob: number;
  when_text: string | null;
  trigger_text: string | null;
  modes: PlayMode[];
  role: string | null;
  added_by: string | null;
  hidden: boolean;
  created_at: string;
  updated_at: string;
}

export interface PlayListResponse {
  items: Play[];
  total: number;
  is_editable: boolean;
}

export interface PlayCreate {
  title: string;
  value_usd?: string | number;
  prob?: number;
  when_text?: string | null;
  trigger_text?: string | null;
  modes?: PlayMode[];
  role?: string | null;
}

export interface PlayUpdate {
  title?: string;
  value_usd?: string | number;
  prob?: number;
  when_text?: string | null;
  trigger_text?: string | null;
  modes?: PlayMode[];
  role?: string | null;
  hidden?: boolean;
}

export interface ModeBreakdown {
  health_pts: number;
  sig_pts: number;
  renew_pts: number;
  arr_pts: number;
  arr_status: "on_track" | "behind" | "declining" | "n/a";
  arr_target_pct: number;
  target_acv_usd: string;
  projected_acv_usd: string;
  utilization_gate: boolean;
}

export interface Appetite {
  account_id: string;
  score: number;
  recommended_mode: PlayMode;
  current_mode: PlayMode;
  is_overridden: boolean;
  breakdown: ModeBreakdown;
}

// Mirrors prototype PLAY_MODES.
// Per-mode brand palette (Beroe brand book Sept 2025). The previous
// prototype hex (#FD576B / #EF9637 / #35E1D4) have been substituted
// for the brand RAG triad:
//   rescue → Risk Red   #CF4548
//   retain → Risk Amber #F0BC41
//   expand → Aqua       #35E1D4 (kept — already on brand)
export const MODE_CONF: Record<
  PlayMode,
  { label: string; icon: string; col: string; bg: string; desc: string }
> = {
  rescue: {
    label: "Rescue",
    icon: "🚨",
    col: "#CF4548",
    bg: "#CF454810",
    desc: "Stop churn, recover relationship, secure renewal",
  },
  retain: {
    label: "Retain",
    icon: "🛡️",
    col: "#F0BC41",
    bg: "#F0BC4115",
    desc: "Protect current ACV, drive adoption, deepen relationship, build toward growth",
  },
  expand: {
    label: "Expand",
    icon: "🚀",
    col: "#35E1D4",
    bg: "#35E1D415",
    desc: "ACV growth through upsell and cross-sell",
  },
};

// Mirrors prototype SALES_STAGES.
export const SALES_STAGES: Array<{ prob: number; label: string }> = [
  { prob: 1,   label: "Accelerated Trials" },
  { prob: 5,   label: "Placeholder" },
  { prob: 10,  label: "Met & Qualified" },
  { prob: 30,  label: "Evaluation" },
  { prob: 45,  label: "Selected / Ref Calls" },
  { prob: 60,  label: "Budget Approved" },
  { prob: 80,  label: "Negotiations / Contracting" },
  { prob: 98,  label: "Contract / SOW Signed" },
  { prob: 99,  label: "Invoiced" },
  { prob: 100, label: "Closed" },
];

export function stageName(prob: number): string {
  const exact = SALES_STAGES.find((s) => s.prob === prob);
  if (exact) return exact.label;
  let closest = SALES_STAGES[0];
  for (const s of SALES_STAGES) {
    if (Math.abs(s.prob - prob) < Math.abs(closest.prob - prob)) closest = s;
  }
  return closest.label;
}

/** Sales-stage colour mapping — brand RAG triad + Indigo for mid-tier.
 *  prob ≥80 → Risk Green   #6EC457 (near-close)
 *  prob ≥60 → Indigo        #4A00F8 (budget approved, in flight)
 *  prob ≥30 → Risk Amber    #F0BC41 (evaluation / selected)
 *  else    → Risk Red       #CF4548 (early / unqualified) */
export function stageColor(prob: number): string {
  if (prob >= 80) return "#6EC457";
  if (prob >= 60) return "#4A00F8";
  if (prob >= 30) return "#F0BC41";
  return "#CF4548";
}

export function fmtK(usd: string | number | null | undefined): string {
  if (usd === null || usd === undefined) return "—";
  const n = typeof usd === "string" ? parseFloat(usd) : usd;
  if (Number.isNaN(n) || !Number.isFinite(n)) return "—";
  if (n === 0) return "$0";
  return `$${Math.round(n / 1000).toLocaleString()}K`;
}
