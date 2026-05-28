// M19 — Success Contract card.
//
// 28-May — verbatim port of prototype/beroe_awb_v20.html line 3109-3170
// (bContractAndGoals → Success Contract block) + locked to the Beroe
// brand palette (Sept 2025 brand book).
//
// Two layouts based on lock state:
//   * LOCKED (locked_at != null):
//       Green-tinted summary card (3 compact tiles) — Metric ·
//       Measurement · Value Narrative — with a 🔒 "Locked" header
//       and (admin-only) Unlock button on the right.
//       Brand colour: Risk Green #6EC457 (was prototype #40CC8F).
//
//   * DRAFT (locked_at == null):
//       Dashed-border card with 3 columns — Lock 1 / Lock 2 / Lock 3.
//       Centered "🔒 Lock Success Contract" CTA at the bottom.
//       Brand colour: Risk Amber #F0BC41 for lock labels + dashed
//       border (was prototype #EF9637).
//
// On top of either layout, an amber "📋 Draft pre-filled from Sales
// handoff" banner shows when auto_drafted is true and the contract
// isn't locked yet — verbatim from prototype line 3111-3114.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  locksState,
  MEASURE_FREQS,
  METRIC_UNITS,
  type SuccessContract,
  type SuccessContractUpdate,
} from "@/types/success_contract";

// Beroe brand palette (Sept 2025 brand book).
const RISK_GREEN = "#6EC457";
const RISK_AMBER = "#F0BC41";
const INDIGO = "#4A00F8";
const MIDNIGHT = "#001137";

interface Props {
  accountId: string;
  /** Whether the current user has admin role (controls Unlock button). */
  isAdmin?: boolean;
}

export function SuccessContractCard({ accountId, isAdmin = false }: Props) {
  const qc = useQueryClient();

  const queryKey = ["success-contract", accountId];
  const { data, isLoading, isError } = useQuery<SuccessContract>({
    queryKey,
    queryFn: () =>
      api.get<SuccessContract>(`/api/v1/accounts/${accountId}/success-contract`),
  });

  const [form, setForm] = useState<SuccessContract | null>(null);
  const [savingError, setSavingError] = useState<string | null>(null);

  useEffect(() => {
    if (data && !form) setForm(data);
  }, [data, form]);

  const dirty = useMemo(() => {
    if (!form || !data) return false;
    const editable = (
      ["metric1", "metric1_unit", "metric2", "measure_source", "measure_freq",
        "measure_owner", "value_narrative"] as const
    );
    return editable.some((k) => (form[k] ?? "") !== (data[k] ?? ""));
  }, [form, data]);

  const saveMutation = useMutation({
    mutationFn: (body: SuccessContractUpdate) =>
      api.patch<SuccessContract>(
        `/api/v1/accounts/${accountId}/success-contract`,
        body,
      ),
    onSuccess: (saved) => {
      qc.setQueryData(queryKey, saved);
      setForm(saved);
      setSavingError(null);
    },
    onError: (e: ApiError) => setSavingError(e.message),
  });

  const lockMutation = useMutation({
    mutationFn: () =>
      api.post<SuccessContract>(
        `/api/v1/accounts/${accountId}/success-contract/lock`,
      ),
    onSuccess: (saved) => {
      qc.setQueryData(queryKey, saved);
      setForm(saved);
      setSavingError(null);
    },
    onError: (e: ApiError) => setSavingError(e.message),
  });

  const unlockMutation = useMutation({
    mutationFn: () =>
      api.post<SuccessContract>(
        `/api/v1/accounts/${accountId}/success-contract/unlock`,
      ),
    onSuccess: (saved) => {
      qc.setQueryData(queryKey, saved);
      setForm(saved);
      setSavingError(null);
    },
    onError: (e: ApiError) => setSavingError(e.message),
  });

  if (isLoading || !form) {
    return (
      <div className="bg-white border border-beroe-card-border rounded-card p-5">
        <div className="text-text-muted text-sm">Loading Success Contract…</div>
      </div>
    );
  }
  if (isError) {
    return (
      <div className="bg-white border border-beroe-card-border rounded-card p-5">
        <div className="text-red-700 text-sm">Could not load Success Contract.</div>
      </div>
    );
  }

  const locked = !!form.locked_at;
  const editable = form.is_editable && !locked;
  const locks = locksState(form);

  const update = <K extends keyof SuccessContract>(k: K, v: SuccessContract[K]) => {
    setForm((prev) => (prev ? { ...prev, [k]: v } : prev));
  };

  const saveChanges = () => {
    const payload: SuccessContractUpdate = {
      metric1: form.metric1,
      metric1_unit: form.metric1_unit,
      metric2: form.metric2,
      measure_source: form.measure_source,
      measure_freq: form.measure_freq,
      measure_owner: form.measure_owner,
      value_narrative: form.value_narrative,
    };
    saveMutation.mutate(payload);
  };

  return (
    <div>
      {/* Auto-draft banner — prototype line 3111-3114 */}
      {data?.auto_drafted && !locked && (
        <div
          className="rounded-card px-4 py-2.5 mb-3 flex items-center gap-2"
          style={{
            background: `${RISK_AMBER}15`,
            border: `1.5px solid ${RISK_AMBER}40`,
          }}
        >
          <span className="text-[14px]">📋</span>
          <span
            className="text-[12px] font-semibold"
            style={{ color: "#854F0B" }}
          >
            Draft pre-filled from Sales handoff — review and lock to activate
            this account.
          </span>
        </div>
      )}

      {locked ? (
        <LockedSummary
          form={form}
          isAdmin={isAdmin}
          unlocking={unlockMutation.isPending}
          onUnlock={() => unlockMutation.mutate()}
        />
      ) : (
        <DraftEditor
          form={form}
          editable={editable}
          locks={locks}
          dirty={dirty}
          saving={saveMutation.isPending}
          locking={lockMutation.isPending}
          onUpdate={update}
          onSave={saveChanges}
          onLock={() => lockMutation.mutate()}
        />
      )}

      {savingError && (
        <div
          className="mt-3 text-[12px] rounded-lg px-3 py-2"
          style={{
            color: "#CF4548",
            background: "#CF454810",
            border: "1px solid #CF454830",
          }}
        >
          {savingError}
        </div>
      )}
    </div>
  );
}

