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

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, ApiError } from "@/lib/api";
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
  identified: "Identified",
  committed: "Committed",
  implemented: "Implemented",
  assessed: "Assessed",
  deployed: "Deployed",
  evidenced: "Evidenced",
  baselined: "Baselined",
  in_progress: "In Progress",
  achieved: "Achieved",
  activated: "Activated",
  growing: "Growing",
  embedded: "Embedded",
  baseline: "Baseline",
  delivered: "Delivered",
  deferred: "Deferred",
  not_pursued: "Not Pursued",
};

const STAGE_COLOR: Record<string, string> = {
  identified: BRAND.t3,
  baselined: BRAND.t3,
  activated: BRAND.t3,
  baseline: BRAND.t3,
  assessed: BRAND.t3,
  committed: BRAND.amber,
  in_progress: BRAND.amber,
  deployed: BRAND.amber,
  growing: BRAND.amber,
  implemented: BRAND.green,
  achieved: BRAND.green,
  evidenced: BRAND.green,
  embedded: BRAND.green,
  delivered: BRAND.green,
  deferred: BRAND.t3,
  not_pursued: BRAND.red,
};

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
  };
}
function writeInit(p: ProtoInit): Initiative {
  return {
    name: p.name,
    status:
      p.delivered >= p.targetContribution && p.targetContribution > 0
        ? "delivered"
        : p.delivered > 0
          ? "in_progress"
          : "not_started",
    value_stage: p.stage,
    value_target: `$${p.targetContribution}`,
    value_delivered: `$${p.delivered}`,
    client_acknowledged: "pending",
    value_fields: {
      id: p.id,
      type: p.type,
      module: p.module,
      owner: p.owner,
      updatedAt: p.updatedAt,
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [openQ, setOpenQ] = useState<Record<string, 1 | 2 | 3 | null>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [editingStakeholders, setEditingStakeholders] = useState(false);

  const goalsQ = useQuery<{ items: CSGoal[] }>({
    queryKey: ["cs-goals", account.id, false],
    queryFn: () =>
      api.get(`/api/v1/accounts/${account.id}/cs-goals?include_deleted=false`),
  });
  const goals = useMemo(() => goalsQ.data?.items ?? [], [goalsQ.data]);

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
      if (filter === "all") return true;
      if (filter === "pending")
        return s === "pending" || s === "in-progress";
      if (filter === "aligned") return s === "aligned";
      if (filter === "frozen") return s === "frozen";
      if (filter === "flagged") return s === "flagged";
      return true;
    });
  }, [goals, filter]);

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

  return (
    <div className="space-y-3">
      <NextActionBanner action={next} onClick={handleNextAction} />
      <StakeholderBar
        onboarding={csOnbQ.data}
        contacts={contactsQ.data?.items ?? []}
        accountId={account.id}
        editing={editingStakeholders}
        setEditing={setEditingStakeholders}
        onChanged={invalidateOnboarding}
      />
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

  const sp = champion?.name ?? "—";
  const bo = commercial?.name ?? "—";

  return (
    <div
      className="rounded-card px-3.5 py-2.5 flex items-center gap-3"
      style={{
        background: "#fff",
        border: `1px solid ${BRAND.cardBorder}`,
      }}
    >
      <span className="text-[16px]">👥</span>
      <StakeholderItem label="SPOC" name={sp} />
      <Divider />
      <StakeholderItem label="Budget Owner" name={bo} />
      <Divider />
      <StakeholderItem
        label="Power users"
        name={`${powerUsers.length}/5`}
      />
      <div className="flex-1" />
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-[11px] font-semibold px-2.5 py-1 rounded-card border"
        style={{
          borderColor: BRAND.cardBorder,
          color: BRAND.t2,
          background: "#fff",
        }}
      >
        ✏️ Edit
      </button>
    </div>
  );
}

