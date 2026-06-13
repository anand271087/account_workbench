// 05-Jun · Pass-1.1 — Goal Validation and Alignment tab, FULL port of
// beroe_sm_strategy_proto.html → renderGoalAlignmentTab() and friends.
//
// Includes everything the user flagged was missing:
//   • Smart NextAction banner (cascades pending → in-progress → aligned → no-init → healthy)
//   • Stakeholder bar (SPOC / Budget Owner / Power users · with inline Edit panel)
//   • 5 filter chips with live counts (chips with 0 hide except All)
//   • Goal card with category icon, status pill, frozen-mode progress bar,
//     initiative count vs Q-progress
//   • Q-box DONE state with concise summary view (replaces editor when done)
//   • Q-box PENDING/LOCKED state with arrow lock when prior Q not done
//   • One-Q-at-a-time via per-goal `openQ` map
//   • "🔒 Lock this goal — start tracking" gradient CTA in aligned state
//   • Frozen body: Alignment Summary (collapsible) + Initiatives section
//   • Full initiatives CRUD: icon by INIT_TYPE, type/module/owner, stage pill
//     by per-category STAGE_FLOW, $delivered/$target, edit/remove, Add form
//   • Flag for discussion · Remove · Unfreeze footer actions
//   • Brand-locked palette
//
// Backend wiring (no migrations):
//   • Q1/Q2/Q3 stored in cs_goals.phase_a/b/c via the existing extra="allow"
//   • Initiatives stored in cs_goals.initiatives — prototype field shape
//     mapped onto our existing Initiative schema:
//       prototype.name       → Initiative.name
//       prototype.type       → Initiative.value_fields.type
//       prototype.module     → Initiative.value_fields.module
//       prototype.owner      → Initiative.value_fields.owner
//       prototype.stage      → Initiative.value_stage
//       prototype.target $   → Initiative.value_target (string)
//       prototype.delivered $→ Initiative.value_delivered (string)
//       prototype.updatedAt  → Initiative.value_fields.updatedAt
//   • Stakeholders → M14 cs_stakeholders (champion=SPOC, commercial=Budget Owner)
//   • Power users  → client_contacts filtered to seniority ∈ {cxo,vp,director}

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
// 10-Jun · Deep-link support — Value Tracking's "✏️ Edit" sends users
// here with ?goal=<id>&init=<initId>. We read those params, auto-expand
// the goal, scroll to it, and pass editInitId down so InitiativeRow
// opens its editor on landing.
import { useNavigate, useSearchParams } from "react-router-dom";

import { api, ApiError } from "@/lib/api";
import { useNotify, usePrompt } from "@/components/DialogProvider";
import { useAccountFromLayout } from "../../AccountProfileLayout";
import {
  CATEGORY_LABELS,
  CSGOAL_CATEGORIES_NEW,
  type CSGoal,
  type CSGoalCategory,
  type CSGoalUpdate,
  type Initiative,
  type PhaseA,
  type PhaseB,
  type PhaseC,
} from "@/types/cs_goal";
import type { CSOnboarding, Stakeholder } from "@/types/cs_onboarding";
import type { Contact, ContactListResponse } from "@/types/contact";
// 09-Jun · G7 — touchpoint counts per initiative come from
// account_activities.linked_initiatives.
import type { Activity, ActivityCreate } from "@/types/signal";
// 10-Jun · Per-initiative touchpoint modal — uses the same ACT_CONF +
// ACTIVITY_TYPES vocabulary as the account-level Log Activity surface.
import { ACT_CONF, ACTIVITY_TYPES } from "@/types/signal";
import { cn } from "@/lib/utils";
// 09-Jun bug (Bug Tracker · Jun-8 #5) — surface VPD-extracted candidate
// goals on this tab so the CSM doesn't have to hunt for them on the
// document row.
import type {
  Document as AccountDocument,
  DocumentListResponse,
} from "@/types/document";
import type {
  CsGoalsExtractionResult,
  ExtractedGoal,
} from "@/types/cs_goals_extraction";
import type {
  VpdMetricsExtractionResult,
  ExtractedMetric,
} from "@/types/vpd_metrics_extraction";
import { VpdExtractionReview } from "@/components/VpdExtractionReview";

// ---------------------------------------------------------------------------
// Brand palette (locked)
// ---------------------------------------------------------------------------
const BRAND = {
  indigo: "#4A00F8",
  midnight: "#001137",
  bumblebee: "#FFE61E",
  fuscia: "#C344C7",
  aqua: "#35E1D4",
  red: "#CF4548",
  amber: "#F0BC41",
  green: "#6EC457",
  cardBorder: "#e4eaf6",
  bg: "#EAF1F5",
  t1: "#0d1b2e",
  t2: "#5a7896",
  t3: "#8496b0",
};

// ---------------------------------------------------------------------------
// Per-category Q1 option groups
// ---------------------------------------------------------------------------
const Q1_OPTIONS_BY_GROUP: Record<string, string[]> = {
  cost: [
    "Direct unit-price reduction",
    "Volume discount / bundling",
    "Cost avoidance (vs market inflation)",
    "Total cost of ownership reduction",
    "Spec rationalization",
    "Payment-term improvement",
    "Other",
  ],
  risk: [
    "Regulatory compliance (EUDR / CSDDD)",
    "Supply disruption mitigation",
    "Supplier financial-health monitoring",
    "Geopolitical exposure reduction",
    "ESG / sustainability compliance",
    "Concentration risk reduction",
    "Other",
  ],
  base: [
    "Reduce supplier count",
    "Consolidate spend on fewer vendors",
    "Eliminate Tier 2/3 redundancies",
    "Standardize specs across plants",
    "Single-source critical SKUs",
    "Other",
  ],
  adoption: [
    "Active user growth",
    "Module-depth (which features are used)",
    "Power-user identification",
    "Stakeholder coverage",
    "Recurring usage cadence",
    "Other",
  ],
};
function q1OptionsFor(cat: CSGoalCategory): string[] {
  const group: Record<CSGoalCategory, keyof typeof Q1_OPTIONS_BY_GROUP> = {
    cost_savings: "cost",
    cost_reduction: "cost",
    negotiation_leverage: "cost",
    should_cost_modeling: "cost",
    tco_optimization: "cost",
    competitive_benchmarking: "cost",
    category_strategy_market_dynamics: "cost",
    supply_demand_outlook: "cost",
    risk_mitigation: "risk",
    financial_risk_monitoring: "risk",
    supply_assurance: "risk",
    geopolitical_risk_management: "risk",
    esg_responsible_sourcing: "risk",
    base_rationalization: "base",
    enhanced_supplier_discovery: "base",
    lcc_ncc_sourcing_strategy: "base",
    adoption: "adoption",
    ai_driven_sourcing_transformations: "adoption",
    other: "cost",
  };
  return Q1_OPTIONS_BY_GROUP[group[cat] ?? "cost"];
}

const Q2_DONE_BY = [
  "Internal client team",
  "Other consultant",
  "Previous Beroe work",
  "Mixed (multiple sources)",
];
const Q2_BEROE_OFFER = [
  "Spend Analytics",
  "Opportunity Assessment (OA)",
  "Benchmarking",
  "Should-cost Modeling (Prism)",
  "Inflation Watch",
  "Market Movement Dashboard (MMD)",
  "Supplier Discovery",
  "Custom Research / Advisory",
  "Cirtuo (Sourcing Strategy)",
  "nnamu (Supplier Ownership)",
  "Hackett Benchmark",
  "Other",
];

// ---------------------------------------------------------------------------
// Initiative type catalog (prototype INIT_TYPES + STAGE_FLOW + STAGE_LBL)
// ---------------------------------------------------------------------------
interface InitType {
  label: string;
  module: string;
  icon: string;
}
const INIT_TYPES: InitType[] = [
  { label: "Market Intel Report", module: "LiVE.Ai", icon: "📄" },
  { label: "Spend Analytics", module: "Spend Analytics", icon: "💹" },
  { label: "Benchmarking", module: "Benchmarking", icon: "📊" },
  { label: "Opportunity Assessment (OA)", module: "OA", icon: "🧭" },
  { label: "Should-cost (Prism)", module: "Prism", icon: "🔮" },
  { label: "Inflation Watch refresh", module: "Inflation Watch", icon: "📉" },
  { label: "Cirtuo Strategy", module: "Cirtuo", icon: "🎯" },
  { label: "nnamu Event", module: "nnamu", icon: "🔗" },
  { label: "Custom Research", module: "Custom Credits", icon: "📚" },
  { label: "Supplier Discovery", module: "Supplier Discovery", icon: "🔍" },
  { label: "Supplier Watch Review", module: "Supplier Watch", icon: "🛡" },
  { label: "Consultation", module: "Custom Credits", icon: "💬" },
  // 09-Jun · G4 — beroe_value_flow_map.html · Stage 8 gap-pill:
  // "INIT_TYPES today is all research deliverables — needs Module Upsell
  // · Cross-sell · Seat Expansion added". Three commercial-side types
  // so initiatives that drive contract growth (not just delivery) get
  // tracked the same way as research deliverables.
  { label: "Module Upsell", module: "Growth", icon: "📈" },
  { label: "Cross-sell", module: "Growth", icon: "🔁" },
  { label: "Seat Expansion", module: "Growth", icon: "🪑" },
  { label: "Training Session", module: "LiVE.Ai", icon: "🎓" },
  { label: "Other", module: "", icon: "📌" },
];

const STAGE_FLOW: Partial<Record<CSGoalCategory, string[]>> = {
  cost_savings: ["identified", "committed", "implemented"],
  cost_reduction: ["identified", "committed", "implemented"],
  risk_mitigation: ["assessed", "deployed", "evidenced"],
  financial_risk_monitoring: ["assessed", "deployed", "evidenced"],
  supply_assurance: ["assessed", "deployed", "evidenced"],
  geopolitical_risk_management: ["assessed", "deployed", "evidenced"],
  base_rationalization: ["baselined", "in_progress", "achieved"],
  enhanced_supplier_discovery: ["baselined", "in_progress", "achieved"],
  adoption: ["activated", "growing", "embedded"],
  ai_driven_sourcing_transformations: ["activated", "growing", "embedded"],
  other: ["baseline", "in_progress", "delivered"],
};
function stagesFor(cat: CSGoalCategory): string[] {
  return STAGE_FLOW[cat] ?? STAGE_FLOW.other!;
}

const STAGE_LBL: Record<string, string> = {
  // 10-Jun · Stakeholder-requested 4-stage universal pipeline for the
  // post-lock initiative tracker.
  identification: "Identification",
  pipeline: "Pipeline",
  in_progress: "In Progress",
  delivered: "Delivered",
  // Legacy category-aware values — kept so existing rows display
  // correctly until the CSM saves them under the new vocabulary.
  identified: "Identified",
  committed: "Committed",
  implemented: "Implemented",
  assessed: "Assessed",
  deployed: "Deployed",
  evidenced: "Evidenced",
  baselined: "Baselined",
  achieved: "Achieved",
  activated: "Activated",
  growing: "Growing",
  embedded: "Embedded",
  baseline: "Baseline",
  deferred: "Deferred",
  not_pursued: "Not Pursued",
  not_started: "Identification",
};

const STAGE_COLOR: Record<string, string> = {
  // 10-Jun · 4-stage palette (Identification = neutral, Pipeline =
  // amber, In Progress = amber-strong, Delivered = green).
  identification: BRAND.t3,
  pipeline: BRAND.amber,
  in_progress: BRAND.amber,
  delivered: BRAND.green,
  // Legacy
  identified: BRAND.t3,
  baselined: BRAND.t3,
  activated: BRAND.t3,
  baseline: BRAND.t3,
  assessed: BRAND.t3,
  committed: BRAND.amber,
  deployed: BRAND.amber,
  growing: BRAND.amber,
  implemented: BRAND.green,
  achieved: BRAND.green,
  evidenced: BRAND.green,
  embedded: BRAND.green,
  deferred: BRAND.t3,
  not_pursued: BRAND.red,
  not_started: BRAND.t3,
};

// 10-Jun · The 4 universal post-lock stages, in order.
const STAGES_4: readonly ["identification", "pipeline", "in_progress", "delivered"] = [
  "identification",
  "pipeline",
  "in_progress",
  "delivered",
];

// ---------------------------------------------------------------------------
// Category metadata (icons)
// ---------------------------------------------------------------------------
const CATEGORY_EMOJI: Partial<Record<CSGoalCategory, string>> = {
  cost_savings: "💰",
  cost_reduction: "💰",
  negotiation_leverage: "🤝",
  should_cost_modeling: "📐",
  tco_optimization: "💸",
  competitive_benchmarking: "📊",
  category_strategy_market_dynamics: "🗺️",
  supply_demand_outlook: "📈",
  enhanced_supplier_discovery: "🔍",
  base_rationalization: "📦",
  risk_mitigation: "🛡",
  financial_risk_monitoring: "🛡",
  supply_assurance: "🚚",
  geopolitical_risk_management: "🌍",
  lcc_ncc_sourcing_strategy: "🌐",
  adoption: "🎯",
  ai_driven_sourcing_transformations: "🤖",
  esg_responsible_sourcing: "♻️",
  other: "📌",
};

// ---------------------------------------------------------------------------
// Q ↔ phase mapping helpers
// ---------------------------------------------------------------------------
interface Q1 {
  means: string[];
  otherText: string;
  confirmation: string;
}
interface Q2 {
  hasBackground: string;
  doneBy: string[];
  doneByOther: string;
  backgroundNotes: string;
  beroeOffer: string[];
  cadence: string;
}
interface Q3 {
  categoryFocus: string;
  baseline: string;
  agreedTarget: string;
  measureMethod: string;
  timeline: string;
}
function readQ1(pa: PhaseA): Q1 {
  return {
    means: (pa.q1_means as string[]) ?? [],
    otherText: (pa.q1_other_text as string) ?? "",
    confirmation: (pa.q1_confirmation as string) ?? "",
  };
}
function readQ2(pb: PhaseB): Q2 {
  return {
    hasBackground: (pb.q2_has_background as string) ?? "",
    doneBy: (pb.q2_done_by as string[]) ?? [],
    doneByOther: (pb.q2_done_by_other as string) ?? "",
    backgroundNotes: (pb.q2_background_notes as string) ?? "",
    beroeOffer: (pb.q2_beroe_offer as string[]) ?? [],
    cadence: (pb.q2_cadence as string) ?? "",
  };
}
function readQ3(pc: PhaseC): Q3 {
  return {
    categoryFocus: (pc.q3_category_focus as string) ?? pc.category_focus ?? "",
    baseline: (pc.q3_baseline as string) ?? pc.baseline ?? "",
    agreedTarget: (pc.q3_agreed_target as string) ?? pc.agreed_target ?? "",
    measureMethod: (pc.q3_measure_method as string) ?? pc.measure_method ?? "",
    timeline: (pc.q3_timeline as string) ?? pc.timeline ?? "",
  };
}

function canQ1(q: Q1) {
  return q.means.length > 0 && q.confirmation.trim().length > 5;
}
function canQ2(q: Q2) {
  if (!q.hasBackground) return false;
  if (q.hasBackground === "Yes, complete")
    return q.doneBy.length > 0 && q.cadence.trim().length > 0;
  if (q.hasBackground === "Yes, partial")
    return (
      q.doneBy.length > 0 &&
      q.beroeOffer.length > 0 &&
      q.cadence.trim().length > 0
    );
  if (q.hasBackground === "No")
    return q.beroeOffer.length > 0 && q.cadence.trim().length > 0;
  return false;
}
function canQ3(q: Q3) {
  return (
    q.categoryFocus.trim().length > 0 &&
    q.baseline.trim().length > 0 &&
    q.agreedTarget.trim().length > 0 &&
    q.measureMethod.trim().length > 0 &&
    q.timeline.trim().length > 0
  );
}