// ============================================================
// LOCKED — green summary card (prototype line 3117-3138)
// ============================================================

function LockedSummary({
  form,
  isAdmin,
  unlocking,
  onUnlock,
}: {
  form: SuccessContract;
  isAdmin: boolean;
  unlocking: boolean;
  onUnlock: () => void;
}) {
  return (
    <div
      className="rounded-card px-4 py-3.5"
      style={{
        background: "#f0fdf4",
        border: `1.5px solid ${RISK_GREEN}40`,
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-[14px]">🔒</span>
          <span
            className="text-[14px] font-bold"
            style={{ color: RISK_GREEN }}
          >
            Success Contract Locked
          </span>
          <span className="text-[10px] text-text-muted">
            {form.locked_at
              ? new Date(form.locked_at).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })
              : "—"}
            {form.locked_by ? ` by ${form.locked_by}` : ""}
          </span>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={onUnlock}
            disabled={unlocking}
            className="text-[11px] px-2.5 py-1 rounded-md font-semibold disabled:opacity-50"
            style={{
              background: "#fff",
              border: "1px solid #e4eaf6",
              color: MIDNIGHT,
            }}
          >
            {unlocking ? "Unlocking…" : "Unlock"}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
        <LockedTile label="Metric">
          <div className="text-[12px] font-semibold" style={{ color: MIDNIGHT }}>
            {form.metric1 ?? "—"}{" "}
            {form.metric1_unit && (
              <span className="text-text-muted font-normal">
                ({form.metric1_unit})
              </span>
            )}
          </div>
          {form.metric2 && (
            <div className="text-[11px] text-text-muted mt-0.5">
              {form.metric2}
            </div>
          )}
        </LockedTile>

        <LockedTile label="Measurement">
          <div className="text-[12px]" style={{ color: MIDNIGHT }}>
            {form.measure_source ?? "—"}
          </div>
          <div className="text-[10px] text-text-muted mt-0.5">
            {form.measure_freq ?? ""}
            {form.measure_freq && form.measure_owner ? " · " : ""}
            {form.measure_owner ?? ""}
          </div>
        </LockedTile>

        <LockedTile label="Value Narrative">
          <div
            className="text-[11px] italic leading-snug"
            style={{ color: "#7a3800" }}
          >
            &ldquo;
            {(form.value_narrative ?? "").slice(0, 120)}
            {(form.value_narrative ?? "").length > 120 ? "…" : ""}
            &rdquo;
          </div>
        </LockedTile>
      </div>
    </div>
  );
}

