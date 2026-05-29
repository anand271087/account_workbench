// M27 — Growth & Pipeline · Signals & Activity sub-tab.
//
// Faithful port of the prototype's bStrategyEngage(): two side-by-side
// cards.
//   * Soft Signals  — list with type pill + impact + resolve/hide/delete
//   * Activity Feed — list with type icon + edit/delete
// + Add Signal modal and Log Activity modal.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/components/AuthProvider";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAccountFromLayout } from "../../AccountProfileLayout";
import {
  ACT_CONF,
  ACTIVITY_TYPES,
  IMPACT_LABELS,
  SIG_CONF,
  SIGNAL_IMPACTS,
  SIGNAL_TYPES,
  type Activity,
  type ActivityCreate,
  type ActivityListResponse,
  type ActivityType,
  type SignalImpact,
  type SoftSignal,
  type SoftSignalCreate,
  type SoftSignalListResponse,
} from "@/types/signal";

export default function SignalsActivityTab() {
  const account = useAccountFromLayout();

  return (
    <div className="grid grid-cols-2 gap-3">
      <SignalsCard accountId={account.id} />
      <ActivityCard accountId={account.id} />
    </div>
  );
}

// ============================================================
// Signals card
// ============================================================

function SignalsCard({ accountId }: { accountId: string }) {
  const { me } = useAuth();
  const isAdmin = !!me?.permissions?.is_global_admin;
  const qc = useQueryClient();
  const key = ["signals", accountId];
  const { data } = useQuery<SoftSignalListResponse>({
    queryKey: key,
    queryFn: () =>
      api.get<SoftSignalListResponse>(`/api/v1/accounts/${accountId}/signals`),
  });
  const [showAdd, setShowAdd] = useState(false);

  const editable = data?.is_editable ?? false;
  // Active first, then resolved.
  const sorted = (data?.items ?? []).slice().sort((a, b) => {
    if (a.status !== b.status) return a.status === "active" ? -1 : 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <div
          className="text-[14px] font-bold"
          title="Early indicators of account risk or opportunity — drive the Signal Mix component of the Appetite Score (25% weight)"
        >
          📡 Soft Signals
        </div>
        {editable && (
          <button
            onClick={() => setShowAdd(true)}
            className="text-[11px] px-2.5 py-1 rounded-md border border-beroe-card-border bg-white hover:bg-beroe-bg/60 font-semibold"
          >
            + Add
          </button>
        )}
      </div>
      {sorted.length === 0 ? (
        <div className="text-center py-5 text-text-muted text-[12px]">
          No active signals
        </div>
      ) : (
        <div className="space-y-1.5">
          {sorted.map((s) => (
            <SignalRow
              key={s.id}
              sig={s}
              editable={editable}
              isAdmin={isAdmin}
              onChange={() => qc.invalidateQueries({ queryKey: key })}
              onAppetiteChange={() =>
                qc.invalidateQueries({ queryKey: ["appetite", accountId] })
              }
            />
          ))}
        </div>
      )}
      {showAdd && (
        <AddSignalModal
          accountId={accountId}
          onClose={() => setShowAdd(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: key });
            qc.invalidateQueries({ queryKey: ["appetite", accountId] });
            setShowAdd(false);
          }}
        />
      )}
    </Card>
  );
}

