// 05-Jun · Pass-2 — Renewal Readiness tab, faithful port of
// beroe_sm_strategy_proto.html renderRenewalTab():
//
//   1. Verdict banner       — Ready / Negotiation Required / In progress
//                              (derived from 3-Q readiness answers)
//   2. Track 1 · DEFEND      — cumulative value delivered + 3-Q scorecard
//   3. Track 2 · EXPAND      — expansion plays (PlayMode=expand) + KPIs
//   4. Renewal Outcome row   — Renewed / At Risk / Not Renewed
//
// Backend wiring (no migrations):
//   • Readiness Q1/Q2/Q3 + outcome  → M23 delivery_renewal endpoints
//   • Track-1 value-delivered rollup → cs_goals.initiatives.value_delivered
//   • Track-2 plays                  → M26 /accounts/:id/plays (mode=expand)

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { useAccountFromLayout } from "../../AccountProfileLayout";
import type { CSGoal } from "@/types/cs_goal";
import type {
  DeliveryRenewal,
  Readiness,
  ReadinessAnswerValue,
  Outcome,
} from "@/types/delivery_renewal";
import type {
  Play,
  PlayListResponse,
} from "@/types/play";
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
  t1: "#0d1b2e",
  t2: "#5a7896",
  t3: "#8496b0",
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

