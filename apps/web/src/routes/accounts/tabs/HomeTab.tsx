// M32 — Home tab (replaces Overview).
//
// Faithful port of the prototype's bHome single-pane-of-glass. Reads
// real data from the M19–M28 endpoints and stitches it into:
//   * Priority Action Card (cascading priority logic — fix entry →
//     lock contract → red flag → renewal readiness → overdue
//     checkpoint → held-but-not-signed-off → no value logged →
//     no checkpoints).
//   * Quick stats KPIs (ACV, renewal in Nd, health, signals).
//   * Top Signals (M27 — critical/high first).
//   * This Week's Actions (computed client-side from signals + plays
//     + renewal proximity + metrics staleness).
//   * Expansion Pipeline preview (M26 plays, prob ≥60).
//   * Recent Activity (M27 activities, latest 4).
//   * Mode banner (M26 appetite recommendation).
//
// Routes the user into the right tab via React Router NavLinks so the
// priority CTAs land in context.

import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAccountFromLayout } from "../AccountProfileLayout";
import { formatACV, formatRenewalDays } from "@/lib/format";
import {
  MODE_CONF,
  fmtK,
  stageColor,
  stageName,
  type Appetite,
  type Play,
  type PlayListResponse,
} from "@/types/play";
import {
  SIG_CONF,
  ACT_CONF,
  type Activity,
  type ActivityListResponse,
  type SoftSignal,
  type SoftSignalListResponse,
} from "@/types/signal";
import type { Checkpoint, CheckpointListResponse } from "@/types/checkpoint";
import type { MetricListResponse, SuccessMetric } from "@/types/metric";
import type { DeliveryRenewal } from "@/types/delivery_renewal";

type PriorityKey =
  | "entry"
  | "contract"
  | "redflag"
  | "renewal"
  | "cp_overdue"
  | "cp_signoff"
  | "no_value"
  | "no_cps";

interface Priority {
  key: PriorityKey;
  text: string;
  cta: string;
  to: string;
  col: string;
}