// ---------------------------------------------------------------------------
// Initiative read/write helpers
// ---------------------------------------------------------------------------
interface ProtoInit {
  id: string;
  name: string;
  type: string;
  module: string;
  owner: string;
  stage: string;
  targetContribution: number;
  delivered: number;
  updatedAt: string;
  // 09-Jun · G6 — value_flow_map Stage 9 gap-pill.
  evidenceConfirmed: boolean;
  evidenceUrl: string;
  // 10-Jun · Stakeholder ask — 4-stage universal pipeline + new
  // Notes + % completion columns. `targetText` / `deliveredText` are
  // the raw strings the CSM typed (no $ prefix) so the column can
  // hold units / % / counts in addition to currency. Numeric
  // `targetContribution` / `delivered` stay derived (via parseUsdNum)
  // for the goal-vs-initiative target-delta math.
  status: "identification" | "pipeline" | "in_progress" | "delivered";
  notes: string | null;
  completionPct: number | null;
  targetText: string;
  deliveredText: string;
  // 12-Jun bug 250 — evidence/supporting docs attached to this initiative.
  // Stored in value_fields.attachments so they survive the JSONB round-trip.
  attachments: InitiativeAttachment[];
}

// 12-Jun bug 250 — lightweight pointer to a doc uploaded via the regular
// /documents pipeline (kind=initiative_doc). File lives in Storage + the
// documents table; the initiative just keeps the reference.
interface InitiativeAttachment {
  document_id: string;
  filename: string;
  uploaded_at: string;
}
function parseUsdNum(s: string | null | undefined): number {
  if (!s) return 0;
  const m = String(s).match(/(\d+\.?\d*)/);
  if (!m) return 0;
  let v = Number(m[1]);
  if (/m/i.test(s)) v *= 1_000_000;
  else if (/k/i.test(s)) v *= 1_000;
  return v;
}
function readInit(it: Initiative, idx: number): ProtoInit {
  const vf = (it.value_fields ?? {}) as Record<string, unknown>;
  // 10-Jun · Pull the 4-stage `status` from the backend Initiative if
  // it's set to one of the new values; otherwise default to
  // identification (legacy `not_started` rows surface here too).
  const rawStatus = it.status as string | undefined;
  const status: ProtoInit["status"] =
    rawStatus === "pipeline" ||
    rawStatus === "in_progress" ||
    rawStatus === "delivered"
      ? rawStatus
      : "identification";
  const targetText = (it.value_target ?? "").replace(/^\$/, "").trim();
  const deliveredText = (it.value_delivered ?? "").replace(/^\$/, "").trim();
  return {
    id: (vf.id as string) ?? `i_${idx}`,
    name: it.name,
    type: (vf.type as string) ?? "Other",
    module: (vf.module as string) ?? "",
    owner: (vf.owner as string) ?? "",
    stage: it.value_stage ?? "",
    targetContribution: parseUsdNum(it.value_target),
    delivered: parseUsdNum(it.value_delivered),
    updatedAt:
      (vf.updatedAt as string) ?? new Date().toISOString().slice(0, 10),
    evidenceConfirmed: vf.evidenceConfirmed === true,
    evidenceUrl: typeof vf.evidenceUrl === "string" ? vf.evidenceUrl : "",
    status,
    notes: it.notes ?? null,
    completionPct:
      typeof it.completion_pct === "number" ? it.completion_pct : null,
    targetText,
    deliveredText,
    // 12-Jun bug 250 — read attachments from value_fields (default []).
    attachments: Array.isArray(vf.attachments)
      ? (vf.attachments as InitiativeAttachment[])
      : [],
  };
}
function writeInit(p: ProtoInit): Initiative {
  return {
    name: p.name,
    // 10-Jun · Status now comes from the explicit 4-stage selector,
    // not derived from delivered/target.
    status: p.status,
    value_stage: p.stage,
    // 10-Jun · Save raw target/delivered text without the $ prefix
    // so the column can hold any unit. Fall back to the numeric
    // value (for back-compat with rows that still type via NumField).
    value_target:
      p.targetText && p.targetText.length > 0
        ? p.targetText
        : p.targetContribution
          ? String(p.targetContribution)
          : null,
    value_delivered:
      p.deliveredText && p.deliveredText.length > 0
        ? p.deliveredText
        : p.delivered
          ? String(p.delivered)
          : null,
    notes: p.notes,
    completion_pct: p.completionPct,
    client_acknowledged: "pending",
    value_fields: {
      id: p.id,
      type: p.type,
      module: p.module,
      owner: p.owner,
      updatedAt: p.updatedAt,
      evidenceConfirmed: p.evidenceConfirmed,
      evidenceUrl: p.evidenceUrl,
      // 12-Jun bug 250 — persist attachments through the JSONB round-trip.
      attachments: p.attachments ?? [],
    },
    client_data: [],
    value_history: [],
  };
}

// ---------------------------------------------------------------------------
// Status derivation
// ---------------------------------------------------------------------------
type ProtoStatus = "pending" | "in-progress" | "aligned" | "frozen" | "flagged" | "removed";

function statusOf(g: CSGoal): ProtoStatus {
  if (g.validation_status === "removed" || g.deleted_at) return "removed";
  if (g.validation_status === "flagged") return "flagged";
  if (g.validation_status === "accepted") return "frozen";
  const c1 = !!g.phase_a_completed_at;
  const c2 = !!g.phase_b_completed_at;
  const c3 = !!g.phase_c_completed_at;
  if (c1 && c2 && c3) return "aligned";
  if (c1 || c2 || c3) return "in-progress";
  return "pending";
}
function progressOf(g: CSGoal): { delivered: number; target: number; pct: number } {
  const delivered = g.initiatives.reduce(
    (s, i) => s + parseUsdNum(i.value_delivered),
    0,
  );
  const target = parseUsdNum(g.target_value);
  const pct = target ? Math.min(100, Math.round((delivered / target) * 100)) : 0;
  return { delivered, target, pct };
}
function fmtUsd(n: number): string {
  if (!n) return "$0";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toLocaleString("en-US")}`;
}
function fd(s: string | null | undefined): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Status pill styles
// ---------------------------------------------------------------------------
const STATUS_LABEL: Record<ProtoStatus, string> = {
  pending: "Pending",
  "in-progress": "In progress",
  aligned: "Ready to freeze",
  frozen: "Frozen",
  flagged: "Flagged",
  removed: "Removed",
};
const STATUS_STYLE: Record<ProtoStatus, React.CSSProperties> = {
  pending: { background: "#f1f5f9", color: "#64748b" },
  "in-progress": { background: "#ede6ff", color: BRAND.indigo },
  aligned: { background: "#f5e0f6", color: BRAND.fuscia },
  frozen: { background: "#d4f5e5", color: "#146a45" },
  flagged: { background: "#fef0c0", color: "#8a4510" },
  removed: { background: "#f1f5f9", color: "#94a3b8" },
};

// ---------------------------------------------------------------------------
// NextAction (cascading priority banner)
// ---------------------------------------------------------------------------
interface NextAction {
  kind: "pending" | "in-progress" | "aligned" | "no-init" | "healthy" | "empty";
  headline: string;
  sub: string;
  goalId: string | null;
  icon: string;
}
function nextActionOf(goals: CSGoal[]): NextAction {
  if (goals.length === 0) {
    return {
      kind: "empty",
      icon: "🎯",
      headline: "Add a goal from the VDD or success contract to begin",
      sub: "Pull each business outcome the client signed up for into its own goal card.",
      goalId: null,
    };
  }
  const buckets = groupByStatus(goals);
  if (buckets.pending.length > 0) {
    const g = buckets.pending[0];
    return {
      kind: "pending",
      icon: "🎯",
      headline: `${buckets.pending.length} goal${buckets.pending.length > 1 ? "s" : ""} need alignment — start with "${g.title}"`,
      sub: "Click below to define what success means with the client.",
      goalId: g.id,
    };
  }
  if (buckets.inprog.length > 0) {
    const g = buckets.inprog[0];
    const n = g.phase_a_completed_at
      ? g.phase_b_completed_at
        ? 3
        : 2
      : 1;
    return {
      kind: "in-progress",
      icon: "⏭",
      headline: `Continue aligning "${g.title}" — Question ${n} of 3`,
      sub: "You're partway through. Pick up where you left off.",
      goalId: g.id,
    };
  }
  if (buckets.aligned.length > 0) {
    const g = buckets.aligned[0];
    return {
      kind: "aligned",
      icon: "🔒",
      headline: `"${g.title}" is ready to freeze`,
      sub: "All 3 questions answered. Lock it in to start tracking initiatives.",
      goalId: g.id,
    };
  }
  const noInit = buckets.frozen.filter((g) => g.initiatives.length === 0);
  if (noInit.length > 0) {
    const g = noInit[0];
    return {
      kind: "no-init",
      icon: "➕",
      headline: `"${g.title}" has no initiatives yet`,
      sub: "Add the first initiative — what work will achieve this goal?",
      goalId: g.id,
    };
  }
  return {
    kind: "healthy",
    icon: "✓",
    headline: "All goals on track",
    sub: "Update value tracking or schedule the next checkpoint when ready.",
    goalId: null,
  };
}
function groupByStatus(goals: CSGoal[]) {
  const out = {
    pending: [] as CSGoal[],
    inprog: [] as CSGoal[],
    aligned: [] as CSGoal[],
    frozen: [] as CSGoal[],
    flagged: [] as CSGoal[],
  };
  for (const g of goals) {
    const s = statusOf(g);
    if (s === "pending") out.pending.push(g);
    else if (s === "in-progress") out.inprog.push(g);
    else if (s === "aligned") out.aligned.push(g);
    else if (s === "frozen") out.frozen.push(g);
    else if (s === "flagged") out.flagged.push(g);
  }
  return out;
}

// ===========================================================================
// Main tab
// ===========================================================================
type FilterKey = "all" | "pending" | "aligned" | "frozen" | "flagged";

export default function GoalAlignmentTab() {
  const account = useAccountFromLayout();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<FilterKey>("all");
  // 12-Jun bug 248-a — "Only Success Goals from the VPD should be used."
  // Default the tab to VPD-sourced goals; a toggle reveals all. Null =
  // not-yet-initialised so the effect below can pick a sensible default
  // based on whether the account actually has any VPD goals.
  const [sourceFilter, setSourceFilter] = useState<"vpd" | "all" | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [openQ, setOpenQ] = useState<Record<string, 1 | 2 | 3 | null>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [editingStakeholders, setEditingStakeholders] = useState(false);

  // 10-Jun · Deep-link from Value Tracking — read ?goal=<id>&init=<id>.
  // editInitId persists in component state (not URL) so refreshing the
  // tab doesn't keep re-opening the editor after the user has closed it.
  const [searchParams, setSearchParams] = useSearchParams();
  const [editInitId, setEditInitId] = useState<string | null>(null);

  useEffect(() => {
    const goalId = searchParams.get("goal");
    const initId = searchParams.get("init");
    if (!goalId) return;
    // Expand the target goal so the initiative is rendered.
    setExpanded((s) => {
      if (s.has(goalId)) return s;
      const next = new Set(s);
      next.add(goalId);
      return next;
    });
    if (initId) setEditInitId(initId);
    // Scroll the goal into view on the next paint.
    requestAnimationFrame(() => {
      const el = document.getElementById(`goal-${goalId}`);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    // Strip the query params so subsequent toggles don't re-trigger.
    const next = new URLSearchParams(searchParams);
    next.delete("goal");
    next.delete("init");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const goalsQ = useQuery<{ items: CSGoal[] }>({
    queryKey: ["cs-goals", account.id, false],
    queryFn: () =>
      api.get(`/api/v1/accounts/${account.id}/cs-goals?include_deleted=false`),
  });
  const goals = useMemo(() => goalsQ.data?.items ?? [], [goalsQ.data]);

  // 12-Jun bug 248-a — count VPD-sourced goals; once loaded, default the
  // source filter to "vpd" if any exist, else "all" (so an account with
  // only manual goals isn't shown an empty list).
  const vpdCount = useMemo(
    () => goals.filter((g) => g.source === "vpd").length,
    [goals],
  );
  useEffect(() => {
    if (sourceFilter === null && !goalsQ.isLoading) {
      setSourceFilter(vpdCount > 0 ? "vpd" : "all");
    }
  }, [sourceFilter, goalsQ.isLoading, vpdCount]);

  // 09-Jun bug (Bug Tracker · Jun-8 #5) — VPD candidate-goals banner.
  // The worker extracts candidate goals + metrics from every VPD upload
  // (workers/tasks.py). Previously the only way to review them was the
  // pulsing pill on the VPD doc row in the Documents tab. Bug report
  // said: "Goals should automatically [be derived] from VPD. No Goals
  // showing." Fix: surface the same review modal directly on this tab
  // so the CSM can click "Review N candidates" without going hunting.
  const vpdDocsQ = useQuery<DocumentListResponse>({
    queryKey: ["documents", account.id, "vpd"],
    queryFn: () =>
      api.get<DocumentListResponse>(
        `/api/v1/accounts/${account.id}/documents?kind=vpd`,
      ),
  });
  const latestVpdWithGoals = useMemo<AccountDocument | null>(() => {
    const items = vpdDocsQ.data?.items ?? [];
    for (const d of items) {
      if (d.deleted_at) continue;
      const g = d.cs_goals_extracted as unknown as
        | CsGoalsExtractionResult
        | null
        | undefined;
      const m = d.metrics_extracted as unknown as
        | VpdMetricsExtractionResult
        | null
        | undefined;
      const gn = (g?.goals?.length ?? 0);
      const mn = (m?.metrics?.length ?? 0);
      if (gn > 0 || mn > 0) return d;
    }
    return null;
  }, [vpdDocsQ.data]);
  const [vpdReviewOpen, setVpdReviewOpen] = useState(false);

  const csOnbQ = useQuery<CSOnboarding>({
    queryKey: ["cs-onboarding", account.id],
    queryFn: () =>
      api.get<CSOnboarding>(`/api/v1/accounts/${account.id}/cs-onboarding`),
  });
  const contactsQ = useQuery<ContactListResponse>({
    queryKey: ["client-contacts", account.id],
    queryFn: () =>
      api.get<ContactListResponse>(
        `/api/v1/accounts/${account.id}/contacts`,
      ),
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["cs-goals", account.id] });
  }
  function invalidateOnboarding() {
    qc.invalidateQueries({ queryKey: ["cs-onboarding", account.id] });
  }

  const counts = useMemo(() => {
    const b = groupByStatus(goals);
    return {
      all: goals.length,
      pending: b.pending.length + b.inprog.length,
      aligned: b.aligned.length,
      frozen: b.frozen.length,
      flagged: b.flagged.length,
    };
  }, [goals]);

  const filtered = useMemo(() => {
    return goals.filter((g) => {
      const s = statusOf(g);
      if (s === "removed") return false;
      // 12-Jun bug 248-a — source gate (VPD-only by default).
      if (sourceFilter === "vpd" && g.source !== "vpd") return false;
      if (filter === "all") return true;
      if (filter === "pending")
        return s === "pending" || s === "in-progress";
      if (filter === "aligned") return s === "aligned";
      if (filter === "frozen") return s === "frozen";
      if (filter === "flagged") return s === "flagged";
      return true;
    });
  }, [goals, filter, sourceFilter]);

  const next = useMemo(() => nextActionOf(goals), [goals]);

  function handleNextAction() {
    if (next.kind === "healthy" || next.kind === "empty") {
      if (next.kind === "empty") setAddOpen(true);
      return;
    }
    if (!next.goalId) return;
    setExpanded((s) => {
      const n = new Set(s);
      n.add(next.goalId!);
      return n;
    });
    if (next.kind === "no-init" || next.kind === "aligned") {
      // scroll & expand
    } else {
      const g = goals.find((x) => x.id === next.goalId);
      if (g) {
        setOpenQ((m) => ({
          ...m,
          [g.id]: !g.phase_a_completed_at
            ? 1
            : !g.phase_b_completed_at
              ? 2
              : 3,
        }));
      }
    }
    setTimeout(() => {
      document
        .getElementById("goal-" + next.goalId)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
  }

  if (goalsQ.isLoading) {
    return <div className="text-[12px] text-text-muted p-4">Loading goals…</div>;
  }

  // VPD candidate counts for banner.
  const vpdGoalsCount = latestVpdWithGoals
    ? ((latestVpdWithGoals.cs_goals_extracted as unknown as CsGoalsExtractionResult | null)
        ?.goals?.length ?? 0)
    : 0;
  const vpdMetricsCount = latestVpdWithGoals
    ? ((latestVpdWithGoals.metrics_extracted as unknown as VpdMetricsExtractionResult | null)
        ?.metrics?.length ?? 0)
    : 0;

  return (
    <div className="space-y-3">
      {latestVpdWithGoals && (vpdGoalsCount > 0 || vpdMetricsCount > 0) && (
        <VpdCandidateBanner
          goalsCount={vpdGoalsCount}
          metricsCount={vpdMetricsCount}
          docName={latestVpdWithGoals.filename}
          onOpen={() => setVpdReviewOpen(true)}
        />
      )}
      {vpdReviewOpen && latestVpdWithGoals && (
        <VpdExtractionReview
          accountId={account.id}
          documentName={latestVpdWithGoals.filename}
          goals={
            latestVpdWithGoals.cs_goals_extracted
              ? ({
                  ...(latestVpdWithGoals.cs_goals_extracted as unknown as CsGoalsExtractionResult),
                  goals: ((latestVpdWithGoals.cs_goals_extracted as unknown as CsGoalsExtractionResult)
                    .goals ?? []) as ExtractedGoal[],
                } satisfies CsGoalsExtractionResult)
              : null
          }
          metrics={
            latestVpdWithGoals.metrics_extracted
              ? ({
                  ...(latestVpdWithGoals.metrics_extracted as unknown as VpdMetricsExtractionResult),
                  metrics: ((latestVpdWithGoals.metrics_extracted as unknown as VpdMetricsExtractionResult)
                    .metrics ?? []) as ExtractedMetric[],
                } satisfies VpdMetricsExtractionResult)
              : null
          }
          initialTab="goals"
          onClose={() => setVpdReviewOpen(false)}
        />
      )}
      <NextActionBanner action={next} onClick={handleNextAction} />
      <StakeholderBar
        onboarding={csOnbQ.data}
        contacts={contactsQ.data?.items ?? []}
        accountId={account.id}
        editing={editingStakeholders}
        setEditing={setEditingStakeholders}
        onChanged={invalidateOnboarding}
      />
      {/* 12-Jun bug 248-a — source toggle. VPD = only goals extracted from
          a VPD (the bug's "only use VPD goals"); All = include manual ones. */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: BRAND.t3 }}>
          Source
        </span>
        {(["vpd", "all"] as const).map((k) => {
          const on = (sourceFilter ?? "all") === k;
          const label = k === "vpd" ? `VPD goals (${vpdCount})` : `All (${goals.length})`;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setSourceFilter(k)}
              className="text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors"
              style={
                on
                  ? { background: BRAND.indigo, color: "#fff", borderColor: BRAND.indigo }
                  : { background: "#fff", color: BRAND.t2, borderColor: BRAND.cardBorder }
              }
            >
              {label}
            </button>
          );
        })}
      </div>
      <FilterBar filter={filter} setFilter={setFilter} counts={counts} />

      <div className="flex items-center gap-2">
        <div
          className="text-[11.5px] flex-1"
          style={{ color: BRAND.t3 }}
        >
          {counts.all === 0
            ? "No goals yet."
            : `${counts.all} goal${counts.all === 1 ? "" : "s"} · ${counts.frozen} frozen`}
        </div>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="text-[11.5px] font-semibold px-3 py-1.5 rounded-card border"
          style={{
            borderColor: BRAND.cardBorder,
            color: BRAND.t2,
            background: "#fff",
          }}
        >
          + Add goal
        </button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState filter={filter} onAdd={() => setAddOpen(true)} />
      ) : (
        <div>
          {filtered.map((g) => (
            <GoalCard
              key={g.id}
              goal={g}
              expanded={expanded.has(g.id)}
              openQ={openQ[g.id] ?? null}
              setOpenQ={(n) => setOpenQ((m) => ({ ...m, [g.id]: n }))}
              onToggle={() =>
                setExpanded((s) => {
                  const n = new Set(s);
                  if (n.has(g.id)) n.delete(g.id);
                  else n.add(g.id);
                  return n;
                })
              }
              onChanged={invalidate}
              editInitId={editInitId}
              onEditInitConsumed={() => setEditInitId(null)}
            />
          ))}
        </div>
      )}

      {addOpen && (
        <AddGoalModal
          accountId={account.id}
          onClose={() => setAddOpen(false)}
          onCreated={() => {
            invalidate();
            setAddOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ===========================================================================
// NextAction banner
// ===========================================================================
function NextActionBanner({
  action,
  onClick,
}: {
  action: NextAction;
  onClick: () => void;
}) {
  const isHealthy = action.kind === "healthy";
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-card flex items-center gap-3.5 px-4 py-3 text-left transition"
      style={
        isHealthy
          ? {
              background: "#f0fdf4",
              border: `1.5px solid ${BRAND.green}40`,
            }
          : {
              background: `linear-gradient(135deg, ${BRAND.indigo}, #3800CC)`,
              color: "#fff",
              boxShadow: `0 6px 20px ${BRAND.indigo}25`,
            }
      }
    >
      <span className="text-[22px]">{action.icon}</span>
      <div className="flex-1">
        <div
          className="text-[13px] font-bold"
          style={{ color: isHealthy ? "#146a45" : "#fff" }}
        >
          {action.headline}
        </div>
        <div
          className="text-[11px] mt-0.5"
          style={{ color: isHealthy ? "#2fb87a" : "rgba(255,255,255,.85)" }}
        >
          {action.sub}
        </div>
      </div>
      {!isHealthy && <span className="text-[18px]">→</span>}
    </button>
  );
}

