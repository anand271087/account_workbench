// M23 — Delivery & Renewal.
//
// Dual-track view:
//   Track 1 (Renewal) — derived from M21 checkpoints; mini-summary tile.
//   Track 2 (Expand)  — 4-column Kanban. Greyed when any open red flag.
// Plus:
//   * Red-flag panel  — raise + resolve.
//   * Renewal Readiness — 3 yes/no/unknown questions with proof notes,
//     score badge (n/3 yes).
//   * Outcome selector — renewed / at_risk / not_renewed. Immutable once
//     set; admin-only "Re-open" releases.

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

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
              Success Management · M23
            </div>
            <h2 className="text-lg font-semibold text-text-primary">
              Delivery & Renewal
            </h2>
            <p className="text-[12px] text-text-secondary mt-0.5">
              Dual-track post-delivery view + 3-question Renewal Readiness +
              final outcome.
            </p>
          </div>
          {form.outcome && (
            <span
              className={cn(
                "text-[11px] px-2 py-1 rounded-md border font-semibold",
                OUTCOME_TONES[form.outcome],
              )}
            >
              🔒 {OUTCOME_LABELS[form.outcome]}
            </span>
          )}
        </div>
      </Card>

      {/* Row 55 (25-May) — VDD summary card embedded at the top of D&R.
          Reads the value_delivery_document jsonb; deep-links to the editor. */}
      <VddSummaryCard accountId={account.id} />

      {/* Dual-track top row */}
      <div className="grid grid-cols-12 gap-4">
        <Track1Card track1={form.track1} className="col-span-5" />
        <Track2Header
          paused={form.expand_paused}
          className="col-span-7"
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
          <div className="mt-3 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
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
              className="text-[11px] px-2.5 py-1 rounded-md border border-beroe-card-border hover:bg-beroe-bg/60"
            >
              + Raise flag
            </button>
          )}
        </div>

        {flagDraft && (
          <div className="border border-amber-300 bg-amber-50/40 rounded-md p-3 mb-3 space-y-2">
            <div className="flex gap-2">
              <select
                value={flagDraft.type}
                onChange={(e) =>
                  setFlagDraft({ ...flagDraft, type: e.target.value as RedFlagType })
                }
                className="text-[12px] border border-beroe-card-border rounded-md px-2 py-1"
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
                className="flex-1 text-[12px] border border-beroe-card-border rounded-md px-2 py-1"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setFlagDraft(null)}
                className="text-[11px] px-2.5 py-1 rounded-md border border-beroe-card-border hover:bg-beroe-bg/60"
              >
                Cancel
              </button>
              <button
                onClick={() => addFlagMutation.mutate(flagDraft)}
                disabled={addFlagMutation.isPending}
                className="text-[11px] px-2.5 py-1 rounded-md bg-red-600 text-white font-semibold disabled:opacity-50"
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

      {/* Outcome */}
      <Card>
        <div className="text-[13px] font-semibold text-text-primary mb-2">
          Final outcome
        </div>
        {form.outcome ? (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  "text-[12px] px-2.5 py-1 rounded-md border font-semibold",
                  OUTCOME_TONES[form.outcome],
                )}
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
                className="text-[11px] px-2.5 py-1 rounded-md border border-beroe-card-border hover:bg-beroe-bg/60"
              >
                Re-open
              </button>
            )}
          </div>
        ) : form.is_editable ? (
          <div className="flex gap-2">
            {(["renewed", "at_risk", "not_renewed"] as Outcome[]).map((o) => (
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
                className={cn(
                  "text-[12px] px-3 py-1.5 rounded-md border font-semibold",
                  OUTCOME_TONES[o],
                  "hover:opacity-90",
                )}
              >
                {OUTCOME_LABELS[o]}
              </button>
            ))}
          </div>
        ) : (
          <div className="text-[12px] text-text-muted italic">
            Your role can't set the outcome.
          </div>
        )}
      </Card>

      {/* Save bar (Kanban + readiness are the editable-on-PATCH bits) */}
      {form.is_editable && !locked && (
        <div
          className={cn(
            "sticky bottom-3 z-10 flex items-center justify-between gap-3 px-3 py-2 rounded-lg border shadow-sm",
            dirty ? "bg-amber-50 border-amber-200" : "bg-white border-beroe-card-border",
          )}
        >
          <div className="text-[12px] text-text-secondary">
            {err ? (
              <span className="text-red-700">{err}</span>
            ) : dirty ? (
              <span className="font-medium text-amber-800">Unsaved changes</span>
            ) : (
              <span>All sections saved.</span>
            )}
          </div>
          <button
            onClick={() => saveMutation.mutate(serializeForm(form))}
            disabled={!dirty || saveMutation.isPending}
            className="text-[12px] px-3 py-1.5 rounded-md border border-beroe-card-border text-text-secondary hover:bg-beroe-bg/60 disabled:opacity-50"
          >
            Save changes
          </button>
        </div>
      )}
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

