// 05-Jun · Pass-2 — Value Tracking tab, faithful port of
// beroe_sm_strategy_proto.html renderTrackingTab():
//
//   1. Portfolio rollup  — totals + 4 KPI tiles + per-category breakdown
//   2. Health signals    — auto-derived warnings (no inits / stale / stuck / deadline)
//   3. Activity feed     — recency filter chips + Log activity modal
//
// Data sources (no backend changes):
//   • Frozen goals = cs_goals where validation_status='accepted'
//   • Initiatives delivered $ = cs_goals.initiatives[].value_delivered
//   • Activities = M27 /accounts/:id/activities
//
// Brand-locked palette only.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, ApiError } from "@/lib/api";
import { useAccountFromLayout } from "../../AccountProfileLayout";
import {
  type CSGoal,
  type CSGoalCategory,
  CATEGORY_LABELS,
} from "@/types/cs_goal";
import {
  type Activity,
  type ActivityListResponse,
  type ActivityCreate,
  type ActivityType,
  ACTIVITY_TYPES,
  ACT_CONF,
} from "@/types/signal";

const BRAND = {
  indigo: "#4A00F8",
  midnight: "#001137",
  fuscia: "#C344C7",
  aqua: "#35E1D4",
  red: "#CF4548",
  amber: "#F0BC41",
  green: "#6EC457",
  cardBorder: "#e4eaf6",
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

const CAT_COLOR: Partial<Record<CSGoalCategory, string>> = {
  cost_savings: BRAND.green,
  cost_reduction: BRAND.green,
  negotiation_leverage: BRAND.green,
  should_cost_modeling: BRAND.green,
  tco_optimization: BRAND.green,
  risk_mitigation: BRAND.red,
  financial_risk_monitoring: BRAND.red,
  supply_assurance: BRAND.red,
  geopolitical_risk_management: BRAND.red,
  esg_responsible_sourcing: BRAND.red,
  base_rationalization: BRAND.amber,
  enhanced_supplier_discovery: BRAND.amber,
  lcc_ncc_sourcing_strategy: BRAND.amber,
  adoption: BRAND.fuscia,
  ai_driven_sourcing_transformations: BRAND.fuscia,
  other: BRAND.fuscia,
};

function fmtUsd(n: number): string {
  if (!n) return "$0";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

function parseUsd(s: string | null | undefined): number {
  if (!s) return 0;
  const m = String(s).match(/(\d+\.?\d*)/);
  if (!m) return 0;
  let v = Number(m[1]);
  if (/m/i.test(s)) v *= 1_000_000;
  else if (/k/i.test(s)) v *= 1_000;
  return v;
}

function daysAgo(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Top-level tab
// ---------------------------------------------------------------------------
export default function ValueTrackingTabV2() {
  const account = useAccountFromLayout();
  const qc = useQueryClient();

  const goalsQ = useQuery<{ items: CSGoal[] }>({
    queryKey: ["cs-goals", account.id, false],
    queryFn: () =>
      api.get(`/api/v1/accounts/${account.id}/cs-goals?include_deleted=false`),
  });
  const goals = goalsQ.data?.items ?? [];

  const actQ = useQuery<ActivityListResponse>({
    queryKey: ["activities", account.id],
    queryFn: () =>
      api.get<ActivityListResponse>(`/api/v1/accounts/${account.id}/activities`),
  });
  const activities = useMemo(
    () => (actQ.data?.items ?? []).filter((a) => !a.hidden),
    [actQ.data],
  );

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["activities", account.id] });
  }

  if (goalsQ.isLoading || actQ.isLoading) {
    return <div className="text-[12px] text-text-muted p-4">Loading…</div>;
  }

  return (
    <div className="space-y-3">
      <PortfolioRollup goals={goals} />
      <HealthSignals goals={goals} />
      <ActivitySection
        accountId={account.id}
        activities={activities}
        canWrite={actQ.data?.is_editable ?? false}
        onChanged={invalidate}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Portfolio rollup
// ---------------------------------------------------------------------------
function PortfolioRollup({ goals }: { goals: CSGoal[] }) {
  const frozen = useMemo(
    () => goals.filter((g) => g.validation_status === "accepted"),
    [goals],
  );

  const stats = useMemo(() => {
    const allInits = frozen.flatMap((g) => g.initiatives);
    const totalTarget = frozen.reduce(
      (s, g) => s + parseUsd(g.target_value),
      0,
    );
    const totalDelivered = allInits.reduce(
      (s, i) => s + parseUsd(i.value_delivered),
      0,
    );
    const pct = totalTarget
      ? Math.min(100, Math.round((totalDelivered / totalTarget) * 100))
      : 0;
    const byCat: Record<string, { target: number; delivered: number; goals: number }> = {};
    for (const g of frozen) {
      const c = g.category;
      if (!byCat[c]) byCat[c] = { target: 0, delivered: 0, goals: 0 };
      byCat[c].target += parseUsd(g.target_value);
      byCat[c].delivered += g.initiatives.reduce(
        (s, i) => s + parseUsd(i.value_delivered),
        0,
      );
      byCat[c].goals++;
    }
    return { allInits, totalTarget, totalDelivered, pct, byCat };
  }, [frozen]);

  return (
    <div
      className="rounded-card p-4"
      style={{ background: "#fff", border: `1px solid ${BRAND.cardBorder}` }}
    >
      <div
        className="text-[11px] font-bold mb-2.5 uppercase tracking-wider"
        style={{ color: "#6b7fa0" }}
      >
        Portfolio rollup · across {frozen.length} frozen goal
        {frozen.length !== 1 ? "s" : ""}
      </div>
      <div className="grid grid-cols-4 gap-2.5 mb-3.5">
        <Tile
          label="Total committed"
          value={stats.totalTarget ? fmtUsd(stats.totalTarget) : "—"}
        />
        <Tile
          label="Delivered"
          value={fmtUsd(stats.totalDelivered)}
          bg="#f0fdf4"
          border={`${BRAND.green}30`}
          color="#146a45"
        />
        <Tile
          label="Overall progress"
          value={`${stats.pct}%`}
          bg="#ede6ff"
          border="#C9B5FF"
          color={BRAND.indigo}
          progress={stats.pct}
        />
        <Tile label="Active initiatives" value={String(stats.allInits.length)} />
      </div>
      {Object.keys(stats.byCat).length > 0 && (
        <div>
          <div
            className="text-[10px] font-bold mb-1.5 uppercase tracking-wider"
            style={{ color: BRAND.t3 }}
          >
            By category
          </div>
          {Object.entries(stats.byCat).map(([cat, c]) => {
            const catKey = cat as CSGoalCategory;
            const catPct = c.target
              ? Math.round((c.delivered / c.target) * 100)
              : 0;
            return (
              <div
                key={cat}
                className="grid items-center py-1.5 text-[11.5px]"
                style={{ gridTemplateColumns: "24px 1fr 90px 90px 140px", gap: 10 }}
              >
                <span className="text-[14px]">
                  {CAT_EMOJI[catKey] ?? "📌"}
                </span>
                <span
                  className="font-semibold"
                  style={{ color: BRAND.t1 }}
                >
                  {CATEGORY_LABELS[catKey]}
                  <span style={{ color: BRAND.t3, fontWeight: 400 }}>
                    {" "}
                    · {c.goals} goal{c.goals !== 1 ? "s" : ""}
                  </span>
                </span>
                <span className="text-right" style={{ color: BRAND.t2 }}>
                  {fmtUsd(c.delivered)}
                </span>
                <span className="text-right" style={{ color: BRAND.t3 }}>
                  / {fmtUsd(c.target)}
                </span>
                <div className="flex items-center gap-1.5">
                  <div
                    className="flex-1 h-[5px] rounded-[3px] overflow-hidden"
                    style={{ background: "#e8eef8" }}
                  >
                    <div
                      className="h-full rounded-[3px]"
                      style={{
                        width: `${catPct}%`,
                        background: CAT_COLOR[catKey] ?? BRAND.indigo,
                      }}
                    />
                  </div>
                  <span
                    className="text-[10px] font-bold"
                    style={{ color: BRAND.t1 }}
                  >
                    {catPct}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {frozen.length === 0 && (
        <div
          className="text-[11.5px] mt-2 px-3 py-2 rounded-card"
          style={{ background: "#f8f9fc", color: BRAND.t2 }}
        >
          No frozen goals yet. Freeze goals in the <b>Goal Validation and
          Alignment</b> tab to populate this rollup.
        </div>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  bg = "#f8f9fc",
  border = BRAND.cardBorder,
  color = BRAND.t1,
  progress,
}: {
  label: string;
  value: string;
  bg?: string;
  border?: string;
  color?: string;
  progress?: number;
}) {
  return (
    <div
      className="rounded-card p-3"
      style={{ background: bg, border: `1px solid ${border}` }}
    >
      <div
        className="text-[9.5px] font-bold uppercase tracking-wider"
        style={{ color: color === BRAND.t1 ? BRAND.t3 : color }}
      >
        {label}
      </div>
      <div
        className="text-[18px] font-extrabold mt-0.5"
        style={{ color }}
      >
        {value}
      </div>
      {progress !== undefined && (
        <div
          className="h-[4px] rounded-[2px] mt-1.5 overflow-hidden"
          style={{ background: "#fff" }}
        >
          <div
            className="h-full rounded-[2px]"
            style={{ width: `${progress}%`, background: color }}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Health signals — auto-derived
// ---------------------------------------------------------------------------
interface HealthSig {
  sev: "red" | "amber" | "blue";
  text: string;
  sub?: string;
}

function computeHealth(goals: CSGoal[]): HealthSig[] {
  const out: HealthSig[] = [];
  const frozen = goals.filter((g) => g.validation_status === "accepted");

  // Frozen goals with no initiatives
  const noInit = frozen.filter((g) => g.initiatives.length === 0);
  if (noInit.length > 0) {
    out.push({
      sev: "amber",
      text: `${noInit.length} frozen goal${noInit.length > 1 ? "s" : ""} ha${noInit.length > 1 ? "ve" : "s"} no initiatives yet`,
      sub: noInit.map((g) => g.title).join(" · "),
    });
  }

  // Stale initiatives — no updated_at on initiative, so use the goal's updated_at
  // as a proxy.
  const stale: { goal: string; name: string; days: number }[] = [];
  for (const g of frozen) {
    const d = daysAgo(g.updated_at);
    if (d !== null && d > 90) {
      for (const i of g.initiatives) {
        stale.push({ goal: g.title, name: i.name, days: d });
      }
    }
  }
  if (stale.length > 0) {
    out.push({
      sev: "amber",
      text: `${stale.length} initiative${stale.length > 1 ? "s" : ""} not updated in 90+ days`,
      sub: stale
        .slice(0, 2)
        .map((s) => `"${s.name}" (${s.days}d)`)
        .join(" · "),
    });
  }

  // Initiatives with zero delivered but a target
  const stuck: { goal: string; name: string }[] = [];
  for (const g of frozen) {
    for (const i of g.initiatives) {
      const delivered = parseUsd(i.value_delivered);
      const target = parseUsd(i.value_target);
      if (target > 0 && delivered === 0) {
        stuck.push({ goal: g.title, name: i.name });
      }
    }
  }
  if (stuck.length > 0) {
    out.push({
      sev: "blue",
      text: `${stuck.length} initiative${stuck.length > 1 ? "s" : ""} not yet started`,
      sub: stuck
        .slice(0, 2)
        .map((s) => `"${s.name}"`)
        .join(" · "),
    });
  }

  // Deadline at risk: target_date < 180d AND pct < 40
  for (const g of frozen) {
    if (!g.target_date) continue;
    const due = new Date(g.target_date).getTime();
    const days = Math.ceil((due - Date.now()) / 86_400_000);
    if (days <= 0 || days >= 180) continue;
    const t = parseUsd(g.target_value);
    if (!t) continue;
    const d = g.initiatives.reduce(
      (s, i) => s + parseUsd(i.value_delivered),
      0,
    );
    const pct = Math.round((d / t) * 100);
    if (pct < 40) {
      out.push({
        sev: "red",
        text: `${g.title} — ${days}d to deadline, only ${pct}% delivered`,
        sub: "Re-prioritize initiatives or revise target.",
      });
    }
  }

  return out;
}

function HealthSignals({ goals }: { goals: CSGoal[] }) {
  const sigs = useMemo(() => computeHealth(goals), [goals]);

  if (sigs.length === 0) {
    return (
      <div
        className="rounded-card px-3.5 py-2.5 flex items-center gap-2.5 text-[12px] font-semibold"
        style={{
          background: "#f0fdf4",
          border: `1px solid ${BRAND.green}30`,
          color: "#146a45",
        }}
      >
        <span className="text-[16px]">✓</span> No active health signals —
        portfolio looks clean.
      </div>
    );
  }

  return (
    <div
      className="rounded-card p-4"
      style={{ background: "#fff", border: `1px solid ${BRAND.cardBorder}` }}
    >
      <div
        className="text-[11px] font-bold mb-2.5 uppercase tracking-wider"
        style={{ color: "#6b7fa0" }}
      >
        Health signals{" "}
        <span style={{ color: BRAND.red, marginLeft: 4 }}>{sigs.length}</span>
      </div>
      {sigs.map((s, idx) => {
        const col =
          s.sev === "red"
            ? BRAND.red
            : s.sev === "amber"
              ? BRAND.amber
              : BRAND.indigo;
        const bg =
          s.sev === "red" ? "#fff0f2" : s.sev === "amber" ? "#fff8eb" : "#f3f0ff";
        const ic = s.sev === "red" ? "🚨" : s.sev === "amber" ? "⚠️" : "ℹ️";
        return (
          <div
            key={idx}
            className="flex gap-2.5 items-start py-2 px-3 mb-1.5"
            style={{
              background: bg,
              borderLeft: `3px solid ${col}`,
              borderRadius: "0 8px 8px 0",
            }}
          >
            <span className="text-[14px]">{ic}</span>
            <div className="flex-1">
              <div
                className="text-[12px] font-bold"
                style={{ color: col }}
              >
                {s.text}
              </div>
              {s.sub && (
                <div
                  className="text-[10.5px] mt-1"
                  style={{ color: BRAND.t2 }}
                >
                  {s.sub}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Activity section — filter chips + log modal
// ---------------------------------------------------------------------------
type ActFilter = "all" | "week" | "month" | "type";

function ActivitySection({
  accountId,
  activities,
  canWrite,
  onChanged,
}: {
  accountId: string;
  activities: Activity[];
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [filter, setFilter] = useState<ActFilter>("all");
  const [typeFilter, setTypeFilter] = useState<ActivityType | "all">("all");
  const [logOpen, setLogOpen] = useState(false);

  const filtered = useMemo(() => {
    const sorted = [...activities].sort(
      (a, b) =>
        new Date(b.occurred_at ?? b.created_at).getTime() -
        new Date(a.occurred_at ?? a.created_at).getTime(),
    );
    return sorted.filter((a) => {
      const days = daysAgo(a.occurred_at ?? a.created_at);
      if (filter === "week" && (days === null || days > 7)) return false;
      if (filter === "month" && (days === null || days > 30)) return false;
      if (filter === "type" && typeFilter !== "all" && a.type !== typeFilter)
        return false;
      return true;
    });
  }, [activities, filter, typeFilter]);

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/activities/${id}`),
    onSuccess: () => onChanged(),
  });

  return (
    <div
      className="rounded-card p-4"
      style={{ background: "#fff", border: `1px solid ${BRAND.cardBorder}` }}
    >
      <div className="flex items-center gap-2.5 mb-2.5">
        <div
          className="text-[11px] font-bold uppercase tracking-wider"
          style={{ color: "#6b7fa0" }}
        >
          Activity feed{" "}
          <span style={{ color: BRAND.t3, marginLeft: 4 }}>
            {activities.length}
          </span>
        </div>
        <div className="flex-1" />
        {canWrite && (
          <button
            type="button"
            onClick={() => setLogOpen(true)}
            className="text-[11px] font-semibold px-3 py-1.5 rounded-card text-white"
            style={{ background: BRAND.indigo }}
          >
            + Log activity
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 mb-2.5">
        {(
          [
            ["all", "All"],
            ["week", "This week"],
            ["month", "This month"],
            ["type", "By type"],
          ] as const
        ).map(([k, lbl]) => {
          const active = filter === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              className="text-[11px] font-semibold px-2.5 py-1 rounded-card border"
              style={
                active
                  ? {
                      background: BRAND.indigo,
                      borderColor: BRAND.indigo,
                      color: "#fff",
                    }
                  : {
                      background: "#fff",
                      borderColor: BRAND.cardBorder,
                      color: BRAND.t2,
                    }
              }
            >
              {lbl}
            </button>
          );
        })}
        {filter === "type" && (
          <select
            value={typeFilter}
            onChange={(e) =>
              setTypeFilter(e.target.value as ActivityType | "all")
            }
            className="text-[11px] px-2 py-1 rounded-card border"
            style={{ borderColor: BRAND.cardBorder, color: BRAND.t2 }}
          >
            <option value="all">All types</option>
            {ACTIVITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {ACT_CONF[t].ic} {ACT_CONF[t].label}
              </option>
            ))}
          </select>
        )}
      </div>

      {filtered.length === 0 ? (
        <div
          className="text-center py-6 text-[11.5px]"
          style={{ color: BRAND.t3 }}
        >
          📭 No activities match this filter.
        </div>
      ) : (
        <div className="space-y-1.5">
          {filtered.map((a) => (
            <ActivityRow
              key={a.id}
              act={a}
              canDelete={canWrite}
              onDelete={() => remove.mutate(a.id)}
            />
          ))}
        </div>
      )}

      {logOpen && (
        <LogActivityModal
          accountId={accountId}
          onClose={() => setLogOpen(false)}
          onCreated={() => {
            onChanged();
            setLogOpen(false);
          }}
        />
      )}
    </div>
  );
}

function ActivityRow({
  act,
  canDelete,
  onDelete,
}: {
  act: Activity;
  canDelete: boolean;
  onDelete: () => void;
}) {
  const cnf = ACT_CONF[act.type];
  const when = act.occurred_at ?? act.created_at;
  return (
    <div
      className="grid items-start gap-3 p-2.5 rounded-card"
      style={{
        gridTemplateColumns: "40px 1fr auto",
        background: "#fff",
        border: `1px solid ${BRAND.cardBorder}`,
      }}
    >
      <div
        className="w-9 h-9 rounded-card flex items-center justify-center text-[16px]"
        style={{ background: cnf.bg, color: cnf.col }}
      >
        {cnf.ic}
      </div>
      <div className="min-w-0">
        <div
          className="text-[12.5px] font-bold mb-0.5"
          style={{ color: BRAND.t1 }}
        >
          {act.title}
        </div>
        {act.summary && (
          <div
            className="text-[11.5px] mb-1"
            style={{ color: BRAND.t2, lineHeight: 1.55 }}
          >
            {act.summary}
          </div>
        )}
        <div
          className="text-[10.5px] flex flex-wrap gap-1.5 items-center"
          style={{ color: BRAND.t3 }}
        >
          <b style={{ color: BRAND.t2, fontWeight: 600 }}>
            {when ? new Date(when).toLocaleDateString() : "—"}
          </b>
          <span>·</span>
          <span>{cnf.label}</span>
          {act.added_by && (
            <>
              <span>·</span>
              <span>{act.added_by}</span>
            </>
          )}
          {act.attendees && (
            <>
              <span>·</span>
              <span>{act.attendees}</span>
            </>
          )}
        </div>
      </div>
      {canDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="text-[11px] px-2 py-1 rounded-card"
          style={{
            color: BRAND.t3,
            background: "#fff",
            border: `1px solid ${BRAND.cardBorder}`,
          }}
          title="Hide activity"
        >
          🗑
        </button>
      )}
    </div>
  );
}

function LogActivityModal({
  accountId,
  onClose,
  onCreated,
}: {
  accountId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [type, setType] = useState<ActivityType>("csm_call");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [attendees, setAttendees] = useState("");
  // ActivityCreate.occurred_at is typed `date | None` server-side, so send
  // a YYYY-MM-DD string — full ISO datetimes get rejected with 422.
  const [occurredAt, setOccurredAt] = useState<string>(
    new Date().toISOString().slice(0, 10),
  );

  const create = useMutation({
    mutationFn: () => {
      const body: ActivityCreate = {
        type,
        title: title.trim(),
        summary: summary.trim() || null,
        attendees: attendees.trim() || null,
        occurred_at: occurredAt || null,
      };
      return api.post(`/api/v1/accounts/${accountId}/activities`, body);
    },
    onSuccess: onCreated,
  });

  const errMsg = create.error
    ? create.error instanceof ApiError
      ? create.error.message
      : "Couldn't save activity — please try again."
    : null;

  return (
    <Modal title="Log a new activity" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <Label>Type</Label>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {ACTIVITY_TYPES.map((t) => {
              const on = type === t;
              const c = ACT_CONF[t];
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-card border"
                  style={
                    on
                      ? { background: c.col, borderColor: c.col, color: "#fff" }
                      : {
                          background: "#fff",
                          borderColor: BRAND.cardBorder,
                          color: BRAND.t2,
                        }
                  }
                >
                  {c.ic} {c.label}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <Label>Title <span style={{ color: BRAND.red }}>*</span></Label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Closed Olam renegotiation — $320K saved"
            className="w-full px-2.5 py-1.5 text-[12px] rounded-card border mt-1.5"
            style={{ borderColor: BRAND.cardBorder }}
          />
        </div>
        <div>
          <Label>Description</Label>
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            rows={3}
            placeholder="What happened? What's the context?"
            className="w-full px-2.5 py-1.5 text-[12px] rounded-card border resize-none mt-1.5"
            style={{ borderColor: BRAND.cardBorder }}
          />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <Label>Attendees</Label>
            <input
              type="text"
              value={attendees}
              onChange={(e) => setAttendees(e.target.value)}
              placeholder="e.g. Anika Sharma, Rohit Kumar"
              className="w-full px-2.5 py-1.5 text-[12px] rounded-card border mt-1.5"
              style={{ borderColor: BRAND.cardBorder }}
            />
          </div>
          <div>
            <Label>Occurred on</Label>
            <input
              type="date"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
              className="w-full px-2.5 py-1.5 text-[12px] rounded-card border mt-1.5"
              style={{ borderColor: BRAND.cardBorder }}
            />
          </div>
        </div>
      </div>
      {errMsg && (
        <div
          className="rounded-card px-3 py-2 mt-3 text-[11.5px]"
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
      <div className="flex justify-end gap-2 mt-4">
        <button
          type="button"
          onClick={onClose}
          className="text-[12px] px-3 py-1.5 rounded-card border"
          style={{ borderColor: BRAND.cardBorder, color: BRAND.t2 }}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={title.trim().length < 3 || create.isPending}
          onClick={() => {
            create.reset();
            create.mutate();
          }}
          className="text-[12px] px-3 py-1.5 rounded-card text-white font-semibold disabled:opacity-40"
          style={{ background: BRAND.indigo }}
        >
          {create.isPending ? "Saving…" : "Save activity"}
        </button>
      </div>
    </Modal>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[10.5px] font-bold uppercase tracking-wider"
      style={{ color: BRAND.t2 }}
    >
      {children}
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-card p-5 w-[520px] max-w-[92vw] shadow-xl max-h-[88vh] overflow-y-auto"
        style={{ border: `1.5px solid ${BRAND.cardBorder}` }}
      >
        <div className="flex items-center justify-between mb-3">
          <div
            className="text-[14px] font-bold"
            style={{ color: BRAND.midnight }}
          >
            {title}
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
        {children}
      </div>
    </div>
  );
}