// ---------------------------------------------------------------------------
// Top-level tab
// ---------------------------------------------------------------------------
export default function RenewalReadinessTab() {
  const account = useAccountFromLayout();
  const qc = useQueryClient();

  const drQ = useQuery<DeliveryRenewal>({
    queryKey: ["delivery-renewal", account.id],
    queryFn: () =>
      api.get<DeliveryRenewal>(
        `/api/v1/accounts/${account.id}/delivery-renewal`,
      ),
  });
  const goalsQ = useQuery<{ items: CSGoal[] }>({
    queryKey: ["cs-goals", account.id, false],
    queryFn: () =>
      api.get(`/api/v1/accounts/${account.id}/cs-goals?include_deleted=false`),
  });
  const playsQ = useQuery<PlayListResponse>({
    queryKey: ["plays", account.id],
    queryFn: () =>
      api.get<PlayListResponse>(`/api/v1/accounts/${account.id}/plays`),
  });
  // 12-Jun bug 253 — activities query removed. Top Wins now derives from
  // initiative completion % (Value Tracking), not from activity types.

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["delivery-renewal", account.id] });
  }
  function invalidatePlays() {
    qc.invalidateQueries({ queryKey: ["plays", account.id] });
  }

  if (drQ.isLoading || goalsQ.isLoading) {
    return <div className="text-[12px] text-text-muted p-4">Loading…</div>;
  }
  if (!drQ.data) {
    return (
      <div
        className="rounded-card p-4 text-[12px]"
        style={{ background: "#f8f9fc", color: BRAND.t2 }}
      >
        Couldn't load renewal data.
      </div>
    );
  }

  const dr = drQ.data;
  const goals = goalsQ.data?.items ?? [];
  const plays = playsQ.data?.items ?? [];

  return (
    <div className="space-y-3">
      <VerdictBanner readiness={dr.readiness} />
      <Track1Defend
        readiness={dr.readiness}
        goals={goals}
        canWrite={dr.is_editable}
        accountId={account.id}
        onChanged={invalidate}
      />
      <Track2Expand
        plays={plays.filter((p) => p.modes.includes("expand") && !p.hidden)}
        canWrite={playsQ.data?.is_editable ?? false}
        onChanged={invalidatePlays}
      />
      <OutcomeRow
        outcome={dr.outcome}
        canWrite={dr.is_editable}
        accountId={account.id}
        onChanged={invalidate}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Verdict banner
// ---------------------------------------------------------------------------
function VerdictBanner({ readiness }: { readiness: Readiness }) {
  const r = readiness;
  const all = (
    [r.delivered_metric, r.proof_data, r.client_acknowledged] as const
  ).map((a) => a.answer);
  const allYes = all.every((a) => a === "yes");
  const anyNo = all.some((a) => a === "no");

  if (allYes) {
    return (
      <div
        className="rounded-card p-4 text-center"
        style={{
          background: "#f0fdf4",
          border: `2px solid ${BRAND.green}`,
        }}
      >
        <div className="text-[24px] mb-1.5">✅</div>
        <div
          className="text-[16px] font-extrabold"
          style={{ color: "#2fb87a" }}
        >
          Ready for Renewal
        </div>
        <div className="text-[12px] mt-1" style={{ color: BRAND.t2 }}>
          All 3 questions answered with proof.
        </div>
      </div>
    );
  }
  if (anyNo) {
    return (
      <div
        className="rounded-card p-4 text-center"
        style={{ background: "#fff0f2", border: `2px solid ${BRAND.red}` }}
      >
        <div className="text-[24px] mb-1.5">⚠️</div>
        <div
          className="text-[16px] font-extrabold"
          style={{ color: BRAND.red }}
        >
          Negotiation Required
        </div>
        <div className="text-[12px] mt-1" style={{ color: BRAND.t2 }}>
          One or more criteria not met. Address gaps before renewal.
        </div>
      </div>
    );
  }
  return (
    <div
      className="rounded-card p-3 text-center"
      style={{
        background: "#fff8eb",
        border: `1.5px solid ${BRAND.amber}`,
      }}
    >
      <div className="text-[13px] font-bold" style={{ color: "#854F0B" }}>
        Assessment in progress
      </div>
      <div className="text-[11px] mt-0.5" style={{ color: "#854F0B" }}>
        Answer each question Yes / No with proof to complete the readiness
        scorecard.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Track 1 — DEFEND
// ---------------------------------------------------------------------------
function Track1Defend({
  readiness,
  goals,
  canWrite,
  accountId,
  onChanged,
}: {
  readiness: Readiness;
  goals: CSGoal[];
  canWrite: boolean;
  accountId: string;
  onChanged: () => void;
}) {
  const qc = useQueryClient();

  // 12-Jun bug 253 — Value Delivered is NOT a monetary rollup; it's the
  // overall delivery % from Value Tracking. Mirror ValueTrackingTabV2's
  // math exactly: effective_pct = 100 if status==='delivered' else
  // completion_pct (clamped 0-100); overall = average across initiatives.
  //
  // 12-Jun bug 251 — pending goals included in the rollup too (was
  // frozen-only). Every goal + its initiatives count toward the
  // portfolio roll-up regardless of validation status.
  const { overallPct, initCount, goalCount } = useMemo(() => {
    const pcts: number[] = [];
    for (const g of goals) {
      for (const i of g.initiatives) {
        const v =
          i.status === "delivered"
            ? 100
            : Math.min(100, Math.max(0, i.completion_pct ?? 0));
        pcts.push(v);
      }
    }
    const overall =
      pcts.length === 0
        ? 0
        : Math.round(pcts.reduce((s, p) => s + p, 0) / pcts.length);
    return { overallPct: overall, initCount: pcts.length, goalCount: goals.length };
  }, [goals]);

  // 12-Jun bug 253 — Top Wins = initiatives with ≥80% value delivered
  // (was: an activity-type proxy on QBR / product / exec-visit events).
  const topWins = useMemo(() => {
    const wins: { id: string; name: string; pct: number }[] = [];
    goals.forEach((g, gi) => {
      g.initiatives.forEach((i, ii) => {
        const pct =
          i.status === "delivered"
            ? 100
            : Math.min(100, Math.max(0, i.completion_pct ?? 0));
        if (pct >= 80) {
          wins.push({ id: `${g.id ?? gi}:${ii}`, name: i.name, pct });
        }
      });
    });
    return wins.sort((a, b) => b.pct - a.pct).slice(0, 3);
  }, [goals]);

  const patch = useMutation({
    mutationFn: (newReadiness: Readiness) =>
      api.patch<DeliveryRenewal>(
        `/api/v1/accounts/${accountId}/delivery-renewal`,
        { readiness: newReadiness },
      ),
    onSuccess: () => {
      onChanged();
      qc.invalidateQueries({ queryKey: ["delivery-renewal", accountId] });
    },
  });

  function setAns(
    key: keyof Readiness,
    answer: ReadinessAnswerValue,
  ) {
    const cur = readiness[key];
    const next: Readiness = {
      ...readiness,
      [key]: {
        ...cur,
        answer: cur.answer === answer ? "unknown" : answer,
      },
    };
    patch.mutate(next);
  }
  function setProof(key: keyof Readiness, proof: string) {
    const next: Readiness = {
      ...readiness,
      [key]: { ...readiness[key], proof_note: proof },
    };
    patch.mutate(next);
  }

  const QUESTIONS: {
    key: keyof Readiness;
    label: string;
    desc: string;
  }[] = [
    {
      key: "delivered_metric",
      label: "Did we deliver the agreed success metric?",
      desc: "Progress vs contract goal, tracked at initiative level",
    },
    {
      key: "proof_data",
      label: "Can we prove it with data?",
      desc: "CSM-attributed value logged. Measurable, not anecdotal",
    },
    {
      key: "client_acknowledged",
      label: "Does the client acknowledge it?",
      desc: "Validated at MBR/QBR checkpoints. Client sign-off recorded",
    },
  ];

  return (
    <div
      className="rounded-card p-4"
      style={{
        background: "#fff",
        border: `1px solid ${BRAND.cardBorder}`,
        borderLeft: `4px solid ${BRAND.indigo}`,
      }}
    >
      <div className="flex items-center gap-2.5 mb-3">
        <span
          className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold tracking-wider"
          style={{ background: BRAND.indigo, color: "#fff" }}
        >
          TRACK 1 · DEFEND
        </span>
        <div
          className="text-[13px] font-bold"
          style={{ color: BRAND.t1 }}
        >
          Renewal readiness + value already delivered
        </div>
      </div>
      <div
        className="text-[11px] mb-3"
        style={{ color: BRAND.t3, lineHeight: 1.55 }}
      >
        Pulled from Value Tracking (initiative delivered values + activity
        log). Defends current ARR by demonstrating value delivered to date +
        answering the 3 renewal questions.
      </div>

      {/* Cumulative value story */}
      <div
        className="rounded-card p-3 mb-3 flex items-center gap-3"
        style={{
          background: `linear-gradient(135deg, #f0fdf4, #dcfce7)`,
          border: `1px solid ${BRAND.green}30`,
        }}
      >
        <div className="flex-1">
          <div
            className="text-[10.5px] font-bold uppercase tracking-wider"
            style={{ color: "#146a45" }}
          >
            Overall value delivered
          </div>
          <div
            className="text-[24px] font-black mt-0.5"
            style={{ color: "#146a45" }}
          >
            {overallPct}%
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: "#2fb87a" }}>
            from Value Tracking · {goalCount} goal{goalCount === 1 ? "" : "s"} ·{" "}
            {initCount} initiative{initCount === 1 ? "" : "s"}
          </div>
        </div>
        {topWins.length > 0 && (
          <div
            className="rounded-card p-2"
            style={{
              background: "rgba(255,255,255,.6)",
              color: "#146a45",
            }}
          >
            <div
              className="text-[10px] font-bold mb-1"
              style={{ color: "#146a45" }}
            >
              Top wins (≥80% delivered)
            </div>
            {topWins.map((w) => (
              <div
                key={w.id}
                className="text-[11px]"
                style={{ color: "#1a4035" }}
              >
                ✓ {w.name.length > 40 ? w.name.slice(0, 40) + "…" : w.name}{" "}
                <b>({w.pct}%)</b>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 3-Q readiness scorecard */}
      <div
        className="text-[11px] font-bold uppercase tracking-wider mb-2"
        style={{ color: "#6b7fa0" }}
      >
        3-Question readiness scorecard
      </div>
      {QUESTIONS.map((q, i) => (
        <RRCard
          key={q.key}
          num={i + 1}
          question={q.label}
          desc={q.desc}
          answer={readiness[q.key].answer}
          proof={readiness[q.key].proof_note ?? ""}
          disabled={!canWrite}
          onAnswer={(a) => setAns(q.key, a)}
          onProof={(v) => setProof(q.key, v)}
        />
      ))}
    </div>
  );
}

function RRCard({
  num,
  question,
  desc,
  answer,
  proof,
  disabled,
  onAnswer,
  onProof,
}: {
  num: number;
  question: string;
  desc: string;
  answer: ReadinessAnswerValue;
  proof: string;
  disabled: boolean;
  onAnswer: (a: ReadinessAnswerValue) => void;
  onProof: (v: string) => void;
}) {
  const col =
    answer === "yes" ? BRAND.green : answer === "no" ? BRAND.red : BRAND.amber;
  const bg =
    answer === "yes" ? "#d4f5e5" : answer === "no" ? "#ffe0e5" : "#fef0c0";
  const tcol =
    answer === "yes" ? "#2fb87a" : answer === "no" ? "#e63950" : "#d88520";

  // local-text — keeps every keystroke from triggering a PATCH; commits on blur.
  const [draft, setDraft] = useState(proof);

  return (
    <div
      className="rounded-card p-3 mb-2"
      style={{
        background: "#fafbfd",
        border: `1px solid ${BRAND.cardBorder}`,
        borderLeft: `3px solid ${col}`,
      }}
    >
      <div className="flex items-start gap-2.5">
        <div
          className="w-6 h-6 rounded-full text-[12px] font-extrabold flex items-center justify-center shrink-0"
          style={{ background: bg, color: tcol }}
        >
          {num}
        </div>
        <div className="flex-1">
          <div
            className="text-[12.5px] font-bold"
            style={{ color: BRAND.t1 }}
          >
            {question}
          </div>
          <div
            className="text-[10.5px] mb-2"
            style={{ color: BRAND.t3 }}
          >
            {desc}
          </div>
          <div className="flex gap-1.5 mb-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => onAnswer("yes")}
              className="text-[11px] font-semibold px-2.5 py-1 rounded-card border"
              style={
                answer === "yes"
                  ? {
                      background: BRAND.green,
                      borderColor: BRAND.green,
                      color: "#fff",
                    }
                  : {
                      background: "#fff",
                      borderColor: BRAND.cardBorder,
                      color: BRAND.t2,
                    }
              }
            >
              ✅ Yes
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onAnswer("no")}
              className="text-[11px] font-semibold px-2.5 py-1 rounded-card border"
              style={
                answer === "no"
                  ? {
                      background: BRAND.red,
                      borderColor: BRAND.red,
                      color: "#fff",
                    }
                  : {
                      background: "#fff",
                      borderColor: BRAND.cardBorder,
                      color: BRAND.t2,
                    }
              }
            >
              ❌ No
            </button>
          </div>
          <input
            type="text"
            value={draft}
            disabled={disabled}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              if (draft !== proof) onProof(draft);
            }}
            placeholder="Evidence / proof — link to data, client email, QBR sign-off…"
            className="w-full px-2.5 py-1.5 text-[11.5px] rounded-card border"
            style={{ borderColor: BRAND.cardBorder }}
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Track 2 — EXPAND
// ---------------------------------------------------------------------------
function Track2Expand({
  plays,
  canWrite,
  onChanged,
}: {
  plays: Play[];
  canWrite: boolean;
  onChanged: () => void;
}) {
  // 12-Jun bug 252 — addOpen state retired with the "+ Add play" button.

  const totalRaw = useMemo(
    () => plays.reduce((s, p) => s + parseUsd(p.value_usd), 0),
    [plays],
  );
  const totalWeighted = useMemo(
    () =>
      plays.reduce(
        (s, p) => s + parseUsd(p.value_usd) * (p.prob / 100),
        0,
      ),
    [plays],
  );
  const stageMix = useMemo(() => {
    const mix: Record<string, number> = {};
    for (const p of plays) {
      const k = p.prob >= 80 ? "closing" : p.prob >= 40 ? "discussion" : "pitched";
      mix[k] = (mix[k] ?? 0) + 1;
    }
    return mix;
  }, [plays]);

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/plays/${id}`),
    onSuccess: () => onChanged(),
  });

  return (
    <div
      className="rounded-card p-4"
      style={{
        background: "#fff",
        border: `1px solid ${BRAND.cardBorder}`,
        borderLeft: `4px solid ${BRAND.aqua}`,
      }}
    >
      <div className="flex items-center gap-2.5 mb-3">
        <span
          className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold tracking-wider"
          style={{ background: BRAND.aqua, color: BRAND.midnight }}
        >
          TRACK 2 · EXPAND
        </span>
        <div
          className="text-[13px] font-bold"
          style={{ color: BRAND.t1 }}
        >
          Expansion plays · pipeline value
        </div>
        <div className="flex-1" />
        {/* 12-Jun bug 252 — "+ Add play" affordance removed from Renewal
            Readiness per stakeholder ask. Plays are still created in
            Growth & Pipeline → Account Plan; this tab is now read-only
            on plays (which matches its "Readiness" framing). `addOpen`
            state + AddInitiativeFromPlaysModal remain unused locally
            but the linter will surface if anything else depended on
            them. */}
      </div>
      <div
        className="text-[11px] mb-3"
        style={{ color: BRAND.t3, lineHeight: 1.55 }}
      >
        Linked to Growth &amp; Pipeline tab (
        <code
          className="text-[10px] px-1.5 py-0.5 rounded font-mono"
          style={{ background: "#f1f5f9", color: BRAND.t1 }}
        >
          plan.plays
        </code>
        ). Grows ARR through upsell + cross-sell. Run alongside Track 1 —
        defend first, expand second.
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <KPI
          label="Pipeline · raw"
          value={fmtUsd(totalRaw)}
          sub={`${plays.length} active play${plays.length !== 1 ? "s" : ""}`}
          bg="#f0fdfa"
          border={`${BRAND.aqua}40`}
          color="#0e7c75"
        />
        <KPI
          label="Pipeline · weighted"
          value={fmtUsd(totalWeighted)}
          sub="prob × est ARR"
          bg="#ede6ff"
          border="#C9B5FF"
          color={BRAND.indigo}
        />
        <div
          className="rounded-card p-2.5"
          style={{
            background: "#f8f9fc",
            border: `1px solid ${BRAND.cardBorder}`,
          }}
        >
          <div
            className="text-[9.5px] font-bold uppercase tracking-wider"
            style={{ color: BRAND.t3 }}
          >
            Stage mix
          </div>
          <div
            className="text-[11px] mt-1"
            style={{ color: BRAND.t2, lineHeight: 1.5 }}
          >
            {Object.keys(stageMix).length === 0 ? (
              <i style={{ color: BRAND.t3 }}>no plays</i>
            ) : (
              ["closing", "discussion", "pitched"].map((st) =>
                stageMix[st] ? (
                  <div key={st}>
                    {st}:{" "}
                    <b style={{ color: BRAND.t1 }}>{stageMix[st]}</b>
                  </div>
                ) : null,
              )
            )}
          </div>
        </div>
      </div>

      {plays.length === 0 ? (
        <div
          className="rounded-card border-2 border-dashed p-6 text-center"
          style={{ borderColor: BRAND.cardBorder }}
        >
          <div className="text-[24px] mb-1.5">📈</div>
          <div
            className="text-[12px] font-bold"
            style={{ color: BRAND.t1 }}
          >
            No expansion plays yet
          </div>
          <div className="text-[10.5px] mt-1" style={{ color: BRAND.t2 }}>
            Examples: extra seats · cross-module cross-sell · multi-year
            prepay · new BU expansion
          </div>
        </div>
      ) : (
        plays.map((p) => (
          <PlayRow
            key={p.id}
            play={p}
            canDelete={canWrite}
            onDelete={() => remove.mutate(p.id)}
          />
        ))
      )}

      {/* 12-Jun bug 252 — AddPlayModal removed with the "+ Add play"
          button. Plays are created from Growth & Pipeline → Account Plan. */}
    </div>
  );
}

function KPI({
  label,
  value,
  sub,
  bg,
  border,
  color,
}: {
  label: string;
  value: string;
  sub: string;
  bg: string;
  border: string;
  color: string;
}) {
  return (
    <div
      className="rounded-card p-2.5"
      style={{ background: bg, border: `1px solid ${border}` }}
    >
      <div
        className="text-[9.5px] font-bold uppercase tracking-wider"
        style={{ color }}
      >
        {label}
      </div>
      <div
        className="text-[18px] font-extrabold mt-0.5"
        style={{ color }}
      >
        {value}
      </div>
      <div className="text-[10px] mt-0.5 opacity-70" style={{ color }}>
        {sub}
      </div>
    </div>
  );
}

function PlayRow({
  play,
  canDelete,
  onDelete,
}: {
  play: Play;
  canDelete: boolean;
  onDelete: () => void;
}) {
  const stage =
    play.prob >= 80 ? "closing" : play.prob >= 40 ? "discussion" : "pitched";
  const stCol =
    stage === "closing"
      ? BRAND.green
      : stage === "discussion"
        ? BRAND.amber
        : BRAND.t3;
  return (
    <div
      className="grid items-center gap-2.5 p-2.5 rounded-card mb-1.5"
      style={{
        gridTemplateColumns: "1fr 110px 100px 90px 60px",
        background: "#fff",
        border: `1px solid ${BRAND.cardBorder}`,
      }}
    >
      <div>
        <div
          className="text-[12.5px] font-bold"
          style={{ color: BRAND.t1 }}
        >
          {play.title}
        </div>
        {play.trigger_text && (
          <div
            className="text-[10.5px] mt-0.5"
            style={{ color: BRAND.t3 }}
          >
            {play.trigger_text}
          </div>
        )}
      </div>
      <span
        className="text-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
        style={{ background: `${stCol}15`, color: stCol }}
      >
        {stage}
      </span>
      <div className="text-right text-[11px]" style={{ color: BRAND.t2 }}>
        <b style={{ color: BRAND.t1 }}>{fmtUsd(parseUsd(play.value_usd))}</b>
        <br />
        <span style={{ color: BRAND.t3, fontSize: "9.5px" }}>est ARR</span>
      </div>
      <div className="text-right text-[11px]" style={{ color: BRAND.t2 }}>
        <b style={{ color: BRAND.t1 }}>{play.prob}%</b>
        <br />
        <span style={{ color: BRAND.t3, fontSize: "9.5px" }}>
          {play.when_text ?? "TBD"}
        </span>
      </div>
      {canDelete ? (
        <button
          type="button"
          onClick={onDelete}
          className="text-[11px] px-2 py-1 rounded-card"
          style={{
            color: BRAND.t3,
            background: "#fff",
            border: `1px solid ${BRAND.cardBorder}`,
          }}
        >
          🗑
        </button>
      ) : (
        <span />
      )}
    </div>
  );
}

// 12-Jun bug 252 — Local AddPlayModal definition removed. Plays are now
// created exclusively from Growth & Pipeline → Account Plan.

// 12-Jun bug 252 — Local Field + Label helpers removed (only used by
// the deleted AddPlayModal).

// ---------------------------------------------------------------------------
// 4. Outcome row
// ---------------------------------------------------------------------------
function OutcomeRow({
  outcome,
  canWrite,
  accountId,
  onChanged,
}: {
  outcome: Outcome | null;
  canWrite: boolean;
  accountId: string;
  onChanged: () => void;
}) {
  const setOutcome = useMutation({
    mutationFn: (o: Outcome) =>
      api.post(`/api/v1/accounts/${accountId}/delivery-renewal/outcome`, {
        outcome: o,
      }),
    onSuccess: () => onChanged(),
  });

  const buttons: { key: Outcome; label: string; icon: string; col: string }[] = [
    { key: "renewed", label: "Renewed", icon: "✅", col: BRAND.green },
    { key: "at_risk", label: "At Risk", icon: "⚠️", col: BRAND.amber },
    { key: "not_renewed", label: "Not Renewed", icon: "❌", col: BRAND.red },
  ];

  return (
    <div
      className="rounded-card p-4 text-center"
      style={{ background: "#fff", border: `1px solid ${BRAND.cardBorder}` }}
    >
      <div
        className="text-[13px] font-bold mb-2"
        style={{ color: BRAND.t1 }}
      >
        Renewal Outcome
      </div>
      <div className="text-[11px] mb-3" style={{ color: BRAND.t3 }}>
        Set this after the renewal conversation closes.
      </div>
      {!canWrite && outcome && (
        <div
          className="text-[11px] mb-2 px-3 py-1.5 rounded-card inline-block"
          style={{
            background: "#f1f5f9",
            color: BRAND.t2,
            border: `1px solid ${BRAND.cardBorder}`,
          }}
        >
          🔒 Outcome locked at <b>{outcome}</b> — admin re-open required to
          change.
        </div>
      )}
      <div className="flex gap-2 justify-center flex-wrap">
        {buttons.map((b) => {
          const active = outcome === b.key;
          return (
            <button
              key={b.key}
              type="button"
              disabled={!canWrite || setOutcome.isPending}
              onClick={() => setOutcome.mutate(b.key)}
              className="text-[12px] font-semibold px-5 py-2 rounded-card border disabled:opacity-40 disabled:cursor-not-allowed"
              style={
                active
                  ? {
                      background: b.col,
                      borderColor: b.col,
                      color: "#fff",
                    }
                  : {
                      background: "#fff",
                      borderColor: BRAND.cardBorder,
                      color: BRAND.t2,
                    }
              }
            >
              {b.icon} {b.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