// ===========================================================================
// Stakeholder bar (+ edit panel)
// ===========================================================================
function StakeholderBar({
  onboarding,
  contacts,
  accountId,
  editing,
  setEditing,
  onChanged,
}: {
  onboarding: CSOnboarding | undefined;
  contacts: Contact[];
  accountId: string;
  editing: boolean;
  setEditing: (b: boolean) => void;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const stk = onboarding?.cs_stakeholders ?? {};
  const champion = stk.champion as Stakeholder | undefined;
  const commercial = stk.commercial as Stakeholder | undefined;
  const powerUsers = useMemo(
    () =>
      contacts
        .filter((c) =>
          ["cxo", "vp", "director"].includes(c.seniority ?? ""),
        )
        .slice(0, 5),
    [contacts],
  );

  if (editing) {
    return (
      <StakeholderEditPanel
        accountId={accountId}
        onboarding={onboarding}
        onClose={() => setEditing(false)}
        onSaved={() => {
          onChanged();
          setEditing(false);
        }}
      />
    );
  }

  // 13-Jun — when the stored "name" is actually an email (bad data /
  // import), still show something sensible: prefer a non-email name,
  // else show the email as the primary. Email sub-line only shows when
  // it differs from the primary, so we don't print it twice.
  const stkDisplay = (s?: Stakeholder) => {
    const nm = (s?.name ?? "").trim();
    const em = (s?.email ?? "").trim();
    const primary = nm || em || "—";
    const sub = em && em !== primary ? em : null;
    return { primary, sub };
  };
  const spD = stkDisplay(champion);
  const boD = stkDisplay(commercial);
  // 13-Jun — show power-user NAMES (was a bare 1/5 count, so the user
  // couldn't see who they were). Fall back to email/title when unnamed.
  const powerNames = powerUsers
    .map((c) => c.name?.trim() || c.email?.trim() || c.title?.trim())
    .filter(Boolean)
    .join(", ");

  return (
    <div
      className="rounded-card px-3.5 py-2.5 flex items-center gap-3"
      style={{
        background: "#fff",
        border: `1px solid ${BRAND.cardBorder}`,
      }}
    >
      <span className="text-[16px]">👥</span>
      <StakeholderItem label="SPOC" name={spD.primary} sub={spD.sub} />
      <Divider />
      <StakeholderItem label="Budget Owner" name={boD.primary} sub={boD.sub} />
      <Divider />
      {/* 13-Jun — Power users come from Client Contacts (seniority ∈
          CXO/VP/Director), so they're managed there, not in the SPOC/
          Budget-Owner edit panel. Show names + a clear who/where hint +
          a direct route to the contacts page. */}
      <div
        className="min-w-0"
        title="Power users = Client Contacts with seniority CXO, VP or Director. Add or edit them in Client Contacts."
      >
        <div
          className="text-[9.5px] font-bold uppercase tracking-wider"
          style={{ color: BRAND.t3 }}
        >
          Power users · {powerUsers.length}/5
        </div>
        <b className="text-[12.5px] block truncate" style={{ color: BRAND.t1 }} title={powerNames || undefined}>
          {powerNames || "None listed yet"}
        </b>
        <button
          type="button"
          onClick={() => navigate(`/accounts/${accountId}/contacts`)}
          className="text-[10px] font-semibold mt-0.5"
          style={{ color: BRAND.indigo }}
          title="Power users are senior Client Contacts (CXO / VP / Director). Manage them in Client Contacts."
        >
          + Add / edit in Client Contacts →
        </button>
      </div>
      <div className="flex-1" />
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-[11px] font-semibold px-2.5 py-1 rounded-card border self-start"
        style={{
          borderColor: BRAND.cardBorder,
          color: BRAND.t2,
          background: "#fff",
        }}
        title="Edit SPOC + Budget Owner"
      >
        ✏️ Edit SPOC / Budget Owner
      </button>
    </div>
  );
}

function StakeholderItem({
  label,
  name,
  sub,
}: {
  label: string;
  name: string;
  // 13-Jun — optional secondary line: email for SPOC/Budget Owner, or the
  // roster of power-user names so they're actually visible (was count-only).
  sub?: string | null;
}) {
  return (
    <div className="min-w-0">
      <div
        className="text-[9.5px] font-bold uppercase tracking-wider"
        style={{ color: BRAND.t3 }}
      >
        {label}
      </div>
      <b className="text-[12.5px] block truncate" style={{ color: BRAND.t1 }} title={name}>
        {name}
      </b>
      {sub && (
        <div
          className="text-[10px] truncate"
          style={{ color: BRAND.t3 }}
          title={sub}
        >
          {sub}
        </div>
      )}
    </div>
  );
}
function Divider() {
  return (
    <div
      className="self-stretch w-px"
      style={{ background: BRAND.cardBorder, margin: "2px 0" }}
    />
  );
}

function StakeholderEditPanel({
  accountId,
  onboarding,
  onClose,
  onSaved,
}: {
  accountId: string;
  onboarding: CSOnboarding | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  const stk = (onboarding?.cs_stakeholders ?? {}) as Record<
    string,
    Stakeholder
  >;
  const [spoc, setSpoc] = useState<Stakeholder>({
    name: stk.champion?.name ?? "",
    email: stk.champion?.email ?? "",
    phone: stk.champion?.phone ?? "",
  });
  const [budget, setBudget] = useState<Stakeholder>({
    name: stk.commercial?.name ?? "",
    email: stk.commercial?.email ?? "",
    phone: stk.commercial?.phone ?? "",
  });

  // 12-Jun bug 239 — Same-person guard removed. Stakeholder feedback:
  // POC / Budget Owner / Primary Contact can legitimately be the same
  // individual at the client. Removed both the local checks AND the
  // backend `_dedup_check` it mirrored.

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/api/v1/accounts/${accountId}/cs-onboarding`, {
        cs_stakeholders: {
          champion: spoc,
          commercial: budget,
        },
      }),
    onSuccess: onSaved,
  });

  const errMsg = save.error
    ? save.error instanceof ApiError
      ? save.error.message
      : "Couldn't save stakeholders — please try again."
    : null;

  return (
    <div
      className="rounded-card p-4"
      style={{
        background: "#fafbff",
        border: `1.5px solid ${BRAND.indigo}40`,
      }}
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[14px]">👥</span>
        <div
          className="text-[12px] font-bold"
          style={{ color: BRAND.t1 }}
        >
          Edit stakeholders
        </div>
        <span
          className="text-[10px]"
          style={{ color: BRAND.t3, fontWeight: 500 }}
        >
          · changes are versioned in cs_onboarding audit log
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <StakeholderEditBlock
          label="SPOC / Gatekeeper"
          stake={spoc}
          set={setSpoc}
        />
        <StakeholderEditBlock
          label="Budget Owner"
          stake={budget}
          set={setBudget}
        />
      </div>
      <div
        className="text-[10.5px] mb-2"
        style={{ color: BRAND.t3 }}
      >
        Power users are sourced from <b>Client Contacts</b> (seniority ∈
        CXO/VP/Director). To add or edit power users, head to the Pre-Sales →
        Client Contacts shortcut.
      </div>
      {errMsg && (
        <div
          className="rounded-card px-3 py-2 mb-2.5 text-[11.5px]"
          style={{
            background: "#fff0f2",
            border: `1.5px solid ${BRAND.red}`,
            color: BRAND.red,
            fontWeight: 600,
          }}
        >
          {errMsg}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="text-[12px] font-semibold px-3 py-1.5 rounded-card border"
          style={{
            borderColor: BRAND.cardBorder,
            color: BRAND.t2,
            background: "#fff",
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            save.reset();
            save.mutate();
          }}
          disabled={save.isPending}
          className="text-[12px] font-semibold px-3 py-1.5 rounded-card text-white disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: BRAND.indigo }}
        >
          {save.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

function StakeholderEditBlock({
  label,
  stake,
  set,
}: {
  label: string;
  stake: Stakeholder;
  set: (s: Stakeholder) => void;
}) {
  return (
    <div>
      <div
        className="text-[10.5px] font-bold uppercase tracking-wider mb-1.5"
        style={{ color: BRAND.t2 }}
      >
        {label}
      </div>
      {/* 13-Jun — explicit field labels. Previously these inputs only had
          placeholder text ("Name"/"Email") which vanishes on typing, so
          users put the email in the Name field. Visible labels prevent it. */}
      <label className="block text-[9px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: BRAND.t3 }}>
        Name
      </label>
      <input
        type="text"
        value={stake.name ?? ""}
        onChange={(e) => set({ ...stake, name: e.target.value })}
        placeholder="e.g. Anand Kumar"
        className="w-full px-2.5 py-1.5 text-[12px] rounded-card border mb-1.5"
        style={{ borderColor: BRAND.cardBorder }}
      />
      <label className="block text-[9px] font-semibold uppercase tracking-wider mb-0.5" style={{ color: BRAND.t3 }}>
        Email
      </label>
      <input
        type="email"
        value={stake.email ?? ""}
        onChange={(e) => set({ ...stake, email: e.target.value })}
        placeholder="e.g. anand@company.com"
        className="w-full px-2.5 py-1.5 text-[12px] rounded-card border"
        style={{ borderColor: BRAND.cardBorder }}
      />
    </div>
  );
}

// ===========================================================================
// Filter bar
// ===========================================================================
function FilterBar({
  filter,
  setFilter,
  counts,
}: {
  filter: FilterKey;
  setFilter: (k: FilterKey) => void;
  counts: Record<FilterKey, number>;
}) {
  const allChips: { key: FilterKey; label: string; tone: string }[] = [
    { key: "all", label: "All", tone: BRAND.midnight },
    { key: "pending", label: "Needs alignment", tone: BRAND.indigo },
    { key: "aligned", label: "Ready to freeze", tone: BRAND.fuscia },
    { key: "frozen", label: "Frozen", tone: BRAND.green },
    { key: "flagged", label: "Flagged", tone: BRAND.amber },
  ];
  const chips = allChips.filter(
    (c) => c.key === "all" || counts[c.key] > 0,
  );
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((c) => {
        const active = filter === c.key;
        return (
          <button
            key={c.key}
            type="button"
            onClick={() => setFilter(c.key)}
            className="text-[11.5px] font-semibold px-3 py-1.5 rounded-card border inline-flex items-center gap-1.5"
            style={
              active
                ? { background: c.tone, borderColor: c.tone, color: "#fff" }
                : {
                    background: "#fff",
                    borderColor: BRAND.cardBorder,
                    color: BRAND.t2,
                  }
            }
          >
            {c.label}
            <span
              className="px-1.5 py-0.5 rounded-full text-[10px] font-bold"
              style={
                active
                  ? { background: "rgba(255,255,255,.25)" }
                  : { background: "#f1f5f9", color: BRAND.t3 }
              }
            >
              {counts[c.key]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ===========================================================================
// Empty state
// ===========================================================================
function EmptyState({
  filter,
  onAdd,
}: {
  filter: FilterKey;
  onAdd: () => void;
}) {
  if (filter === "all") {
    return (
      <div
        className="rounded-card border-2 border-dashed p-8 text-center"
        style={{ borderColor: BRAND.cardBorder }}
      >
        <div className="text-[28px] mb-2">🎯</div>
        <div
          className="text-[13px] font-bold mb-1"
          style={{ color: BRAND.midnight }}
        >
          No goals yet
        </div>
        <div
          className="text-[11.5px] mb-3"
          style={{ color: BRAND.t2 }}
        >
          Pull goals from the client's VDD or success contract — typically one
          per business outcome.
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="text-[12px] font-semibold px-3.5 py-2 rounded-card text-white"
          style={{ background: BRAND.indigo }}
        >
          + Add first goal
        </button>
      </div>
    );
  }
  return (
    <div
      className="rounded-card border p-6 text-center text-[12px]"
      style={{ borderColor: BRAND.cardBorder, color: BRAND.t2 }}
    >
      📭 No goals match this filter
    </div>
  );
}

// ===========================================================================
// Goal card
// ===========================================================================
function GoalCard({
  goal,
  expanded,
  openQ,
  setOpenQ,
  onToggle,
  onChanged,
  editInitId,
  onEditInitConsumed,
}: {
  goal: CSGoal;
  expanded: boolean;
  openQ: 1 | 2 | 3 | null;
  setOpenQ: (n: 1 | 2 | 3 | null) => void;
  onToggle: () => void;
  onChanged: () => void;
  // 10-Jun · Deep-link from Value Tracking — set when this goal is the
  // landing target. Threaded down to FrozenView → InitiativeRow which
  // opens its editor when init.id matches editInitId.
  editInitId?: string | null;
  onEditInitConsumed?: () => void;
}) {
  const status = statusOf(goal);
  const isFrozen = status === "frozen";
  const isFlagged = status === "flagged";
  const prog = progressOf(goal);

  // 12-Jun bug 249 — Stakeholder ask: "Option to edit the goal heading
  // captured from Solutioning." Inline pencil next to the title opens
  // a usePrompt() with the current value, then PATCHes the goal title.
  // Disabled on frozen goals (locked-once-validated invariant).
  const qc = useQueryClient();
  const prompt = usePrompt();
  const notify = useNotify();
  const accountId = goal.account_id;
  const renameTitle = useMutation({
    mutationFn: (next: string) =>
      api.patch<CSGoal>(`/api/v1/cs-goals/${goal.id}`, { title: next }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cs-goals", accountId] });
      qc.invalidateQueries({ queryKey: ["cs-goals", accountId, false] });
      qc.invalidateQueries({ queryKey: ["activity", accountId] });
      onChanged();
    },
    onError: (e: ApiError) =>
      notify({ title: "Couldn't rename goal", body: e.message, tone: "error" }),
  });
  const openTitleEditor = async () => {
    if (isFrozen) return;
    const next = await prompt({
      title: "Edit goal heading",
      body: "Renames just the title — alignment status + initiatives stay as they were.",
      initial: goal.title,
      placeholder: "Goal title",
      minLength: 3,
      maxLength: 200,
      confirmLabel: "Save",
    });
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed || trimmed === goal.title) return;
    renameTitle.mutate(trimmed);
  };

  const cardStyle: React.CSSProperties = isFrozen
    ? {
        borderColor: `${BRAND.green}40`,
        background: "linear-gradient(180deg,#f0fdf4,#fff 30%)",
      }
    : status === "aligned"
      ? {
          borderColor: `${BRAND.fuscia}60`,
          background: "linear-gradient(180deg,#fdf5ff,#fff 30%)",
        }
      : isFlagged
        ? {
            borderColor: BRAND.amber,
            background: "linear-gradient(180deg,#fff8eb,#fff 30%)",
          }
        : status === "in-progress"
          ? { borderColor: `${BRAND.indigo}40`, background: "#fff" }
          : { borderColor: BRAND.cardBorder, background: "#fff" };

  const qProg =
    (goal.phase_a_completed_at ? 1 : 0) +
    (goal.phase_b_completed_at ? 1 : 0) +
    (goal.phase_c_completed_at ? 1 : 0);

  return (
    <div
      id={`goal-${goal.id}`}
      className="rounded-card border-[1.5px] mb-2.5 overflow-hidden transition"
      style={cardStyle}
    >
      <div
        onClick={onToggle}
        className="grid items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50/50"
        style={{ gridTemplateColumns: "36px 1fr 130px 140px 80px 24px" }}
      >
        <div
          className="w-9 h-9 rounded-card flex items-center justify-center text-[16px]"
          style={{
            background: isFrozen
              ? "#d4f5e5"
              : status === "aligned"
                ? "#f5e0f6"
                : "#f3f0ff",
          }}
        >
          {CATEGORY_EMOJI[goal.category] ?? "📌"}
        </div>
        <div className="min-w-0">
          <div
            className="text-[13px] font-bold leading-snug flex items-center gap-1.5 group"
            style={{ color: BRAND.t1 }}
          >
            <span className="truncate" title={goal.title}>
              {goal.title}
            </span>
            {/* 12-Jun bug 249 — inline-edit pencil. Hidden on frozen
                goals (post-validation lock). Stops click propagation so
                the card doesn't toggle expand when editing. */}
            {!isFrozen && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  openTitleEditor();
                }}
                className="opacity-0 group-hover:opacity-100 text-[12px] leading-none px-1 rounded hover:bg-slate-100 transition-opacity"
                title="Edit goal heading"
                aria-label="Edit goal heading"
                disabled={renameTitle.isPending}
              >
                ✏️
              </button>
            )}
          </div>
          <div className="text-[10.5px]" style={{ color: BRAND.t3 }}>
            {CATEGORY_LABELS[goal.category]}
            {goal.target_value ? ` · target ${goal.target_value}` : ""}
          </div>
        </div>
        <div>
          <span
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider whitespace-nowrap"
            style={STATUS_STYLE[status]}
          >
            {isFrozen ? "✓ " : ""}
            {STATUS_LABEL[status]}
          </span>
        </div>
        {isFrozen ? (
          <div className="flex flex-col gap-1">
            <div
              className="flex justify-between text-[10.5px]"
              style={{ color: BRAND.t2 }}
            >
              <span>
                <b style={{ color: BRAND.t1 }}>{fmtUsd(prog.delivered)}</b>{" "}
                <span style={{ opacity: 0.6 }}>
                  / {goal.target_value || "—"}
                </span>
              </span>
              <b>{prog.pct}%</b>
            </div>
            <div
              className="h-[5px] rounded-[3px] overflow-hidden"
              style={{ background: "#e8eef8" }}
            >
              <div
                className="h-full rounded-[3px] transition-all"
                style={{ width: `${prog.pct}%`, background: BRAND.green }}
              />
            </div>
          </div>
        ) : (
          <div className="opacity-40">
            <div
              className="text-[10.5px] italic"
              style={{ color: BRAND.t2 }}
            >
              not started
            </div>
          </div>
        )}
        <div
          className="text-[11px] text-right"
          style={{ color: BRAND.t3 }}
        >
          {isFrozen ? (
            <>
              <b style={{ color: BRAND.t1, fontSize: 14 }}>
                {goal.initiatives.length}
              </b>
              <br />
              <span style={{ fontSize: 9 }}>initiatives</span>
            </>
          ) : (
            <span style={{ fontSize: 10, fontStyle: "italic" }}>
              {qProg}/3 done
            </span>
          )}
        </div>
        <div
          className="text-center text-[11px] transition-transform"
          style={{
            color: BRAND.t3,
            transform: expanded ? "rotate(180deg)" : undefined,
          }}
        >
          ▼
        </div>
      </div>

      {expanded &&
        (isFrozen ? (
          <GoalFrozenBody
            goal={goal}
            onChanged={onChanged}
            editInitId={editInitId}
            onEditInitConsumed={onEditInitConsumed}
          />
        ) : (
          <GoalAlignmentBody
            goal={goal}
            openQ={openQ}
            setOpenQ={setOpenQ}
            onChanged={onChanged}
          />
        ))}
    </div>
  );
}

// ===========================================================================
// Goal body — alignment (non-frozen)
// ===========================================================================
function GoalAlignmentBody({
  goal,
  openQ,
  setOpenQ,
  onChanged,
}: {
  goal: CSGoal;
  openQ: 1 | 2 | 3 | null;
  setOpenQ: (n: 1 | 2 | 3 | null) => void;
  onChanged: () => void;
}) {
  const status = statusOf(goal);
  const isFlagged = status === "flagged";
  const prompt = usePrompt();

  const patch = useMutation({
    mutationFn: (body: CSGoalUpdate) =>
      api.patch<CSGoal>(`/api/v1/cs-goals/${goal.id}`, body),
    onSuccess: () => onChanged(),
  });
  const remove = useMutation({
    mutationFn: (reason: string) =>
      api.delete<CSGoal>(`/api/v1/cs-goals/${goal.id}`, { reason }),
    onSuccess: () => onChanged(),
  });

  function saveQ1(next: Q1, complete: boolean) {
    const phase_a: PhaseA = {
      ...goal.phase_a,
      q1_means: next.means,
      q1_other_text: next.otherText,
      q1_confirmation: next.confirmation,
      phase_a_complete: complete,
    };
    const body: CSGoalUpdate = { phase_a };
    if (complete && !goal.phase_a_completed_at)
      body.phase_a_completed_at = new Date().toISOString();
    patch.mutate(body);
    if (complete) setOpenQ(2);
  }
  function saveQ2(next: Q2, complete: boolean) {
    const phase_b: PhaseB = {
      ...goal.phase_b,
      q2_has_background: next.hasBackground,
      q2_done_by: next.doneBy,
      q2_done_by_other: next.doneByOther,
      q2_background_notes: next.backgroundNotes,
      q2_beroe_offer: next.beroeOffer,
      q2_cadence: next.cadence,
      phase_b_complete: complete,
    };
    const body: CSGoalUpdate = { phase_b };
    if (complete && !goal.phase_b_completed_at)
      body.phase_b_completed_at = new Date().toISOString();
    patch.mutate(body);
    if (complete) setOpenQ(3);
  }
  function saveQ3(next: Q3, complete: boolean) {
    const phase_c: PhaseC = {
      ...goal.phase_c,
      q3_category_focus: next.categoryFocus,
      q3_baseline: next.baseline,
      q3_agreed_target: next.agreedTarget,
      q3_measure_method: next.measureMethod,
      q3_timeline: next.timeline,
      phase_c_complete: complete,
    };
    const body: CSGoalUpdate = { phase_c };
    if (complete && !goal.phase_c_completed_at)
      body.phase_c_completed_at = new Date().toISOString();
    patch.mutate(body);
    if (complete) setOpenQ(null);
  }

  const freeze = () =>
    patch.mutate({ validation_status: "accepted", alignment_status: "aligned" });
  // 12-Jun bug 248-b — Re-Align: send the goal back for alignment with a
  // required note (vs the old canned-note flag). Reuses the `flagged`
  // validation state; the note lands in flag_note + the goal's history.
  // Toggling on an already-flagged goal clears it (back to pending).
  async function realign() {
    if (isFlagged) {
      patch.mutate({ validation_status: "pending", flag_note: null });
      return;
    }
    const note = await prompt({
      title: "Re-Align this goal",
      body: "Send this goal back for alignment with a note for whoever owns it (Solutioning / Sales). Recorded in the goal's history.",
      placeholder: "e.g. Target value doesn't match the signed VPD — please reconfirm.",
      minLength: 5,
      maxLength: 2000,
      multiline: true,
      confirmLabel: "Send Re-Align",
      tone: "warning",
    });
    if (note && note.trim().length >= 5) {
      patch.mutate({ validation_status: "flagged", flag_note: note.trim() });
    }
  }
  async function removeWithPrompt() {
    // 12-Jun bug 248-b — was window.prompt; usePrompt now owns `prompt`
    // in this scope, so use the dialog (consistent UX + enforces minLength).
    const reason = await prompt({
      title: "Remove this goal?",
      body: "Add a brief reason (kept in the audit trail).",
      placeholder: "e.g. Duplicate of another goal; superseded by the VPD refresh.",
      minLength: 5,
      maxLength: 600,
      multiline: true,
      confirmLabel: "Remove",
      tone: "error",
    });
    if (reason && reason.trim().length >= 5) remove.mutate(reason.trim());
  }

  return (
    <div
      className="px-4 pt-3 pb-3.5 border-t"
      style={{ borderColor: BRAND.cardBorder }}
    >
      {isFlagged && (
        <div
          className="rounded-card px-3 py-2 mb-3 text-[11.5px]"
          style={{
            background: "#fff8eb",
            border: `1.5px solid ${BRAND.amber}`,
            color: "#8a4510",
          }}
        >
          <b>↩ Re-alignment requested:</b> {goal.flag_note || "(no note)"}
        </div>
      )}

      <div
        className="text-[11px] font-bold uppercase tracking-wider mb-2.5"
        style={{ color: "#6b7fa0" }}
      >
        📝 Goal alignment — answer 3 questions, then lock the goal
      </div>

      <Q1Box
        goal={goal}
        openQ={openQ}
        setOpenQ={setOpenQ}
        onSave={saveQ1}
      />
      <Q2Box
        goal={goal}
        openQ={openQ}
        setOpenQ={setOpenQ}
        onSave={saveQ2}
      />
      <Q3Box
        goal={goal}
        openQ={openQ}
        setOpenQ={setOpenQ}
        onSave={saveQ3}
      />

      {status === "aligned" && (
        <button
          type="button"
          onClick={freeze}
          className="w-full mt-3 rounded-card flex items-center gap-3 px-4 py-3 text-left text-white"
          style={{
            background: `linear-gradient(135deg, ${BRAND.fuscia}, #8a1a90)`,
            boxShadow: `0 6px 20px ${BRAND.fuscia}25`,
          }}
        >
          <span className="text-[22px]">🔒</span>
          <div className="flex-1">
            <div className="text-[13px] font-bold">
              Lock this goal — start tracking
            </div>
            <div className="text-[11px] opacity-90">
              All 3 questions answered. Once locked, you'll add initiatives
              and track value delivered.
            </div>
          </div>
          <span className="text-[16px]">→</span>
        </button>
      )}

      <div
        className="flex justify-end gap-1.5 mt-3 pt-2.5"
        style={{ borderTop: `1px dashed ${BRAND.cardBorder}` }}
      >
        <button
          type="button"
          onClick={realign}
          className="text-[11px] font-semibold px-2.5 py-1.5 rounded-card border"
          style={{
            borderColor: BRAND.cardBorder,
            color: BRAND.t2,
            background: "#fff",
          }}
        >
          {isFlagged ? "Clear re-align" : "↩ Re-Align"}
        </button>
        <button
          type="button"
          onClick={removeWithPrompt}
          className="text-[11px] font-semibold px-2.5 py-1.5 rounded-card border"
          style={{
            borderColor: BRAND.cardBorder,
            color: BRAND.t2,
            background: "#fff",
          }}
        >
          ✕ Remove
        </button>
      </div>
    </div>
  );
}