function StakeholderItem({ label, name }: { label: string; name: string }) {
  return (
    <div>
      <div
        className="text-[9.5px] font-bold uppercase tracking-wider"
        style={{ color: BRAND.t3 }}
      >
        {label}
      </div>
      <b className="text-[12.5px]" style={{ color: BRAND.t1 }}>
        {name}
      </b>
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

  // Client-side same-name guard mirrors the backend dedup_check so the
  // user sees the conflict before they click Save.
  const localDupName = useMemo(() => {
    const a = (spoc.name ?? "").trim().toLowerCase();
    const b = (budget.name ?? "").trim().toLowerCase();
    return !!a && !!b && a === b;
  }, [spoc.name, budget.name]);
  const localDupEmail = useMemo(() => {
    const a = (spoc.email ?? "").trim().toLowerCase();
    const b = (budget.email ?? "").trim().toLowerCase();
    return !!a && !!b && a === b;
  }, [spoc.email, budget.email]);

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
  const localBlocked = localDupName || localDupEmail;

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
      {(errMsg || localBlocked) && (
        <div
          className="rounded-card px-3 py-2 mb-2.5 text-[11.5px]"
          style={{
            background: "#fff0f2",
            border: `1.5px solid ${BRAND.red}`,
            color: BRAND.red,
            fontWeight: 600,
          }}
        >
          {localDupName
            ? "SPOC and Budget Owner can't share the same name — they need to be different people."
            : localDupEmail
              ? "SPOC and Budget Owner can't share the same email — they need to be different people."
              : errMsg}
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
          disabled={save.isPending || localBlocked}
          title={
            localBlocked
              ? "Resolve the duplicate first"
              : undefined
          }
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
      <input
        type="text"
        value={stake.name ?? ""}
        onChange={(e) => set({ ...stake, name: e.target.value })}
        placeholder="Name"
        className="w-full px-2.5 py-1.5 text-[12px] rounded-card border mb-1.5"
        style={{ borderColor: BRAND.cardBorder }}
      />
      <input
        type="text"
        value={stake.email ?? ""}
        onChange={(e) => set({ ...stake, email: e.target.value })}
        placeholder="Email"
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
}: {
  goal: CSGoal;
  expanded: boolean;
  openQ: 1 | 2 | 3 | null;
  setOpenQ: (n: 1 | 2 | 3 | null) => void;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const status = statusOf(goal);
  const isFrozen = status === "frozen";
  const isFlagged = status === "flagged";
  const prog = progressOf(goal);

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
        <div>
          <div
            className="text-[13px] font-bold leading-snug"
            style={{ color: BRAND.t1 }}
          >
            {goal.title}
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
          <GoalFrozenBody goal={goal} onChanged={onChanged} />
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
  const flag = () =>
    patch.mutate({
      validation_status: isFlagged ? "pending" : "flagged",
      flag_note: isFlagged
        ? null
        : (goal.flag_note ?? "Flagged for discussion"),
    });
  function removeWithPrompt() {
    const reason = prompt(
      "Remove this goal? Add a brief reason (≥5 chars, kept in audit trail):",
    );
    if (!reason || reason.trim().length < 5) return;
    remove.mutate(reason.trim());
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
          <b>🚩 Flagged for discussion:</b> {goal.flag_note || "(no note)"}
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
          onClick={flag}
          className="text-[11px] font-semibold px-2.5 py-1.5 rounded-card border"
          style={{
            borderColor: BRAND.cardBorder,
            color: BRAND.t2,
            background: "#fff",
          }}
        >
          {isFlagged ? "Un-flag" : "🚩 Flag for discussion"}
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
    return (
      <QBoxFrame state="pending" onClick={() => setOpenQ(1)}>
        <QBoxHead
          state="pending"
          num={1}
          title="1 · What does this goal mean?"
          tag="Click to start"
        />
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
    return (
      <QBoxFrame
        state="pending"
        onClick={locked ? undefined : () => setOpenQ(2)}
      >
        <QBoxHead
          state="pending"
          num={2}
          title="2 · What background work has informed this?"
          tag={locked ? "Locked" : "Pending"}
        />
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
    return (
      <QBoxFrame
        state="pending"
        onClick={locked ? undefined : () => setOpenQ(3)}
      >
        <QBoxHead
          state="pending"
          num={3}
          title="3 · Agreed target — the number, not the aspiration"
          tag={locked ? "Locked" : "Pending"}
        />
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
}: {
  goal: CSGoal;
  onChanged: () => void;
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

      {inits.length === 0 ? (
        <EmptyInitiatives cat={goal.category} />
      ) : (
        inits.map((it) => (
          <InitiativeRow
            key={it.id}
            init={it}
            cat={goal.category}
            onSave={(next) => {
              saveInits(inits.map((x) => (x.id === it.id ? next : x)));
            }}
            onDelete={() => {
              if (!confirm("Remove this initiative?")) return;
              saveInits(inits.filter((x) => x.id !== it.id));
            }}
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
  onSave,
  onDelete,
}: {
  init: ProtoInit;
  cat: CSGoalCategory;
  onSave: (next: ProtoInit) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const itype = INIT_TYPES.find((t) => t.label === init.type) ?? INIT_TYPES[0];

  if (editing) {
    return (
      <InitiativeEditRow
        init={init}
        cat={cat}
        onClose={() => setEditing(false)}
        onSave={(next) => {
          onSave(next);
          setEditing(false);
        }}
      />
    );
  }

  return (
    <div
      className="grid items-center gap-2.5 p-2.5 rounded-card mb-1.5"
      style={{
        gridTemplateColumns: "36px 1fr 110px 130px 90px 60px",
        background: "#fff",
        border: `1px solid ${BRAND.cardBorder}`,
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
      </div>
      <span
        className="text-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
        style={{
          background: `${STAGE_COLOR[init.stage] ?? BRAND.t3}15`,
          color: STAGE_COLOR[init.stage] ?? BRAND.t3,
        }}
      >
        {STAGE_LBL[init.stage] ?? init.stage}
      </span>
      <div
        className="text-right text-[11px]"
        style={{ color: BRAND.t2 }}
      >
        <b style={{ color: BRAND.t1 }}>{fmtUsd(init.delivered)}</b> /{" "}
        {fmtUsd(init.targetContribution)}
        <br />
        <span style={{ fontSize: 9, color: BRAND.t3 }}>
          delivered of target
        </span>
      </div>
      <div
        className="text-right text-[10px]"
        style={{ color: BRAND.t3 }}
      >
        {fd(init.updatedAt)}
      </div>
      <div className="flex gap-1 justify-end">
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
  );
}

function InitiativeEditRow({
  init,
  cat,
  onClose,
  onSave,
}: {
  init: ProtoInit;
  cat: CSGoalCategory;
  onClose: () => void;
  onSave: (next: ProtoInit) => void;
}) {
  const [draft, setDraft] = useState<ProtoInit>(init);
  const stages = stagesFor(cat);

  function commit<K extends keyof ProtoInit>(k: K, v: ProtoInit[K]) {
    setDraft({ ...draft, [k]: v });
  }

  return (
    <div
      className="rounded-card p-3 mb-1.5"
      style={{ background: "#fafbff", border: `1.5px solid ${BRAND.indigo}40` }}
    >
      <div
        className="grid gap-2 items-end"
        style={{
          gridTemplateColumns: "2fr 1.4fr 1.2fr 1fr 1fr auto",
        }}
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
          value={draft.stage}
          options={stages}
          render={(s) => STAGE_LBL[s] ?? s}
          onChange={(v) => commit("stage", v)}
        />
        <NumField
          label="Target $"
          value={draft.targetContribution}
          onChange={(v) => commit("targetContribution", v)}
        />
        <NumField
          label="Delivered $"
          value={draft.delivered}
          onChange={(v) => commit("delivered", v)}
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
      <div className="flex justify-end mt-1.5">
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
  const [draft, setDraft] = useState<ProtoInit>({
    id: "",
    name: "",
    type: INIT_TYPES[0].label,
    module: INIT_TYPES[0].module,
    owner: "",
    stage: stages[0],
    targetContribution: 0,
    delivered: 0,
    updatedAt: "",
  });

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
          value={draft.stage}
          options={stages}
          render={(s) => STAGE_LBL[s] ?? s}
          onChange={(v) => setDraft({ ...draft, stage: v })}
        />
        <NumField
          label="Target $"
          value={draft.targetContribution}
          onChange={(v) => setDraft({ ...draft, targetContribution: v })}
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
            setDraft({
              id: "",
              name: "",
              type: INIT_TYPES[0].label,
              module: INIT_TYPES[0].module,
              owner: "",
              stage: stages[0],
              targetContribution: 0,
              delivered: 0,
              updatedAt: "",
            });
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
