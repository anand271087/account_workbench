// M23 — Delivery & Renewal.
//
// 28-May — port of prototype/beroe_awb_v20.html `bDeliveryRenewal`
// (line 3484-3583), locked to the Beroe brand palette (Sept 2025).
//
// Layout (top → bottom):
//   1. Aqua "Delivery & Renewal" heading + outcome lock pill (when set).
//   2. Red-flag banner — only when any unresolved flag (prototype line
//      3518-3525).
//   3. Dual-track top row (prototype line 3527-3538):
//        Track 1 — Renewal (Indigo accent, Risk Red when red-flagged)
//        Track 2 — Expand (Risk Green accent, greyed when paused)
//      Both render the prototype's stage-dot progress bar.
//   4. Track 2 Kanban (4 cols — Value Proof · Expand Ask · New Scope ·
//      Close). Greyed when paused.
//   5. Red-flag panel — raise + resolve.
//   6. Renewal Readiness — 3 questions with brand RAG (prototype line
//      3540-3564).
//   7. Final outcome — Risk Green / Risk Amber / Risk Red buttons.
//   8. Sticky save bar with brand Risk-Amber dirty tint + Indigo Save.
//   9. VDD summary card stays at the top under the heading (Aqua left
//      border per prototype line 3567).

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/components/AuthProvider";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAccountFromLayout } from "../../AccountProfileLayout";
import {
  FLAG_LABELS,
  FLAG_TYPES,
  OUTCOME_LABELS,
  OUTCOME_TONES,
  READINESS_QUESTIONS,
  STAGES,
  STAGE_COL_KEYS,
  STAGE_LABELS,
  type DeliveryRenewal,
  type DeliveryRenewalUpdate,
  type ExpandItem,
  type ExpandStage,
  type Outcome,
  type Readiness,
  type ReadinessAnswerValue,
  type RedFlag,
  type RedFlagType,
} from "@/types/delivery_renewal";

// Beroe brand palette anchors.
const INDIGO = "#4A00F8";
const MIDNIGHT = "#001137";
const AQUA = "#35E1D4";
const RISK_GREEN = "#6EC457";
const RISK_AMBER = "#F0BC41";
const RISK_RED = "#CF4548";