function LockedTile({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-lg px-3 py-2.5"
      style={{ background: "#fff", border: "1px solid #e8eef8" }}
    >
      <div
        className="text-[9px] font-bold uppercase mb-1"
        style={{ color: RISK_GREEN, letterSpacing: "0.06em" }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

// ============================================================
// DRAFT — 3-column dashed-amber editor (prototype line 3140-3169)
// ============================================================

function DraftEditor({
  form,
  editable,
  locks,
  dirty,
  saving,
  locking,
  onUpdate,
  onSave,
  onLock,
}: {
  form: SuccessContract;
  editable: boolean;
  locks: { lock1: boolean; lock2: boolean; lock3: boolean; allLocked: boolean };
  dirty: boolean;
  saving: boolean;
  locking: boolean;
  onUpdate: <K extends keyof SuccessContract>(k: K, v: SuccessContract[K]) => void;
  onSave: () => void;
  onLock: () => void;
}) {
  return (
    <div
      className="bg-white rounded-card p-4"
      style={{ border: `2px dashed ${RISK_AMBER}40` }}
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[14px]">🔒</span>
        <h3 className="text-[14px] font-bold" style={{ color: MIDNIGHT }}>
          Define Success Contract
        </h3>
        <LockPipsTracker locks={locks} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <Lock n={1} title="Success Metric" ok={locks.lock1} editable={editable}>
          <input
            type="text"
            className={inputCls(editable)}
            value={form.metric1 ?? ""}
            placeholder="e.g. $2M savings delivered"
            onChange={(e) => onUpdate("metric1", e.target.value || null)}
            disabled={!editable}
          />
          <select
            className={cn(inputCls(editable), "mt-1.5")}
            value={form.metric1_unit ?? ""}
            onChange={(e) => onUpdate("metric1_unit", e.target.value || null)}
            disabled={!editable}
          >
            <option value="">Unit —</option>
            {METRIC_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
          <input
            type="text"
            className={cn(inputCls(editable), "mt-1.5")}
            value={form.metric2 ?? ""}
            placeholder="Secondary metric (optional)"
            onChange={(e) => onUpdate("metric2", e.target.value || null)}
            disabled={!editable}
          />
        </Lock>

        <Lock n={2} title="Measurement" ok={locks.lock2} editable={editable}>
          <input
            type="text"
            className={inputCls(editable)}
            value={form.measure_source ?? ""}
            placeholder="Data source"
            onChange={(e) => onUpdate("measure_source", e.target.value || null)}
            disabled={!editable}
          />
          <select
            className={cn(inputCls(editable), "mt-1.5")}
            value={form.measure_freq ?? ""}
            onChange={(e) =>
              onUpdate(
                "measure_freq",
                (e.target.value || null) as SuccessContract["measure_freq"],
              )
            }
            disabled={!editable}
          >
            <option value="">Frequency —</option>
            {MEASURE_FREQS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <input
            type="text"
            className={cn(inputCls(editable), "mt-1.5")}
            value={form.measure_owner ?? ""}
            placeholder="Owner (stakeholder)"
            onChange={(e) => onUpdate("measure_owner", e.target.value || null)}
            disabled={!editable}
          />
        </Lock>

        <Lock
          n={3}
          title="Value Narrative"
          ok={locks.lock3}
          editable={editable}
          hint={
            !locks.lock3 && (form.value_narrative?.length ?? 0) > 0
              ? `Need ≥10 chars — currently ${form.value_narrative?.length ?? 0}`
              : undefined
          }
        >
          <textarea
            className={cn(inputCls(editable), "min-h-[100px] resize-y leading-relaxed")}
            value={form.value_narrative ?? ""}
            placeholder="We help [client] achieve [outcome] by [approach], delivering [value]."
            onChange={(e) => onUpdate("value_narrative", e.target.value || null)}
            disabled={!editable}
            style={
              editable
                ? {
                    background: `${RISK_AMBER}10`,
                    borderColor: `${RISK_AMBER}40`,
                  }
                : undefined
            }
          />
        </Lock>
      </div>

      <div className="flex items-center gap-3 pt-3 border-t border-beroe-card-border">
        <div className="flex-1 text-[11px] text-text-muted">
          {locks.allLocked
            ? "All three locks satisfied — ready to lock the contract."
            : "Complete all three locks to enable the Lock button."}
        </div>
        <button
          type="button"
          onClick={onSave}
          disabled={!editable || !dirty || saving}
          className="text-[12px] px-3 py-1.5 rounded-md font-semibold disabled:opacity-40"
          style={{
            background: "#fff",
            border: "1px solid #e4eaf6",
            color: MIDNIGHT,
          }}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={onLock}
          disabled={!editable || !locks.allLocked || dirty || locking}
          className="text-[12px] px-4 py-1.5 rounded-md font-bold text-white disabled:opacity-40"
          style={{
            background: locks.allLocked && !dirty ? INDIGO : `${INDIGO}80`,
          }}
          title={
            dirty
              ? "Save your edits first"
              : !locks.allLocked
                ? "Complete all three locks first"
                : undefined
          }
        >
          {locking ? "Locking…" : "🔒 Lock Success Contract"}
        </button>
      </div>
    </div>
  );
}

function Lock({
  n,
  title,
  ok,
  editable,
  hint,
  children,
}: {
  n: number;
  title: string;
  ok: boolean;
  editable: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="rounded-lg p-3"
      style={{
        background: ok ? `${RISK_GREEN}10` : `${RISK_AMBER}08`,
        border: `1.5px solid ${ok ? `${RISK_GREEN}40` : `${RISK_AMBER}30`}`,
        opacity: editable ? 1 : 0.9,
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold flex-shrink-0 text-white"
          style={{
            background: ok ? RISK_GREEN : "#e4eaf6",
            color: ok ? "#fff" : "#94a3b8",
          }}
        >
          {ok ? "✓" : n}
        </span>
        <div
          className="text-[11px] font-bold uppercase"
          style={{
            color: ok ? RISK_GREEN : RISK_AMBER,
            letterSpacing: "0.05em",
          }}
        >
          Lock {n} — {title}
        </div>
      </div>
      <div className="flex flex-col gap-0">{children}</div>
      {hint && (
        <div
          className="text-[10px] mt-1.5"
          style={{ color: "#854F0B" }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

function LockPipsTracker({
  locks,
}: {
  locks: { lock1: boolean; lock2: boolean; lock3: boolean };
}) {
  return (
    <div className="flex items-center gap-1 ml-auto">
      {[locks.lock1, locks.lock2, locks.lock3].map((ok, i) => (
        <span
          key={i}
          className="w-2.5 h-2.5 rounded-full transition-colors"
          style={{ background: ok ? RISK_GREEN : "#e4eaf6" }}
          title={`Lock ${i + 1} ${ok ? "satisfied" : "incomplete"}`}
        />
      ))}
    </div>
  );
}

function inputCls(editable: boolean): string {
  return cn(
    "w-full px-2 py-1.5 rounded-md border text-[12px] placeholder:text-text-muted",
    editable
      ? "bg-white border-beroe-card-border focus:border-beroe-blue focus:outline-none focus:ring-1 focus:ring-beroe-blue/20"
      : "border-beroe-card-border/60 bg-beroe-bg/30 cursor-not-allowed text-text-secondary",
  );
}
