// 10-Jun · Value Tracking — rewritten to a 3-layer % completion
// drill-down (replaces the older $-based portfolio rollup):
//
//   1. Portfolio rollup  — # active initiatives + overall % completion
//   2. Goal cards        — per-goal initiative count + average % + bar
//   3. Initiative cards  — info + touchpoints (read-only here; Edit
//                          deep-links to the Goal Alignment tab)
//
// Math (matches stakeholder spec):
//   effective_pct = (init.status === 'delivered') ? 100 : (completion_pct ?? 0)
//   overall_% = sum(effective_pct) / count(initiatives)
//   goal_%    = sum(effective_pct on that goal) / count(those initiatives)
//
// "Active" = every non-deleted initiative on a frozen + non-deleted goal.
// Delivered ones still count toward the denominator at 100%.
//
// Data sources (no backend changes):
//   • Frozen goals  → /accounts/:id/cs-goals?include_deleted=false
//   • Activities    → /accounts/:id/activities  (filtered to touchpoints
//                     whose linked_initiatives contains the init id)

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { api } from "@/lib/api";
import { useAccountFromLayout } from "../../AccountProfileLayout";
import {
  type CSGoal,
  type CSGoalCategory,
  type Initiative,
} from "@/types/cs_goal";
import { type Activity, ACT_CONF } from "@/types/signal";