export default function DeliveryRenewalTab() {
  const account = useAccountFromLayout();
  const { me } = useAuth();
  const isAdmin = !!me?.permissions?.is_global_admin;
  const qc = useQueryClient();
  const queryKey = ["delivery-renewal", account.id];

  const { data, isLoading } = useQuery<DeliveryRenewal>({
    queryKey,
    queryFn: () =>
      api.get<DeliveryRenewal>(
        `/api/v1/accounts/${account.id}/delivery-renewal`,
      ),
  });

  const [form, setForm] = useState<DeliveryRenewal | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [flagDraft, setFlagDraft] = useState<{ type: RedFlagType; note: string } | null>(null);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const dirty = useMemo(() => {
    if (!form || !data) return false;
    return JSON.stringify(serializeForm(form)) !== JSON.stringify(serializeForm(data));
  }, [form, data]);

  const saveMutation = useMutation({
    mutationFn: (body: DeliveryRenewalUpdate) =>
      api.patch<DeliveryRenewal>(
        `/api/v1/accounts/${account.id}/delivery-renewal`,
        body,
      ),
    onSuccess: (saved) => {
      qc.setQueryData(queryKey, saved);
      setErr(null);
    },
    onError: (e: ApiError) => setErr(e.message),
  });

  const addFlagMutation = useMutation({
    mutationFn: (b: { type: RedFlagType; note: string }) =>
      api.post<DeliveryRenewal>(
        `/api/v1/accounts/${account.id}/delivery-renewal/red-flags`,
        b,
      ),
    onSuccess: (saved) => {
      qc.setQueryData(queryKey, saved);
      setFlagDraft(null);
    },
    onError: (e: ApiError) => setErr(e.message),
  });

  const resolveFlagMutation = useMutation({
    mutationFn: (flagId: string) =>
      api.post<DeliveryRenewal>(
        `/api/v1/accounts/${account.id}/delivery-renewal/red-flags/${flagId}/resolve`,
      ),
    onSuccess: (saved) => qc.setQueryData(queryKey, saved),
    onError: (e: ApiError) => setErr(e.message),
  });

  const setOutcomeMutation = useMutation({
    mutationFn: (outcome: Outcome) =>
      api.post<DeliveryRenewal>(
        `/api/v1/accounts/${account.id}/delivery-renewal/outcome`,
        { outcome },
      ),
    onSuccess: (saved) => qc.setQueryData(queryKey, saved),
    onError: (e: ApiError) => setErr(e.message),
  });

  const reopenMutation = useMutation({
    mutationFn: () =>
      api.post<DeliveryRenewal>(
        `/api/v1/accounts/${account.id}/delivery-renewal/reopen`,
      ),
    onSuccess: (saved) => qc.setQueryData(queryKey, saved),
    onError: (e: ApiError) => setErr(e.message),
  });

  if (isLoading || !form) {
    return (
      <Card>
        <div className="text-sm text-text-muted">Loading Delivery & Renewal…</div>
      </Card>
    );
  }

  const locked = form.outcome !== null;
  const editable = form.is_editable && !locked;

  // Track 1 → checkpoint stage-dot progress (prototype line 3531).
  const renewalStages = ["Kickoff", "MBR", "QBR", "Renewal"] as const;
  // Track 2 → expand pipeline stage-dot progress (prototype line 3536).
  const expandStages = ["Value Proof", "Expand Ask", "New Scope", "Close"] as const;
  const hasRedFlag = form.red_flags.some((f) => f.resolved_at === null);

  return (
    <div className="space-y-3.5">
      {/* Aqua heading — matches other SM tabs (VDD, Contract & Goals,
          Value Tracking, Checkpoints). */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div
            className="text-[11px] font-bold uppercase"
            style={{ color: AQUA, letterSpacing: "0.05em" }}
          >
            Delivery &amp; Renewal
          </div>
          <p className="text-[11px] text-text-muted mt-0.5">
            Dual-track post-delivery view + 3-question Renewal Readiness +
            final outcome.
          </p>
        </div>
        {form.outcome && (
          <span
            className="text-[11px] px-2.5 py-1 rounded-md font-semibold whitespace-nowrap"
            style={{
              background: OUTCOME_TONES[form.outcome].bg,
              border: `1px solid ${OUTCOME_TONES[form.outcome].border}`,
              color: OUTCOME_TONES[form.outcome].text,
            }}
          >
            🔒 {OUTCOME_LABELS[form.outcome]}
          </span>
        )}
      </div>

      {/* Red-flag banner — verbatim port of prototype line 3518-3525. */}
      {hasRedFlag && (
        <div
          className="rounded-card p-3 flex items-start gap-2.5"
          style={{
            background: `${RISK_RED}10`,
            border: `2px solid ${RISK_RED}`,
          }}
        >
          <span className="text-[16px]">🚨</span>
          <div className="flex-1">
            <div
              className="text-[13px] font-bold"
              style={{ color: RISK_RED }}
            >
              Red Flag — Track 2 Paused
            </div>
            <div className="text-[11px]" style={{ color: "#7F1D1D" }}>
              Resolve open red flag(s) before resuming the expand pipeline.
              Fix Track 1 first.
            </div>
          </div>
        </div>
      )}

      {/* Dual-track top row — prototype line 3527-3538. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Track1Card
          track1={form.track1}
          hasRedFlag={hasRedFlag}
          stages={renewalStages as unknown as string[]}
          checkpointSignedTypes={undefined}
        />
        <Track2Card
          paused={form.expand_paused}
          stages={expandStages as unknown as string[]}
          firstStageDone={
            (form.expand_value_proof ?? []).length > 0 ||
            (form.expand_expand_ask ?? []).length > 0 ||
            (form.expand_new_scope ?? []).length > 0 ||
            (form.expand_close ?? []).length > 0
          }
        />
      </div>

      {/* Track 2 Kanban */}
      <Card>
        <div className="grid grid-cols-4 gap-3">
          {STAGES.map((s) => (
            <KanbanColumn
              key={s}
              stage={s}
              items={form[STAGE_COL_KEYS[s]] ?? []}
              editable={editable}
              paused={form.expand_paused}
              onChange={(next) =>
                setForm({ ...form, [STAGE_COL_KEYS[s]]: next })
              }
            />
          ))}
        </div>
        {form.expand_paused && (
          <div
            className="mt-3 text-[11px] rounded-md px-3 py-2"
            style={{
              background: `${RISK_AMBER}15`,
              border: `1px solid ${RISK_AMBER}40`,
              color: "#854F0B",
            }}
          >
            Track 2 is paused — resolve all open red flags to resume the
            expand pipeline.
          </div>
        )}
      </Card>

      {/* Red flags */}
      <Card>
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-[13px] font-semibold text-text-primary">
              Red flags
            </div>
            <div className="text-[11px] text-text-muted">
              Any unresolved flag pauses the expand pipeline.
            </div>
          </div>
          {editable && !flagDraft && (
            <button
              onClick={() => setFlagDraft({ type: "missed_checkpoint", note: "" })}
              className="text-[11px] px-2.5 py-1 rounded-md font-semibold"
              style={{
                background: "#fff",
                border: `1px solid ${RISK_RED}40`,
                color: RISK_RED,
              }}
            >
              + Raise flag
            </button>
          )}
        </div>

        {flagDraft && (
          <div
            className="rounded-md p-3 mb-3 space-y-2"
            style={{
              background: `${RISK_RED}08`,
              border: `1px solid ${RISK_RED}30`,
            }}
          >
            <div className="flex gap-2">
              <select
                value={flagDraft.type}
                onChange={(e) =>
                  setFlagDraft({ ...flagDraft, type: e.target.value as RedFlagType })
                }
                className="text-[12px] border border-beroe-card-border rounded-md px-2 py-1 focus:border-beroe-blue focus:outline-none"
              >
                {FLAG_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {FLAG_LABELS[t]}
                  </option>
                ))}
              </select>
              <input
                value={flagDraft.note}
                onChange={(e) => setFlagDraft({ ...flagDraft, note: e.target.value })}
                placeholder="Why?"
                className="flex-1 text-[12px] border border-beroe-card-border rounded-md px-2 py-1 focus:border-beroe-blue focus:outline-none"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setFlagDraft(null)}
                className="text-[11px] px-2.5 py-1 rounded-md"
                style={{
                  background: "#fff",
                  border: "1px solid #e4eaf6",
                  color: MIDNIGHT,
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => addFlagMutation.mutate(flagDraft)}
                disabled={addFlagMutation.isPending}
                className="text-[11px] px-2.5 py-1 rounded-md font-semibold text-white disabled:opacity-50"
                style={{ background: RISK_RED }}
              >
                Raise flag
              </button>
            </div>
          </div>
        )}

        <RedFlagList
          flags={form.red_flags}
          editable={editable}
          onResolve={(id) => resolveFlagMutation.mutate(id)}
        />
      </Card>

      {/* Renewal Readiness */}
      <Card>
        <div className="flex items-center justify-between mb-2">
          <div>
            <div className="text-[13px] font-semibold text-text-primary">
              Renewal Readiness
            </div>
            <div className="text-[11px] text-text-muted">
              Gates the renewal conversation.
            </div>
          </div>
          <ScoreBadge score={form.readiness_score} />
        </div>
        <ReadinessGrid
          value={form.readiness}
          editable={editable}
          onChange={(next) => setForm({ ...form, readiness: next })}
        />
      </Card>

      {/* Final outcome — prototype line 3559-3563 (✓ Renewed / ⚠ At Risk
          / ✕ Not Renewed). Brand RAG. */}
      <Card>
        <div
          className="text-[13px] font-bold mb-2"
          style={{ color: MIDNIGHT }}
        >
          Final outcome
        </div>
        {form.outcome ? (
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <span
                className="text-[12px] px-2.5 py-1 rounded-md font-semibold"
                style={{
                  background: OUTCOME_TONES[form.outcome].bg,
                  border: `1px solid ${OUTCOME_TONES[form.outcome].border}`,
                  color: OUTCOME_TONES[form.outcome].text,
                }}
              >
                {OUTCOME_LABELS[form.outcome]}
              </span>
              {form.outcome_set_at && (
                <span className="text-[11px] text-text-muted">
                  Set {new Date(form.outcome_set_at).toLocaleString()}
                </span>
              )}
            </div>
            {isAdmin && (
              <button
                onClick={() => {
                  if (
                    confirm(
                      "Re-open the outcome? Editing will be unlocked again.",
                    )
                  )
                    reopenMutation.mutate();
                }}
                disabled={reopenMutation.isPending}
                className="text-[11px] px-2.5 py-1 rounded-md"
                style={{
                  background: "#fff",
                  border: "1px solid #e4eaf6",
                  color: MIDNIGHT,
                }}
              >
                🔓 Re-open
              </button>
            )}
          </div>
        ) : form.is_editable ? (
          <div className="flex gap-2 flex-wrap">
            {(["renewed", "at_risk", "not_renewed"] as Outcome[]).map((o) => {
              const t = OUTCOME_TONES[o];
              const icon =
                o === "renewed" ? "✅" : o === "at_risk" ? "⚠️" : "❌";
              return (
                <button
                  key={o}
                  onClick={() => {
                    if (
                      confirm(
                        `Set outcome to "${OUTCOME_LABELS[o]}"? This locks the document.`,
                      )
                    )
                      setOutcomeMutation.mutate(o);
                  }}
                  disabled={setOutcomeMutation.isPending}
                  className="text-[12px] px-3 py-1.5 rounded-md font-semibold hover:opacity-90"
                  style={{
                    background: t.bg,
                    border: `1px solid ${t.border}`,
                    color: t.text,
                  }}
                >
                  {icon} {OUTCOME_LABELS[o]}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="text-[12px] text-text-muted italic">
            Your role can&apos;t set the outcome.
          </div>
        )}
      </Card>

      {/* Save bar — Risk Amber tint when dirty (brand). */}
      {form.is_editable && !locked && (
        <div
          className="sticky bottom-3 z-10 flex items-center justify-between gap-3 px-3 py-2 rounded-lg shadow-sm"
          style={
            dirty
              ? {
                  background: `${RISK_AMBER}15`,
                  border: `1px solid ${RISK_AMBER}40`,
                }
              : { background: "#fff", border: "1px solid #e4eaf6" }
          }
        >
          <div className="text-[12px]">
            {err ? (
              <span style={{ color: RISK_RED }}>{err}</span>
            ) : dirty ? (
              <span className="font-bold" style={{ color: "#854F0B" }}>
                Unsaved changes
              </span>
            ) : (
              <span className="text-text-muted">All sections saved.</span>
            )}
          </div>
          <button
            onClick={() => saveMutation.mutate(serializeForm(form))}
            disabled={!dirty || saveMutation.isPending}
            className="text-[12px] px-3 py-1.5 rounded-md font-semibold text-white disabled:opacity-50"
            style={{ background: INDIGO }}
          >
            {saveMutation.isPending ? "Saving…" : "Save changes"}
          </button>
        </div>
      )}

      {/* VDD compact card — verbatim port of prototype line 3567-3580.
          Bottom of the page, Aqua left border, "Draft with AI" +
          "Download PPT" buttons, value-narrative quote in amber italic
          box, then the 4 named sections. */}
      <VddSummaryCard accountId={account.id} />
    </div>
  );
}

// ============================================================
// Helpers + sub-components
// ============================================================

function serializeForm(v: DeliveryRenewal): DeliveryRenewalUpdate {
  return {
    expand_value_proof: v.expand_value_proof,
    expand_expand_ask: v.expand_expand_ask,
    expand_new_scope: v.expand_new_scope,
    expand_close: v.expand_close,
    readiness: v.readiness,
  };
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white border border-beroe-card-border rounded-card p-4">
      {children}
    </div>
  );
}

/** Track 1 card — verbatim port of prototype line 3528-3532.
 *  Border accent: Indigo when healthy, Risk Red when a red flag is open.
 *  Renders the 4-stage progress dots (Kickoff → MBR → QBR → Renewal). */
function Track1Card({
  track1,
  hasRedFlag,
  stages,
  checkpointSignedTypes,
}: {
  track1: DeliveryRenewal["track1"];
  hasRedFlag: boolean;
  stages: string[];
  checkpointSignedTypes: Set<string> | undefined;
}) {
  void checkpointSignedTypes; // reserved for future use — the back end
  // could surface which exact stages are signed off; for now we drive
  // dot completion from `signed_off_count` as a simple progress proxy.
  const col = hasRedFlag ? RISK_RED : INDIGO;
  return (
    <div
      className="rounded-card p-3.5"
      style={{
        background: "#fff",
        border: `1.5px solid ${col}`,
      }}
    >
      <div
        className="text-[13px] font-bold mb-1"
        style={{ color: col }}
      >
        🛡 Track 1 — Renewal
      </div>
      <div className="text-[10px] text-text-muted mb-2.5">
        Deliver on initiatives. Prove ROI. Hold checkpoints.
      </div>
      <StageDots
        stages={stages}
        doneCount={track1.signed_off_count}
        color={col}
      />
      {track1.total === 0 ? (
        <div className="text-[11px] text-text-muted italic mt-2">
          No checkpoints scheduled — use the Checkpoints tab.
        </div>
      ) : (
        <div className="text-[11px] text-text-muted mt-2 flex gap-3 flex-wrap">
          <span>
            Signed off:{" "}
            <span className="font-semibold" style={{ color: MIDNIGHT }}>
              {track1.signed_off_count}/{track1.total}
            </span>
          </span>
          {typeof track1.next_days_until === "number" &&
            track1.next_type && (
              <span>
                Next: {track1.next_type}{" "}
                <span
                  className="px-1.5 py-px rounded text-[10px] font-semibold"
                  style={{
                    background:
                      track1.next_days_until < 0
                        ? `${RISK_RED}15`
                        : track1.next_days_until <= 7
                          ? `${RISK_AMBER}15`
                          : "#EAF1F5",
                    color:
                      track1.next_days_until < 0
                        ? RISK_RED
                        : track1.next_days_until <= 7
                          ? "#854F0B"
                          : "#475569",
                  }}
                >
                  {track1.next_days_until < 0
                    ? `${Math.abs(track1.next_days_until)}d overdue`
                    : `in ${track1.next_days_until}d`}
                </span>
              </span>
            )}
          {track1.overdue_count > 0 && (
            <span className="font-semibold" style={{ color: RISK_RED }}>
              Overdue: {track1.overdue_count}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Track 2 card — verbatim port of prototype line 3533-3537.
 *  Border accent: Risk Green when active, brand grey + opacity 0.5
 *  when paused. */
function Track2Card({
  paused,
  stages,
  firstStageDone,
}: {
  paused: boolean;
  stages: string[];
  firstStageDone: boolean;
}) {
  const col = paused ? "#94a3b8" : RISK_GREEN;
  return (
    <div
      className="rounded-card p-3.5"
      style={{
        background: "#fff",
        border: `1.5px solid ${col}`,
        opacity: paused ? 0.6 : 1,
      }}
    >
      <div
        className="text-[13px] font-bold mb-1 flex items-center gap-2"
        style={{ color: col }}
      >
        🚀 Track 2 — Expand
        {paused && (
          <span className="text-[10px] font-medium text-text-muted">
            (paused)
          </span>
        )}
      </div>
      <div className="text-[10px] text-text-muted mb-2.5">
        New categories, users, scope. Runs parallel unless Track 1 red.
      </div>
      <StageDots
        stages={stages}
        doneCount={firstStageDone ? 1 : 0}
        color={col}
      />
    </div>
  );
}

/** Stage progress dots — verbatim port of prototype's connected-dot
 *  pattern (line 3531 / 3536). N dots evenly spaced, connector lines
 *  between, filled in `color` up to `doneCount`. */
function StageDots({
  stages,
  doneCount,
  color,
}: {
  stages: string[];
  doneCount: number;
  color: string;
}) {
  return (
    <div className="flex items-center gap-0">
      {stages.map((st, i) => {
        const done = i < doneCount;
        return (
          <Stage
            key={st}
            label={st}
            done={done}
            color={color}
            connector={i > 0}
            connectorActive={done}
          />
        );
      })}
    </div>
  );
}

function Stage({
  label,
  done,
  color,
  connector,
  connectorActive,
}: {
  label: string;
  done: boolean;
  color: string;
  connector: boolean;
  connectorActive: boolean;
}) {
  return (
    <>
      {connector && (
        <div
          className="flex-1 h-0.5"
          style={{ background: connectorActive ? color : "#e8eef8" }}
        />
      )}
      <div className="flex flex-col items-center gap-1">
        <div
          className="rounded-full flex items-center justify-center text-[8px] font-bold text-white"
          style={{
            width: 14,
            height: 14,
            background: done ? color : "#e8eef8",
            border: `2px solid ${done ? color : "#cbd5e1"}`,
          }}
        >
          {done ? "✓" : ""}
        </div>
        <div
          className="text-[8px] font-semibold whitespace-nowrap"
          style={{ color: done ? color : "#94a3b8" }}
        >
          {label}
        </div>
      </div>
    </>
  );
}

function KanbanColumn({
  stage,
  items,
  editable,
  paused,
  onChange,
}: {
  stage: ExpandStage;
  items: ExpandItem[];
  editable: boolean;
  paused: boolean;
  onChange: (v: ExpandItem[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const update = (i: number, patch: Partial<ExpandItem>) => {
    const next = [...items];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  return (
    <div
      className={cn(
        "rounded-md border p-2.5 min-h-[120px]",
        paused
          ? "border-slate-200 bg-slate-50/50 opacity-70"
          : "border-beroe-card-border bg-beroe-bg/30",
      )}
    >
      <div className="text-[11px] font-bold uppercase tracking-wider text-text-muted mb-2">
        {STAGE_LABELS[stage]} · {items.length}
      </div>
      <div className="space-y-2">
        {items.map((it, i) => (
          <div
            key={i}
            className="bg-white border border-beroe-card-border rounded-md p-2 text-[12px]"
          >
            {editable ? (
              <>
                <input
                  value={it.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                  className="w-full text-[12px] font-medium border-0 p-0 focus:outline-none"
                />
                <div className="flex gap-2 mt-1">
                  <input
                    value={it.amount_musd ?? ""}
                    onChange={(e) =>
                      update(i, {
                        amount_musd: e.target.value === ""
                          ? null
                          : parseFloat(e.target.value),
                      })
                    }
                    placeholder="$M"
                    className="flex-1 text-[11px] border border-beroe-card-border rounded px-1.5 py-0.5"
                  />
                  <button
                    onClick={() => onChange(items.filter((_, j) => j !== i))}
                    className="text-[11px] text-text-muted hover:text-red-700 px-1"
                  >
                    ✕
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="font-medium text-text-primary">{it.name}</div>
                {typeof it.amount_musd === "number" && (
                  <div className="text-[11px] text-text-muted">
                    ${it.amount_musd.toFixed(2)}M
                  </div>
                )}
              </>
            )}
          </div>
        ))}
        {editable && (
          <div className="flex gap-1.5">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="+ add"
              onKeyDown={(e) => {
                if (e.key === "Enter" && draft.trim()) {
                  onChange([
                    ...items,
                    { name: draft.trim(), stage } as ExpandItem,
                  ]);
                  setDraft("");
                }
              }}
              className="flex-1 text-[11px] border border-beroe-card-border rounded px-1.5 py-0.5"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function RedFlagList({
  flags,
  editable,
  onResolve,
}: {
  flags: RedFlag[];
  editable: boolean;
  onResolve: (id: string) => void;
}) {
  if (flags.length === 0) {
    return (
      <div className="text-[12px] text-text-muted italic">
        No red flags raised.
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      {flags.map((f) => {
        const open = f.resolved_at === null;
        return (
          <div
            key={f.id ?? Math.random()}
            className="flex items-start gap-3 p-2 rounded-md text-[12px]"
            style={
              open
                ? {
                    background: `${RISK_RED}08`,
                    border: `1px solid ${RISK_RED}30`,
                  }
                : {
                    background: "#EAF1F580",
                    border: "1px solid #e4eaf6",
                  }
            }
          >
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded font-bold uppercase"
                  style={
                    open
                      ? {
                          background: `${RISK_RED}15`,
                          color: RISK_RED,
                        }
                      : {
                          background: "#94a3b820",
                          color: "#475569",
                        }
                  }
                >
                  {open ? "OPEN" : "RESOLVED"}
                </span>
                <span
                  className="font-semibold"
                  style={{ color: MIDNIGHT }}
                >
                  {FLAG_LABELS[f.type]}
                </span>
              </div>
              {f.note && (
                <div className="text-text-secondary mt-0.5">{f.note}</div>
              )}
              <div className="text-[10px] text-text-muted mt-0.5">
                {f.raised_at && (
                  <>Raised {new Date(f.raised_at).toLocaleString()} </>
                )}
                {f.resolved_at && (
                  <>· Resolved {new Date(f.resolved_at).toLocaleString()}</>
                )}
              </div>
            </div>
            {editable && open && f.id && (
              <button
                onClick={() => onResolve(f.id!)}
                className="text-[11px] px-2.5 py-0.5 rounded-md font-semibold"
                style={{
                  background: "#fff",
                  border: `1px solid ${RISK_GREEN}40`,
                  color: RISK_GREEN,
                }}
              >
                ✓ Resolve
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const t =
    score === 3
      ? { bg: `${RISK_GREEN}15`, border: `${RISK_GREEN}40`, color: "#1d6b35" }
      : score >= 1
        ? { bg: `${RISK_AMBER}15`, border: `${RISK_AMBER}40`, color: "#854F0B" }
        : { bg: "#94a3b815", border: "#94a3b830", color: "#475569" };
  return (
    <span
      className="text-[11px] px-2 py-0.5 rounded-md font-bold"
      style={{
        background: t.bg,
        border: `1px solid ${t.border}`,
        color: t.color,
      }}
    >
      {score}/3 yes
    </span>
  );
}

function ReadinessGrid({
  value,
  editable,
  onChange,
}: {
  value: Readiness;
  editable: boolean;
  onChange: (v: Readiness) => void;
}) {
  return (
    <div className="space-y-3">
      {READINESS_QUESTIONS.map((q) => {
        const a = value[q.key];
        return (
          <div
            key={q.key as string}
            className="rounded-md p-2.5"
            style={{
              background: "#fff",
              border: "1px solid #e4eaf6",
            }}
          >
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <div
                  className="text-[12px] font-semibold"
                  style={{ color: MIDNIGHT }}
                >
                  {q.label}
                </div>
                <div className="text-[11px] text-text-muted">{q.hint}</div>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                {(["yes", "no", "unknown"] as ReadinessAnswerValue[]).map(
                  (opt) => {
                    const active = a.answer === opt;
                    const tone =
                      opt === "yes"
                        ? {
                            bg: `${RISK_GREEN}15`,
                            border: `${RISK_GREEN}40`,
                            color: "#1d6b35",
                          }
                        : opt === "no"
                          ? {
                              bg: `${RISK_RED}10`,
                              border: `${RISK_RED}30`,
                              color: "#7F1D1D",
                            }
                          : {
                              bg: "#94a3b815",
                              border: "#94a3b830",
                              color: "#475569",
                            };
                    return (
                      <button
                        key={opt}
                        disabled={!editable}
                        onClick={() =>
                          onChange({
                            ...value,
                            [q.key]: { ...a, answer: opt },
                          })
                        }
                        className={cn(
                          "text-[10px] px-2 py-0.5 rounded-md uppercase font-bold",
                          !editable && "cursor-default",
                        )}
                        style={{
                          background: active ? tone.bg : "#fff",
                          border: `1px solid ${active ? tone.border : "#e4eaf6"}`,
                          color: active ? tone.color : "#94a3b8",
                          letterSpacing: "0.05em",
                        }}
                      >
                        {opt}
                      </button>
                    );
                  },
                )}
              </div>
            </div>
            <textarea
              disabled={!editable}
              value={a.proof_note ?? ""}
              onChange={(e) =>
                onChange({
                  ...value,
                  [q.key]: { ...a, proof_note: e.target.value },
                })
              }
              rows={2}
              placeholder="Proof note (dashboard link, sign-off ref, email subject…)"
              className="w-full mt-2 text-[12px] border border-beroe-card-border rounded-md px-2 py-1 disabled:bg-beroe-bg/40 focus:border-beroe-blue focus:outline-none"
            />
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// Row 55 (25-May-2026) — VDD summary card embedded on D&R
// ============================================================

/** Compact VDD card — verbatim port of prototype line 3567-3580.
 *  Renders below all the D&R workflow cards. Aqua left border, title +
 *  Draft-with-AI / Download-PPT buttons, then the value narrative quote
 *  (from the Success Contract) and the four named sections from the
 *  VDD jsonb. */
function VddSummaryCard({ accountId }: { accountId: string }) {
  type ValueRow = {
    initiative_name?: string;
    identified_musd?: number | null;
    committed_musd?: number | null;
    implemented_musd?: number | null;
  };
  type MetricRow = {
    name?: string;
    target?: string | null;
    current?: string | null;
  };
  type ApproachRow = {
    initiative?: string;
    approach?: string | null;
    levers?: string[] | null;
  };
  type Vdd = {
    value_delivered?: ValueRow[];
    agreed_success_metrics?: MetricRow[];
    beroes_approach?: ApproachRow[];
    client_strategic_priorities?: string[];
    locked_at: string | null;
    exec_summary?: string | null;
  };
  type SuccessContract = {
    value_narrative?: string | null;
  };

  const { data: vdd, isLoading } = useQuery<Vdd>({
    queryKey: ["vdd", accountId],
    queryFn: () =>
      api.get<Vdd>(`/api/v1/accounts/${accountId}/value-delivery-document`),
  });
  const { data: sc } = useQuery<SuccessContract>({
    queryKey: ["success-contract", accountId],
    queryFn: () =>
      api.get<SuccessContract>(
        `/api/v1/accounts/${accountId}/success-contract`,
      ),
  });

  const priorities = vdd?.client_strategic_priorities ?? [];
  const metrics = vdd?.agreed_success_metrics ?? [];
  const approach = vdd?.beroes_approach ?? [];
  const valueDelivered = vdd?.value_delivered ?? [];
  const valueNarrative = sc?.value_narrative ?? "";

  const fmt = (n: number | null | undefined) =>
    typeof n === "number" && Number.isFinite(n) ? `$${n.toFixed(2)}M` : "—";

  const vddHref = `/accounts/${accountId}/success-management/vdd`;

  return (
    <div
      className="rounded-card p-4"
      style={{
        background: "#fff",
        border: "1px solid #e4eaf6",
        borderLeft: `3px solid ${AQUA}`,
      }}
    >
      {/* Header — prototype line 3568-3574 */}
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div
          className="text-[13px] font-bold"
          style={{ color: MIDNIGHT }}
        >
          📄 Value Delivery Document
        </div>
        <div className="flex gap-2 items-center">
          <a
            href={vddHref}
            className="text-[11px] px-2.5 py-1 rounded-md font-semibold"
            style={{
              background: "#fff",
              border: `1px solid ${INDIGO}40`,
              color: INDIGO,
            }}
            title="Open VDD to AI-draft the 4 sections"
          >
            ✨ Draft with AI
          </a>
          <a
            href={vddHref}
            className="text-[11px] px-2.5 py-1 rounded-md font-semibold"
            style={{
              background: "#fff",
              border: "1px solid #e4eaf6",
              color: MIDNIGHT,
            }}
            title="Open VDD to export"
          >
            ⬇ Download PPT
          </a>
        </div>
      </div>

      {isLoading && (
        <div className="text-[12px] text-text-muted italic">Loading…</div>
      )}

      {/* Value narrative quote — prototype line 3575. */}
      {!isLoading && valueNarrative && (
        <div
          className="text-[11px] italic rounded-md mb-2.5"
          style={{
            color: "#7a3800",
            background: `${RISK_AMBER}15`,
            padding: "8px 10px",
            lineHeight: 1.5,
          }}
        >
          &ldquo;{valueNarrative}&rdquo;
        </div>
      )}

      {/* Four named sections — prototype line 3577-3579, all titles in
          Aqua uppercase. */}
      {!isLoading && (
        <>
          <VddSection title="Client Strategic Priorities" empty={priorities.length === 0}>
            <ul className="space-y-1">
              {priorities.map((p, i) => (
                <li key={i} className="text-[11px] text-text-secondary leading-snug">
                  • {p}
                </li>
              ))}
            </ul>
          </VddSection>

          <VddSection title="Agreed Success Metrics" empty={metrics.length === 0}>
            <ul className="space-y-1">
              {metrics.map((m, i) => (
                <li key={i} className="text-[11px] text-text-secondary leading-snug">
                  •{" "}
                  <span className="font-semibold" style={{ color: MIDNIGHT }}>
                    {m.name ?? "—"}
                  </span>
                  {(m.current || m.target) && (
                    <span className="text-text-muted">
                      {" "}— {m.current ?? "—"} / {m.target ?? "—"}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </VddSection>

          <VddSection title="Beroe's Approach Per Initiative" empty={approach.length === 0}>
            <ul className="space-y-1">
              {approach.map((a, i) => (
                <li key={i} className="text-[11px] text-text-secondary leading-snug">
                  •{" "}
                  <span className="font-semibold" style={{ color: MIDNIGHT }}>
                    {a.initiative ?? "—"}
                  </span>
                  {a.approach && (
                    <span className="text-text-muted"> — {a.approach}</span>
                  )}
                </li>
              ))}
            </ul>
          </VddSection>

          <VddSection
            title="Value Delivered — CSM Attributed"
            empty={valueDelivered.length === 0}
          >
            <ul className="space-y-1">
              {valueDelivered.map((r, i) => (
                <li key={i} className="text-[11px] text-text-secondary leading-snug">
                  •{" "}
                  <span className="font-semibold" style={{ color: MIDNIGHT }}>
                    {r.initiative_name ?? "—"}
                  </span>
                  <span className="text-text-muted">
                    {" "}— {" "}
                    <span style={{ color: RISK_AMBER }}>
                      {fmt(r.identified_musd)} ID
                    </span>
                    {" / "}
                    <span style={{ color: INDIGO }}>
                      {fmt(r.committed_musd)} CO
                    </span>
                    {" / "}
                    <span style={{ color: RISK_GREEN }}>
                      {fmt(r.implemented_musd)} IM
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </VddSection>

          {vdd?.locked_at && (
            <div
              className="text-[11px] mt-2 font-semibold"
              style={{ color: RISK_GREEN }}
            >
              🔒 Locked {new Date(vdd.locked_at).toLocaleDateString()}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Aqua-uppercase section title + content (prototype line 3577-3579). */
function VddSection({
  title,
  empty,
  children,
}: {
  title: string;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2.5 last:mb-0">
      <div
        className="text-[10px] font-bold uppercase mb-1"
        style={{ color: AQUA, letterSpacing: "0.04em" }}
      >
        {title}
      </div>
      {empty ? (
        <div
          className="text-[11px] italic rounded-md px-2 py-1.5"
          style={{
            color: "#94a3b8",
            background: "#EAF1F580",
          }}
        >
          —
        </div>
      ) : (
        children
      )}
    </div>
  );
}