function SignalRow({
  sig,
  editable,
  isAdmin,
  onChange,
  onAppetiteChange,
}: {
  sig: SoftSignal;
  editable: boolean;
  isAdmin: boolean;
  onChange: () => void;
  onAppetiteChange: () => void;
}) {
  const conf = SIG_CONF[sig.type];
  const [showResolveModal, setShowResolveModal] = useState(false);
  const hide = useMutation({
    mutationFn: () =>
      api.patch(`/api/v1/signals/${sig.id}`, { hidden: true }),
    onSuccess: () => {
      onChange();
      onAppetiteChange();
    },
  });
  const del = useMutation({
    mutationFn: () => api.delete(`/api/v1/signals/${sig.id}`),
    onSuccess: () => {
      onChange();
      onAppetiteChange();
    },
  });
  const reopen = useMutation({
    mutationFn: () => api.post(`/api/v1/signals/${sig.id}/reopen`),
    onSuccess: () => {
      onChange();
      onAppetiteChange();
    },
  });
  const isResolved = sig.status === "resolved";

  return (
    <>
      <div
        className={cn(
          "flex items-start gap-2.5 p-2 rounded-md border",
          isResolved
            ? "bg-beroe-bg border-beroe-card-border opacity-80"
            : "border-beroe-card-border bg-white",
        )}
      >
        <div
          className="w-2 h-2 rounded-full mt-1.5 flex-shrink-0"
          style={{ background: conf.dot }}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[12px] font-bold">{sig.signal}</span>
            <span
              className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ background: conf.bg, color: conf.col }}
            >
              {conf.label}
            </span>
            <span className="text-[9px] text-text-muted">
              · {IMPACT_LABELS[sig.impact]}
            </span>
            {isResolved && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-beroe-bg text-text-secondary uppercase tracking-wider font-semibold">
                Resolved
              </span>
            )}
          </div>
          {sig.description && (
            <div className="text-[11px] text-text-secondary mt-0.5 leading-snug">
              {sig.description}
            </div>
          )}
          <div className="text-[10px] text-text-muted mt-0.5">
            {new Date(sig.created_at).toLocaleDateString()}
            {sig.category && <> · {sig.category}</>}
          </div>
          {isResolved && sig.resolved_note && (
            <div className="text-[10px] text-beroe-green mt-1 bg-beroe-green/15 border border-beroe-green/30 rounded px-2 py-1">
              <b>Resolution:</b> {sig.resolved_note}
            </div>
          )}
        </div>
        {editable && (
          <div className="flex flex-col gap-1 flex-shrink-0">
            {!isResolved && (
              <button
                onClick={() => setShowResolveModal(true)}
                className="text-[10px] px-1.5 py-0.5 rounded border border-beroe-green/30 text-beroe-green hover:bg-beroe-green/15"
                title="Mark resolved (requires note)"
              >
                ✅ Resolve
              </button>
            )}
            {isResolved && isAdmin && (
              <button
                onClick={() => reopen.mutate()}
                className="text-[10px] px-1.5 py-0.5 rounded border border-beroe-card-border text-text-muted hover:bg-beroe-bg/60"
                title="Re-open (admin only)"
              >
                ↩ Reopen
              </button>
            )}
            <button
              onClick={() => {
                if (confirm("Hide this signal? It can be brought back by Admin from the DB.")) hide.mutate();
              }}
              className="text-[10px] px-1.5 py-0.5 rounded border border-beroe-card-border text-text-muted hover:bg-beroe-bg/60"
            >
              👁️ Hide
            </button>
            {isAdmin && (
              <button
                onClick={() => {
                  if (confirm(`Hard-delete "${sig.signal}"? This is irreversible.`))
                    del.mutate();
                }}
                className="text-[10px] px-1.5 py-0.5 rounded border border-beroe-red/30 text-beroe-red hover:bg-beroe-red/10"
              >
                ✕ Delete
              </button>
            )}
          </div>
        )}
      </div>
      {showResolveModal && (
        <ResolveSignalModal
          sig={sig}
          onClose={() => setShowResolveModal(false)}
          onSaved={() => {
            setShowResolveModal(false);
            onChange();
            onAppetiteChange();
          }}
        />
      )}
    </>
  );
}

function ResolveSignalModal({
  sig,
  onClose,
  onSaved,
}: {
  sig: SoftSignal;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () =>
      api.post(`/api/v1/signals/${sig.id}/resolve`, { resolved_note: note }),
    onSuccess: () => onSaved(),
    onError: (e: ApiError) => setErr(e.message),
  });
  return (
    <ModalShell onClose={onClose} title={`Resolve: ${sig.signal}`}>
      <div className="text-[11px] text-text-muted mb-2">
        Add a short note (≥5 chars) describing the resolution. This sticks to
        the audit trail.
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={4}
        placeholder="e.g. IT configured SSO on 14 Nov; 32 users now active"
        className="w-full text-[12px] border border-beroe-card-border rounded-md px-2 py-1.5"
      />
      {err && <div className="text-[11px] text-beroe-red mt-2">{err}</div>}
      <div className="flex justify-end gap-2 mt-3">
        <button
          onClick={onClose}
          className="text-[11px] px-3 py-1.5 rounded-md border border-beroe-card-border hover:bg-beroe-bg/60"
        >
          Cancel
        </button>
        <button
          onClick={() => m.mutate()}
          disabled={m.isPending || note.trim().length < 5}
          className="text-[11px] px-3 py-1.5 rounded-md bg-beroe-green text-white font-semibold disabled:opacity-50"
        >
          Mark resolved
        </button>
      </div>
    </ModalShell>
  );
}

