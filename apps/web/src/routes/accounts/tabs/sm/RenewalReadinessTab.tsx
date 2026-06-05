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
  PlayCreate,
  PlayMode,
} from "@/types/play";
import { type Activity, type ActivityListResponse } from "@/types/signal";

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
  const actsQ = useQuery<ActivityListResponse>({
    queryKey: ["activities", account.id],
    queryFn: () =>
      api.get<ActivityListResponse>(`/api/v1/accounts/${account.id}/activities`),
  });

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
  const activities = actsQ.data?.items ?? [];

  return (
    <div className="space-y-3">
      <VerdictBanner readiness={dr.readiness} />
      <Track1Defend
        readiness={dr.readiness}
        goals={goals}
        activities={activities}
        canWrite={dr.is_editable}
        accountId={account.id}
        onChanged={invalidate}
      />
      <Track2Expand
        plays={plays.filter((p) => p.modes.includes("expand") && !p.hidden)}
        canWrite={playsQ.data?.is_editable ?? false}
        accountId={account.id}
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
  activities,
  canWrite,
  accountId,
  onChanged,
}: {
  readiness: Readiness;
  goals: CSGoal[];
  activities: Activity[];
  canWrite: boolean;
  accountId: string;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const frozen = goals.filter((g) => g.validation_status === "accepted");

  const { totalDelivered, totalTarget } = useMemo(() => {
    let d = 0;
    let t = 0;
    for (const g of frozen) {
      t += parseUsd(g.target_value);
      for (const i of g.initiatives) {
        d += parseUsd(i.value_delivered);
      }
    }
    return { totalDelivered: d, totalTarget: t };
  }, [frozen]);

  // Top wins = activities tagged with QBR / Product / Project hits (best
  // available proxy for prototype's `valueImpact > 0`).
  const topWins = useMemo(
    () =>
      [...activities]
        .filter((a) =>
          ["qbr", "exec_visit", "product", "csm_call"].includes(a.type),
        )
        .sort(
          (a, b) =>
            new Date(b.occurred_at ?? b.created_at).getTime() -
            new Date(a.occurred_at ?? a.created_at).getTime(),
        )
        .slice(0, 3),
    [activities],
  );

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
            Total value delivered
          </div>
          <div
            className="text-[24px] font-black mt-0.5"
            style={{ color: "#146a45" }}
          >
            {fmtUsd(totalDelivered)}
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: "#2fb87a" }}>
            of {fmtUsd(totalTarget)} committed · across {frozen.length} frozen
            goals
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
              Top wins
            </div>
            {topWins.map((w) => (
              <div
                key={w.id}
                className="text-[11px]"
                style={{ color: "#1a4035" }}
              >
                ✓{" "}
                {w.title.length > 40 ? w.title.slice(0, 40) + "…" : w.title}
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
  accountId,
  onChanged,
}: {
  plays: Play[];
  canWrite: boolean;
  accountId: string;
  onChanged: () => void;
}) {
  const [addOpen, setAddOpen] = useState(false);

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
        {canWrite && (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="text-[11px] font-semibold px-3 py-1.5 rounded-card border"
            style={{ borderColor: BRAND.cardBorder, color: BRAND.t2 }}
          >
            + Add play
          </button>
        )}
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

      {addOpen && (
        <AddPlayModal
          accountId={accountId}
          onClose={() => setAddOpen(false)}
          onCreated={() => {
            onChanged();
            setAddOpen(false);
          }}
        />
      )}
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

function AddPlayModal({
  accountId,
  onClose,
  onCreated,
}: {
  accountId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState("");
  const [arr, setArr] = useState("");
  const [prob, setProb] = useState(30);
  const [when, setWhen] = useState("");
  const [trigger, setTrigger] = useState("");

  const create = useMutation({
    mutationFn: () => {
      const body: PlayCreate = {
        title: title.trim(),
        value_usd: arr || "0",
        prob,
        when_text: when || null,
        trigger_text: trigger || null,
        modes: ["expand" as PlayMode],
      };
      return api.post(`/api/v1/accounts/${accountId}/plays`, body);
    },
    onSuccess: onCreated,
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-card p-5 w-[460px] max-w-[92vw] shadow-xl"
        style={{ border: `1.5px solid ${BRAND.cardBorder}` }}
      >
        <div className="flex items-center justify-between mb-3">
          <div
            className="text-[14px] font-bold"
            style={{ color: BRAND.midnight }}
          >
            Add expansion play
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
            label="Play title"
            required
            value={title}
            onChange={setTitle}
            placeholder="e.g. Custom Credits — Quarterly Pack"
          />
          <div className="grid grid-cols-2 gap-2.5">
            <Field
              label="Est. ARR uplift"
              value={arr}
              onChange={setArr}
              placeholder="e.g. 50000 or 50K"
            />
            <div>
              <Label>Probability (%)</Label>
              <input
                type="number"
                min={0}
                max={100}
                value={prob}
                onChange={(e) => setProb(Number(e.target.value))}
                className="w-full px-2.5 py-1.5 text-[12px] rounded-card border mt-1.5"
                style={{ borderColor: BRAND.cardBorder }}
              />
            </div>
          </div>
          <Field
            label="When"
            value={when}
            onChange={setWhen}
            placeholder="e.g. Q3 FY-26"
          />
          <Field
            label="Trigger / notes"
            value={trigger}
            onChange={setTrigger}
            placeholder="What sparked this play? Any context for the next CSM?"
          />
        </div>
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
            onClick={() => create.mutate()}
            className="text-[12px] px-3 py-1.5 rounded-card text-white font-semibold disabled:opacity-40"
            style={{ background: BRAND.indigo }}
          >
            {create.isPending ? "Adding…" : "Add play"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div>
      <Label>
        {label}
        {required && <span style={{ color: BRAND.red }}> *</span>}
      </Label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-2.5 py-1.5 text-[12px] rounded-card border mt-1.5"
        style={{ borderColor: BRAND.cardBorder }}
      />
    </div>
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