// ===========================================================================
// Q-Box wrappers — Q1 / Q2 / Q3
// ===========================================================================
function Q1Box({
  goal,
  openQ,
  setOpenQ,
  onSave,
}: {
  goal: CSGoal;
  openQ: 1 | 2 | 3 | null;
  setOpenQ: (n: 1 | 2 | 3 | null) => void;
  onSave: (q: Q1, done: boolean) => void;
}) {
  const q1 = readQ1(goal.phase_a);
  const done = !!goal.phase_a_completed_at;
  const isOpen = openQ === 1;

  if (done && !isOpen) {
    return (
      <QBoxFrame state="done" onClick={() => setOpenQ(1)}>
        <QBoxHead
          state="done"
          num={1}
          title={`1 · What does "${trunc(goal.title, 50)}" mean?`}
        />
        <div className="px-3 pb-3 pl-11">
          <div
            className="text-[11.5px]"
            style={{ color: BRAND.t2, lineHeight: 1.6 }}
          >
            <b>Means:</b> {q1.means.join(" · ")}
            {q1.otherText ? " · " + q1.otherText : ""}
            <br />
            <b>Client confirmed:</b> {q1.confirmation}
          </div>
        </div>
      </QBoxFrame>
    );
  }
  if (!isOpen) {
    // 08-Jun · Surface saved-but-not-completed drafts inline so the
    // closed card doesn't hide user work after a "Save draft" click.
    const hasDraft =
      q1.means.length > 0 || !!q1.otherText || !!q1.confirmation;
    return (
      <QBoxFrame state="pending" onClick={() => setOpenQ(1)}>
        <QBoxHead
          state="pending"
          num={1}
          title="1 · What does this goal mean?"
          tag={hasDraft ? "Draft" : "Click to start"}
        />
        {hasDraft && (
          <div className="px-3 pb-3 pl-11">
            <div
              className="text-[11.5px]"
              style={{ color: BRAND.t2, lineHeight: 1.6 }}
            >
              {q1.means.length > 0 && (
                <>
                  <b>Means:</b> {q1.means.join(" · ")}
                  {q1.otherText ? " · " + q1.otherText : ""}
                </>
              )}
              {q1.confirmation && (
                <>
                  <br />
                  <b>Client confirmed:</b> {q1.confirmation}
                </>
              )}
            </div>
          </div>
        )}
      </QBoxFrame>
    );
  }
  return (
    <QBoxFrame state="active">
      <QBoxHead
        state="active"
        num={1}
        title={`1 · What does "${goal.title}" mean — concretely?`}
        tag="Active"
        onClick={() => setOpenQ(null)}
      />
      <div className="px-3 pb-3 pl-11">
        <Q1Editor
          cat={goal.category}
          q1={q1}
          onClose={() => setOpenQ(null)}
          onSave={onSave}
        />
      </div>
    </QBoxFrame>
  );
}

