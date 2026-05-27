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
  const appetite = apptQ.data;

  return (
    <div className="space-y-3">
      {/* Header strip — 27-May Row 64 (CSM/Sales name fallback) + Row 65
          (Growth & Tier next to name). csm_full_name + co_full_name are
          already returned by the AccountDetail endpoint (joined on user). */}
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted">
              Home — single pane of glass
            </div>
            <div className="flex items-baseline gap-2 flex-wrap">
              <h1 className="text-[18px] font-bold text-text-primary">
                {account.name}
              </h1>
              {/* Growth + Tier pills next to the account name */}
              {account.account_type && (
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  {account.account_type}
                </span>
              )}
              {account.tier && (
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200">
                  Tier {account.tier}
                </span>
              )}
            </div>
            <div className="text-[12px] text-text-muted">
              {account.industry ?? "—"} · {account.country ?? "—"}
              {/* CSM name when present, otherwise Sales (Commercial Owner)
                  name fallback. Row 64. */}
              {account.csm_full_name ? (
                <> · CSM: <b className="text-text-secondary">{account.csm_full_name}</b></>
              ) : account.co_full_name ? (
                <> · Sales: <b className="text-text-secondary">{account.co_full_name}</b></>
              ) : (
                <> · <span className="italic">Unassigned</span></>
              )}
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
                Appetite Score: <b>{appetite.score}/100</b>
              </div>
            </div>
          )}
        </div>
      </Card>

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
          <div className="bg-red-50 border-2 border-red-300 rounded-card p-3.5 flex items-start gap-3">
            <span className="text-[22px] flex-shrink-0">🚩</span>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-bold text-red-700 mb-0.5">
                {openRedFlags.length === 1
                  ? "1 unresolved red flag"
                  : `${openRedFlags.length} unresolved red flags`}
              </div>
              <ul className="text-[12px] text-red-700/90 space-y-0.5 list-disc pl-5">
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
              <Link
                to={`/accounts/${aid}/success-management/delivery-renewal`}
                className="inline-block mt-2 text-[11px] text-red-700 font-bold hover:underline"
              >
                Resolve in Delivery & Renewal →
              </Link>
            </div>
          </div>
        );
      })()}

      {/* Priority Action Card */}
      {activePriority && <PriorityCard priority={activePriority} aid={aid} />}

      {/* H34/H35/H36/H38 — enriched KPI tiles. Each surfaces a sublabel
          with the relevant ratio / supporting metric the prototype shows
          (target / gap / pipeline on ACV, product score on Health,
          declining-signal + checkpoint hints on Risk %). */}
      {(() => {
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
            <div className="bg-blue-50 border-2 border-blue-300 rounded-card p-3 col-span-1 lg:col-span-1">
              <div className="text-[10px] uppercase tracking-wider font-bold text-blue-900/70 mb-1">
                ACV & Health
              </div>
              <div className="flex items-baseline gap-3 mb-2">
                <div>
                  <div className="text-[20px] font-extrabold text-blue-900 leading-none">
                    {formatACV(account.current_acv)}
                  </div>
                  <div className="text-[9px] uppercase tracking-wider text-blue-900/70 mt-0.5">
                    Current ACV
                  </div>
                </div>
                <div className="ml-auto text-right">
                  <div
                    className="text-[20px] font-extrabold leading-none"
                    style={{
                      color:
                        hs >= 70 ? "#40CC8F" : hs >= 40 ? "#EF9637" : "#e63950",
                    }}
                  >
                    {account.health_score ?? "—"}
                  </div>
                  <div className="text-[9px] uppercase tracking-wider text-blue-900/70 mt-0.5">
                    Health
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1 text-[10px]">
                <div className="bg-white/60 rounded px-1.5 py-1">
                  <div className="text-blue-900/60 text-[8.5px]">Target</div>
                  <div className="font-bold text-blue-900">
                    {account.target_acv ? formatACV(account.target_acv) : "—"}
                  </div>
                </div>
                <div className="bg-white/60 rounded px-1.5 py-1">
                  <div className="text-blue-900/60 text-[8.5px]">Gap</div>
                  <div className="font-bold text-blue-900">
                    {gap > 0 ? formatACV(String(gap)) : "—"}
                  </div>
                </div>
                <div className="bg-white/60 rounded px-1.5 py-1">
                  <div className="text-blue-900/60 text-[8.5px]">Product</div>
                  <div className="font-bold text-blue-900">
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
                  ? "#e63950"
                  : renewal.tone === "warn"
                    ? "#EF9637"
                    : "#40CC8F"
              }
              sublines={[
                {
                  k: "Date",
                  v: account.gate_renewal_date
                    ? new Date(account.gate_renewal_date).toLocaleDateString()
                    : account.renewal_date
                      ? new Date(account.renewal_date).toLocaleDateString()
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
                  riskPct >= 50 ? "#e63950" : riskPct >= 25 ? "#EF9637" : "#40CC8F"
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
                color="#40CC8F"
                sublines={[
                  { k: "Critical", v: "0" },
                  { k: "Risk", v: "0" },
                ]}
              />
            )}
          </div>
        );
      })()}

      {/* Secondary row: Delivery + Weighted pipeline + Open signals */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
        {(() => {
          const totalCp = cps.length;
          const signedCp = cps.filter((c) => c.status === "signed_off").length;
          const heldCp = cps.filter((c) => c.status === "held").length;
          return (
            <RichTile
              label="Delivery"
              value={
                totalCp === 0 ? "—" : `${signedCp}/${totalCp}`
              }
              color={overdueCp > 0 ? "#e63950" : "#0d1b2e"}
              sublines={[
                { k: "Held", v: String(heldCp) },
                { k: "Overdue", v: String(overdueCp) },
              ]}
            />
          );
        })()}
        <RichTile
          label="Weighted pipeline"
          value={fmtK(pipelineTotal)}
          color="#4A00F8"
          sublines={[
            {
              k: "Plays",
              v: String(
                plays.filter((p) => !p.hidden).length,
              ),
            },
            {
              k: "Expand-mode",
              v: String(
                plays.filter(
                  (p) => !p.hidden && p.modes.includes("expand"),
                ).length,
              ),
            },
          ]}
        />
        <RichTile
          label="Open signals"
          value={String(
            signals.filter((s) => s.status === "active" && !s.hidden).length,
          )}
          color="#4A00F8"
          sublines={[
            {
              k: "Critical",
              v: String(
                signals.filter(
                  (s) =>
                    s.status === "active" && !s.hidden && s.type === "critical",
                ).length,
              ),
            },
            {
              k: "Risk",
              v: String(
                signals.filter(
                  (s) =>
                    s.status === "active" && !s.hidden && s.type === "risk",
                ).length,
              ),
            },
          ]}
        />
      </div>

      {/* 27-May Row 67 — AI Account Brief promoted above Account Pulse
          (first content card after KPIs / priority surfaces). */}
      <AIAccountBriefCard aid={aid} accountName={account.name} />

      {/* H38 — Account Pulse card. Surfaces: Value Tracking link,
          Adoption %, Modules, Depth/User and Metric snapshot. */}
      <AccountPulseCard
        aid={aid}
        modules={gateQ.data?.gate_contract_modules ?? []}
        tier={gateQ.data?.gate_platform_tier ?? null}
        subscribers={gateQ.data?.gate_subscribers ?? null}
        metrics={mets}
      />

      {/* Two columns: This Week (left) + Top Signals (right).
          27-May Row 70 — items now have tick-off checkboxes. State is
          per-account in localStorage so progress survives tab swaps;
          dynamic keys (auto-computed from signals/plays/metrics) just
          stay completed until they fall off the list naturally. */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardTitle>🗓 This Week</CardTitle>
          <ThisWeekList aid={aid} items={thisWeek} />
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

      {/* Two columns: Pipeline (left) + Recent Activity (right).
          27-May Row 71 — section renamed from "🚀 Expansion Pipeline"
          to "🎯 Pipeline" to match stakeholder vocabulary. */}
      <div className="grid grid-cols-2 gap-3">
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
            className="inline-block mt-2 text-[11px] text-emerald-700 font-semibold hover:underline"
          >
            → Full account plan
          </Link>
        </Card>

        <Card>
          <div className="flex items-center justify-between mb-2.5">
            <div className="text-[13px] font-bold text-text-primary">
              💬 Recent Activity
            </div>
            {/* 27-May Row 72 — "View All" link → Growth & Pipeline →
                Account Plan (per stakeholder; activities live under
                the Signals & Activity sub-tab there). */}
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
function AccountPulseCard({
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
                ? "bg-emerald-500"
                : m.status === "amber"
                  ? "bg-amber-500"
                  : m.status === "red"
                    ? "bg-red-500"
                    : "bg-slate-300";
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
      ? "bg-emerald-50 text-emerald-900 border-emerald-200"
      : tone === "amber"
        ? "bg-amber-50 text-amber-900 border-amber-200"
        : tone === "red"
          ? "bg-red-50 text-red-900 border-red-200"
          : tone === "blue"
            ? "bg-blue-50 text-blue-900 border-blue-200"
            : "bg-slate-50 text-slate-900 border-slate-200";
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
              <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 uppercase tracking-wider font-semibold text-[9px]">
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
                  ? "bg-red-50 text-red-700"
                  : a.priority === "medium"
                    ? "bg-amber-50 text-amber-700"
                    : "bg-emerald-50 text-emerald-700",
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
