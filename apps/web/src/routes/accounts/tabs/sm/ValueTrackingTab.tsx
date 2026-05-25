// M20 — Value Tracking.
//
// Renders one card per tracked metric with current / target, auto-derived
// status, and the value-log history. Inline "Log value" affordance on
// each card writes a new log entry + bumps current_value.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAccountFromLayout } from "../../AccountProfileLayout";
import {
  STATUS_COLORS,
  STATUS_LABELS,
  type MetricListResponse,
  type MetricStatus,
  type MetricType,
  type SuccessMetric,
} from "@/types/metric";

export default function ValueTrackingTab() {
  const account = useAccountFromLayout();
  const qc = useQueryClient();
  const queryKey = ["metrics", account.id];

  const { data, isLoading } = useQuery<MetricListResponse>({
    queryKey,
    queryFn: () =>
      api.get<MetricListResponse>(`/api/v1/accounts/${account.id}/metrics`),
  });

  const [showCreate, setShowCreate] = useState(false);

  const editable = !!data?.is_editable;
  const metrics = data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[14px] font-bold text-text-primary">Value Tracking</h2>
          <p className="text-[11px] text-text-muted">
            Live status of the metrics that flow from the Success Contract. Each
            metric auto-derives green/amber/red from current vs target — override
            in the metric card when judgement is needed.
          </p>
        </div>
        {editable && (
          <button
            onClick={() => setShowCreate(true)}
            className="text-[12px] px-3 py-1.5 rounded-lg bg-beroe-blue text-white font-semibold"
          >
            + Add metric
          </button>
        )}
      </div>

      {/* Status summary strip */}
      {metrics.length > 0 && <StatusSummary metrics={metrics} />}

      {isLoading && <div className="text-sm text-text-muted">Loading metrics…</div>}

      {!isLoading && metrics.length === 0 && (
        <div className="bg-white border border-beroe-card-border rounded-card p-8 text-center">
          <div className="text-[13px] font-semibold text-text-primary mb-1">
            No metrics tracked yet
          </div>
          <p className="text-[12px] text-text-muted">
            Lock the Success Contract first, then add the metrics that prove it
            is being delivered.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {metrics.map((m) => (
          <MetricCard key={m.id} metric={m} accountId={account.id} editable={editable} />
        ))}
      </div>

      {/* Row 52 (25-May) — Overall Value Delivered. Three-bucket rollup that
          mirrors the VDD's CSM-attributed value totals so Value Tracking
          tells a unified story. Reads from the saved VDD jsonb on the
          account; the tab also links to the editable VDD surface. */}
      <OverallValueDelivered accountId={account.id} />

      {showCreate && (
        <CreateMetricModal
          accountId={account.id}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            qc.invalidateQueries({ queryKey });
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// Status summary strip
// ============================================================

function StatusSummary({ metrics }: { metrics: SuccessMetric[] }) {
  const counts: Record<MetricStatus, number> = { green: 0, amber: 0, red: 0, grey: 0 };
  metrics.forEach((m) => {
    counts[m.status] = (counts[m.status] ?? 0) + 1;
  });
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {(["green", "amber", "red", "grey"] as MetricStatus[]).map((s) => (
        <div
          key={s}
          className={cn(
            "px-3 py-1.5 rounded-lg border text-[11px] font-semibold flex items-center gap-2",
            STATUS_COLORS[s].bg,
            STATUS_COLORS[s].border,
            STATUS_COLORS[s].text,
          )}
        >
          <span className={cn("w-2 h-2 rounded-full", STATUS_COLORS[s].dot)} />
          {STATUS_LABELS[s]}: {counts[s]}
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Metric card — inline edit + value log
// ============================================================

function MetricCard({
  metric,
  accountId,
  editable,
}: {
  metric: SuccessMetric;
  accountId: string;
  editable: boolean;
}) {
  const qc = useQueryClient();
  const queryKey = ["metrics", accountId];
  const [logOpen, setLogOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const tone = STATUS_COLORS[metric.status];

  const deleteMutation = useMutation({
    mutationFn: (reason: string) =>
      api.delete<SuccessMetric>(`/api/v1/metrics/${metric.id}`, { reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  const overrideMutation = useMutation({
    mutationFn: (status_override: MetricStatus | null) =>
      api.patch<SuccessMetric>(`/api/v1/metrics/${metric.id}`, {
        status_override,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  return (
    <div
      className={cn(
        "bg-white border-l-4 border-r border-t border-b border-beroe-card-border rounded-card p-4",
        "border-l-" + tone.dot.replace("bg-", ""), // ignored by Tailwind, just visual
      )}
      style={{
        borderLeftColor:
          metric.status === "green"
            ? "#22c55e"
            : metric.status === "amber"
              ? "#f59e0b"
              : metric.status === "red"
                ? "#ef4444"
                : "#94a3b8",
      }}
    >
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-[14px] font-bold text-text-primary">{metric.name}</h3>
            <span
              className={cn(
                "text-[10px] font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1",
                tone.bg,
                tone.text,
              )}
            >
              <span className={cn("w-1.5 h-1.5 rounded-full", tone.dot)} />
              {STATUS_LABELS[metric.status]}
              {metric.status_override && " (override)"}
            </span>
            <span className="text-[10px] text-text-muted">
              {metric.metric_type === "quantitative" ? "quant" : "qual"}
              {metric.unit ? ` · ${metric.unit}` : ""}
            </span>
          </div>
          {metric.description && (
            <p className="text-[12px] text-text-muted mt-1">{metric.description}</p>
          )}
        </div>
        {editable && (
          <div className="flex gap-1.5 flex-shrink-0">
            <button
              onClick={() => setLogOpen((v) => !v)}
              className="text-[11px] px-2.5 py-1 rounded-md bg-beroe-blue text-white font-semibold"
            >
              {logOpen ? "Cancel" : "Log value"}
            </button>
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-[11px] px-2.5 py-1 rounded-md border border-beroe-card-border text-text-muted hover:text-red-700 hover:border-red-300"
              title="Delete metric"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Big current / target display */}
      <div className="flex items-baseline gap-3 mb-3">
        <span className={cn("text-[22px] font-bold", tone.text)}>
          {metric.current_value ?? "—"}
        </span>
        <span className="text-[12px] text-text-muted">
          / {metric.target_value ?? "—"} target
        </span>
        {metric.last_updated_at && (
          <span className="text-[10px] text-text-muted ml-auto">
            Updated {new Date(metric.last_updated_at).toLocaleString()}
          </span>
        )}
      </div>

      {/* Progress bar for quantitative */}
      {metric.metric_type === "quantitative" && metric.target_value && metric.current_value && (
        <ProgressBar
          target={metric.target_value}
          current={metric.current_value}
          status={metric.status}
        />
      )}

      {/* Inline log row */}
      {logOpen && editable && (
        <LogValueRow
          metric={metric}
          onSaved={() => {
            setLogOpen(false);
            qc.invalidateQueries({ queryKey });
          }}
        />
      )}

      {/* Status override */}
      {editable && (
        <div className="flex items-center gap-2 mt-3 pt-2.5 border-t border-beroe-card-border/60 text-[11px]">
          <span className="text-text-muted">Override:</span>
          {(["green", "amber", "red"] as MetricStatus[]).map((s) => (
            <button
              key={s}
              onClick={() =>
                overrideMutation.mutate(metric.status_override === s ? null : s)
              }
              className={cn(
                "px-2 py-0.5 rounded-md border",
                metric.status_override === s
                  ? cn(STATUS_COLORS[s].bg, STATUS_COLORS[s].border, STATUS_COLORS[s].text)
                  : "border-beroe-card-border text-text-muted hover:text-text-secondary",
              )}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
          {metric.status_override && (
            <button
              onClick={() => overrideMutation.mutate(null)}
              className="text-text-muted hover:text-text-secondary underline ml-1"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Log history */}
      {metric.log_entries.length > 0 && (
        <div className="mt-3 pt-2.5 border-t border-beroe-card-border/60">
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            className="text-[11px] text-beroe-blue font-semibold"
          >
            {historyOpen ? "Hide" : "Show"} value log ({metric.log_entries.length})
          </button>
          {historyOpen && (
            <ul className="mt-2 space-y-1.5">
              {[...metric.log_entries].reverse().map((e, i) => (
                <li
                  key={(e.at ?? "") + i}
                  className="text-[11px] bg-beroe-bg/40 border border-beroe-card-border/40 rounded-md px-2 py-1.5"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-text-primary">
                      {e.value ?? "—"}
                    </span>
                    {e.at && (
                      <span className="text-text-muted">
                        {new Date(e.at).toLocaleString()}
                      </span>
                    )}
                  </div>
                  {e.source && (
                    <div className="text-text-secondary mt-0.5">📎 {e.source}</div>
                  )}
                  {e.note && (
                    <div className="text-text-muted italic mt-0.5">{e.note}</div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {confirmDelete && (
        <DeleteConfirm
          onCancel={() => setConfirmDelete(false)}
          onConfirm={(reason) => {
            deleteMutation.mutate(reason);
            setConfirmDelete(false);
          }}
        />
      )}
    </div>
  );
}

function ProgressBar({
  target,
  current,
  status,
}: {
  target: string;
  current: string;
  status: MetricStatus;
}) {
  const t = parseFloat(target.replace(/[^0-9.]/g, ""));
  const c = parseFloat(current.replace(/[^0-9.]/g, ""));
  if (!t || isNaN(c)) return null;
  const pct = Math.min(100, Math.round((c / t) * 100));
  return (
    <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
      <div
        className={cn(
          "h-full transition-all",
          status === "green" ? "bg-green-500"
            : status === "amber" ? "bg-amber-500"
              : "bg-red-500",
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function LogValueRow({
  metric,
  onSaved,
}: {
  metric: SuccessMetric;
  onSaved: () => void;
}) {
  const [value, setValue] = useState("");
  const [source, setSource] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      api.post<SuccessMetric>(`/api/v1/metrics/${metric.id}/log`, {
        value,
        source: source || null,
        note: note || null,
      }),
    onSuccess: () => onSaved(),
    onError: (e: ApiError) => setError(e.message),
  });

  return (
    <div className="mt-3 pt-2.5 border-t border-beroe-card-border/60 grid grid-cols-1 md:grid-cols-3 gap-2">
      <input
        type="text"
        placeholder={
          metric.metric_type === "qualitative" ? "High / Medium / Low" : "New value"
        }
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="text-[12px] px-2 py-1.5 rounded-md border border-beroe-card-border focus:border-beroe-blue focus:outline-none"
      />
      <input
        type="text"
        placeholder="Source / evidence (link, PO #, QBR ref)"
        value={source}
        onChange={(e) => setSource(e.target.value)}
        className="text-[12px] px-2 py-1.5 rounded-md border border-beroe-card-border focus:border-beroe-blue focus:outline-none"
      />
      <div className="flex gap-1.5">
        <input
          type="text"
          placeholder="Note (required)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="flex-1 text-[12px] px-2 py-1.5 rounded-md border border-beroe-card-border focus:border-beroe-blue focus:outline-none"
        />
        <button
          onClick={() => mutation.mutate()}
          disabled={!value.trim() || !note.trim() || mutation.isPending}
          title={!note.trim() ? "A note is required to log a value" : ""}
          className="text-[12px] px-3 py-1.5 rounded-md bg-green-600 text-white font-semibold disabled:opacity-50"
        >
          {mutation.isPending ? "Saving…" : "Save"}
        </button>
      </div>
      {error && <div className="md:col-span-3 text-[11px] text-red-700">{error}</div>}
    </div>
  );
}

// ============================================================
// Create metric modal
// ============================================================

function CreateMetricModal({
  accountId,
  onClose,
  onCreated,
}: {
  accountId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<MetricType>("quantitative");
  const [unit, setUnit] = useState("$");
  const [target, setTarget] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      api.post<SuccessMetric>(`/api/v1/accounts/${accountId}/metrics`, {
        name,
        metric_type: type,
        unit: type === "qualitative" ? null : unit || null,
        target_value: target || null,
        description: description || null,
      }),
    onSuccess: () => onCreated(),
    onError: (e: ApiError) => setError(e.message),
  });

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-card p-5 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[14px] font-bold mb-3">Add a metric</h3>
        <div className="space-y-2.5">
          <input
            placeholder='Metric name (e.g. "Documented savings")'
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full text-[12px] px-2.5 py-1.5 rounded-md border border-beroe-card-border"
          />
          <textarea
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="w-full text-[12px] px-2.5 py-1.5 rounded-md border border-beroe-card-border"
          />
          <div className="flex gap-2">
            <select
              value={type}
              onChange={(e) => setType(e.target.value as MetricType)}
              className="text-[12px] px-2.5 py-1.5 rounded-md border border-beroe-card-border"
            >
              <option value="quantitative">Quantitative</option>
              <option value="qualitative">Qualitative</option>
            </select>
            {type === "quantitative" && (
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="text-[12px] px-2.5 py-1.5 rounded-md border border-beroe-card-border"
              >
                {["$", "€", "%", "MAU", "#", "hours", "score"].map((u) => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            )}
            <input
              placeholder={type === "qualitative" ? "High / Medium / Low" : "Target"}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="flex-1 text-[12px] px-2.5 py-1.5 rounded-md border border-beroe-card-border"
            />
          </div>
          {error && (
            <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-md px-2 py-1">
              {error}
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              className="flex-1 text-[12px] px-3 py-1.5 rounded-md border border-beroe-card-border text-text-secondary"
            >
              Cancel
            </button>
            <button
              onClick={() => mutation.mutate()}
              disabled={!name.trim() || mutation.isPending}
              className="flex-1 text-[12px] px-3 py-1.5 rounded-md bg-beroe-blue text-white font-semibold disabled:opacity-50"
            >
              {mutation.isPending ? "Adding…" : "Add metric"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Delete-with-reason confirm
// ============================================================

function DeleteConfirm({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-card p-5 w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[14px] font-bold mb-2">Delete metric?</h3>
        <p className="text-[12px] text-text-muted mb-3">
          Soft delete — admins can restore. Reason is required.
        </p>
        <textarea
          placeholder="Reason (≥5 chars)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          className="w-full text-[12px] px-2.5 py-1.5 rounded-md border border-beroe-card-border mb-3"
        />
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 text-[12px] px-3 py-1.5 rounded-md border border-beroe-card-border"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(reason)}
            disabled={reason.trim().length < 5}
            className="flex-1 text-[12px] px-3 py-1.5 rounded-md bg-red-600 text-white font-semibold disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Row 52 (25-May-2026) — Overall Value Delivered rollup
// ============================================================

function OverallValueDelivered({ accountId }: { accountId: string }) {
  type ValueRow = {
    initiative_name?: string;
    identified_musd?: number | null;
    committed_musd?: number | null;
    implemented_musd?: number | null;
  };
  type Vdd = {
    value_delivered?: ValueRow[];
    locked_at: string | null;
    exec_summary: string | null;
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
    <div className="bg-white border border-beroe-card-border rounded-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[14px] font-bold">💰 Overall Value Delivered</div>
          <div className="text-[11px] text-text-muted mt-0.5">
            Three-bucket rollup from the Value Delivery Document.
          </div>
        </div>
        <a
          href={`/accounts/${accountId}/success-management/vdd`}
          className="text-[11px] text-beroe-blue font-semibold hover:underline"
        >
          → Edit in VDD
        </a>
      </div>
      {isLoading ? (
        <div className="text-[12px] text-text-muted italic">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-[12px] text-text-muted italic">
          No value-delivered entries yet. Add them on the Value Delivery
          Document.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-md border bg-slate-50 border-slate-200 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted">
                Identified
              </div>
              <div className="text-[18px] font-extrabold text-slate-900 mt-0.5">
                {fmt(ident)}
              </div>
            </div>
            <div className="rounded-md border bg-amber-50 border-amber-200 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider font-bold text-amber-800">
                Committed
              </div>
              <div className="text-[18px] font-extrabold text-amber-900 mt-0.5">
                {fmt(comm)}
              </div>
            </div>
            <div className="rounded-md border bg-emerald-50 border-emerald-200 px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider font-bold text-emerald-800">
                Implemented
              </div>
              <div className="text-[18px] font-extrabold text-emerald-900 mt-0.5">
                {fmt(impl)}
              </div>
            </div>
          </div>
          <div className="mt-3 text-[11px] text-text-muted">
            Across <b className="text-text-primary">{rows.length}</b>{" "}
            initiative{rows.length === 1 ? "" : "s"}
            {data?.locked_at && (
              <>
                {" "}· 🔒 VDD locked on{" "}
                <b className="text-text-primary">
                  {new Date(data.locked_at).toLocaleDateString()}
                </b>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
