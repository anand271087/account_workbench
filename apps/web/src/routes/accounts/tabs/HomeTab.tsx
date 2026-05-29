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

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAccountFromLayout } from "../AccountProfileLayout";
import { formatACV, formatRenewalDays } from "@/lib/format";
import {
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
import type { SigningGate } from "@/types/signing";

// H36 — Product score = % of Beroe modules contracted (out of 8 named modules).
// Mirrors prototype `bProductSaturation` denominator.
const TOTAL_BEROE_MODULES = 8;

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
  // 27-May Row 66 — Escalate button inside red-flag box (bug 27-06).
  const [redFlagEscalateOpen, setRedFlagEscalateOpen] = useState(false);

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
  // H36/H38 — signing gate carries modules + tier + segment + subscribers
  // which drive the Product score on the Health tile + Account Pulse card.
  const gateQ = useQuery<SigningGate>({
    queryKey: ["signing-gate", aid],
    queryFn: () => api.get<SigningGate>(`/api/v1/accounts/${aid}/sign`),
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

  // Feature flag (variable, not literal — so eslint's
  // no-constant-binary-expression rule stays quiet). The legacy 4+3-tile
  // KPI grid lives below this flag for git-revert convenience; flip to
  // true to render it again.
  const SHOW_LEGACY_KPI_GRID: boolean = false;

  return (
    <div className="space-y-3">
      {/* 28-May — Duplicate Home header strip REMOVED. The account name,
          account_type pill, tier, CSM, mode/appetite, and 30d/90d/FY
          period bar all live on the single compact header in
          AccountProfileLayout (prototype line 2802-2814). The Home tab
          now starts with content (red flag banner, priority card, KPIs)
          rather than re-rendering chrome. */}

      {/* 28-May — Escalation section (prototype line 4149). Banner when
          open escalations exist + Escalate button + history list. */}
      <EscalationSection
        accountId={aid}
        accountName={account.name}
        canEdit={account.is_editable}
      />

      {/* 28-May — Churn Risk banner (prototype line 4626-4644). Renders
          only when computed risk is medium or high. Derives churn-score
          inversely from appetite breakdown: lower appetite → higher
          churn. Surfaces the 4 score components + recent trend. */}
      <ChurnRiskBanner
        healthScore={account.health_score}
        appetite={apptQ}
        overdueCp={overdueCp}
      />

      {/* 27-May Row 66 — Red Flag notification.
          Renders ONLY when there are unresolved red flags on the
          M23 Delivery & Renewal record. Red highlighted, top-of-page
          so it's impossible to miss. */}
      {(() => {
        const openRedFlags = (dr?.red_flags ?? []).filter(
          (f) => !f.resolved_at,
        );
        if (openRedFlags.length === 0) return null;
        return (
          <div className="bg-beroe-red/10 border-2 border-beroe-red/40 rounded-card p-3.5 flex items-start gap-3">
            <span className="text-[22px] flex-shrink-0">🚩</span>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-bold text-beroe-red mb-0.5">
                {openRedFlags.length === 1
                  ? "1 unresolved red flag"
                  : `${openRedFlags.length} unresolved red flags`}
              </div>
              <ul className="text-[12px] text-beroe-red/90 space-y-0.5 list-disc pl-5">
                {openRedFlags.slice(0, 3).map((f) => (
                  <li key={f.id}>
                    <b>{f.type.replace(/_/g, " ")}</b>
                    {f.note ? ` — ${f.note}` : ""}
                  </li>
                ))}
                {openRedFlags.length > 3 && (
                  <li className="italic">
                    + {openRedFlags.length - 3} more
                  </li>
                )}
              </ul>
              <div className="mt-2 flex items-center gap-3 flex-wrap">
                <Link
                  to={`/accounts/${aid}/success-management/delivery-renewal`}
                  className="text-[11px] text-beroe-red font-bold hover:underline"
                >
                  Resolve in Delivery & Renewal →
                </Link>
                <button
                  type="button"
                  onClick={() => setRedFlagEscalateOpen(true)}
                  className="text-[11px] px-2.5 py-1 rounded-md border border-beroe-red/40 bg-white font-bold text-beroe-red hover:bg-beroe-red/10"
                >
                  🚩 Escalate this Account
                </button>
              </div>
            </div>
          </div>
        );
      })()}
      {redFlagEscalateOpen && (
        <EscalationModal
          accountId={aid}
          accountName={account.name}
          onClose={() => setRedFlagEscalateOpen(false)}
        />
      )}

      {/* Priority Action Card */}
      {activePriority && <PriorityCard priority={activePriority} aid={aid} />}

      {/* 27-May Row 67 — AI Account Brief.
          Prototype line 4687 — white card with violet left border + ✨
          icon. Auto-generated date in the top-right corner. */}
      <AIAccountBriefCard aid={aid} accountName={account.name} />

      {/* 28-May — Prototype block 1.5 + 2 (line 4713-4776): violet ACV
          Progress card with embedded Health gauge LEFT, + Account Pulse
          (3 stat tiles + metric bars) RIGHT. Replaces the previous
          4+3-tile KPI grids that diverged from the prototype. */}
      <AcvHealthPulseRow account={account} apptQ={apptQ} gateQ={gateQ} mets={mets} aid={aid} />

      {/* — Legacy KPI grid removed. Info now lives inside the violet
          ACV+Health card + Account Pulse above. Renewal/Risk%/etc
          deep-dives live on respective sub-tabs. — */}
      {SHOW_LEGACY_KPI_GRID && (() => {
        // Dead-code block preserved verbatim for git-revert convenience.
        const active = signals.filter((s) => s.status === "active" && !s.hidden);
        const riskCount = active.filter(
          (s) => s.type === "risk" || s.type === "critical",
        ).length;
        const riskPct = active.length === 0
          ? 0
          : Math.round((riskCount / active.length) * 100);
        const currentAcvNum = parseFloat(String(account.current_acv ?? "0")) || 0;
        const targetAcvNum = parseFloat(String(account.target_acv ?? "0")) || 0;
        const gap = Math.max(0, targetAcvNum - currentAcvNum);
        const modules = gateQ.data?.gate_contract_modules ?? [];
        const productScore = Math.min(
          100,
          Math.round((modules.length / TOTAL_BEROE_MODULES) * 100),
        );
        const hs = account.health_score ?? 0;
        return (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
            {/* 27-May Row 68 — Combined ACV + Health tile (blue).
                Replaces two separate tiles; ACV value as main number,
                Health score + product score on the sublines. */}
            <div className="bg-beroe-blue/10 border-2 border-beroe-blue/40 rounded-card p-3 col-span-1 lg:col-span-1">
              <div className="text-[10px] uppercase tracking-wider font-bold text-beroe-blue/70 mb-1">
                ACV & Health
              </div>
              <div className="flex items-baseline gap-3 mb-2">
                <div>
                  <div className="text-[20px] font-extrabold text-beroe-blue leading-none">
                    {formatACV(account.current_acv)}
                  </div>
                  <div className="text-[9px] uppercase tracking-wider text-beroe-blue/70 mt-0.5">
                    Current ACV
                  </div>
                </div>
                <div className="ml-auto text-right">
                  <div
                    className="text-[20px] font-extrabold leading-none"
                    style={{
                      color:
                        hs >= 70 ? "#6EC457" : hs >= 40 ? "#F0BC41" : "#CF4548",
                    }}
                  >
                    {account.health_score ?? "—"}
                  </div>
                  <div className="text-[9px] uppercase tracking-wider text-beroe-blue/70 mt-0.5">
                    Health
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1 text-[10px]">
                <div className="bg-white/60 rounded px-1.5 py-1">
                  <div className="text-beroe-blue/60 text-[8.5px]">Target</div>
                  <div className="font-bold text-beroe-blue">
                    {account.target_acv ? formatACV(account.target_acv) : "—"}
                  </div>
                </div>
                <div className="bg-white/60 rounded px-1.5 py-1">
                  <div className="text-beroe-blue/60 text-[8.5px]">Gap</div>
                  <div className="font-bold text-beroe-blue">
                    {gap > 0 ? formatACV(String(gap)) : "—"}
                  </div>
                </div>
                <div className="bg-white/60 rounded px-1.5 py-1">
                  <div className="text-beroe-blue/60 text-[8.5px]">Product</div>
                  <div className="font-bold text-beroe-blue">
                    {modules.length === 0 ? "—" : `${productScore}%`}
                  </div>
                </div>
              </div>
            </div>
            {/* Renewal — countdown (unchanged behaviour, RichTile shape). */}
            <RichTile
              label="Renewal"
              value={renewal.label}
              color={
                renewal.tone === "danger"
                  ? "#CF4548"
                  : renewal.tone === "warn"
                    ? "#F0BC41"
                    : "#6EC457"
              }
              sublines={[
                {
                  k: "Date",
                  v: account.gate_renewal_date
                    ? new Date(account.gate_renewal_date as string).toLocaleDateString()
                    : account.renewal_date
                      ? new Date(account.renewal_date as string).toLocaleDateString()
                      : "—",
                },
              ]}
            />
            {/* 27-May Row 66 — Risk % tile only renders when there are
                active signals to compute a meaningful percentage AND
                at least one risk/critical signal exists. Colour still
                varies by riskPct (>=50 red, >=25 amber, else green). */}
            {active.length > 0 && riskCount > 0 ? (
              <RichTile
                label="Risk %"
                value={`${riskPct}%`}
                color={
                  riskPct >= 50 ? "#CF4548" : riskPct >= 25 ? "#F0BC41" : "#6EC457"
                }
                sublines={[
                  {
                    k: "Critical",
                    v: String(
                      active.filter((s) => s.type === "critical").length,
                    ),
                  },
                  {
                    k: "Overdue CP",
                    v: overdueCp === 0 ? "0" : `${overdueCp} ⚠`,
                  },
                  {
                    k: "Declining",
                    v: String(mets.filter((m) => m.status === "red").length),
                  },
                ]}
              />
            ) : (
              <RichTile
                label="Signals"
                value={active.length === 0 ? "—" : `${active.length} open`}
                color="#6EC457"
                sublines={[
                  { k: "Critical", v: "0" },
                  { k: "Risk", v: "0" },
                ]}
              />
            )}
          </div>
        );
      })()}

      {/* 28-May — Bottom blocks now mirror prototype layout exactly
          (line 4778-4834 of beroe_awb_v20.html):
            Block 3: Active Signals (full-width)
            Block 4+5: This Week (left) + Pipeline (right)
            Block 6: Recent Activity (full-width) */}

      {/* Block 3 — Top Signals (full-width, prototype line 4778) */}
      {topSignals.length > 0 && (
        <Card>
          <div className="flex items-center justify-between mb-2.5">
            <div className="text-[13px] font-bold">🚨 Active Signals</div>
            <Link
              to={`/accounts/${aid}/growth-pipeline/signals`}
              className="text-[11px] text-beroe-blue font-semibold hover:underline"
            >
              View all →
            </Link>
          </div>
          <ul className="space-y-1.5 text-[12px]">
            {topSignals.map((s) => (
              <SignalRow key={s.id} sig={s} />
            ))}
          </ul>
        </Card>
      )}

      {/* Block 4+5 — This Week (left) + Pipeline (right). Prototype line 4793. */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardTitle>🗓 This Week</CardTitle>
          <ThisWeekList aid={aid} items={thisWeek} />
        </Card>

        <Card>
          <div className="flex items-center justify-between mb-2.5">
            <div className="text-[13px] font-bold">🎯 Pipeline</div>
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
            className="inline-block mt-2 text-[11px] text-beroe-green font-semibold hover:underline"
          >
            → Full account plan
          </Link>
        </Card>
      </div>

      {/* Block 6 — Recent Activity (full-width, prototype line 4820) */}
      <Card>
        <div className="flex items-center justify-between mb-2.5">
          <div className="text-[13px] font-bold text-text-primary">
            💬 Recent Activity
          </div>
          <Link
            to={`/accounts/${aid}/growth-pipeline/signals`}
            className="text-[11px] text-beroe-blue font-semibold hover:underline"
          >
            View All →
          </Link>
        </div>
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

      {/* Health bar — overdue checkpoints + at-risk surface */}
      {(overdueCp > 0 || (dr && dr.expand_paused)) && (
        <Card className="bg-beroe-amber/15 border-beroe-amber/40">
          <div className="flex items-center gap-3">
            <span className="text-[20px]">⚠️</span>
            <div className="flex-1 text-[12px]">
              {overdueCp > 0 && (
                <div>
                  <b className="text-beroe-amber">{overdueCp}</b> overdue
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
      col: "#CF4548",
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
      col: "#CF4548",
    });
  }

  const held = cps.find((c) => c.status === "held");
  if (held) {
    out.push({
      key: "cp_signoff",
      text: `${held.type} held but not signed off — get client confirmation`,
      cta: "Complete sign-off",
      to: "success-management/checkpoints",
      col: "#F0BC41",
    });
  }

  if (dr && dr.expand_paused) {
    out.push({
      key: "redflag",
      text: "Track 1 red flag — address before expanding",
      cta: "View delivery",
      to: "success-management/delivery-renewal",
      col: "#CF4548",
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
      col: "#F0BC41",
    });
  }

  if (cps.length === 0 && entryDone) {
    out.push({
      key: "no_cps",
      text: "No checkpoints scheduled — set up the cadence",
      cta: "Schedule checkpoints",
      to: "success-management/checkpoints",
      col: "#F0BC41",
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

function RichTile({
  label,
  value,
  color,
  sublines,
}: {
  label: string;
  value: string;
  color: string;
  sublines?: { k: string; v: string }[];
}) {
  return (
    <div className="bg-white border border-beroe-card-border rounded-card px-3 py-2.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[18px] font-extrabold" style={{ color }}>
          {value}
        </span>
        <span className="text-[10px] text-text-muted">{label}</span>
      </div>
      {sublines && sublines.length > 0 && (
        <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1">
          {sublines.map((s) => (
            <span key={s.k} className="text-[10px] text-text-muted">
              {s.k}{" "}
              <b className="text-text-primary font-semibold">{s.v}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// H38 — Account Pulse: Value Tracking link + Adoption % + Modules count +
// Depth/User (subscribers) + Metric snapshot.
// 28-May — superseded by PulseCard inside AcvHealthPulseRow. Kept here
// (unused) until the next cleanup pass.
// @ts-expect-error — intentional unused; preserved for git-revert convenience.
function _AccountPulseCard({
  aid,
  modules,
  tier: _tier,
  subscribers,
  metrics,
}: {
  aid: string;
  modules: string[];
  tier: string | null;
  subscribers: string | null;
  metrics: SuccessMetric[];
}) {
  const adoption =
    modules.length === 0
      ? 0
      : Math.round((modules.length / TOTAL_BEROE_MODULES) * 100);
  const greenMetrics = metrics.filter((m) => m.status === "green").length;
  const totalMetrics = metrics.length;
  const metricsHealth =
    totalMetrics === 0 ? 0 : Math.round((greenMetrics / totalMetrics) * 100);
  return (
    <Card>
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-[13px] font-bold">⚡ Account Pulse</div>
        <Link
          to={`/accounts/${aid}/success-management/value-tracking`}
          className="text-[11px] text-beroe-blue font-semibold hover:underline"
        >
          → Value Tracking
        </Link>
      </div>
      {/* 27-May Row 69 — Tier moved to the header (Row 65); Pulse keeps
          Adoption / Modules / Depth-per-User. Metric snapshot now shows
          all Value Tracking metrics inline (was a count-only stat). */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <PulseStat
          label="Adoption"
          value={modules.length === 0 ? "—" : `${adoption}%`}
          tone={adoption >= 50 ? "green" : adoption >= 25 ? "amber" : "slate"}
        />
        <PulseStat
          label="Modules"
          value={
            modules.length === 0
              ? "—"
              : `${modules.length}/${TOTAL_BEROE_MODULES}`
          }
          tone="slate"
        />
        <PulseStat
          label="Depth / User"
          value={subscribers ?? "—"}
          tone="slate"
        />
        <PulseStat
          label="Metrics on-track"
          value={
            totalMetrics === 0
              ? "—"
              : `${greenMetrics}/${totalMetrics} (${metricsHealth}%)`
          }
          tone={
            metricsHealth >= 70 ? "green" : metricsHealth >= 40 ? "amber" : "red"
          }
        />
      </div>
      {/* All metrics inline — surfaces what's tracked at a glance. */}
      {metrics.length > 0 && (
        <ul className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
          {metrics.slice(0, 8).map((m) => {
            const dot =
              m.status === "green"
                ? "bg-beroe-green/150"
                : m.status === "amber"
                  ? "bg-beroe-amber/150"
                  : m.status === "red"
                    ? "bg-beroe-red/100"
                    : "bg-text-subtle";
            return (
              <li
                key={m.id}
                className="flex items-center gap-1.5 py-0.5 border-b border-beroe-card-border/40 last:border-b-0"
              >
                <span className={cn("inline-block w-1.5 h-1.5 rounded-full flex-shrink-0", dot)} />
                <span className="flex-1 truncate text-text-secondary">
                  {m.name}
                </span>
                <span className="text-text-muted">
                  {m.current_value ?? "—"}
                  {m.target_value ? ` / ${m.target_value}` : ""}
                </span>
              </li>
            );
          })}
          {metrics.length > 8 && (
            <li className="text-[10px] italic text-text-muted col-span-full">
              + {metrics.length - 8} more in Value Tracking
            </li>
          )}
        </ul>
      )}
    </Card>
  );
}

function PulseStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "slate" | "blue" | "green" | "amber" | "red";
}) {
  const toneCls =
    tone === "green"
      ? "bg-beroe-green/15 text-beroe-green border-beroe-green/30"
      : tone === "amber"
        ? "bg-beroe-amber/15 text-beroe-amber border-beroe-amber/40"
        : tone === "red"
          ? "bg-beroe-red/10 text-beroe-red border-beroe-red/30"
          : tone === "blue"
            ? "bg-beroe-blue/10 text-beroe-blue border-beroe-blue/30"
            : "bg-beroe-bg text-text-primary border-beroe-card-border";
  return (
    <div className={cn("rounded-md border px-2.5 py-1.5", toneCls)}>
      <div className="text-[10px] uppercase tracking-wider font-bold opacity-75">
        {label}
      </div>
      <div className="text-[13px] font-bold mt-0.5 leading-tight">{value}</div>
    </div>
  );
}

// H37 — AI Account Brief tile. Calls server-side Claude with the account
// context (engagement / signals / metrics / appetite) and renders a short
// narrative. Cached for 6 hours.
function AIAccountBriefCard({
  aid,
  accountName,
}: {
  aid: string;
  accountName: string;
}) {
  const { data, isLoading, refetch, isFetching } = useQuery<{
    brief: string;
    is_stub: boolean;
    generated_at: string;
  }>({
    queryKey: ["ai-account-brief", aid],
    queryFn: () =>
      api.get(`/api/v1/accounts/${aid}/ai-brief`),
    staleTime: 6 * 60 * 60 * 1000,
    retry: false,
  });
  return (
    <Card>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[13px] font-bold">✨ AI Account Brief</div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="text-[11px] text-beroe-blue font-semibold hover:underline disabled:opacity-50"
        >
          {isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {isLoading ? (
        <div className="text-[12px] text-text-muted italic">
          Generating Claude summary for {accountName}…
        </div>
      ) : !data ? (
        <div className="text-[12px] text-text-muted italic">
          Couldn't load the AI brief.
        </div>
      ) : (
        <>
          <div className="text-[12px] text-text-primary leading-relaxed whitespace-pre-wrap">
            {data.brief}
          </div>
          <div className="text-[10px] text-text-muted mt-2">
            Generated{" "}
            {new Date(data.generated_at).toLocaleString()}
            {data.is_stub && (
              <span className="ml-2 px-1.5 py-0.5 rounded bg-beroe-amber/15 text-beroe-amber border border-beroe-amber/40 uppercase tracking-wider font-semibold text-[9px]">
                Stub AI
              </span>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

// ============================================================
// This Week — 27-May Row 70
// ============================================================
//
// Items come from computeThisWeek (signal / play / metric derived).
// Checkbox state is stored per-account in localStorage under
// `awb:home:this-week:<accountId>`. Stable keys come from item.key
// (e.g. "sig:<id>" / "renewal" / "metric:<id>"); same key flipping
// to done across reloads survives the localStorage TTL until the
// item naturally falls off the computed list.

type ThisWeekItem = {
  key: string;
  icon: string;
  text: string;
  priority: "high" | "medium" | "low";
};

function ThisWeekList({ aid, items }: { aid: string; items: ThisWeekItem[] }) {
  const storageKey = `awb:home:this-week:${aid}`;
  const [done, setDone] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
    } catch {
      return new Set();
    }
  });
  const toggle = (key: string) => {
    setDone((prev: Set<string>) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(storageKey, JSON.stringify(Array.from(next)));
      } catch {
        // ignore quota errors
      }
      return next;
    });
  };
  if (items.length === 0) {
    return (
      <div className="text-[12px] text-text-muted text-center py-4">
        Nothing on the calendar this week.
      </div>
    );
  }
  return (
    <ul className="space-y-1.5 text-[12px]">
      {items.map((a) => {
        const checked = done.has(a.key);
        return (
          <li
            key={a.key}
            className="flex items-start gap-2 py-1 border-b border-beroe-card-border/60 last:border-b-0"
          >
            <input
              type="checkbox"
              checked={checked}
              onChange={() => toggle(a.key)}
              className="mt-1 flex-shrink-0 cursor-pointer"
              aria-label={`Mark "${a.text}" complete`}
            />
            <span className="flex-shrink-0">{a.icon}</span>
            <span
              className={cn(
                "flex-1",
                checked && "line-through text-text-muted",
              )}
            >
              {a.text}
            </span>
            <span
              className={cn(
                "text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider",
                a.priority === "high"
                  ? "bg-beroe-red/10 text-beroe-red"
                  : a.priority === "medium"
                    ? "bg-beroe-amber/15 text-beroe-amber"
                    : "bg-beroe-green/15 text-beroe-green",
              )}
            >
              {a.priority}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ============================================================
// 28-May — Prototype-mirror components (ports of bHome blocks)
// ============================================================

import type { UseQueryResult } from "@tanstack/react-query";
import type { AccountDetail } from "@/types/account";

// Churn Risk banner — prototype line 4626. Derives risk INVERSELY
// from appetite breakdown (lower appetite → higher churn). Shows
// only when risk score ≥ 40 (medium or high).
function ChurnRiskBanner({
  healthScore,
  appetite,
  overdueCp,
}: {
  healthScore: number | null;
  appetite: UseQueryResult<Appetite, Error>;
  overdueCp: number;
}) {
  if (!appetite.data) return null;
  const bd = appetite.data.breakdown;
  // Components 1:1 with prototype's calcChurnRisk: invert each appetite
  // component, scale to 100. Higher = more churn risk.
  const healthRisk = Math.round(((40 - bd.health_pts) / 40) * 35);
  const sigRisk = Math.round(((25 - bd.sig_pts) / 25) * 25);
  const arrRisk = Math.round(((20 - bd.arr_pts) / 20) * 20);
  const cpRisk = Math.min(20, overdueCp * 5);
  const score = Math.max(
    0,
    Math.min(100, healthRisk + sigRisk + arrRisk + cpRisk),
  );
  const level: "low" | "medium" | "high" =
    score >= 60 ? "high" : score >= 35 ? "medium" : "low";
  if (level === "low") return null;
  const col = level === "high" ? "#CF3030" : "#B45309";
  const bg = level === "high" ? "#CF454810" : "#F0BC4115";
  const bc = level === "high" ? "#CF454830" : "#F0BC4140";
  const factors: string[] = [];
  if (healthScore !== null && healthScore < 60)
    factors.push(`Health declining — score ${healthScore}/100`);
  if (overdueCp > 0)
    factors.push(`${overdueCp} overdue checkpoint${overdueCp === 1 ? "" : "s"}`);
  if (bd.arr_pts < 10)
    factors.push("Pipeline below ARR-growth target");
  if (bd.sig_pts < 10)
    factors.push("Signal mix tilted risk/critical");
  return (
    <div
      className="rounded-card p-3 flex items-start gap-3"
      style={{ background: bg, border: `1.5px solid ${bc}` }}
    >
      <div className="min-w-[48px] text-center">
        <div className="text-[22px] font-extrabold leading-none" style={{ color: col }}>
          {score}%
        </div>
        <div className="text-[8px] font-bold uppercase tracking-wider mt-1" style={{ color: col }}>
          Churn Risk
        </div>
      </div>
      <div className="flex-1">
        <div className="text-[12px] font-bold mb-1" style={{ color: col }}>
          {level === "high"
            ? "🚨 High churn risk — immediate attention needed"
            : "⚠️ Elevated churn risk — monitor closely"}
        </div>
        <ul className="text-[11px] leading-snug space-y-0.5" style={{ color: level === "high" ? "#791F1F" : "#854F0B" }}>
          {factors.slice(0, 4).map((f, i) => (
            <li key={i}>• {f}</li>
          ))}
        </ul>
        <div className="flex gap-1.5 mt-2 flex-wrap">
          {[
            ["health", healthRisk, 35],
            ["signals", sigRisk, 25],
            ["arr", arrRisk, 20],
            ["overdue", cpRisk, 20],
          ].map(([k, v, total]) => (
            <span
              key={String(k)}
              className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
              style={{
                background: (v as number) > 10 ? `${col}20` : "#f8f9fc",
                color: (v as number) > 10 ? col : "#94a3b8",
              }}
            >
              {k}: {v}/{total}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// 28-May — ACV Progress (violet gradient) + Account Pulse side-by-side.
// Prototype line 4713-4776. Embeds the Health gauge inside the violet
// ACV card (right column).
function AcvHealthPulseRow({
  account,
  apptQ,
  gateQ,
  mets,
  aid,
}: {
  account: AccountDetail;
  apptQ: UseQueryResult<Appetite, Error>;
  gateQ: UseQueryResult<SigningGate, Error>;
  mets: SuccessMetric[];
  aid: string;
}) {
  const current = parseFloat(String(account.current_acv ?? "0")) || 0;
  const target = parseFloat(String(account.target_acv ?? "0")) || 0;
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  const gap = Math.max(0, target - current);
  const barCol =
    pct >= 80 ? "#6EC457" : pct >= 50 ? "#ffffff" : "#F0BC41";
  const plays = (apptQ.data?.breakdown?.projected_acv_usd
    ? parseFloat(apptQ.data.breakdown.projected_acv_usd) - current
    : 0);
  const pipeline = plays > 0 ? plays : 0;
  const hs = account.health_score ?? 0;
  const healthCol = hs >= 70 ? "#6EC457" : hs >= 40 ? "#F0BC41" : "#CF4548";
  const productPct = Math.min(
    100,
    Math.round(
      ((gateQ.data?.gate_contract_modules?.length ?? 0) / TOTAL_BEROE_MODULES) * 100,
    ),
  );
  // Inverse-scaled signal score for the Health card breakdown.
  const sigPts = apptQ.data?.breakdown?.sig_pts ?? 15;
  const signalsScore = Math.round((sigPts / 25) * 100);
  const dtr = account.days_to_renewal;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
      {/* LEFT: Violet ACV Progress card with embedded Health gauge */}
      <div
        className="rounded-card p-4 relative overflow-hidden"
        style={{
          background:
            "linear-gradient(135deg,#4A00F8 0%,#3800CC 50%,#2a0099 100%)",
        }}
      >
        <div
          className="absolute top-0 right-0 w-72 h-full pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse at right,rgba(255,255,255,.06) 0%,transparent 65%)",
          }}
        />
        <div className="grid grid-cols-2 gap-4 relative">
          {/* Left: ACV PROGRESS */}
          <div>
            <div className="text-[9px] uppercase tracking-[0.1em] font-bold mb-2" style={{ color: "rgba(255,255,255,.5)" }}>
              ACV PROGRESS
            </div>
            <div className="flex items-baseline gap-2 mb-2">
              <span className="text-[26px] font-extrabold leading-none text-white">
                {formatACV(account.current_acv)}
              </span>
              <span className="text-[12px]" style={{ color: "rgba(255,255,255,.6)" }}>
                of {target > 0 ? formatACV(String(target)) : "—"} target
              </span>
            </div>
            <div className="h-2 rounded-full overflow-hidden mb-1.5" style={{ background: "rgba(255,255,255,.08)" }}>
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, background: barCol }}
              />
            </div>
            <div className="flex gap-3.5 text-[11px]">
              {gap > 0 ? (
                <span style={{ color: "#fbbf24" }}>▲ {formatACV(String(gap))} gap</span>
              ) : (
                <span style={{ color: "#6EC457" }}>✓ Target achieved</span>
              )}
              {pipeline > 0 && (
                <span style={{ color: "rgba(255,255,255,.6)" }}>
                  Pipeline: {fmtK(pipeline)}
                </span>
              )}
            </div>
          </div>
          {/* Right: HEALTH gauge */}
          <div
            className="rounded-[10px] p-3"
            style={{ background: "rgba(255,255,255,.04)" }}
          >
            <div className="text-[9px] uppercase tracking-[0.1em] font-bold mb-2" style={{ color: "rgba(255,255,255,.5)" }}>
              HEALTH
            </div>
            <div className="flex items-center gap-2.5">
              <div
                className="w-11 h-11 rounded-full flex items-center justify-center text-[16px] font-extrabold flex-shrink-0"
                style={{
                  border: `3px solid ${healthCol}`,
                  color: healthCol,
                }}
              >
                {hs || "—"}
              </div>
              <div>
                <div className="text-[11px]" style={{ color: "rgba(255,255,255,.6)" }}>
                  Product: <b className="text-white">{productPct}</b> (50%)
                </div>
                <div className="text-[11px]" style={{ color: "rgba(255,255,255,.6)" }}>
                  Signals: <b className="text-white">{signalsScore}</b> (50%)
                </div>
              </div>
            </div>
            <div className="text-[10px] mt-1.5" style={{ color: "rgba(255,255,255,.4)" }}>
              {account.account_type ?? "—"}
              {account.tier && ` · ${account.tier}`}
              {dtr !== null && dtr !== undefined && ` · ${dtr}d renewal`}
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT: Account Pulse (3 colored stat tiles + metric bars) */}
      <PulseCard
        modules={gateQ.data?.gate_contract_modules ?? []}
        subscribers={gateQ.data?.gate_subscribers ?? null}
        metrics={mets}
        aid={aid}
      />
    </div>
  );
}

// 28-May — Account Pulse card mirroring prototype line 4747-4775.
// Three coloured stat tiles (Adoption / Modules / Depth/User) on top,
// metric bars (status dot + progress) below.
function PulseCard({
  modules,
  subscribers,
  metrics,
  aid,
}: {
  modules: string[];
  subscribers: string | null;
  metrics: SuccessMetric[];
  aid: string;
}) {
  const adoption =
    modules.length === 0
      ? 0
      : Math.round((modules.length / TOTAL_BEROE_MODULES) * 100);
  const visibleMetrics = metrics.slice(0, 3);
  return (
    <div className="bg-white rounded-card border border-beroe-card-border p-4">
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-[13px] font-bold text-text-primary">
          Account Pulse
        </span>
        <Link
          to={`/accounts/${aid}/success-management/value-tracking`}
          className="text-[10px] px-2 py-0.5 rounded border border-beroe-green/40 text-beroe-green font-semibold hover:bg-beroe-green/15"
        >
          Value Tracking →
        </Link>
      </div>
      <div className="flex gap-2 mb-3">
        <PulseTile
          value={modules.length === 0 ? "—" : `${adoption}%`}
          label="ADOPTION"
          color="#6EC457"
        />
        <PulseTile
          value={modules.length === 0 ? "—" : `${modules.length}/${TOTAL_BEROE_MODULES}`}
          label="MODULES"
          color="#F0BC41"
        />
        <PulseTile
          value={subscribers ?? "—"}
          label="DEPTH/USER"
          color="#35E1D4"
        />
      </div>
      {visibleMetrics.length === 0 ? (
        <div className="text-[11px] text-text-muted italic text-center py-3">
          No success metrics tracked yet.
        </div>
      ) : (
        <div className="space-y-1.5">
          {visibleMetrics.map((m) => {
            const stCol =
              m.status === "green"
                ? "#6EC457"
                : m.status === "amber"
                  ? "#F0BC41"
                  : m.status === "red"
                    ? "#CF4548"
                    : "#94a3b8";
            const tgt = parseFloat(String(m.target_value || "0").replace(/[^0-9.]/g, ""));
            const cur = parseFloat(String(m.current_value || "0").replace(/[^0-9.]/g, ""));
            const pctMet =
              m.metric_type === "quantitative" && tgt > 0
                ? Math.min(100, Math.round((cur / tgt) * 100))
                : 0;
            return (
              <div key={m.id}>
                <div className="flex items-center justify-between mb-0.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className="inline-block w-1.5 h-1.5 rounded-full flex-shrink-0"
                      style={{ background: stCol }}
                    />
                    <span className="text-[11px] font-semibold truncate">
                      {m.name.length > 32 ? m.name.slice(0, 32) + "…" : m.name}
                    </span>
                  </div>
                  <span
                    className="text-[11px] font-bold flex-shrink-0"
                    style={{ color: stCol }}
                  >
                    {m.current_value ?? "—"}
                  </span>
                </div>
                {m.metric_type === "quantitative" && tgt > 0 && (
                  <div className="h-1 rounded bg-beroe-bg overflow-hidden">
                    <div
                      className="h-full rounded"
                      style={{ width: `${pctMet}%`, background: stCol }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PulseTile({
  value,
  label,
  color,
}: {
  value: string;
  label: string;
  color: string;
}) {
  return (
    <div className="flex-1 rounded-lg p-2 text-center" style={{ background: "#f8f9fc" }}>
      <div className="text-[16px] font-extrabold leading-none" style={{ color }}>
        {value}
      </div>
      <div className="text-[8px] font-bold uppercase tracking-wider mt-1 text-text-muted">
        {label}
      </div>
    </div>
  );
}

// ============================================================
// 28-May — Escalation section (prototype line 4149)
// ============================================================

import { EscalationModal } from "@/components/EscalationModal";
import type { EscalationListResponse } from "@/types/escalation";
import { ESCALATION_TYPE_LABELS } from "@/types/escalation";

function EscalationSection({
  accountId,
  accountName,
  canEdit,
}: {
  accountId: string;
  accountName: string;
  canEdit: boolean;
}) {
  const [modalOpen, setModalOpen] = useState(false);
  const [resolveFor, setResolveFor] = useState<string | null>(null);
  const qc = useQueryClient();
  const listKey = ["escalations", accountId];
  const { data } = useQuery<EscalationListResponse>({
    queryKey: listKey,
    queryFn: () =>
      api.get<EscalationListResponse>(
        `/api/v1/accounts/${accountId}/escalations`,
      ),
  });

  const resolveMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      api.post(`/api/v1/escalations/${id}/resolve`, { resolved_note: note }),
    onSuccess: () => qc.invalidateQueries({ queryKey: listKey }),
  });

  const items = data?.items ?? [];
  const open = items.filter((e) => e.status !== "resolved");
  const canResolve = data?.can_resolve ?? false;

  return (
    <div className="space-y-2">
      {/* Open-escalation banner */}
      {open.length > 0 && (
        <div className="bg-beroe-red/10 border-[1.5px] border-beroe-red/40 rounded-card px-4 py-2.5 flex items-center gap-3">
          <span className="text-[18px]">🚨</span>
          <div className="flex-1 text-[12px]" style={{ color: "#CF4548" }}>
            <b>Escalation open</b> — {ESCALATION_TYPE_LABELS[open[0].escalation_type]} ·
            owner {open[0].owner} · raised{" "}
            {new Date(open[0].raised_at).toLocaleDateString()}
            {open[0].reason && (
              <> · {open[0].reason.slice(0, 80)}{open[0].reason.length > 80 ? "…" : ""}</>
            )}
          </div>
          {canResolve && (
            <button
              type="button"
              onClick={() => setResolveFor(open[0].id)}
              className="text-[11px] px-2.5 py-1 rounded-md border border-beroe-red/40 bg-white font-semibold text-beroe-red hover:bg-beroe-red/10"
            >
              ✓ Resolve
            </button>
          )}
        </div>
      )}

      {/* Escalate button (top-right, only when no open + role can edit) */}
      {canEdit && open.length === 0 && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="text-[11px] px-3 py-1 rounded-md border font-semibold hover:bg-beroe-red/10 transition-colors"
            style={{ color: "#CF4548", borderColor: "#CF454840" }}
          >
            🚩 Escalate this account
          </button>
        </div>
      )}

      {/* Resolved history — collapsible, only when there's history */}
      {items.length > 0 && items.some((e) => e.status === "resolved") && (
        <details className="bg-white border border-beroe-card-border rounded-card">
          <summary className="px-3 py-2 cursor-pointer list-none flex items-center gap-2 text-[11px] text-text-muted hover:text-text-secondary">
            <span>▸ Escalation history ({items.length})</span>
          </summary>
          <div className="px-3 pb-3">
            {items.map((e) => {
              const stCol =
                e.status === "open"
                  ? "#CF4548"
                  : e.status === "in_progress"
                    ? "#F0BC41"
                    : "#6EC457";
              const stLbl =
                e.status === "open"
                  ? "Open"
                  : e.status === "in_progress"
                    ? "In Progress"
                    : "Resolved";
              return (
                <div
                  key={e.id}
                  className="flex items-start gap-2 py-2 border-b border-beroe-card-border/40 last:border-b-0"
                >
                  <span
                    className="text-[9px] font-bold px-1.5 py-0.5 rounded-full border flex-shrink-0"
                    style={{
                      background: stCol + "15",
                      color: stCol,
                      borderColor: stCol + "30",
                    }}
                  >
                    {stLbl}
                  </span>
                  <div className="flex-1 text-[11px] text-text-secondary">
                    <div>
                      {ESCALATION_TYPE_LABELS[e.escalation_type]} · {e.owner} ·{" "}
                      {new Date(e.raised_at).toLocaleDateString()}
                    </div>
                    <div className="text-[10px] text-text-muted mt-0.5">
                      {e.reason.slice(0, 100)}
                      {e.reason.length > 100 ? "…" : ""}
                    </div>
                    {e.resolved_note && (
                      <div className="text-[10px] text-beroe-green mt-0.5">
                        Resolved: {e.resolved_note}
                      </div>
                    )}
                  </div>
                  {e.status !== "resolved" && canResolve && (
                    <button
                      type="button"
                      onClick={() => setResolveFor(e.id)}
                      className="text-[10px] px-2 py-0.5 rounded border border-beroe-card-border font-semibold flex-shrink-0"
                    >
                      Resolve
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </details>
      )}

      {modalOpen && (
        <EscalationModal
          accountId={accountId}
          accountName={accountName}
          onClose={() => setModalOpen(false)}
        />
      )}

      {resolveFor && (
        <ResolveEscalationPrompt
          onCancel={() => setResolveFor(null)}
          onConfirm={(note) => {
            resolveMutation.mutate({ id: resolveFor, note });
            setResolveFor(null);
          }}
        />
      )}
    </div>
  );
}

function ResolveEscalationPrompt({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="bg-white rounded-card w-full max-w-md p-5">
        <div className="text-[14px] font-bold mb-2">Resolve escalation</div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="Resolution note (≥5 chars)…"
          className="w-full text-[12px] border border-beroe-card-border rounded-md px-2.5 py-1.5 focus:outline-none focus:border-beroe-blue"
        />
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="text-[12px] px-3 py-1.5 border border-beroe-card-border rounded-md font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={note.trim().length < 5}
            onClick={() => onConfirm(note.trim())}
            className="text-[12px] px-3 py-1.5 rounded-md bg-beroe-green text-white font-semibold disabled:opacity-50"
          >
            ✓ Resolve
          </button>
        </div>
      </div>
    </div>
  );
}