function AddSignalModal({
  accountId,
  onClose,
  onSaved,
}: {
  accountId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<SoftSignalCreate>({
    type: "neutral",
    signal: "",
    description: "",
    impact: "medium",
    category: "",
    occurred_at: new Date().toISOString().slice(0, 10),
  });
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: (body: SoftSignalCreate) =>
      api.post(`/api/v1/accounts/${accountId}/signals`, body),
    onSuccess: () => onSaved(),
    onError: (e: ApiError) => setErr(e.message),
  });
  return (
    <ModalShell onClose={onClose} title="Add soft signal">
      <div className="space-y-2.5">
        <FormRow label="Type">
          <div className="flex gap-1 flex-wrap">
            {SIGNAL_TYPES.map((t) => {
              const c = SIG_CONF[t];
              const on = form.type === t;
              return (
                <button
                  key={t}
                  onClick={() => setForm({ ...form, type: t })}
                  className={cn(
                    "text-[11px] px-2 py-1 rounded-md border-[1.5px]",
                    on ? "" : "bg-white border-beroe-card-border text-text-muted",
                  )}
                  style={on ? { background: c.bg, color: c.col, borderColor: c.col + "60" } : {}}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        </FormRow>
        <FormRow label="Signal">
          <input
            value={form.signal}
            onChange={(e) => setForm({ ...form, signal: e.target.value })}
            placeholder="e.g. Phase 2 budget confirmed"
            className="w-full text-[12px] border border-beroe-card-border rounded-md px-2 py-1.5"
          />
        </FormRow>
        <FormRow label="Description">
          <textarea
            value={form.description ?? ""}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={2}
            placeholder="One-line context — who said what, when"
            className="w-full text-[12px] border border-beroe-card-border rounded-md px-2 py-1.5"
          />
        </FormRow>
        <div className="grid grid-cols-2 gap-2">
          <FormRow label="Impact">
            <select
              value={form.impact ?? "medium"}
              onChange={(e) =>
                setForm({ ...form, impact: e.target.value as SignalImpact })
              }
              className="w-full text-[12px] border border-beroe-card-border rounded-md px-2 py-1.5"
            >
              {SIGNAL_IMPACTS.map((i) => (
                <option key={i} value={i}>
                  {IMPACT_LABELS[i]}
                </option>
              ))}
            </select>
          </FormRow>
          <FormRow label="Date noticed">
            <input
              type="date"
              value={form.occurred_at ?? ""}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) =>
                setForm({ ...form, occurred_at: e.target.value || null })
              }
              className="w-full text-[12px] border border-beroe-card-border rounded-md px-2 py-1.5"
            />
          </FormRow>
        </div>
        <FormRow label="Category (optional)">
          <input
            value={form.category ?? ""}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            placeholder="commercial / product / strategic / relationship"
            className="w-full text-[12px] border border-beroe-card-border rounded-md px-2 py-1.5"
          />
        </FormRow>
        {err && <div className="text-[11px] text-beroe-red">{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="text-[11px] px-3 py-1.5 rounded-md border border-beroe-card-border hover:bg-beroe-bg/60"
          >
            Cancel
          </button>
          <button
            onClick={() => m.mutate(form)}
            disabled={m.isPending || !form.signal.trim()}
            className="text-[11px] px-3 py-1.5 rounded-md bg-beroe-navy text-white font-semibold disabled:opacity-50"
          >
            Add signal
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ============================================================
// Activity card
// ============================================================

function ActivityCard({ accountId }: { accountId: string }) {
  const qc = useQueryClient();
  const key = ["activities", accountId];
  const { data } = useQuery<ActivityListResponse>({
    queryKey: key,
    queryFn: () =>
      api.get<ActivityListResponse>(`/api/v1/accounts/${accountId}/activities`),
  });
  const [showLog, setShowLog] = useState(false);

  const editable = data?.is_editable ?? false;

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <div className="text-[14px] font-bold">💬 Activity Feed</div>
        {editable && (
          <button
            onClick={() => setShowLog(true)}
            className="text-[11px] px-2.5 py-1 rounded-md border border-beroe-card-border bg-white hover:bg-beroe-bg/60 font-semibold"
          >
            + Log
          </button>
        )}
      </div>
      {(!data || data.items.length === 0) ? (
        <div className="text-center py-5 text-text-muted text-[12px]">
          No activity logged
        </div>
      ) : (
        <div>
          {data.items.map((a) => (
            <ActivityRow
              key={a.id}
              act={a}
              editable={editable}
              onChange={() => qc.invalidateQueries({ queryKey: key })}
            />
          ))}
        </div>
      )}
      {showLog && (
        <LogActivityModal
          accountId={accountId}
          onClose={() => setShowLog(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: key });
            setShowLog(false);
          }}
        />
      )}
    </Card>
  );
}

function ActivityRow({
  act,
  editable,
  onChange,
}: {
  act: Activity;
  editable: boolean;
  onChange: () => void;
}) {
  const conf = ACT_CONF[act.type];
  const del = useMutation({
    mutationFn: () => api.delete(`/api/v1/activities/${act.id}`),
    onSuccess: () => onChange(),
  });
  return (
    <div className="flex gap-2.5 py-2.5 border-b border-beroe-card-border/60 last:border-b-0">
      <div
        className="w-7 h-7 rounded-md flex items-center justify-center text-[14px] flex-shrink-0"
        style={{ background: conf.bg, color: conf.col, border: `1px solid ${conf.col}30` }}
      >
        {conf.ic}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-semibold">{act.title}</div>
        <div className="text-[10px] text-text-muted">
          {conf.label} · {new Date(act.created_at).toLocaleDateString()}
        </div>
        {act.summary && (
          <div className="text-[11px] text-text-secondary mt-1 leading-snug">
            {act.summary}
          </div>
        )}
        {act.attendees && (
          <div className="text-[10px] text-text-muted mt-0.5">
            <b>Attendees:</b> {act.attendees}
          </div>
        )}
      </div>
      {editable && (
        <div className="flex gap-1 flex-shrink-0">
          <button
            onClick={() => {
              if (confirm(`Delete activity "${act.title}"?`)) del.mutate();
            }}
            className="text-[10px] text-text-muted hover:text-beroe-red px-1"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

function LogActivityModal({
  accountId,
  onClose,
  onSaved,
}: {
  accountId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<ActivityCreate>({
    type: "csm_call",
    title: "",
    summary: "",
    items: "",
    attendees: "",
    occurred_at: new Date().toISOString().slice(0, 10),
    linked_metrics: [],
  });
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: (body: ActivityCreate) =>
      api.post(`/api/v1/accounts/${accountId}/activities`, body),
    onSuccess: () => onSaved(),
    onError: (e: ApiError) => setErr(e.message),
  });
  return (
    <ModalShell onClose={onClose} title="Log activity">
      <div className="space-y-2.5">
        <FormRow label="Type">
          <div className="flex gap-1 flex-wrap">
            {ACTIVITY_TYPES.map((t) => {
              const c = ACT_CONF[t];
              const on = form.type === t;
              return (
                <button
                  key={t}
                  onClick={() => setForm({ ...form, type: t })}
                  className={cn(
                    "text-[11px] px-2 py-1 rounded-md border-[1.5px]",
                    on ? "" : "bg-white border-beroe-card-border text-text-muted",
                  )}
                  style={on ? { background: c.bg, color: c.col, borderColor: c.col + "60" } : {}}
                >
                  {c.ic} {c.label}
                </button>
              );
            })}
          </div>
        </FormRow>
        <div className="grid grid-cols-2 gap-2">
          <FormRow label="Title">
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="e.g. Weekly check-in with Jordan"
              className="w-full text-[12px] border border-beroe-card-border rounded-md px-2 py-1.5"
            />
          </FormRow>
          <FormRow label="Date">
            <input
              type="date"
              value={form.occurred_at ?? ""}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) =>
                setForm({ ...form, occurred_at: e.target.value || null })
              }
              className="w-full text-[12px] border border-beroe-card-border rounded-md px-2 py-1.5"
            />
          </FormRow>
        </div>
        <FormRow label="Summary">
          <textarea
            value={form.summary ?? ""}
            onChange={(e) => setForm({ ...form, summary: e.target.value })}
            rows={3}
            placeholder="Key points discussed"
            className="w-full text-[12px] border border-beroe-card-border rounded-md px-2 py-1.5"
          />
        </FormRow>
        <FormRow label="Attendees (optional)">
          <input
            value={form.attendees ?? ""}
            onChange={(e) => setForm({ ...form, attendees: e.target.value })}
            placeholder="Jordan Mills, Tanya Sarna"
            className="w-full text-[12px] border border-beroe-card-border rounded-md px-2 py-1.5"
          />
        </FormRow>
        <FormRow label="Items / action items (optional)">
          <textarea
            value={form.items ?? ""}
            onChange={(e) => setForm({ ...form, items: e.target.value })}
            rows={2}
            placeholder="• action 1\n• action 2"
            className="w-full text-[12px] border border-beroe-card-border rounded-md px-2 py-1.5"
          />
        </FormRow>
        {/* Row 57 — link the activity to one or more Success Metrics. */}
        <FormRow label="Link to metrics (optional)">
          <LinkedMetricsPicker
            accountId={accountId}
            value={form.linked_metrics ?? []}
            onChange={(ids) => setForm({ ...form, linked_metrics: ids })}
          />
        </FormRow>
        {err && <div className="text-[11px] text-beroe-red">{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="text-[11px] px-3 py-1.5 rounded-md border border-beroe-card-border hover:bg-beroe-bg/60"
          >
            Cancel
          </button>
          <button
            onClick={() => m.mutate(form)}
            disabled={m.isPending || !form.title.trim()}
            className="text-[11px] px-3 py-1.5 rounded-md bg-beroe-navy text-white font-semibold disabled:opacity-50"
          >
            Log activity
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ============================================================
// Shared primitives
// ============================================================

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white border border-beroe-card-border rounded-card p-4">
      {children}
    </div>
  );
}

function FormRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider font-semibold text-text-muted">
        {label}
      </label>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function ModalShell({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center pt-12 pb-8 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl w-[min(560px,95vw)]">
        <div className="px-4 py-3 border-b border-beroe-card-border flex items-center justify-between">
          <div className="text-[14px] font-bold text-text-primary">{title}</div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary text-lg leading-none px-1"
          >
            ✕
          </button>
        </div>
        <div className="px-4 py-3">{children}</div>
      </div>
    </div>
  );
}

// `ActivityType` is only re-exported as a type-import marker so eslint
// doesn't flag the import as unused.
export type { ActivityType };

// ============================================================
// Row 57 — Linked-metrics picker (multi-select)
// ============================================================

function LinkedMetricsPicker({
  accountId,
  value,
  onChange,
}: {
  accountId: string;
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  type MetricRow = { id: string; name: string; status: string };
  const { data, isLoading } = useQuery<{ items: MetricRow[] }>({
    queryKey: ["metrics", accountId],
    queryFn: () =>
      api.get<{ items: MetricRow[] }>(`/api/v1/accounts/${accountId}/metrics`),
  });
  const metrics = data?.items ?? [];
  const selected = new Set(value);
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  };
  if (isLoading) {
    return <div className="text-[11px] text-text-muted italic">Loading metrics…</div>;
  }
  if (metrics.length === 0) {
    return (
      <div className="text-[11px] text-text-muted italic">
        No metrics defined yet. Add some on Value Tracking first.
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {metrics.map((m) => {
        const on = selected.has(m.id);
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => toggle(m.id)}
            className={cn(
              "text-[10px] px-2 py-1 rounded-full border-[1.5px] transition-colors",
              on
                ? "bg-beroe-blue/10 border-beroe-blue text-beroe-blue font-semibold"
                : "bg-white border-beroe-card-border text-text-muted hover:border-beroe-blue/40",
            )}
          >
            {on ? "✓ " : ""}
            {m.name}
          </button>
        );
      })}
    </div>
  );
}