function Q2Box({
  goal,
  openQ,
  setOpenQ,
  onSave,
}: {
  goal: CSGoal;
  openQ: 1 | 2 | 3 | null;
  setOpenQ: (n: 1 | 2 | 3 | null) => void;
  onSave: (q: Q2, done: boolean) => void;
}) {
  const q2 = readQ2(goal.phase_b);
  const done = !!goal.phase_b_completed_at;
  const c1 = !!goal.phase_a_completed_at;
  const isOpen = openQ === 2;

  if (done && !isOpen) {
    return (
      <QBoxFrame state="done" onClick={() => setOpenQ(2)}>
        <QBoxHead
          state="done"
          num={2}
          title="2 · What background work has informed this?"
        />
        <div
          className="px-3 pb-3 pl-11 text-[11.5px]"
          style={{ color: BRAND.t2, lineHeight: 1.6 }}
        >
          <b>Done already?</b> {q2.hasBackground}
          {q2.doneBy.length > 0 && (
            <>
              {" · "}
              <b>by</b> {q2.doneBy.join(", ")}
              {q2.doneByOther ? ` (${q2.doneByOther})` : ""}
            </>
          )}
          {q2.beroeOffer.length > 0 && (
            <>
              <br />
              <b>Beroe to fill gap with:</b> {q2.beroeOffer.join(" · ")}
            </>
          )}
          {q2.cadence && (
            <>
              <br />
              <b>Cadence:</b> {q2.cadence}
            </>
          )}
        </div>
      </QBoxFrame>
    );
  }
  if (!isOpen) {
    const locked = !c1;
    // 08-Jun · "Save draft" clears phase_b_completed_at server-side, so
    // the done summary above doesn't render after a draft save. Without
    // this branch the user sees a bare "Pending" header and thinks
    // their input vanished. Surface the saved draft inline so the work
    // is visible at-a-glance even before they re-open the editor.
    const hasDraft =
      !!q2.hasBackground ||
      q2.doneBy.length > 0 ||
      q2.beroeOffer.length > 0 ||
      !!q2.cadence ||
      !!q2.backgroundNotes;
    return (
      <QBoxFrame
        state="pending"
        onClick={locked ? undefined : () => setOpenQ(2)}
      >
        <QBoxHead
          state="pending"
          num={2}
          title="2 · What background work has informed this?"
          tag={locked ? "Locked" : hasDraft ? "Draft" : "Pending"}
        />
        {hasDraft && (
          <div
            className="px-3 pb-3 pl-11 text-[11.5px]"
            style={{ color: BRAND.t2, lineHeight: 1.6 }}
          >
            {q2.hasBackground && (
              <>
                <b>Done already?</b> {q2.hasBackground}
              </>
            )}
            {q2.doneBy.length > 0 && (
              <>
                {" · "}
                <b>by</b> {q2.doneBy.join(", ")}
                {q2.doneByOther ? ` (${q2.doneByOther})` : ""}
              </>
            )}
            {q2.beroeOffer.length > 0 && (
              <>
                <br />
                <b>Beroe to fill gap with:</b> {q2.beroeOffer.join(" · ")}
              </>
            )}
            {q2.cadence && (
              <>
                <br />
                <b>Cadence:</b> {q2.cadence}
              </>
            )}
            {q2.backgroundNotes && (
              <>
                <br />
                <b>Notes:</b> {q2.backgroundNotes}
              </>
            )}
          </div>
        )}
      </QBoxFrame>
    );
  }
  return (
    <QBoxFrame state="active">
      <QBoxHead
        state="active"
        num={2}
        title="2 · What background work has informed this?"
        tag="Active"
        onClick={() => setOpenQ(null)}
      />
      <div className="px-3 pb-3 pl-11">
        <Q2Editor
          q2={q2}
          onClose={() => setOpenQ(null)}
          onSave={onSave}
        />
      </div>
    </QBoxFrame>
  );
}

function Q3Box({
  goal,
  openQ,
  setOpenQ,
  onSave,
}: {
  goal: CSGoal;
  openQ: 1 | 2 | 3 | null;
  setOpenQ: (n: 1 | 2 | 3 | null) => void;
  onSave: (q: Q3, done: boolean) => void;
}) {
  const q3 = readQ3(goal.phase_c);
  const done = !!goal.phase_c_completed_at;
  const c2 = !!goal.phase_b_completed_at;
  const isOpen = openQ === 3;

  if (done && !isOpen) {
    return (
      <QBoxFrame state="done" onClick={() => setOpenQ(3)}>
        <QBoxHead
          state="done"
          num={3}
          title="3 · Agreed target — the number, not the aspiration"
        />
        <div
          className="px-3 pb-3 pl-11 text-[11.5px]"
          style={{ color: BRAND.t2, lineHeight: 1.6 }}
        >
          <b>Categories:</b> {q3.categoryFocus}
          <br />
          <b>Baseline:</b> {q3.baseline} → <b>Target:</b> {q3.agreedTarget}
          <br />
          <b>Measured by:</b> {q3.measureMethod} · <b>By:</b>{" "}
          {fd(q3.timeline)}
        </div>
      </QBoxFrame>
    );
  }
  if (!isOpen) {
    const locked = !c2;
    // 08-Jun · Surface saved-but-not-completed drafts inline.
    const hasDraft =
      !!q3.categoryFocus ||
      !!q3.baseline ||
      !!q3.agreedTarget ||
      !!q3.measureMethod ||
      !!q3.timeline;
    return (
      <QBoxFrame
        state="pending"
        onClick={locked ? undefined : () => setOpenQ(3)}
      >
        <QBoxHead
          state="pending"
          num={3}
          title="3 · Agreed target — the number, not the aspiration"
          tag={locked ? "Locked" : hasDraft ? "Draft" : "Pending"}
        />
        {hasDraft && (
          <div
            className="px-3 pb-3 pl-11 text-[11.5px]"
            style={{ color: BRAND.t2, lineHeight: 1.6 }}
          >
            {q3.categoryFocus && (
              <>
                <b>Categories:</b> {q3.categoryFocus}
                <br />
              </>
            )}
            {(q3.baseline || q3.agreedTarget) && (
              <>
                <b>Baseline:</b> {q3.baseline || "—"} → <b>Target:</b>{" "}
                {q3.agreedTarget || "—"}
                <br />
              </>
            )}
            {(q3.measureMethod || q3.timeline) && (
              <>
                <b>Measured by:</b> {q3.measureMethod || "—"} · <b>By:</b>{" "}
                {fd(q3.timeline)}
              </>
            )}
          </div>
        )}
      </QBoxFrame>
    );
  }
  return (
    <QBoxFrame state="active">
      <QBoxHead
        state="active"
        num={3}
        title="3 · Agreed target — the number, not the aspiration"
        tag="Active"
        onClick={() => setOpenQ(null)}
      />
      <div className="px-3 pb-3 pl-11">
        <Q3Editor
          q3={q3}
          onClose={() => setOpenQ(null)}
          onSave={onSave}
        />
      </div>
    </QBoxFrame>
  );
}

// ---------------------------------------------------------------------------
// QBox shared shell
// ---------------------------------------------------------------------------
function QBoxFrame({
  state,
  children,
  onClick,
}: {
  state: "done" | "active" | "pending";
  children: React.ReactNode;
  onClick?: () => void;
}) {
  const style =
    state === "done"
      ? { border: `1.5px solid ${BRAND.green}50`, background: "#f0fdf4" }
      : state === "active"
        ? {
            border: `1.5px solid ${BRAND.indigo}`,
            background: "#fff",
            boxShadow: `0 3px 14px ${BRAND.indigo}1A`,
          }
        : {
            border: `1.5px solid ${BRAND.cardBorder}`,
            background: "#f8f9fc",
            opacity: 0.7,
            cursor: onClick ? "pointer" : "default",
          };
  return (
    <div
      className="rounded-card mb-2 overflow-hidden"
      style={style}
      onClick={state !== "active" ? onClick : undefined}
    >
      {children}
    </div>
  );
}

function QBoxHead({
  state,
  num,
  title,
  tag,
  onClick,
}: {
  state: "done" | "active" | "pending";
  num: number;
  title: string;
  tag?: string;
  onClick?: () => void;
}) {
  const numStyle =
    state === "done"
      ? { background: BRAND.green, color: "#fff", borderColor: BRAND.green }
      : state === "active"
        ? { background: BRAND.indigo, color: "#fff", borderColor: BRAND.indigo }
        : {
            background: "#e8eef8",
            color: BRAND.t3,
            borderColor: BRAND.cardBorder,
          };
  const tagText = tag ?? (state === "done" ? "Done" : "Pending");
  return (
    <div
      className="flex items-center gap-2 px-3 py-2.5"
      onClick={onClick}
      style={{ cursor: onClick ? "pointer" : "default" }}
    >
      <span
        className="w-6 h-6 rounded-full text-[11px] font-extrabold inline-flex items-center justify-center border-[1.5px]"
        style={numStyle}
      >
        {state === "done" ? "✓" : num}
      </span>
      <span
        className="text-[12px] font-bold flex-1"
        style={{ color: state === "pending" ? BRAND.t3 : BRAND.t1 }}
      >
        {title}
      </span>
      <span
        className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border"
        style={{
          background:
            state === "done"
              ? BRAND.green
              : state === "active"
                ? BRAND.indigo
                : "#fff",
          color: state === "pending" ? BRAND.t3 : "#fff",
          borderColor:
            state === "done"
              ? BRAND.green
              : state === "active"
                ? BRAND.indigo
                : BRAND.cardBorder,
        }}
      >
        {tagText}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Q1 / Q2 / Q3 editors
// ---------------------------------------------------------------------------
function Q1Editor({
  cat,
  q1,
  onClose,
  onSave,
}: {
  cat: CSGoalCategory;
  q1: Q1;
  onClose: () => void;
  onSave: (q: Q1, done: boolean) => void;
}) {
  const [draft, setDraft] = useState<Q1>(q1);
  const opts = q1OptionsFor(cat);
  function toggle(opt: string) {
    setDraft((d) => ({
      ...d,
      means: d.means.includes(opt)
        ? d.means.filter((x) => x !== opt)
        : [...d.means, opt],
    }));
  }
  return (
    <div className="space-y-2.5">
      <FieldLabel>
        Pick the type(s) of {CATEGORY_LABELS[cat]} — what does it mean here?
      </FieldLabel>
      <ChipGroup
        options={opts}
        selected={draft.means}
        onToggle={toggle}
      />
      {draft.means.includes("Other") && (
        <input
          type="text"
          placeholder="What does 'Other' mean here?"
          value={draft.otherText}
          onChange={(e) => setDraft({ ...draft, otherText: e.target.value })}
          className="w-full px-2.5 py-1.5 text-[12px] rounded-card border"
          style={{ borderColor: BRAND.cardBorder }}
        />
      )}
      <FieldLabel>
        What did the client confirm? (their exact words)
      </FieldLabel>
      <textarea
        value={draft.confirmation}
        onChange={(e) =>
          setDraft({ ...draft, confirmation: e.target.value })
        }
        placeholder="e.g. Jordan confirmed baseline = FY24 actuals. $1.6M = 2.4% on $68M baseline. Methodology signed off."
        rows={2}
        className="w-full px-2.5 py-1.5 text-[12px] rounded-card border resize-none"
        style={{ borderColor: BRAND.cardBorder }}
      />
      <EditorActions
        ready={canQ1(draft)}
        nextLabel="Done · continue to Q2 →"
        onSaveDraft={() => onSave(draft, false)}
        onComplete={() => onSave(draft, true)}
        onClose={onClose}
      />
    </div>
  );
}

function Q2Editor({
  q2,
  onClose,
  onSave,
}: {
  q2: Q2;
  onClose: () => void;
  onSave: (q: Q2, done: boolean) => void;
}) {
  const [draft, setDraft] = useState<Q2>(q2);
  const showBy =
    draft.hasBackground === "Yes, complete" ||
    draft.hasBackground === "Yes, partial";
  const showOffer =
    draft.hasBackground === "No" || draft.hasBackground === "Yes, partial";

  function toggle(key: "doneBy" | "beroeOffer", v: string) {
    setDraft((d) => ({
      ...d,
      [key]: d[key].includes(v)
        ? d[key].filter((x) => x !== v)
        : [...d[key], v],
    }));
  }
  return (
    <div className="space-y-2.5">
      <FieldLabel>Has any background work been done on this already?</FieldLabel>
      <ChipGroup
        options={["Yes, complete", "Yes, partial", "No"]}
        selected={[draft.hasBackground]}
        onToggle={(v) =>
          setDraft({
            ...draft,
            hasBackground: draft.hasBackground === v ? "" : v,
          })
        }
        singleSelect
      />
      {showBy && (
        <>
          <FieldLabel>By whom?</FieldLabel>
          <ChipGroup
            options={Q2_DONE_BY}
            selected={draft.doneBy}
            onToggle={(v) => toggle("doneBy", v)}
          />
          {draft.doneBy.includes("Other consultant") && (
            <input
              type="text"
              placeholder="Which consultant? (e.g. PwC, Deloitte)"
              value={draft.doneByOther}
              onChange={(e) =>
                setDraft({ ...draft, doneByOther: e.target.value })
              }
              className="w-full px-2.5 py-1.5 text-[12px] rounded-card border"
              style={{ borderColor: BRAND.cardBorder }}
            />
          )}
          <textarea
            value={draft.backgroundNotes}
            onChange={(e) =>
              setDraft({ ...draft, backgroundNotes: e.target.value })
            }
            placeholder="What did they find? Where are the gaps?"
            rows={2}
            className="w-full px-2.5 py-1.5 text-[12px] rounded-card border resize-none"
            style={{ borderColor: BRAND.cardBorder }}
          />
        </>
      )}
      {showOffer && (
        <>
          <FieldLabel>
            What can Beroe offer to{" "}
            {draft.hasBackground === "No" ? "do this work" : "close the gap"}?
          </FieldLabel>
          <ChipGroup
            options={Q2_BEROE_OFFER}
            selected={draft.beroeOffer}
            onToggle={(v) => toggle("beroeOffer", v)}
          />
          <div
            className="text-[10.5px] italic"
            style={{ color: BRAND.t3 }}
          >
            These will appear as suggested initiatives once the goal is locked.
          </div>
        </>
      )}
      {draft.hasBackground && (
        <>
          <FieldLabel>Refresh cadence for ongoing work</FieldLabel>
          <input
            type="text"
            value={draft.cadence}
            onChange={(e) =>
              setDraft({ ...draft, cadence: e.target.value })
            }
            placeholder="e.g. Quarterly with Ana · monthly Inflation Watch refresh"
            className="w-full px-2.5 py-1.5 text-[12px] rounded-card border"
            style={{ borderColor: BRAND.cardBorder }}
          />
        </>
      )}
      <EditorActions
        ready={canQ2(draft)}
        nextLabel="Done · continue to Q3 →"
        onSaveDraft={() => onSave(draft, false)}
        onComplete={() => onSave(draft, true)}
        onClose={onClose}
      />
    </div>
  );
}

function Q3Editor({
  q3,
  onClose,
  onSave,
}: {
  q3: Q3;
  onClose: () => void;
  onSave: (q: Q3, done: boolean) => void;
}) {
  const [draft, setDraft] = useState<Q3>(q3);
  function field<K extends keyof Q3>(k: K, v: Q3[K]) {
    setDraft({ ...draft, [k]: v });
  }
  return (
    <div className="space-y-2.5">
      <FieldLabel>Which specific categories?</FieldLabel>
      <textarea
        value={draft.categoryFocus}
        onChange={(e) => field("categoryFocus", e.target.value)}
        placeholder="e.g. Flexible packaging — laminates, films, pouches across 8 plants"
        rows={2}
        className="w-full px-2.5 py-1.5 text-[12px] rounded-card border resize-none"
        style={{ borderColor: BRAND.cardBorder }}
      />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <FieldLabel>Baseline (today)</FieldLabel>
          <input
            type="text"
            value={draft.baseline}
            onChange={(e) => field("baseline", e.target.value)}
            placeholder="e.g. $13.3M, 32 suppliers"
            className="w-full px-2.5 py-1.5 text-[12px] rounded-card border"
            style={{ borderColor: BRAND.cardBorder }}
          />
        </div>
        <div>
          <FieldLabel>Agreed target — the number</FieldLabel>
          <input
            type="text"
            value={draft.agreedTarget}
            onChange={(e) => field("agreedTarget", e.target.value)}
            placeholder="e.g. $2.4M savings"
            className="w-full px-2.5 py-1.5 text-[12px] rounded-card border"
            style={{ borderColor: BRAND.cardBorder }}
          />
        </div>
      </div>
      <FieldLabel>How will both parties confirm achievement?</FieldLabel>
      <input
        type="text"
        value={draft.measureMethod}
        onChange={(e) => field("measureMethod", e.target.value)}
        placeholder="e.g. Quarterly PO actuals vs Beroe benchmark, validated by Ana"
        className="w-full px-2.5 py-1.5 text-[12px] rounded-card border"
        style={{ borderColor: BRAND.cardBorder }}
      />
      <FieldLabel>Timeline</FieldLabel>
      <input
        type="date"
        value={draft.timeline.slice(0, 10)}
        onChange={(e) => field("timeline", e.target.value)}
        className="w-full px-2.5 py-1.5 text-[12px] rounded-card border"
        style={{ borderColor: BRAND.cardBorder }}
      />
      <EditorActions
        ready={canQ3(draft)}
        nextLabel="Done · ready to freeze →"
        onSaveDraft={() => onSave(draft, false)}
        onComplete={() => onSave(draft, true)}
        onClose={onClose}
      />
    </div>
  );
}

function EditorActions({
  ready,
  nextLabel,
  onSaveDraft,
  onComplete,
  onClose,
}: {
  ready: boolean;
  nextLabel: string;
  onSaveDraft: () => void;
  onComplete: () => void;
  onClose: () => void;
}) {
  // 08-Jun · Save Draft was silently working but users couldn't tell —
  // editor stays open, no toast, draft state already equals what got
  // saved. Surface a 2-second "Saved ✓" pip + a brief "Saving…" label
  // so the click visibly registers.
  const [phase, setPhase] = useState<"idle" | "saving" | "saved">("idle");
  const handleSave = () => {
    setPhase("saving");
    onSaveDraft();
    // The mutation is fire-and-forget at this layer; flash "Saved ✓"
    // shortly after click so the user gets a confirmation. The backend
    // PATCH is already in flight and the query refetch fans out on
    // success — this is purely a visual nudge.
    window.setTimeout(() => setPhase("saved"), 250);
    window.setTimeout(() => setPhase("idle"), 2000);
  };
  return (
    <div className="flex items-center gap-2 pt-1">
      <button
        type="button"
        onClick={onClose}
        className="text-[11px] font-semibold px-2.5 py-1.5 rounded-card border"
        style={{
          borderColor: BRAND.cardBorder,
          color: BRAND.t2,
          background: "#fff",
        }}
      >
        Close
      </button>
      <button
        type="button"
        onClick={handleSave}
        disabled={phase === "saving"}
        className="text-[11px] font-semibold px-2.5 py-1.5 rounded-card border disabled:opacity-60"
        style={{
          borderColor: BRAND.cardBorder,
          color: BRAND.t2,
          background: "#fff",
        }}
      >
        {phase === "saving" ? "Saving…" : "Save draft"}
      </button>
      {phase === "saved" && (
        <span
          className="text-[11px] font-semibold"
          style={{ color: BRAND.green }}
        >
          Saved ✓
        </span>
      )}
      <button
        type="button"
        disabled={!ready}
        onClick={onComplete}
        className="ml-auto text-[11.5px] font-semibold px-3 py-1.5 rounded-card text-white disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ background: BRAND.indigo }}
      >
        {nextLabel}
      </button>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[10.5px] font-bold uppercase tracking-wider"
      style={{ color: BRAND.t2 }}
    >
      {children}
    </div>
  );
}

function ChipGroup({
  options,
  selected,
  onToggle,
  singleSelect,
}: {
  options: string[];
  selected: string[];
  onToggle: (opt: string) => void;
  singleSelect?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const on = selected.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onToggle(opt)}
            className="text-[11px] font-semibold px-2.5 py-1 rounded-card border transition"
            style={
              on
                ? {
                    background: BRAND.indigo,
                    color: "#fff",
                    borderColor: BRAND.indigo,
                  }
                : {
                    background: "#fff",
                    color: BRAND.t2,
                    borderColor: BRAND.cardBorder,
                  }
            }
          >
            {(singleSelect ? on : on) ? "✓ " : ""}
            {opt}
          </button>
        );
      })}
    </div>
  );
}