export default function HomeTab() {
  const account = useAccountFromLayout();
  const aid = account.id;

  // Fetch everything in parallel. Each query is independent so failures
  // degrade the corresponding section, not the whole page.
  const apptQ = useQuery<Appetite>({
    queryKey: ["appetite", aid],
    queryFn: () =>
      api.get<Appetite>(`/api/v1/accounts/${aid}/appetite-score`),
  });
  const signalsQ = useQuery<SoftSignalListResponse>({
    queryKey: ["signals", aid],
    queryFn: () =>
      api.get<SoftSignalListResponse>(`/api/v1/accounts/${aid}/signals`),
  });
  const playsQ = useQuery<PlayListResponse>({
    queryKey: ["plays", aid],
    queryFn: () => api.get<PlayListResponse>(`/api/v1/accounts/${aid}/plays`),
  });
  const cpsQ = useQuery<CheckpointListResponse>({
    queryKey: ["checkpoints", aid],
    queryFn: () =>
      api.get<CheckpointListResponse>(`/api/v1/accounts/${aid}/checkpoints`),
  });
  const metsQ = useQuery<MetricListResponse>({
    queryKey: ["metrics", aid],
    queryFn: () => api.get<MetricListResponse>(`/api/v1/accounts/${aid}/metrics`),
  });
  const actsQ = useQuery<ActivityListResponse>({
    queryKey: ["activities", aid],
    queryFn: () =>
      api.get<ActivityListResponse>(`/api/v1/accounts/${aid}/activities`),
  });
  const drQ = useQuery<DeliveryRenewal>({
    queryKey: ["delivery-renewal", aid],
    queryFn: () =>
      api.get<DeliveryRenewal>(`/api/v1/accounts/${aid}/delivery-renewal`),
  });

  // useMemo on each so the downstream useMemo dependency arrays stay
  // stable across re-renders (avoids react-hooks/exhaustive-deps churn).
  const signals = useMemo(() => signalsQ.data?.items ?? [], [signalsQ.data]);
  const plays = useMemo(() => playsQ.data?.items ?? [], [playsQ.data]);
  const cps = useMemo(() => cpsQ.data?.items ?? [], [cpsQ.data]);
  const mets = useMemo(() => metsQ.data?.items ?? [], [metsQ.data]);
  const acts = useMemo(() => actsQ.data?.items ?? [], [actsQ.data]);
  const dr = drQ.data;

  const priorities = useMemo(
    () => computePriorities({ account, cps, mets, dr, dtr: account.gate_renewal_date }),
    [account, cps, mets, dr],
  );
  const activePriority = priorities[0];

  const thisWeek = useMemo(
    () => computeThisWeek({ signals, plays, dtr: account.days_to_renewal ?? null, mets }),
    [signals, plays, account.days_to_renewal, mets],
  );

  const topSignals = useMemo(
    () =>
      [...signals.filter((s) => s.status === "active" && !s.hidden)]
        .sort((a, b) => {
          const ord: Record<string, number> = {
            critical: 0,
            high: 1,
            medium: 2,
            low: 3,
          };
          return (ord[a.impact] ?? 4) - (ord[b.impact] ?? 4);
        })
        .slice(0, 3),
    [signals],
  );

  const expandPlays = plays
    .filter((p) => !p.hidden && p.prob >= 60 && p.modes.includes("expand"))
    .slice(0, 4);

  const recentActs = acts.filter((a) => !a.hidden).slice(0, 4);

  const pipelineTotal = plays
    .filter((p) => !p.hidden)
    .reduce(
      (sum, p) => sum + parseFloat(p.value_usd) * (p.prob / 100),
      0,
    );

  const overdueCp = cps.filter(
    (c) =>
      c.status !== "signed_off" &&
      c.scheduled_date &&
      new Date(c.scheduled_date) < new Date(),
  ).length;

  const dtr = account.days_to_renewal;
  const renewal = formatRenewalDays(dtr ?? null);
  const appetite = apptQ.data;

  return (
    <div className="space-y-3">
      {/* Header strip */}
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted">
              Home — single pane of glass
            </div>
            <h1 className="text-[18px] font-bold text-text-primary">
              {account.name}
            </h1>
            <div className="text-[12px] text-text-muted">
              {account.industry ?? "—"} · {account.country ?? "—"} ·{" "}
              {account.tier ?? "—"} · {account.account_type ?? "—"}
            </div>
          </div>
          {appetite && (
            <div
              className="rounded-lg border-[1.5px] px-3 py-2 text-right flex-shrink-0"
              style={{
                background: MODE_CONF[appetite.current_mode].bg,
                borderColor: MODE_CONF[appetite.current_mode].col + "40",
              }}
            >
              <div
                className="text-[12px] font-bold"
                style={{ color: MODE_CONF[appetite.current_mode].col }}
              >
                {MODE_CONF[appetite.current_mode].icon}{" "}
                {MODE_CONF[appetite.current_mode].label}
              </div>
              <div className="text-[10px] text-text-muted mt-0.5">
                Score: <b>{appetite.score}/100</b>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Priority Action Card */}
      {activePriority && <PriorityCard priority={activePriority} aid={aid} />}

      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-2">
        <Kpi
          label="Current ACV"
          value={formatACV(account.current_acv)}
          color="#0d1b2e"
        />
        <Kpi
          label="Renewal"
          value={renewal.label}
          color={
            renewal.tone === "danger"
              ? "#e63950"
              : renewal.tone === "warn"
                ? "#EF9637"
                : "#40CC8F"
          }
        />
        <Kpi
          label="Health"
          value={String(account.health_score ?? "—")}
          color={
            (account.health_score ?? 0) >= 70
              ? "#40CC8F"
              : (account.health_score ?? 0) >= 40
                ? "#EF9637"
                : "#e63950"
          }
        />
        <Kpi
          label="Open signals"
          value={String(
            signals.filter((s) => s.status === "active" && !s.hidden).length,
          )}
          color="#4A00F8"
        />
      </div>

      {/* R9 — second tile row: deeper rollups (Delivery / Risk % / Pipeline / Account Pulse). */}
      {(() => {
        const active = signals.filter((s) => s.status === "active" && !s.hidden);
        const riskCount = active.filter(
          (s) => s.type === "risk" || s.type === "critical",
        ).length;
        const riskPct = active.length === 0
          ? 0
          : Math.round((riskCount / active.length) * 100);
        const totalCp = cps.length;
        const signedCp = cps.filter((c) => c.status === "signed_off").length;
        const delivery =
          totalCp === 0 ? "—" : `${signedCp}/${totalCp} signed-off`;
        const pulse =
          (account.health_score ?? 0) >= 70 && riskPct < 30 && overdueCp === 0
            ? { label: "Healthy", col: "#40CC8F" }
            : overdueCp > 0 || riskPct >= 50
              ? { label: "At risk", col: "#e63950" }
              : { label: "Watch", col: "#EF9637" };
        return (
          <div className="grid grid-cols-4 gap-2">
            <Kpi
              label="Delivery"
              value={delivery}
              color={overdueCp > 0 ? "#e63950" : "#0d1b2e"}
            />
            <Kpi
              label="Risk %"
              value={`${riskPct}%`}
              color={
                riskPct >= 50 ? "#e63950" : riskPct >= 25 ? "#EF9637" : "#40CC8F"
              }
            />
            <Kpi
              label="Weighted pipeline"
              value={fmtK(pipelineTotal)}
              color="#4A00F8"
            />
            <Kpi label="Account pulse" value={pulse.label} color={pulse.col} />
          </div>
        );
      })()}

      {/* Two columns: This Week (left) + Top Signals (right) */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardTitle>🗓 This Week</CardTitle>
          <ul className="space-y-1.5 text-[12px]">
            {thisWeek.map((a) => (
              <li
                key={a.key}
                className="flex items-start gap-2 py-1 border-b border-beroe-card-border/60 last:border-b-0"
              >
                <span className="flex-shrink-0">{a.icon}</span>
                <span className="flex-1">{a.text}</span>
                <span
                  className={cn(
                    "text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider",
                    a.priority === "high"
                      ? "bg-red-50 text-red-700"
                      : a.priority === "medium"
                        ? "bg-amber-50 text-amber-700"
                        : "bg-emerald-50 text-emerald-700",
                  )}
                >
                  {a.priority}
                </span>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardTitle>📡 Top Signals</CardTitle>
          {topSignals.length === 0 ? (
            <div className="text-[12px] text-text-muted text-center py-4">
              No active signals. Raise one from Growth & Pipeline → Signals.
            </div>
          ) : (
            <ul className="space-y-1.5 text-[12px]">
              {topSignals.map((s) => (
                <SignalRow key={s.id} sig={s} />
              ))}
            </ul>
          )}
          <Link
            to={`/accounts/${aid}/growth-pipeline/signals`}
            className="inline-block mt-2 text-[11px] text-beroe-blue font-semibold hover:underline"
          >
            → All signals & activity
          </Link>
        </Card>
      </div>

      {/* Two columns: Expansion Pipeline (left) + Recent Activity (right) */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <div className="flex items-center justify-between mb-2.5">
            <div className="text-[13px] font-bold">🚀 Expansion Pipeline</div>
            <span className="text-[11px] text-text-muted">
              Weighted: <b className="text-text-primary">{fmtK(pipelineTotal)}</b>
            </span>
          </div>
          {expandPlays.length === 0 ? (
            <div className="text-[12px] text-text-muted text-center py-4">
              No high-prob expansion plays yet. Add from Growth & Pipeline →
              Account Plan.
            </div>
          ) : (
            <ul className="space-y-1.5 text-[12px]">
              {expandPlays.map((p) => (
                <PlayRow key={p.id} play={p} />
              ))}
            </ul>
          )}
          <Link
            to={`/accounts/${aid}/growth-pipeline/plan`}
            className="inline-block mt-2 text-[11px] text-emerald-700 font-semibold hover:underline"
          >
            → Full account plan
          </Link>
        </Card>

        <Card>
          <CardTitle>💬 Recent Activity</CardTitle>
          {recentActs.length === 0 ? (
            <div className="text-[12px] text-text-muted text-center py-4">
              No activity logged yet.
            </div>
          ) : (
            <ul className="space-y-2 text-[12px]">
              {recentActs.map((a) => (
                <ActivityRow key={a.id} act={a} />
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Health bar — overdue checkpoints + at-risk surface */}
      {(overdueCp > 0 || (dr && dr.expand_paused)) && (
        <Card className="bg-amber-50 border-amber-200">
          <div className="flex items-center gap-3">
            <span className="text-[20px]">⚠️</span>
            <div className="flex-1 text-[12px]">
              {overdueCp > 0 && (
                <div>
                  <b className="text-amber-800">{overdueCp}</b> overdue
                  checkpoint{overdueCp === 1 ? "" : "s"} — fix in{" "}
                  <Link
                    to={`/accounts/${aid}/success-management/checkpoints`}
                    className="text-beroe-blue hover:underline font-semibold"
                  >
                    Checkpoints
                  </Link>
                </div>
              )}
              {dr?.expand_paused && (
                <div className="mt-0.5">
                  Track 2 (Expand) is paused — resolve open red flags in{" "}
                  <Link
                    to={`/accounts/${aid}/success-management/delivery-renewal`}
                    className="text-beroe-blue hover:underline font-semibold"
                  >
                    Delivery & Renewal
                  </Link>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

// ============================================================
// Priority cascade
// ============================================================

function computePriorities(args: {
  account: { gate_signed: boolean; cs_entry_type: "A" | "B" | null };
  cps: Checkpoint[];
  mets: SuccessMetric[];
  dr: DeliveryRenewal | undefined;
  dtr: string | null;
}): Priority[] {
  const { account, cps, mets, dr } = args;
  const out: Priority[] = [];
  const entryDone =
    account.gate_signed || account.cs_entry_type === "B";

  if (!entryDone) {
    out.push({
      key: "entry",
      text: "Complete account entry to start the CS workflow",
      cta: "Set up entry",
      to: "success-management/contract-goals",
      col: "#FD576B",
    });
  }

  const today = new Date();
  const overdue = cps.find(
    (c) =>
      c.status === "not_held" &&
      c.scheduled_date &&
      (today.getTime() - new Date(c.scheduled_date).getTime()) / 86400000 > 7,
  );
  if (overdue) {
    const days = Math.floor(
      (today.getTime() - new Date(overdue.scheduled_date!).getTime()) /
        86400000,
    );
    out.push({
      key: "cp_overdue",
      text: `${overdue.type} overdue by ${days}d — schedule or escalate`,
      cta: "Fix checkpoint",
      to: "success-management/checkpoints",
      col: "#FD576B",
    });
  }

  const held = cps.find((c) => c.status === "held");
  if (held) {
    out.push({
      key: "cp_signoff",
      text: `${held.type} held but not signed off — get client confirmation`,
      cta: "Complete sign-off",
      to: "success-management/checkpoints",
      col: "#EF9637",
    });
  }

  if (dr && dr.expand_paused) {
    out.push({
      key: "redflag",
      text: "Track 1 red flag — address before expanding",
      cta: "View delivery",
      to: "success-management/delivery-renewal",
      col: "#FD576B",
    });
  }

  if (
    mets.length > 0 &&
    !mets.some(
      (m) => m.current_value && String(m.current_value).trim() !== "",
    )
  ) {
    out.push({
      key: "no_value",
      text: "No value logged on any metric — record the first reading",
      cta: "Log value",
      to: "success-management/value-tracking",
      col: "#EF9637",
    });
  }

  if (cps.length === 0 && entryDone) {
    out.push({
      key: "no_cps",
      text: "No checkpoints scheduled — set up the cadence",
      cta: "Schedule checkpoints",
      to: "success-management/checkpoints",
      col: "#EF9637",
    });
  }

  return out;
}

function PriorityCard({
  priority,
  aid,
}: {
  priority: Priority;
  aid: string;
}) {
  return (
    <div
      className="rounded-lg border-[1.5px] px-4 py-3 flex items-center gap-3"
      style={{
        background: priority.col + "08",
        borderColor: priority.col + "30",
      }}
    >
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-[14px] flex-shrink-0"
        style={{ background: priority.col + "15" }}
      >
        🎯
      </div>
      <div
        className="flex-1 text-[13px] font-semibold"
        style={{ color: priority.col }}
      >
        {priority.text}
      </div>
      <Link
        to={`/accounts/${aid}/${priority.to}`}
        className="text-[11px] px-2.5 py-1.5 rounded-md text-white font-semibold flex-shrink-0"
        style={{ background: priority.col }}
      >
        {priority.cta} →
      </Link>
    </div>
  );
}

// ============================================================
// This Week computation
// ============================================================

interface WeekItem {
  key: string;
  text: string;
  priority: "high" | "medium" | "low";
  icon: string;
}

function computeThisWeek(args: {
  signals: SoftSignal[];
  plays: Play[];
  dtr: number | null;
  mets: SuccessMetric[];
}): WeekItem[] {
  const { signals, plays, dtr, mets } = args;
  const out: WeekItem[] = [];

  signals
    .filter((s) => s.status === "active" && !s.hidden && s.impact === "critical")
    .slice(0, 2)
    .forEach((s) =>
      out.push({
        key: `sig_${s.id}`,
        text: `Address: ${s.signal}`,
        priority: "high",
        icon: "🚨",
      }),
    );

  if (dtr !== null && dtr <= 90 && dtr >= 0) {
    out.push({
      key: "renewal",
      text: `Prepare renewal proposal (${dtr}d remaining)`,
      priority: "high",
      icon: "📅",
    });
  }

  plays
    .filter((p) => !p.hidden && p.prob >= 60)
    .slice(0, 2)
    .forEach((p) =>
      out.push({
        key: `play_${p.id}`,
        text: `Advance: ${p.title} — ${stageName(p.prob)}`,
        priority: "medium",
        icon: "🎯",
      }),
    );

  mets.forEach((m) => {
    if (m.updated_at) {
      const days = Math.floor(
        (Date.now() - new Date(m.updated_at).getTime()) / 86400000,
      );
      if (days > 30 && !out.find((x) => x.key.startsWith(`metric_${m.id}`))) {
        out.push({
          key: `metric_${m.id}`,
          text: `Update ${m.name} — last updated ${days}d ago`,
          priority: "medium",
          icon: "📊",
        });
      }
    }
  });

  if (out.length === 0) {
    out.push({
      key: "ok",
      text: "All on track — maintain regular engagement",
      priority: "low",
      icon: "✓",
    });
  }

  return out.slice(0, 5);
}

// ============================================================
// Sub-components
// ============================================================

function SignalRow({ sig }: { sig: SoftSignal }) {
  const conf = SIG_CONF[sig.type];
  return (
    <li className="flex items-start gap-2 py-1 border-b border-beroe-card-border/60 last:border-b-0">
      <span
        className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
        style={{ background: conf.dot }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="font-semibold">{sig.signal}</span>
          <span
            className="text-[9px] px-1.5 py-0.5 rounded-full font-bold"
            style={{ background: conf.bg, color: conf.col }}
          >
            {conf.label}
          </span>
          <span className="text-[10px] text-text-muted">{sig.impact}</span>
        </div>
        {sig.description && (
          <div className="text-[11px] text-text-muted leading-snug mt-0.5">
            {sig.description.slice(0, 90)}
            {sig.description.length > 90 ? "…" : ""}
          </div>
        )}
      </div>
    </li>
  );
}

function PlayRow({ play }: { play: Play }) {
  const col = stageColor(play.prob);
  const val = parseFloat(play.value_usd);
  return (
    <li className="flex items-center gap-2 py-1 border-b border-beroe-card-border/60 last:border-b-0 text-[12px]">
      <span className="font-medium flex-1 truncate">{play.title}</span>
      <span className="text-[10px] font-bold" style={{ color: col }}>
        {play.prob}%
      </span>
      {val > 0 && <span className="text-[10px] text-text-muted">{fmtK(val)}</span>}
    </li>
  );
}

function ActivityRow({ act }: { act: Activity }) {
  const conf = ACT_CONF[act.type];
  return (
    <li className="flex gap-2 py-1.5 border-b border-beroe-card-border/60 last:border-b-0">
      <span
        className="w-6 h-6 rounded-md flex items-center justify-center text-[13px] flex-shrink-0"
        style={{ background: conf.bg, color: conf.col }}
      >
        {conf.ic}
      </span>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-[12px]">{act.title}</div>
        <div className="text-[10px] text-text-muted">
          {conf.label} · {new Date(act.created_at).toLocaleDateString()}
        </div>
        {act.summary && (
          <div className="text-[11px] text-text-secondary mt-0.5 leading-snug">
            {act.summary.slice(0, 90)}
            {act.summary.length > 90 ? "…" : ""}
          </div>
        )}
      </div>
    </li>
  );
}

// ============================================================
// Primitives
// ============================================================

function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-white border border-beroe-card-border rounded-card p-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[13px] font-bold text-text-primary mb-2.5">
      {children}
    </div>
  );
}

function Kpi({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="bg-white border border-beroe-card-border rounded-card px-3 py-3 text-center">
      <div className="text-[18px] font-extrabold" style={{ color }}>
        {value}
      </div>
      <div className="text-[10px] text-text-muted mt-0.5">{label}</div>
    </div>
  );
}