const BRAND = {
  indigo: "#4A00F8",
  midnight: "#001137",
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

const CAT_EMOJI: Partial<Record<CSGoalCategory, string>> = {
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

const STATUS_TONE: Record<string, { bg: string; col: string; label: string }> = {
  identification: { bg: "#f1f5f9", col: BRAND.t2, label: "Identification" },
  pipeline:       { bg: "#fff8eb", col: "#a36400", label: "Pipeline" },
  in_progress:    { bg: "#ede6ff", col: BRAND.indigo, label: "In Progress" },
  delivered:      { bg: "#f0fdf4", col: "#146a45", label: "Delivered" },
  not_started:    { bg: "#f1f5f9", col: BRAND.t3, label: "Identification" },
};

function effectivePct(it: Initiative): number {
  if (it.status === "delivered") return 100;
  const v = (it.completion_pct ?? 0);
  if (Number.isNaN(v) || v < 0) return 0;
  return Math.min(100, v);
}

function avg(pcts: number[]): number {
  if (pcts.length === 0) return 0;
  return Math.round(pcts.reduce((s, p) => s + p, 0) / pcts.length);
}

// ============================================================
// Top-level tab
// ============================================================
export default function ValueTrackingTabV2() {
  const account = useAccountFromLayout();

  const goalsQ = useQuery<{ items: CSGoal[] }>({
    queryKey: ["cs-goals", account.id, false],
    queryFn: () =>
      api.get(`/api/v1/accounts/${account.id}/cs-goals?include_deleted=false`),
  });

  const actQ = useQuery<{ items: Activity[] }>({
    queryKey: ["activities", account.id],
    queryFn: () =>
      api.get<{ items: Activity[] }>(`/api/v1/accounts/${account.id}/activities`),
    staleTime: 60_000,
  });

  const frozenGoals = useMemo(
    () =>
      (goalsQ.data?.items ?? []).filter(
        (g) => g.validation_status === "accepted" && !g.deleted_at,
      ),
    [goalsQ.data],
  );

  // Build per-initiative touchpoint list (newest first), keyed by init id.
  // Init ids live on Initiative.value_fields.id.
  const touchpointsByInit = useMemo(() => {
    const map = new Map<string, Activity[]>();
    for (const a of actQ.data?.items ?? []) {
      if (a.hidden) continue;
      for (const initId of a.linked_initiatives ?? []) {
        const arr = map.get(initId) ?? [];
        arr.push(a);
        map.set(initId, arr);
      }
    }
    for (const arr of map.values()) {
      arr.sort((x, y) => {
        const xt = x.occurred_at ?? x.created_at ?? "";
        const yt = y.occurred_at ?? y.created_at ?? "";
        return yt.localeCompare(xt);
      });
    }
    return map;
  }, [actQ.data]);

  if (goalsQ.isLoading || actQ.isLoading) {
    return <div className="text-[12px] text-text-muted p-4">Loading…</div>;
  }

  if (frozenGoals.length === 0) {
    return (
      <div
        className="rounded-card p-6 text-center"
        style={{
          background: "#fff",
          border: `1px dashed ${BRAND.cardBorder}`,
        }}
      >
        <div className="text-[22px] mb-2">🎯</div>
        <div
          className="text-[13px] font-bold mb-1"
          style={{ color: BRAND.t1 }}
        >
          No frozen goals yet
        </div>
        <div className="text-[11.5px]" style={{ color: BRAND.t2 }}>
          Lock at least one goal in{" "}
          <Link
            to={`/accounts/${account.id}/success-management/goal-alignment`}
            className="font-bold underline"
            style={{ color: BRAND.indigo }}
          >
            Validation &amp; Alignment
          </Link>{" "}
          to start tracking value here.
        </div>
      </div>
    );
  }

  // Portfolio rollup math — pool every initiative across every frozen goal.
  const allInits = frozenGoals.flatMap((g) => g.initiatives);
  const portfolioPct = avg(allInits.map(effectivePct));
  // 10-Jun · Touchpoint roll-up is the SUM of per-initiative counts
  // (stakeholder preference — not de-duplicated). One activity tagged
  // to N initiatives counts as N touchpoints in the total.
  const portfolioTpCount = frozenGoals.reduce(
    (n, g) =>
      n +
      g.initiatives.reduce(
        (m, it, idx) =>
          m + (touchpointsByInit.get(initIdFor(it, idx)) ?? []).length,
        0,
      ),
    0,
  );

  return (
    <div className="space-y-3">
      <PortfolioRollup
        initCount={allInits.length}
        overallPct={portfolioPct}
        goalCount={frozenGoals.length}
        touchpointCount={portfolioTpCount}
      />

      {/* 10-Jun · Per-goal cards — one per frozen goal, average % of that
          goal's initiatives + expandable initiative drill-down. */}
      {frozenGoals.map((g) => (
        <GoalCard
          key={g.id}
          goal={g}
          accountId={account.id}
          touchpointsByInit={touchpointsByInit}
        />
      ))}
    </div>
  );
}

// ============================================================
// 1. Portfolio rollup — 2 numbers + progress bar
// ============================================================
function PortfolioRollup({
  initCount,
  overallPct,
  goalCount,
  touchpointCount,
}: {
  initCount: number;
  overallPct: number;
  goalCount: number;
  touchpointCount: number;
}) {
  return (
    <div
      className="rounded-card p-4"
      style={{ background: "#fff", border: `1px solid ${BRAND.cardBorder}` }}
    >
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <div
            className="text-[14px] font-bold"
            style={{ color: BRAND.t1 }}
          >
            Portfolio Rollup
          </div>
          <div className="text-[10.5px]" style={{ color: BRAND.t3 }}>
            {goalCount} frozen goal{goalCount === 1 ? "" : "s"} ·{" "}
            {initCount} active initiative{initCount === 1 ? "" : "s"} ·{" "}
            {touchpointCount} touchpoint{touchpointCount === 1 ? "" : "s"}
          </div>
        </div>
        <div
          className="text-[10.5px] font-bold uppercase tracking-wider"
          style={{ color: BRAND.indigo }}
        >
          {overallPct}% overall
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-stretch">
        <Tile
          label="Active initiatives"
          value={String(initCount)}
          accent={BRAND.indigo}
        />
        <Tile
          label="Overall % completion"
          value={`${overallPct}%`}
          accent={BRAND.green}
          progress={overallPct}
        />
        {/* 10-Jun · Total touchpoints — sum of per-initiative counts
            across every frozen goal. Not de-duplicated; activity tagged
            to N initiatives counts as N touchpoints. */}
        <Tile
          label="Touchpoints"
          value={String(touchpointCount)}
          accent={BRAND.fuscia}
        />
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  accent,
  progress,
}: {
  label: string;
  value: string;
  accent: string;
  progress?: number;
}) {
  return (
    <div
      className="rounded-card p-3 flex flex-col justify-between"
      style={{
        background: "#fff",
        border: `1px solid ${BRAND.cardBorder}`,
        borderLeftWidth: 4,
        borderLeftColor: accent,
      }}
    >
      <div
        className="text-[10px] font-bold uppercase tracking-wider"
        style={{ color: BRAND.t3 }}
      >
        {label}
      </div>
      <div className="flex items-baseline justify-between gap-2 mt-1">
        <div
          className="text-[24px] font-extrabold leading-none"
          style={{ color: BRAND.t1 }}
        >
          {value}
        </div>
      </div>
      {typeof progress === "number" && (
        <div
          className="h-1.5 rounded-full overflow-hidden mt-2"
          style={{ background: "#e8eef8" }}
        >
          <div
            className="h-full rounded-full"
            style={{ width: `${progress}%`, background: accent }}
          />
        </div>
      )}
    </div>
  );
}

// ============================================================
// 2. Per-goal card
// ============================================================
function GoalCard({
  goal,
  accountId,
  touchpointsByInit,
}: {
  goal: CSGoal;
  accountId: string;
  touchpointsByInit: Map<string, Activity[]>;
}) {
  const [open, setOpen] = useState(true);

  const inits = goal.initiatives;
  const goalPct = avg(inits.map(effectivePct));
  // Sum-of-per-initiative touchpoint counts (matches the portfolio
  // rollup math — not deduplicated across initiatives).
  const tpCount = inits.reduce(
    (n, it, idx) => n + (touchpointsByInit.get(initIdFor(it, idx)) ?? []).length,
    0,
  );

  const emoji = CAT_EMOJI[goal.category] ?? "📌";

  return (
    <div
      className="rounded-card overflow-hidden"
      style={{ background: "#fff", border: `1px solid ${BRAND.cardBorder}` }}
    >
      {/* Card header — clickable to toggle */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-4 py-3 flex items-center gap-3"
        style={{ background: "#fff" }}
      >
        <div
          className="w-10 h-10 rounded-card flex items-center justify-center text-[22px] shrink-0"
          style={{ background: "#f3f0ff" }}
        >
          {emoji}
        </div>
        <div className="flex-1 min-w-0">
          <div
            className="text-[13px] font-bold leading-snug"
            style={{ color: BRAND.t1 }}
          >
            {goal.title}
          </div>
          <div className="text-[10.5px]" style={{ color: BRAND.t3 }}>
            {inits.length} initiative{inits.length === 1 ? "" : "s"}
            {tpCount > 0 && (
              <>
                {" · "}
                {tpCount} touchpoint{tpCount === 1 ? "" : "s"}
              </>
            )}
            {goal.owner && (
              <>
                {" · "}
                Owner: <b style={{ color: BRAND.t2 }}>{goal.owner}</b>
              </>
            )}
          </div>
        </div>

        {/* Per-goal % completion + bar + touchpoint pill */}
        <div className="w-[260px] shrink-0">
          <div className="flex justify-between text-[10.5px] mb-1">
            <span style={{ color: BRAND.t3 }}>Completion</span>
            <b style={{ color: BRAND.t1 }}>{goalPct}%</b>
          </div>
          <div
            className="h-1.5 rounded-full overflow-hidden"
            style={{ background: "#e8eef8" }}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${goalPct}%`,
                background: goalPct >= 80
                  ? BRAND.green
                  : goalPct >= 40
                    ? BRAND.amber
                    : BRAND.red,
              }}
            />
          </div>
          {/* 10-Jun · Touchpoint count adjacent to the bar — same
              sum-of-counts math as the portfolio rollup. */}
          <div className="flex justify-end mt-1">
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold"
              style={{ background: "#f5e0f6", color: "#8a1a90" }}
              title="Sum of touchpoints across this goal's initiatives"
            >
              💬 {tpCount} touchpoint{tpCount === 1 ? "" : "s"}
            </span>
          </div>
        </div>

        <div
          className="text-[12px] font-bold ml-2"
          style={{ color: BRAND.t3 }}
        >
          {open ? "▾" : "▸"}
        </div>
      </button>

      {/* Card body — initiatives */}
      {open && (
        <div
          className="px-4 pt-1 pb-3 border-t"
          style={{ borderColor: BRAND.cardBorder, background: "#fafbff" }}
        >
          {inits.length === 0 ? (
            <div
              className="rounded-card border border-dashed p-4 my-2 text-center text-[11.5px]"
              style={{ borderColor: BRAND.cardBorder, color: BRAND.t3 }}
            >
              No initiatives on this goal yet — add them in{" "}
              <Link
                to={`/accounts/${accountId}/success-management/goal-alignment`}
                className="font-bold underline"
                style={{ color: BRAND.indigo }}
              >
                Validation &amp; Alignment
              </Link>
              .
            </div>
          ) : (
            <div className="space-y-2 mt-2">
              {inits.map((it, idx) => {
                const id = initIdFor(it, idx);
                return (
                  <InitiativeCard
                    key={id}
                    init={it}
                    initId={id}
                    goalId={goal.id}
                    accountId={accountId}
                    touchpoints={touchpointsByInit.get(id) ?? []}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Initiative id lives on Initiative.value_fields.id (set by readInit in
// GoalAlignmentTab). Falls back to a positional id matching that file's
// pattern so the touchpoint linkage stays consistent.
function initIdFor(it: Initiative, idx?: number): string {
  const vf = (it.value_fields ?? {}) as Record<string, unknown>;
  const id = typeof vf.id === "string" ? vf.id : null;
  return id ?? `i_${idx ?? 0}`;
}

// ============================================================
// 3. Per-initiative card — info + touchpoints
// ============================================================
function InitiativeCard({
  init,
  initId,
  goalId,
  accountId,
  touchpoints,
}: {
  init: Initiative;
  initId: string;
  goalId: string;
  accountId: string;
  touchpoints: Activity[];
}) {
  const [openTp, setOpenTp] = useState(false);

  const pct = effectivePct(init);
  const status = init.status === "not_started" ? "identification" : init.status;
  const tone = STATUS_TONE[status] ?? STATUS_TONE.identification;
  const target = (init.value_target ?? "").replace(/^\$/, "").trim();
  const delivered = (init.value_delivered ?? "").replace(/^\$/, "").trim();

  return (
    <div
      className="rounded-card"
      style={{ background: "#fff", border: `1px solid ${BRAND.cardBorder}` }}
    >
      {/* Row 1 — name · stage · target/delivered · % · edit deep-link */}
      <div
        className="grid items-center gap-2.5 p-2.5"
        style={{
          gridTemplateColumns: "1.6fr 110px 1fr 80px 80px",
        }}
      >
        <div className="min-w-0">
          <div
            className="text-[12.5px] font-bold leading-snug"
            style={{ color: BRAND.t1 }}
          >
            {init.name || "Untitled initiative"}
          </div>
          {init.notes && (
            <div
              className="text-[10.5px] mt-0.5 leading-snug line-clamp-2"
              style={{ color: BRAND.t2 }}
              title={init.notes}
            >
              {init.notes}
            </div>
          )}
        </div>
        <span
          className="text-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
          style={{ background: tone.bg, color: tone.col }}
        >
          {tone.label}
        </span>
        <div className="text-right text-[11px]" style={{ color: BRAND.t2 }}>
          <b style={{ color: BRAND.t1 }}>{delivered || "—"}</b>
          <span style={{ color: BRAND.t3 }}> / {target || "—"}</span>
          <div style={{ fontSize: 9, color: BRAND.t3 }}>delivered / target</div>
        </div>
        <div className="text-center">
          <div
            className="text-[14px] font-extrabold"
            style={{ color: BRAND.t1 }}
          >
            {pct}%
          </div>
          <div
            className="h-1 rounded-full overflow-hidden mt-1"
            style={{ background: "#e8eef8" }}
          >
            <div
              className="h-full"
              style={{
                width: `${pct}%`,
                background: pct >= 80 ? BRAND.green : pct >= 40 ? BRAND.amber : BRAND.red,
              }}
            />
          </div>
        </div>
        {/* Edit → deep-link to Goal Alignment tab. Query string carries
            both the goal id (for scroll + expand) and the initiative id
            (so InitiativeRow opens its editor automatically on landing). */}
        <Link
          to={`/accounts/${accountId}/success-management/goal-alignment?goal=${encodeURIComponent(goalId)}&init=${encodeURIComponent(initId)}`}
          className="text-[10.5px] font-bold rounded-card border px-2 py-1.5 text-center"
          style={{
            borderColor: BRAND.indigo + "40",
            background: "#f3f0ff",
            color: BRAND.indigo,
          }}
          title="Edit in Validation & Alignment"
        >
          ✏️ Edit
        </Link>
      </div>

      {/* Row 2 — Touchpoints expander */}
      {touchpoints.length > 0 && (
        <div
          className="px-2.5 pb-2.5 -mt-1"
          style={{ borderTop: "0" }}
        >
          <button
            type="button"
            onClick={() => setOpenTp((v) => !v)}
            className="text-[10.5px] font-semibold inline-flex items-center gap-1.5 px-2 py-1 rounded-card"
            style={{
              background: "#f3f0ff",
              color: BRAND.indigo,
              border: `1px solid ${BRAND.indigo}20`,
            }}
          >
            {openTp ? "▾" : "▸"} 💬 {touchpoints.length} touchpoint
            {touchpoints.length === 1 ? "" : "s"}
          </button>
          {openTp && (
            <div className="mt-2 space-y-1.5">
              {touchpoints.map((a) => (
                <TouchpointRow key={a.id} act={a} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// 4. Touchpoint row (read-only; mirrors GoalAlignmentTab styling)
// ============================================================
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
            <div className="text-[10px] mt-1" style={{ color: BRAND.t3 }}>
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
