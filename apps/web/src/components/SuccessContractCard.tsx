// M19 — Success Contract card.
//
// Three-lock structure inside one card. Modes:
//   * In-draft (locked_at == null): show editable form, "Save changes"
//     button + "Lock contract" CTA once all 3 locks are satisfied.
//   * Locked: read-only display + "Unlock" button (admin only — the
//     button is hidden for everyone else; the backend returns 403 if
//     someone tries anyway).
//   * Auto-draft (auto_drafted: true on the response): orange "Pre-filled
//     from Sales Handoff" badge to signal the values are suggestions.

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

  // Dirty = any editable field differs from the server snapshot.
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
    return <Card><div className="text-text-muted text-sm">Loading Success Contract…</div></Card>;
  }
  if (isError) {
    return (
      <Card>
        <div className="text-red-700 text-sm">Could not load Success Contract.</div>
      </Card>
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
    <Card>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-[14px] font-bold text-text-primary">Success Contract</h3>
            {locked ? (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-800">
                🔒 Locked
              </span>
            ) : (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                Draft
              </span>
            )}
            {data?.auto_drafted && !locked && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-800">
                📋 from Sales handoff
              </span>
            )}
          </div>
          <p className="text-[11px] text-text-muted">
            Three locks — all required to lock the contract. Once locked, edits
            require an admin unlock.
          </p>
        </div>
        <LockPipsTracker locks={locks} />
      </div>

      {/* Three fieldsets */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <Lock
          n={1}
          title="Success Metric"
          ok={locks.lock1}
          editable={editable}
        >
          <input
            type="text"
            className={inputCls(editable)}
            value={form.metric1 ?? ""}
            placeholder='e.g. $2M documented savings'
            onChange={(e) => update("metric1", e.target.value || null)}
            disabled={!editable}
          />
          <select
            className={cn("inp mt-1.5", inputCls(editable))}
            value={form.metric1_unit ?? ""}
            onChange={(e) => update("metric1_unit", e.target.value || null)}
            disabled={!editable}
          >
            <option value="">Unit…</option>
            {METRIC_UNITS.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
          <input
            type="text"
            className={cn(inputCls(editable), "mt-1.5")}
            value={form.metric2 ?? ""}
            placeholder="Secondary metric (optional)"
            onChange={(e) => update("metric2", e.target.value || null)}
            disabled={!editable}
          />
        </Lock>

        <Lock
          n={2}
          title="Measurement Method"
          ok={locks.lock2}
          editable={editable}
        >
          <input
            type="text"
            className={inputCls(editable)}
            value={form.measure_source ?? ""}
            placeholder="Data source / proof"
            onChange={(e) => update("measure_source", e.target.value || null)}
            disabled={!editable}
          />
          <select
            className={cn(inputCls(editable), "mt-1.5")}
            value={form.measure_freq ?? ""}
            onChange={(e) => update("measure_freq", (e.target.value || null) as SuccessContract["measure_freq"])}
            disabled={!editable}
          >
            <option value="">Frequency…</option>
            {MEASURE_FREQS.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
          <input
            type="text"
            className={cn(inputCls(editable), "mt-1.5")}
            value={form.measure_owner ?? ""}
            placeholder="Owner (stakeholder name)"
            onChange={(e) => update("measure_owner", e.target.value || null)}
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
            className={cn(inputCls(editable), "min-h-[110px] resize-y leading-relaxed")}
            value={form.value_narrative ?? ""}
            placeholder="We help [client] achieve [outcome] by [approach], delivering [value]."
            onChange={(e) => update("value_narrative", e.target.value || null)}
            disabled={!editable}
          />
        </Lock>
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-2 pt-3 border-t border-beroe-card-border">
        {locked ? (
          <>
            <div className="text-[11px] text-text-secondary flex-1">
              Locked {data?.locked_at ? new Date(data.locked_at).toLocaleString() : ""}
              {isAdmin && " — admins can unlock to edit."}
            </div>
            {isAdmin && (
              <button
                onClick={() => unlockMutation.mutate()}
                disabled={unlockMutation.isPending}
                className="text-[12px] px-3 py-1.5 rounded-lg border border-beroe-card-border text-text-secondary hover:bg-amber-50 disabled:opacity-50"
              >
                {unlockMutation.isPending ? "Unlocking…" : "🔓 Unlock"}
              </button>
            )}
          </>
        ) : (
          <>
            <div className="text-[11px] text-text-muted flex-1">
              {locks.allLocked
                ? "All three locks satisfied — ready to lock the contract."
                : "Complete all three locks to enable the Lock button."}
            </div>
            <button
              onClick={saveChanges}
              disabled={!editable || !dirty || saveMutation.isPending}
              className="text-[12px] px-3 py-1.5 rounded-lg border border-beroe-card-border text-text-secondary hover:bg-beroe-bg/60 disabled:opacity-40"
            >
              {saveMutation.isPending ? "Saving…" : "Save changes"}
            </button>
            <button
              onClick={() => lockMutation.mutate()}
              disabled={!editable || !locks.allLocked || dirty || lockMutation.isPending}
              className="text-[12px] px-3 py-1.5 rounded-lg bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-40 disabled:bg-green-600"
              title={dirty ? "Save your edits first" : !locks.allLocked ? "Complete all three locks first" : undefined}
            >
              {lockMutation.isPending ? "Locking…" : "🔒 Lock contract"}
            </button>
          </>
        )}
      </div>

      {savingError && (
        <div className="mt-3 text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {savingError}
        </div>
      )}
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white border border-beroe-card-border rounded-card p-5">
      {children}
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
      className={cn(
        "rounded-card border-[1.5px] p-3.5 transition-colors",
        ok
          ? "border-green-300/60 bg-green-50/40"
          : "border-beroe-card-border bg-beroe-bg/40",
        !editable && "opacity-90",
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className={cn(
            "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0",
            ok ? "bg-green-600 text-white" : "bg-beroe-card-border text-text-muted",
          )}
        >
          {ok ? "✓" : n}
        </span>
        <div className="text-[11px] font-bold uppercase tracking-wide text-text-secondary">
          Lock {n} — {title}
        </div>
      </div>
      <div className="flex flex-col gap-0">{children}</div>
      {hint && (
        <div className="text-[10px] text-amber-700 mt-1.5">{hint}</div>
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
    <div className="flex items-center gap-1 flex-shrink-0">
      {[locks.lock1, locks.lock2, locks.lock3].map((ok, i) => (
        <span
          key={i}
          className={cn(
            "w-3 h-3 rounded-full transition-colors",
            ok ? "bg-green-500" : "bg-beroe-card-border",
          )}
          title={`Lock ${i + 1} ${ok ? "satisfied" : "incomplete"}`}
        />
      ))}
    </div>
  );
}

function inputCls(editable: boolean): string {
  return cn(
    "w-full px-2 py-1.5 rounded-md border text-[12px] bg-white text-text-primary placeholder:text-text-muted",
    editable
      ? "border-beroe-card-border focus:border-beroe-blue focus:outline-none focus:ring-1 focus:ring-beroe-blue/20"
      : "border-beroe-card-border/60 bg-beroe-bg/30 cursor-not-allowed",
  );
}