function trunc(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// ===========================================================================
// Goal body — frozen (alignment summary + initiatives)
// ===========================================================================
function GoalFrozenBody({
  goal,
  onChanged,
  editInitId,
  onEditInitConsumed,
}: {
  goal: CSGoal;
  onChanged: () => void;
  // 10-Jun · Deep-link target — passed to the InitiativeRow whose id
  // matches editInitId so the editor opens automatically.
  editInitId?: string | null;
  onEditInitConsumed?: () => void;
}) {
  const [summaryOpen, setSummaryOpen] = useState(false);
  const q1 = readQ1(goal.phase_a);
  const q2 = readQ2(goal.phase_b);
  const q3 = readQ3(goal.phase_c);

  const patch = useMutation({
    mutationFn: (body: CSGoalUpdate) =>
      api.patch<CSGoal>(`/api/v1/cs-goals/${goal.id}`, body),
    onSuccess: () => onChanged(),
  });

  function unfreeze() {
    if (
      !confirm(
        "Unfreeze this goal? It goes back to 'Ready to freeze' so you can revise the answers.",
      )
    )
      return;
    patch.mutate({ validation_status: "pending" });
  }

  function saveInits(next: ProtoInit[]) {
    patch.mutate({ initiatives: next.map(writeInit) });
  }

  const inits = goal.initiatives.map((it, idx) => readInit(it, idx));

  // 09-Jun · G7 — Per-initiative touchpoint counter (value_flow_map
  // Stage 10). Activities tagged with linked_initiatives[<protoId>]
  // get tallied client-side: count + most-recent date. Same query key
  // the activity-log card uses → no duplicate fetch.
  const activitiesQ = useQuery<{ items: Activity[] }>({
    queryKey: ["activities", goal.account_id],
    queryFn: () =>
      api.get<{ items: Activity[] }>(`/api/v1/accounts/${goal.account_id}/activities`),
    staleTime: 60_000,
  });
  const touchpointsByInit = useMemo(() => {
    const map = new Map<string, { count: number; lastAt: string | null }>();
    for (const a of activitiesQ.data?.items ?? []) {
      if (a.hidden) continue;
      const when = a.occurred_at ?? a.created_at ?? null;
      for (const initId of a.linked_initiatives ?? []) {
        const cur = map.get(initId) ?? { count: 0, lastAt: null as string | null };
        cur.count += 1;
        if (when && (!cur.lastAt || when > cur.lastAt)) cur.lastAt = when;
        map.set(initId, cur);
      }
    }
    return map;
  }, [activitiesQ.data]);

  // 10-Jun · Full activity list per initiative (newest first). Drives
  // the per-initiative Touchpoints expander on each row.
  const touchpointListByInit = useMemo(() => {
    const map = new Map<string, Activity[]>();
    for (const a of activitiesQ.data?.items ?? []) {
      if (a.hidden) continue;
      for (const initId of a.linked_initiatives ?? []) {
        const arr = map.get(initId) ?? [];
        arr.push(a);
        map.set(initId, arr);
      }
    }
    // Newest first
    for (const arr of map.values()) {
      arr.sort((x, y) => {
        const xt = x.occurred_at ?? x.created_at ?? "";
        const yt = y.occurred_at ?? y.created_at ?? "";
        return yt.localeCompare(xt);
      });
    }
    return map;
  }, [activitiesQ.data]);

  return (
    <div
      className="px-4 pt-3 pb-3.5 border-t"
      style={{ borderColor: BRAND.cardBorder }}
    >
      {/* Alignment summary (collapsible) */}
      <div
        className="rounded-card overflow-hidden mb-3"
        style={{
          background: "#f0fdf4",
          border: `1px solid ${BRAND.green}30`,
        }}
      >
        <div
          onClick={() => setSummaryOpen((v) => !v)}
          className="flex items-center gap-2 px-3 py-2 cursor-pointer text-[12px] font-semibold"
          style={{ color: "#146a45" }}
        >
          <span className="text-[14px]">🔒</span>
          <span>Alignment summary</span>
          <span
            className="text-[10px]"
            style={{ color: BRAND.t3, fontWeight: 500, marginLeft: 6 }}
          >
            Frozen {fd(goal.updated_at)}
          </span>
          <span className="flex-1" />
          <span
            className="text-[11px] transition-transform"
            style={{
              transform: summaryOpen ? "rotate(180deg)" : undefined,
            }}
          >
            ▼
          </span>
        </div>
        {summaryOpen && (
          <div
            className="px-3 pb-3 text-[11.5px] border-t"
            style={{
              color: BRAND.t2,
              borderColor: `${BRAND.green}30`,
              lineHeight: 1.65,
            }}
          >
            <b>What it means:</b> {q1.means.join(" · ")}
            {q1.otherText ? " · " + q1.otherText : ""}
            <br />
            <i style={{ opacity: 0.8 }}>"{q1.confirmation}"</i>
            <br />
            <br />
            <b>Background:</b> {q2.hasBackground}
            {q2.doneBy.length > 0 && (
              <>
                {" "}
                · by {q2.doneBy.join(", ")}
                {q2.doneByOther ? ` (${q2.doneByOther})` : ""}
              </>
            )}
            {q2.beroeOffer.length > 0 && (
              <>
                {" "}
                · Beroe to fill gap with {q2.beroeOffer.join(", ")}
              </>
            )}
            <br />
            <b>Agreed target:</b> {q3.baseline} → {q3.agreedTarget} by{" "}
            {fd(q3.timeline)}
            <br />
            <b>Measure:</b> {q3.measureMethod}
          </div>
        )}
      </div>

      {/* Initiatives */}
      <div
        className="flex items-center gap-2 mb-2 text-[11px] font-bold uppercase tracking-wider"
        style={{ color: "#6b7fa0" }}
      >
        <span>⚙ Initiatives</span>
        <span
          className="px-1.5 py-0.5 rounded-full text-[10px]"
          style={{ background: "#f1f5f9", color: BRAND.t3 }}
        >
          {inits.length}
        </span>
        <span
          className="ml-auto text-[10px] font-normal lowercase tracking-normal"
          style={{ color: BRAND.t3 }}
        >
          — what work is achieving this goal
        </span>
      </div>

      {/* 09-Jun · G5 — value_flow_map Stage 8 gap-pill:
          "Sum of initiative targets may not equal goal target — silent
          gap, no warning surfaced." Now we compute the delta and show
          an amber strip when initiatives don't add up to (or overshoot)
          the goal target. Hidden when there are no initiatives yet,
          or when the goal target itself is missing. */}
      <InitiativeTargetDelta goal={goal} inits={inits} />


      {inits.length === 0 ? (
        <EmptyInitiatives cat={goal.category} />
      ) : (
        inits.map((it) => (
          <InitiativeRow
            key={it.id}
            init={it}
            cat={goal.category}
            touchpoints={touchpointsByInit.get(it.id) ?? null}
            touchpointList={touchpointListByInit.get(it.id) ?? []}
            accountId={goal.account_id}
            onSave={(next) => {
              saveInits(inits.map((x) => (x.id === it.id ? next : x)));
            }}
            onDelete={() => {
              if (!confirm("Remove this initiative?")) return;
              saveInits(inits.filter((x) => x.id !== it.id));
            }}
            onTouchpointSaved={() => activitiesQ.refetch()}
            forceEdit={editInitId === it.id}
            onForceEditConsumed={onEditInitConsumed}
          />
        ))
      )}

      <AddInitiativeForm
        cat={goal.category}
        suggestedTypes={q2.beroeOffer}
        onAdd={(p) => saveInits([...inits, p])}
      />

      <div
        className="flex justify-end mt-3 pt-2.5"
        style={{ borderTop: `1px dashed ${BRAND.cardBorder}` }}
      >
        <button
          type="button"
          onClick={unfreeze}
          className="text-[11px] font-semibold px-2.5 py-1.5 rounded-card border"
          style={{
            borderColor: BRAND.cardBorder,
            color: BRAND.t2,
            background: "#fff",
          }}
        >
          ↩ Unfreeze to revise
        </button>
      </div>
    </div>
  );
}

function EmptyInitiatives({ cat }: { cat: CSGoalCategory }) {
  const sugg =
    cat === "cost_savings" || cat === "cost_reduction"
      ? "market intelligence report · benchmarking · should-cost analysis · custom research"
      : cat === "risk_mitigation" ||
          cat === "financial_risk_monitoring" ||
          cat === "supply_assurance"
        ? "supplier discovery · custom research · supplier-watch profile"
        : cat === "base_rationalization"
          ? "spend analytics · Cirtuo strategy · OA"
          : "market intel · custom research";
  return (
    <div
      className="rounded-card border-2 border-dashed p-5 text-center mb-2"
      style={{ borderColor: BRAND.cardBorder }}
    >
      <div className="text-[22px] mb-1.5">⚙</div>
      <div
        className="text-[12px] font-bold mb-1"
        style={{ color: BRAND.t1 }}
      >
        No initiatives yet — add the first one
      </div>
      <div
        className="text-[10.5px]"
        style={{ color: BRAND.t2 }}
      >
        For {CATEGORY_LABELS[cat]}, an initiative could be a {sugg}, or
        anything else that drives the goal.
      </div>
    </div>
  );
}

function InitiativeRow({
  init,
  cat,
  touchpoints,
  touchpointList,
  accountId,
  onSave,
  onDelete,
  onTouchpointSaved,
  forceEdit,
  onForceEditConsumed,
}: {
  init: ProtoInit;
  cat: CSGoalCategory;
  // 09-Jun · G7 — null when no activities reference this init yet.
  touchpoints: { count: number; lastAt: string | null } | null;
  // 10-Jun · Full list of touchpoints for this initiative (newest first).
  touchpointList: Activity[];
  accountId: string;
  onSave: (next: ProtoInit) => void;
  onDelete: () => void;
  onTouchpointSaved: () => void;
  // 10-Jun · Deep-link from Value Tracking — open the editor and
  // scroll the row into view when this initiative is the landing
  // target. Consumed (cleared) once handled so closing the editor
  // doesn't re-open it.
  forceEdit?: boolean;
  onForceEditConsumed?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  // 10-Jun · Per-initiative touchpoint expander + modal state.
  const [showTouchpoints, setShowTouchpoints] = useState(false);
  const [logTouchpoint, setLogTouchpoint] = useState(false);

  // 10-Jun · React to a deep-link landing — open the editor, scroll
  // into view, then notify the parent to clear the flag so subsequent
  // edits stay user-driven.
  useEffect(() => {
    if (!forceEdit) return;
    setEditing(true);
    requestAnimationFrame(() => {
      const el = document.getElementById(`init-row-${init.id}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    onForceEditConsumed?.();
  }, [forceEdit, init.id, onForceEditConsumed]);
  const itype = INIT_TYPES.find((t) => t.label === init.type) ?? INIT_TYPES[0];

  if (editing) {
    return (
      <InitiativeEditRow
        init={init}
        cat={cat}
        accountId={accountId}
        onClose={() => setEditing(false)}
        onSave={(next) => {
          onSave(next);
          setEditing(false);
        }}
      />
    );
  }

  return (
    <div className="mb-1.5" id={`init-row-${init.id}`}>
    <div
      className="grid items-center gap-2.5 p-2.5 rounded-card"
      style={{
        // 10-Jun · 7-column layout — icon · name · stage · target/delivered
        // · % completion · notes · actions (3 buttons now).
        gridTemplateColumns: "36px 1fr 110px 140px 80px 1fr 96px",
        background: "#fff",
        border: `1px solid ${BRAND.cardBorder}`,
        // Round only top corners when expanded (touchpoint list sits below).
        borderBottomLeftRadius: showTouchpoints ? 0 : undefined,
        borderBottomRightRadius: showTouchpoints ? 0 : undefined,
      }}
    >
      <div
        className="w-9 h-9 rounded-card flex items-center justify-center text-[16px]"
        style={{ background: "#f3f0ff" }}
      >
        {itype.icon}
      </div>
      <div className="min-w-0">
        <div
          className="text-[12.5px] font-bold leading-snug"
          style={{ color: BRAND.t1 }}
        >
          {init.name}
        </div>
        <div className="text-[10.5px]" style={{ color: BRAND.t3 }}>
          {init.type}
          {init.module ? ` · ${init.module}` : ""}
          {init.owner ? ` · ${init.owner}` : ""}
        </div>
        {/* 09-Jun · G7 — touchpoint counter. Hidden when no activities
            link to this initiative; surfaces as a compact pill once
            CSMs start tagging activities with the init id. */}
        {touchpoints && touchpoints.count > 0 && (
          <button
            type="button"
            onClick={() => setShowTouchpoints((v) => !v)}
            className="mt-1 inline-flex items-center gap-1.5 text-[9.5px] font-semibold uppercase tracking-wider cursor-pointer hover:opacity-80"
            style={{ color: BRAND.t2 }}
            title={touchpoints.lastAt ? `Last touchpoint ${touchpoints.lastAt.slice(0, 10)}` : ""}
          >
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full"
              style={{ background: "#f3f0ff", color: BRAND.indigo }}
            >
              {showTouchpoints ? "▾" : "▸"} 💬 {touchpoints.count} touchpoint{touchpoints.count === 1 ? "" : "s"}
            </span>
            {touchpoints.lastAt && (
              <span style={{ color: BRAND.t3, textTransform: "none" }}>
                · last {touchpoints.lastAt.slice(0, 10)}
              </span>
            )}
          </button>
        )}
      </div>
      {/* 10-Jun · Stage column now shows the 4-stage universal pipeline. */}
      <span
        className="text-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
        style={{
          background: `${STAGE_COLOR[init.status] ?? BRAND.t3}15`,
          color: STAGE_COLOR[init.status] ?? BRAND.t3,
        }}
      >
        {STAGE_LBL[init.status] ?? init.status}
      </span>
      {/* 10-Jun · Target / Delivered — raw text, no $ prefix. */}
      <div
        className="text-right text-[11px]"
        style={{ color: BRAND.t2 }}
      >
        <b style={{ color: BRAND.t1 }}>{init.deliveredText || "—"}</b>
        <span style={{ color: BRAND.t3 }}> / {init.targetText || "—"}</span>
        <br />
        <span style={{ fontSize: 9, color: BRAND.t3 }}>delivered / target</span>
        {init.delivered > 0 && (
          <div className="flex items-center justify-end gap-1 mt-0.5">
            {init.evidenceConfirmed ? (
              <span
                className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                style={{ background: "#e6f7f5", color: "#0b5e6b" }}
                title={init.evidenceUrl || "Evidence confirmed"}
              >
                ✓ Evidenced
              </span>
            ) : (
              <span
                className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                style={{ background: "#fff3e0", color: "#854F0B" }}
                title="No evidence confirmed — unverified, disputable at renewal"
              >
                ? Unverified
              </span>
            )}
          </div>
        )}
      </div>
      {/* 10-Jun · % completion (0–100). */}
      <div
        className="text-center text-[11px] font-bold"
        style={{ color: BRAND.t1 }}
      >
        {init.completionPct != null ? `${init.completionPct}%` : "—"}
        <div style={{ fontSize: 9, fontWeight: 500, color: BRAND.t3 }}>
          completion
        </div>
      </div>
      {/* 10-Jun · Notes preview (1-line truncated). Hover via title for full text. */}
      <div
        className="text-left text-[10.5px] truncate"
        style={{ color: BRAND.t2 }}
        title={init.notes ?? undefined}
      >
        {init.notes ? init.notes : <span style={{ color: BRAND.t3 }}>—</span>}
      </div>
      <div className="flex gap-1 justify-end">
        <button
          type="button"
          onClick={() => setLogTouchpoint(true)}
          className="text-[11px] px-2 py-1 rounded-card border"
          style={{
            borderColor: BRAND.indigo + "40",
            background: "#f3f0ff",
            color: BRAND.indigo,
          }}
          title="Log touchpoint"
        >
          💬
        </button>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="text-[11px] px-2 py-1 rounded-card border"
          style={{
            borderColor: BRAND.cardBorder,
            background: "#fff",
            color: BRAND.t3,
          }}
          title="Edit"
        >
          ✏️
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="text-[11px] px-2 py-1 rounded-card border"
          style={{
            borderColor: BRAND.cardBorder,
            background: "#fff",
            color: BRAND.t3,
          }}
          title="Remove"
        >
          🗑
        </button>
      </div>
    </div>
    {/* 10-Jun · Per-initiative Touchpoints expansion — shows when the
        CSM clicks the 💬 count pill in the row above. Lists every
        activity linked to this initiative, newest first. */}
    {showTouchpoints && touchpointList.length > 0 && (
      <div
        className="border border-t-0 rounded-b-card px-3 py-2.5"
        style={{ borderColor: BRAND.cardBorder, background: "#fafbff" }}
      >
        <div className="flex items-center justify-between mb-2">
          <div
            className="text-[11px] font-bold uppercase tracking-wider"
            style={{ color: BRAND.t2 }}
          >
            Touchpoints · {touchpointList.length}
          </div>
          <button
            type="button"
            onClick={() => setLogTouchpoint(true)}
            className="text-[10.5px] font-semibold px-2 py-1 rounded-card"
            style={{ background: BRAND.indigo, color: "#fff" }}
          >
            + Log touchpoint
          </button>
        </div>
        <div className="space-y-1.5">
          {touchpointList.map((a) => (
            <TouchpointRow key={a.id} act={a} />
          ))}
        </div>
      </div>
    )}
    {logTouchpoint && (
      <TouchpointModal
        accountId={accountId}
        initId={init.id}
        initName={init.name}
        onClose={() => setLogTouchpoint(false)}
        onSaved={() => {
          setLogTouchpoint(false);
          setShowTouchpoints(true);
          onTouchpointSaved();
        }}
      />
    )}
    </div>
  );
}

// 10-Jun · Single touchpoint row inside the per-initiative expander.
function TouchpointRow({ act }: { act: Activity }) {
  const conf = ACT_CONF[act.type];
  const when = act.occurred_at ?? act.created_at ?? "";
  return (
    <div
      className="rounded-card border px-2.5 py-2"
      style={{ borderColor: BRAND.cardBorder, background: "#fff" }}
    >
      <div className="flex items-start gap-2">
        <span
          className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0"
          style={{ background: conf.bg, color: conf.col }}
        >
          {conf.ic} {conf.label}
        </span>
        <div className="flex-1 min-w-0">
          <div
            className="text-[12px] font-bold leading-snug"
            style={{ color: BRAND.t1 }}
          >
            {act.title}
          </div>
          {act.summary && (
            <div
              className="text-[11px] leading-snug mt-0.5"
              style={{ color: BRAND.t2 }}
            >
              {act.summary}
            </div>
          )}
          {act.attendees && (
            <div
              className="text-[10px] mt-1"
              style={{ color: BRAND.t3 }}
            >
              👥 {act.attendees}
            </div>
          )}
        </div>
        <div
          className="text-[10px] font-mono shrink-0"
          style={{ color: BRAND.t3 }}
        >
          {when ? when.slice(0, 10) : "—"}
        </div>
      </div>
    </div>
  );
}

// 10-Jun · Local copies of FormRow + ModalShell from SignalsActivityTab.
// Both surfaces share the same chrome; lifting these to a shared module
// is a follow-up cleanup. Kept inline to keep this change contained.
function FormRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider font-semibold text-text-muted">
        {label}
      </label>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function ModalShell({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center pt-12 pb-8 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl w-[min(560px,95vw)]">
        <div className="px-4 py-3 border-b border-beroe-card-border flex items-center justify-between">
          <div className="text-[14px] font-bold text-text-primary">{title}</div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary text-lg leading-none px-1"
          >
            ✕
          </button>
        </div>
        <div className="px-4 py-3">{children}</div>
      </div>
    </div>
  );
}

// 10-Jun · Touchpoint modal — clone of the LogActivityModal in
// SignalsActivityTab but pre-fills linked_initiatives = [initId] so
// the resulting activity row is anchored to this initiative.
function TouchpointModal({
  accountId,
  initId,
  initName,
  onClose,
  onSaved,
}: {
  accountId: string;
  initId: string;
  initName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<ActivityCreate>({
    type: "csm_call",
    title: "",
    summary: "",
    items: "",
    attendees: "",
    occurred_at: new Date().toISOString().slice(0, 10),
    linked_metrics: [],
    linked_initiatives: [initId],
  });
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (body: ActivityCreate) =>
      api.post(`/api/v1/accounts/${accountId}/activities`, body),
    onSuccess: () => onSaved(),
    onError: (e: ApiError) => setErr(e.message),
  });
  return (
    <ModalShell
      onClose={onClose}
      title={`Log touchpoint — ${initName || "Initiative"}`}
    >
      <div className="space-y-2.5">
        <div
          className="text-[10.5px] px-2 py-1 rounded-card inline-flex items-center gap-1.5"
          style={{ background: "#f3f0ff", color: BRAND.indigo }}
        >
          🔗 Linked to initiative <b>{initName}</b>
        </div>
        <FormRow label="Type">
          <div className="flex gap-1 flex-wrap">
            {ACTIVITY_TYPES.map((t) => {
              const c = ACT_CONF[t];
              const on = form.type === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setForm({ ...form, type: t })}
                  className={cn(
                    "text-[11px] px-2 py-1 rounded-md border-[1.5px]",
                    on ? "" : "bg-white border-beroe-card-border text-text-muted",
                  )}
                  style={
                    on
                      ? { background: c.bg, color: c.col, borderColor: c.col + "60" }
                      : {}
                  }
                >
                  {c.ic} {c.label}
                </button>
              );
            })}
          </div>
        </FormRow>
        <div className="grid grid-cols-2 gap-2">
          <FormRow label="Title">
            <input
              type="text"
              maxLength={200}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="w-full text-[12px] px-2 py-1.5 rounded-card border bg-white"
              style={{ borderColor: BRAND.cardBorder }}
              placeholder="e.g. Q3 progress call with Ramesh"
            />
          </FormRow>
          <FormRow label="Date">
            <input
              type="date"
              value={form.occurred_at ?? ""}
              onChange={(e) =>
                setForm({ ...form, occurred_at: e.target.value || null })
              }
              className="w-full text-[12px] px-2 py-1.5 rounded-card border bg-white"
              style={{ borderColor: BRAND.cardBorder }}
            />
          </FormRow>
        </div>
        <FormRow label="Summary">
          <textarea
            rows={3}
            maxLength={4000}
            value={form.summary ?? ""}
            onChange={(e) => setForm({ ...form, summary: e.target.value })}
            className="w-full text-[12px] px-2 py-1.5 rounded-card border bg-white"
            style={{ borderColor: BRAND.cardBorder }}
            placeholder="What was discussed / decided / committed."
          />
        </FormRow>
        <FormRow label="Attendees">
          <input
            type="text"
            maxLength={400}
            value={form.attendees ?? ""}
            onChange={(e) => setForm({ ...form, attendees: e.target.value })}
            className="w-full text-[12px] px-2 py-1.5 rounded-card border bg-white"
            style={{ borderColor: BRAND.cardBorder }}
            placeholder="Comma-separated names"
          />
        </FormRow>
        {err && (
          <div
            className="text-[11px] p-2 rounded-card"
            style={{ background: "#fde7ea", color: BRAND.red }}
          >
            {err}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="text-[11.5px] font-semibold px-3 py-1.5 rounded-card border"
            style={{ borderColor: BRAND.cardBorder, color: BRAND.t3, background: "#fff" }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!form.title.trim() || save.isPending}
            onClick={() => save.mutate(form)}
            className="text-[11.5px] font-semibold px-3 py-1.5 rounded-card text-white disabled:opacity-40"
            style={{ background: BRAND.indigo }}
          >
            {save.isPending ? "Logging…" : "Log touchpoint"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function InitiativeEditRow({
  init,
  cat: _cat,
  accountId,
  onClose,
  onSave,
}: {
  init: ProtoInit;
  // 10-Jun · `cat` no longer drives stage options (4-stage universal
  // pipeline replaced the category-aware list). Kept on the signature
  // so existing callers don't break.
  cat: CSGoalCategory;
  // 12-Jun bug 250 — needed to upload initiative evidence docs.
  accountId: string;
  onClose: () => void;
  onSave: (next: ProtoInit) => void;
}) {
  const [draft, setDraft] = useState<ProtoInit>(init);
  const notify = useNotify();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  function commit<K extends keyof ProtoInit>(k: K, v: ProtoInit[K]) {
    setDraft({ ...draft, [k]: v });
  }

  // 12-Jun bug 250 — upload an evidence file via the regular documents
  // pipeline (kind=initiative_doc), then keep a {document_id, filename}
  // pointer on the draft. Parent saves the goal, persisting it in the
  // initiative's value_fields.attachments.
  async function onAttach(file: File) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("kind", "initiative_doc");
      fd.append("file", file);
      const res = await api.postForm<{ document?: { id: string }; id?: string }>(
        `/api/v1/accounts/${accountId}/documents`,
        fd,
      );
      const docId = res.document?.id ?? res.id;
      if (!docId) throw new Error("Upload did not return a document id");
      setDraft((d) => ({
        ...d,
        attachments: [
          ...(d.attachments ?? []),
          {
            document_id: docId,
            filename: file.name,
            uploaded_at: new Date().toISOString(),
          },
        ],
      }));
      notify({
        title: "Attached",
        body: `${file.name} — remember to click Done to save.`,
        tone: "success",
      });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Upload failed";
      notify({ title: "Attach failed", body: msg, tone: "error" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function removeAttachment(docId: string) {
    setDraft((d) => ({
      ...d,
      attachments: (d.attachments ?? []).filter((a) => a.document_id !== docId),
    }));
  }

  async function openAttachment(docId: string) {
    try {
      const r = await api.get<{ url: string }>(
        `/api/v1/documents/${docId}/download-url`,
      );
      if (r.url) window.open(r.url, "_blank", "noopener");
    } catch {
      notify({ title: "Couldn't open document", tone: "error" });
    }
  }

  return (
    <div
      className="rounded-card p-3 mb-1.5"
      style={{ background: "#fafbff", border: `1.5px solid ${BRAND.indigo}40` }}
    >
      {/* 10-Jun · Row 1 — name + type + 4-stage select. */}
      <div
        className="grid gap-2 items-end mb-2"
        style={{ gridTemplateColumns: "2fr 1.4fr 1.2fr" }}
      >
        <Field
          label="Initiative"
          value={draft.name}
          onChange={(v) => commit("name", v)}
        />
        <SelectField
          label="Type"
          value={draft.type}
          options={INIT_TYPES.map((t) => t.label)}
          onChange={(v) => {
            const m =
              INIT_TYPES.find((t) => t.label === v)?.module ?? draft.module;
            setDraft({ ...draft, type: v, module: m });
          }}
        />
        <SelectField
          label="Stage"
          value={draft.status}
          options={STAGES_4 as unknown as string[]}
          render={(s) => STAGE_LBL[s] ?? s}
          onChange={(v) =>
            commit("status", v as ProtoInit["status"])
          }
        />
      </div>
      {/* 10-Jun · Row 2 — Target / Delivered (text, no $) + % completion. */}
      <div
        className="grid gap-2 items-end mb-2"
        style={{ gridTemplateColumns: "1fr 1fr 1fr auto" }}
      >
        <Field
          label="Target"
          value={draft.targetText}
          onChange={(v) => {
            const num = parseUsdNum(v);
            setDraft({ ...draft, targetText: v, targetContribution: num });
          }}
          placeholder='e.g. 1M · "40 → 25" · "80%"'
        />
        <Field
          label="Delivered"
          value={draft.deliveredText}
          onChange={(v) => {
            const num = parseUsdNum(v);
            setDraft({ ...draft, deliveredText: v, delivered: num });
          }}
          placeholder="Same unit as target"
        />
        <NumField
          label="% completion"
          value={draft.completionPct ?? 0}
          onChange={(v) =>
            commit("completionPct", Math.max(0, Math.min(100, v)))
          }
        />
        <button
          type="button"
          onClick={() => {
            onSave({
              ...draft,
              updatedAt: new Date().toISOString().slice(0, 10),
            });
          }}
          className="text-[11.5px] font-semibold px-3 py-1.5 rounded-card text-white"
          style={{ background: BRAND.indigo }}
        >
          Done
        </button>
      </div>
      {/* 10-Jun · Notes — free-form, 2-line textarea. */}
      <div className="mb-1">
        <label
          className="text-[10px] font-semibold uppercase tracking-wider"
          style={{ color: BRAND.t3 }}
        >
          Notes
        </label>
        <textarea
          rows={2}
          maxLength={4000}
          value={draft.notes ?? ""}
          onChange={(e) =>
            commit("notes", e.target.value || null)
          }
          placeholder="Internal notes for this initiative"
          className="w-full text-[11px] px-2 py-1 rounded-card border bg-white"
          style={{ borderColor: BRAND.cardBorder, color: BRAND.t1 }}
        />
      </div>
      {/* 09-Jun · G6 — Evidence confirmation row. CSM ticks the box
          when the delivered $ is backed by an artefact (report, email,
          deck) the client signed off on. Optional URL points at the
          artefact. Stored in Initiative.value_fields jsonb. */}
      <div
        className="flex items-center gap-3 mt-2 pt-2 border-t"
        style={{ borderColor: BRAND.cardBorder }}
      >
        <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold cursor-pointer select-none" style={{ color: BRAND.t2 }}>
          <input
            type="checkbox"
            checked={draft.evidenceConfirmed}
            onChange={(e) => commit("evidenceConfirmed", e.target.checked)}
          />
          Evidence confirmed
        </label>
        <input
          type="url"
          placeholder="Link to proof artefact (optional)"
          value={draft.evidenceUrl}
          onChange={(e) => commit("evidenceUrl", e.target.value)}
          className="flex-1 text-[11px] px-2 py-1 rounded-card border bg-white"
          style={{ borderColor: BRAND.cardBorder, color: BRAND.t1 }}
        />
        <button
          type="button"
          onClick={onClose}
          className="text-[10.5px] font-semibold px-2 py-1 rounded-card border"
          style={{
            borderColor: BRAND.cardBorder,
            color: BRAND.t3,
            background: "#fff",
          }}
        >
          Cancel
        </button>
      </div>

      {/* 12-Jun bug 250 — Documents attached to this initiative. Upload via
          the regular documents pipeline (kind=initiative_doc); the pointer
          persists in value_fields.attachments on Done. */}
      <div className="mt-2 pt-2 border-t" style={{ borderColor: BRAND.cardBorder }}>
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: BRAND.t3 }}>
            Documents
          </span>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onAttach(f);
            }}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            className="text-[10.5px] font-semibold px-2 py-1 rounded-card border disabled:opacity-50"
            style={{ borderColor: BRAND.indigo + "40", background: "#f3f0ff", color: BRAND.indigo }}
          >
            {uploading ? "Uploading…" : "📎 Attach document"}
          </button>
        </div>
        {(draft.attachments ?? []).length === 0 ? (
          <div className="text-[10.5px]" style={{ color: BRAND.t3 }}>
            No documents attached yet.
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {(draft.attachments ?? []).map((a) => (
              <div
                key={a.document_id}
                className="flex items-center gap-2 text-[11px] px-2 py-1 rounded-card border bg-white"
                style={{ borderColor: BRAND.cardBorder }}
              >
                <button
                  type="button"
                  onClick={() => void openAttachment(a.document_id)}
                  className="flex-1 text-left truncate font-semibold"
                  style={{ color: BRAND.indigo }}
                  title={a.filename}
                >
                  📄 {a.filename}
                </button>
                <button
                  type="button"
                  onClick={() => removeAttachment(a.document_id)}
                  className="text-[10px] px-1.5 py-0.5 rounded border"
                  style={{ borderColor: BRAND.cardBorder, color: BRAND.t3 }}
                  title="Remove (click Done to save)"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AddInitiativeForm({
  cat,
  suggestedTypes,
  onAdd,
}: {
  cat: CSGoalCategory;
  suggestedTypes: string[];
  onAdd: (p: ProtoInit) => void;
}) {
  const [open, setOpen] = useState(false);
  const stages = stagesFor(cat);
  const blankDraft = (): ProtoInit => ({
    id: "",
    name: "",
    type: INIT_TYPES[0].label,
    module: INIT_TYPES[0].module,
    owner: "",
    stage: stages[0],
    targetContribution: 0,
    delivered: 0,
    updatedAt: "",
    evidenceConfirmed: false,
    evidenceUrl: "",
    // 10-Jun · Defaults for the 4-stage + notes + % completion columns.
    status: "identification",
    notes: null,
    completionPct: null,
    targetText: "",
    deliveredText: "",
    attachments: [],
  });
  const [draft, setDraft] = useState<ProtoInit>(blankDraft);

  if (!open) {
    return (
      <div
        className="rounded-card border-2 border-dashed py-2.5 px-3 text-center cursor-pointer"
        style={{ borderColor: BRAND.cardBorder }}
        onClick={() => setOpen(true)}
      >
        <span
          className="text-[12px] font-semibold"
          style={{ color: BRAND.indigo }}
        >
          ＋ Add an initiative
        </span>
      </div>
    );
  }

  return (
    <div
      className="rounded-card p-3 mb-1.5"
      style={{
        background: "#fafbff",
        border: `1.5px solid ${BRAND.indigo}`,
        boxShadow: `0 3px 14px ${BRAND.indigo}1A`,
      }}
    >
      <div
        className="grid gap-2 items-end"
        style={{
          gridTemplateColumns: "2fr 1.4fr 1.2fr 1fr auto",
        }}
      >
        <Field
          label="Initiative name"
          value={draft.name}
          onChange={(v) => setDraft({ ...draft, name: v })}
          placeholder="e.g. Q3 Cocoa Price Forecast"
        />
        <SelectField
          label="Type"
          value={draft.type}
          options={INIT_TYPES.map((t) => t.label)}
          onChange={(v) => {
            const m = INIT_TYPES.find((t) => t.label === v)?.module ?? "";
            setDraft({ ...draft, type: v, module: m });
          }}
        />
        <SelectField
          label="Stage"
          value={draft.status}
          options={STAGES_4 as unknown as string[]}
          render={(s) => STAGE_LBL[s] ?? s}
          onChange={(v) =>
            setDraft({ ...draft, status: v as ProtoInit["status"] })
          }
        />
        {/* 10-Jun · Target — text input (no $), value can be any unit. */}
        <Field
          label="Target"
          value={draft.targetText}
          onChange={(v) => {
            const num = parseUsdNum(v);
            setDraft({ ...draft, targetText: v, targetContribution: num });
          }}
          placeholder='e.g. 1M · "40 → 25" · "80%"'
        />
        <button
          type="button"
          onClick={() => {
            if (!draft.name.trim()) return;
            onAdd({
              ...draft,
              id: `i_${Date.now()}`,
              updatedAt: new Date().toISOString().slice(0, 10),
            });
            setOpen(false);
            setDraft(blankDraft());
          }}
          disabled={!draft.name.trim()}
          className="text-[11.5px] font-semibold px-3 py-1.5 rounded-card text-white disabled:opacity-40"
          style={{ background: BRAND.indigo }}
        >
          Add
        </button>
      </div>
      <div
        className="flex items-center justify-between mt-2 text-[10.5px]"
        style={{ color: BRAND.t3 }}
      >
        <div>
          {INIT_TYPES.find((t) => t.label === draft.type)?.module && (
            <>
              Linked module will default to{" "}
              <b style={{ color: BRAND.indigo }}>
                {INIT_TYPES.find((t) => t.label === draft.type)?.module}
              </b>
              .{" "}
            </>
          )}
          {suggestedTypes.length > 0 && (
            <span>
              💡 Q2 suggested: {suggestedTypes.join(" · ")}. Use as a starting
              list.
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[10.5px] font-semibold px-2 py-1 rounded-card border"
          style={{
            borderColor: BRAND.cardBorder,
            color: BRAND.t3,
            background: "#fff",
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-2.5 py-1.5 text-[12px] rounded-card border mt-1"
        style={{ borderColor: BRAND.cardBorder }}
      />
    </div>
  );
}
function SelectField({
  label,
  value,
  options,
  onChange,
  render,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  render?: (v: string) => string;
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2 py-1.5 text-[12px] rounded-card border mt-1 bg-white"
        style={{ borderColor: BRAND.cardBorder }}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {render ? render(o) : o}
          </option>
        ))}
      </select>
    </div>
  );
}
function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <input
        type="number"
        value={value || ""}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className="w-full px-2.5 py-1.5 text-[12px] rounded-card border mt-1"
        style={{ borderColor: BRAND.cardBorder }}
      />
    </div>
  );
}

// ===========================================================================
// Add-goal modal
// ===========================================================================
function AddGoalModal({
  accountId,
  onClose,
  onCreated,
}: {
  accountId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<CSGoalCategory>("cost_reduction");
  const [target, setTarget] = useState("");
  const [owner, setOwner] = useState("");

  const create = useMutation({
    mutationFn: () =>
      api.post<CSGoal>(`/api/v1/accounts/${accountId}/cs-goals`, {
        title: title.trim(),
        category,
        target_value: target || null,
        owner: owner || null,
      }),
    onSuccess: onCreated,
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-card p-5 w-[480px] max-w-[92vw] shadow-xl"
        style={{ border: `1.5px solid ${BRAND.cardBorder}` }}
      >
        <div className="flex items-center justify-between mb-3">
          <div
            className="text-[14px] font-bold"
            style={{ color: BRAND.midnight }}
          >
            Add goal
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[16px]"
            style={{ color: BRAND.t3 }}
          >
            ×
          </button>
        </div>
        <div className="space-y-3">
          <Field
            label="Goal title *"
            value={title}
            onChange={setTitle}
            placeholder="e.g. Reduce electronics direct-spend by 6%"
          />
          <div>
            <FieldLabel>Category</FieldLabel>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as CSGoalCategory)}
              className="w-full px-2.5 py-1.5 text-[12px] rounded-card border bg-white mt-1"
              style={{ borderColor: BRAND.cardBorder }}
            >
              {CSGOAL_CATEGORIES_NEW.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <Field
              label="Target"
              value={target}
              onChange={setTarget}
              placeholder="e.g. $2.4M"
            />
            <Field
              label="Owner"
              value={owner}
              onChange={setOwner}
              placeholder="e.g. Anika Sharma"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <button
            type="button"
            onClick={onClose}
            className="text-[12px] font-semibold px-3 py-1.5 rounded-card border"
            style={{
              borderColor: BRAND.cardBorder,
              color: BRAND.t2,
              background: "#fff",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={title.trim().length < 3 || create.isPending}
            onClick={() => create.mutate()}
            className="text-[12px] font-semibold px-3 py-1.5 rounded-card text-white disabled:opacity-40"
            style={{ background: BRAND.indigo }}
          >
            {create.isPending ? "Creating…" : "Add goal"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 09-Jun · G5 — Initiative target sum vs goal target delta banner.
// Compares Σ initiatives[i].targetContribution to goal.target_value
// (parsed via parseUsdNum). Surfaces:
//   • amber "Under-allocated" strip when initiatives sum < goal target
//   • amber "Over-allocated" strip when initiatives sum > goal target
//   • teal "Matched" strip when within ±5% rounding
// Hidden when:
//   • no initiatives yet (the empty-state already prompts the CSM)
//   • goal target is missing or unparseable (can't compute a delta)
// ---------------------------------------------------------------------------
function InitiativeTargetDelta({
  goal,
  inits,
}: {
  goal: CSGoal;
  inits: ProtoInit[];
}) {
  const goalTarget = parseUsdNum(goal.target_value);
  if (!goalTarget || inits.length === 0) return null;
  const initSum = inits.reduce((s, i) => s + (i.targetContribution || 0), 0);
  const delta = initSum - goalTarget;
  const absDelta = Math.abs(delta);
  const pctOff = absDelta / goalTarget;
  const fmt = (n: number) => {
    if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
    return `$${n.toFixed(0)}`;
  };
  // Within 5% counts as matched — small rounding tolerance.
  const matched = pctOff < 0.05;
  const tone = matched
    ? { bg: "#e6f7f5", border: "#35E1D4", fg: "#0b5e6b" }
    : { bg: "#fff3e0", border: "#EF9637", fg: "#854F0B" };
  const direction = matched
    ? "Matched"
    : delta < 0
      ? "Under-allocated"
      : "Over-allocated";
  return (
    <div
      className="mb-2 rounded-[8px] border px-3 py-1.5 text-[11.5px] flex items-center gap-2"
      style={{
        background: tone.bg,
        borderColor: tone.border,
        color: tone.fg,
      }}
    >
      <span className="text-[13px]">{matched ? "✓" : "⚠"}</span>
      <span className="font-bold">{direction}</span>
      <span>·</span>
      <span>
        Initiatives Σ <b>{fmt(initSum)}</b> vs goal target{" "}
        <b>{fmt(goalTarget)}</b>
      </span>
      {!matched && (
        <span className="ml-auto">
          Gap <b>{delta < 0 ? "−" : "+"}{fmt(absDelta)}</b>{" "}
          <span className="opacity-70">({(pctOff * 100).toFixed(0)}%)</span>
        </span>
      )}
    </div>
  );
}

// 09-Jun bug (Bug Tracker · Jun-8 #5) — fuscia pill that surfaces the
// VPD-extracted candidate goals + metrics directly on the Goal Validation
// tab. Click → opens the unified VpdExtractionReview modal, so the CSM
// can create goals without leaving this screen.
function VpdCandidateBanner({
  goalsCount,
  metricsCount,
  docName,
  onOpen,
}: {
  goalsCount: number;
  metricsCount: number;
  docName: string;
  onOpen: () => void;
}) {
  const parts: string[] = [];
  if (goalsCount > 0)
    parts.push(`${goalsCount} goal${goalsCount === 1 ? "" : "s"}`);
  if (metricsCount > 0)
    parts.push(
      `${metricsCount} metric${metricsCount === 1 ? "" : "s"}`,
    );
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full flex items-center gap-2 rounded-lg border px-4 py-2.5 text-left hover:brightness-105 transition"
      style={{
        background: "#fdf0fd",
        borderColor: BRAND.fuscia,
        color: "#7a1a90",
      }}
      title={`AI extracted candidate goals from ${docName} — review and create on this tab`}
    >
      <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
        <span
          className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60"
          style={{ background: BRAND.fuscia }}
        />
        <span
          className="relative inline-flex rounded-full h-2.5 w-2.5"
          style={{ background: BRAND.fuscia }}
        />
      </span>
      <span className="text-[12.5px] font-bold">
        🎯 {parts.join(" + ")} extracted from VPD
      </span>
      <span className="text-[11px] opacity-80 hidden sm:inline">
        — review &amp; create
      </span>
      <span
        className="ml-auto text-[10.5px] opacity-70 truncate max-w-[40%]"
        title={docName}
      >
        {docName}
      </span>
      <span className="text-[13px] font-bold">→</span>
    </button>
  );
}