function Track1Card({
  track1,
  className,
}: {
  track1: DeliveryRenewal["track1"];
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-white border border-beroe-card-border rounded-card p-4",
        className,
      )}
    >
      <div className="text-[11px] font-bold uppercase tracking-wider text-text-muted mb-1.5">
        Track 1 · Renewal cadence
      </div>
      {track1.total === 0 ? (
        <div className="text-[12px] text-text-muted italic">
          No checkpoints scheduled yet — use the Checkpoints tab to auto-schedule.
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="text-[12px] text-text-primary">
            <span className="font-semibold">Next:</span>{" "}
            {track1.next_type ? (
              <>
                {track1.next_type}
                {track1.next_scheduled && (
                  <>
                    {" "}
                    on {new Date(track1.next_scheduled).toLocaleDateString()}
                  </>
                )}
                {typeof track1.next_days_until === "number" && (
                  <span
                    className={cn(
                      "ml-1.5 text-[11px] px-1.5 py-0.5 rounded border",
                      track1.next_days_until < 0
                        ? "bg-red-50 text-red-700 border-red-200"
                        : track1.next_days_until <= 7
                          ? "bg-amber-50 text-amber-700 border-amber-200"
                          : "bg-slate-50 text-slate-700 border-slate-200",
                    )}
                  >
                    {track1.next_days_until < 0
                      ? `${Math.abs(track1.next_days_until)}d overdue`
                      : `in ${track1.next_days_until}d`}
                  </span>
                )}
              </>
            ) : (
              <span className="text-text-muted">no upcoming checkpoint</span>
            )}
          </div>
          <div className="text-[11px] text-text-muted flex gap-3">
            <span>
              Signed off:{" "}
              <span className="text-text-primary font-medium">
                {track1.signed_off_count}/{track1.total}
              </span>
            </span>
            {track1.overdue_count > 0 && (
              <span className="text-red-700 font-medium">
                Overdue: {track1.overdue_count}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Track2Header({
  paused,
  className,
}: {
  paused: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-white border border-beroe-card-border rounded-card p-4",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-text-muted mb-1.5">
            Track 2 · Expand pipeline
          </div>
          <div className="text-[12px] text-text-secondary">
            Value Proof → Expand Ask → New Scope → Close
          </div>
        </div>
        <span
          className={cn(
            "text-[11px] px-2 py-1 rounded-md border font-semibold",
            paused
              ? "bg-amber-50 text-amber-700 border-amber-300"
              : "bg-green-50 text-green-700 border-green-300",
          )}
        >
          {paused ? "⏸ Paused" : "▶ Active"}
        </span>
      </div>
    </div>
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
            className={cn(
              "flex items-start gap-3 p-2 rounded-md border text-[12px]",
              open
                ? "bg-red-50/40 border-red-200"
                : "bg-slate-50 border-slate-200",
            )}
          >
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wider",
                    open
                      ? "bg-red-100 text-red-700"
                      : "bg-slate-200 text-slate-700",
                  )}
                >
                  {open ? "OPEN" : "RESOLVED"}
                </span>
                <span className="font-medium text-text-primary">
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
                className="text-[11px] px-2 py-0.5 rounded border border-beroe-card-border bg-white hover:bg-beroe-bg/60"
              >
                Resolve
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const tone =
    score === 3
      ? "bg-green-50 text-green-700 border-green-300"
      : score >= 1
        ? "bg-amber-50 text-amber-700 border-amber-300"
        : "bg-slate-50 text-slate-700 border-slate-300";
  return (
    <span
      className={cn(
        "text-[11px] px-2 py-0.5 rounded-md border font-semibold",
        tone,
      )}
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
            className="border border-beroe-card-border rounded-md p-2.5"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[12px] font-semibold text-text-primary">
                  {q.label}
                </div>
                <div className="text-[11px] text-text-muted">{q.hint}</div>
              </div>
              <div className="flex gap-1">
                {(["yes", "no", "unknown"] as ReadinessAnswerValue[]).map((opt) => (
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
                      "text-[10px] px-2 py-0.5 rounded-md border uppercase tracking-wider font-semibold",
                      a.answer === opt
                        ? opt === "yes"
                          ? "bg-green-50 text-green-700 border-green-300"
                          : opt === "no"
                            ? "bg-red-50 text-red-700 border-red-300"
                            : "bg-slate-100 text-slate-700 border-slate-300"
                        : "bg-white text-text-muted border-beroe-card-border",
                      !editable && "cursor-default",
                    )}
                  >
                    {opt}
                  </button>
                ))}
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
              className="w-full mt-2 text-[12px] border border-beroe-card-border rounded-md px-2 py-1 disabled:bg-beroe-bg/40"
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

function VddSummaryCard({ accountId }: { accountId: string }) {
  type ValueRow = {
    initiative_name?: string;
    identified_musd?: number | null;
    committed_musd?: number | null;
    implemented_musd?: number | null;
  };
  type Vdd = {
    value_delivered?: ValueRow[];
    client_strategic_priorities?: unknown[];
    locked_at: string | null;
    exec_summary?: string | null;
  };
  const { data, isLoading } = useQuery<Vdd>({
    queryKey: ["vdd", accountId],
    queryFn: () =>
      api.get<Vdd>(`/api/v1/accounts/${accountId}/value-delivery-document`),
  });
  const rows: ValueRow[] = data?.value_delivered ?? [];
  const sum = (k: keyof ValueRow) =>
    rows.reduce((acc, r) => {
      const v = Number(r[k]);
      return acc + (Number.isFinite(v) ? v : 0);
    }, 0);
  const ident = sum("identified_musd");
  const comm = sum("committed_musd");
  const impl = sum("implemented_musd");
  const fmt = (n: number) => `$${n.toFixed(2)}M`;
  return (
    <Card>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div>
          <div className="text-[13px] font-bold">📄 Value Delivery Document</div>
          <div className="text-[11px] text-text-muted mt-0.5">
            Evidence of delivered value for the renewal conversation.
          </div>
        </div>
        <a
          href={`/accounts/${accountId}/success-management/vdd`}
          className="text-[11px] text-beroe-blue font-semibold hover:underline"
        >
          → Open / edit VDD
        </a>
      </div>
      {isLoading ? (
        <div className="text-[12px] text-text-muted italic">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-[12px] text-text-muted italic">
          No value-delivered entries on the VDD yet. Open VDD to populate.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-md border bg-slate-50 border-slate-200 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted">
                Identified
              </div>
              <div className="text-[16px] font-extrabold text-slate-900">
                {fmt(ident)}
              </div>
            </div>
            <div className="rounded-md border bg-amber-50 border-amber-200 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider font-bold text-amber-800">
                Committed
              </div>
              <div className="text-[16px] font-extrabold text-amber-900">
                {fmt(comm)}
              </div>
            </div>
            <div className="rounded-md border bg-emerald-50 border-emerald-200 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider font-bold text-emerald-800">
                Implemented
              </div>
              <div className="text-[16px] font-extrabold text-emerald-900">
                {fmt(impl)}
              </div>
            </div>
          </div>
          <div className="mt-2 text-[11px] text-text-muted">
            {rows.length} initiative{rows.length === 1 ? "" : "s"} · {" "}
            {(data?.client_strategic_priorities ?? []).length} priorit
            {(data?.client_strategic_priorities ?? []).length === 1 ? "y" : "ies"}
            {data?.locked_at && (
              <>
                {" "}·{" "}
                <span className="text-emerald-700 font-semibold">
                  🔒 Locked {new Date(data.locked_at).toLocaleDateString()}
                </span>
              </>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
