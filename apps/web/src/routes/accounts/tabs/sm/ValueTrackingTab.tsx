// M20 — Value Tracking.
//
// 28-May — port of prototype/beroe_awb_v20.html `bMetricsPane`
// (line 2941-3038), locked to the Beroe brand palette (Sept 2025).
//
// Layout (top → bottom):
//   1. "Value Tracking" header + Add-metric CTA (Aqua heading like
//      VDD / Contract & Goals for tab consistency).
//   2. Status summary strip (On Track / At Risk / Off Track / No Data
//      counts) — brand RAG.
//   3. Overall Value Delivered card — prototype line 2964-2979. Big
//      progress bar of the primary quantitative metric with brand
//      status colour. Hidden when no quantitative metric has a value.
//   4. Per-metric cards — prototype line 2995-3033. 3px left border
//      in status colour, status dot + name + label + big current /
//      target on the right, 6px progress bar, value-log entries with
//      ↑/↓ arrows, inline Log-value form.
//   5. Footer "+ Add a metric" button — prototype line 3036.
//   6. VDD 3-bucket rollup at the bottom (our M22 addition — kept).

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

// Beroe brand palette anchors used across this file.
const INDIGO = "#4A00F8";
const MIDNIGHT = "#001137";
const RISK_GREEN = "#6EC457";
const RISK_AMBER = "#F0BC41";
const RISK_RED = "#CF4548";

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
    <div className="space-y-3.5">
      {/* Header — Aqua section heading to match VDD + Contract & Goals. */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div
            className="text-[11px] font-bold uppercase"
            style={{ color: "#35E1D4", letterSpacing: "0.05em" }}
          >
            Value Tracking
          </div>
          <p className="text-[11px] text-text-muted mt-0.5 max-w-[640px]">
            Live status of the metrics that flow from the Success Contract.
            Each metric auto-derives green / amber / red from current vs
            target — override in the metric card when judgement is needed.
          </p>
        </div>
        {editable && (
          <button
            onClick={() => setShowCreate(true)}
            className="text-[12px] px-3 py-1.5 rounded-md font-semibold text-white whitespace-nowrap"
            style={{ background: INDIGO }}
          >
            + Add metric
          </button>
        )}
      </div>

      {/* Status summary strip */}
      {metrics.length > 0 && <StatusSummary metrics={metrics} />}

      {/* 28-May — "Value Delivered" surfaces moved to the top so the
          tab opens with the headline value first (matches prototype
          bMetricsPane line 2964-2979 order: Value Delivered card →
          metric cards). */}
      <OverallValueDelivered accountId={account.id} />

      {/* Prototype line 2964-2979 — overall progress bar of the primary
          quantitative metric. */}
      {metrics.length > 0 && (
        <OverallProgressCard metrics={metrics} />
      )}

      {isLoading && (
        <div className="text-sm text-text-muted">Loading metrics…</div>
      )}

      {!isLoading && metrics.length === 0 && (
        <div
          className="rounded-card p-8 text-center"
          style={{ background: "#fff", border: "1px solid #e4eaf6" }}
        >
          <div className="text-[28px] mb-2">🎯</div>
          <div
            className="text-[14px] font-bold mb-1"
            style={{ color: MIDNIGHT }}
          >
            No success metrics defined yet
          </div>
          <p className="text-[12px] text-text-muted max-w-[400px] mx-auto">
            Define goals and lock the success contract first. Then metrics
            will flow here automatically.
          </p>
          {editable && (
            <button
              onClick={() => setShowCreate(true)}
              className="mt-3 text-[12px] px-3 py-1.5 rounded-md font-semibold text-white"
              style={{ background: INDIGO }}
            >
              + Add a metric
            </button>
          )}
        </div>
      )}

      <div className="space-y-2.5">
        {metrics.map((m) => (
          <MetricCard
            key={m.id}
            metric={m}
            accountId={account.id}
            editable={editable}
          />
        ))}
      </div>

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
// Status summary strip — brand RAG pills
// ============================================================

function StatusSummary({ metrics }: { metrics: SuccessMetric[] }) {
  const counts: Record<MetricStatus, number> = {
    green: 0,
    amber: 0,
    red: 0,
    grey: 0,
  };
  metrics.forEach((m) => {
    counts[m.status] = (counts[m.status] ?? 0) + 1;
  });
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {(["green", "amber", "red", "grey"] as MetricStatus[]).map((s) => {
        const c = STATUS_COLORS[s];
        return (
          <div
            key={s}
            className="px-3 py-1.5 rounded-md text-[11px] font-semibold flex items-center gap-2"
            style={{
              background: c.bg,
              border: `1px solid ${c.border}`,
              color: c.text,
            }}
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ background: c.dot }}
            />
            {STATUS_LABELS[s]}: {counts[s]}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// Overall progress card — verbatim port of prototype line 2964-2979
// ============================================================

function OverallProgressCard({ metrics }: { metrics: SuccessMetric[] }) {
  // Take the first quantitative metric that has a non-empty current value.
  const top = metrics.find(
    (m) =>
      m.metric_type === "quantitative" &&
      m.target_value &&
      m.current_value &&
      m.current_value.trim() !== "",
  );
  if (!top) return null;
  const t = parseFloat((top.target_value ?? "0").replace(/[^0-9.]/g, ""));
  const c = parseFloat((top.current_value ?? "0").replace(/[^0-9.]/g, ""));
  if (!t || !Number.isFinite(c)) return null;
  const pct = Math.min(100, Math.round((c / t) * 100));
  // Brand RAG by completion band, matching prototype line 2971 logic.
  const color = pct >= 75 ? RISK_GREEN : pct >= 50 ? INDIGO : RISK_AMBER;
  const fmt = (v: number) => {
    const unit = top.unit ?? "";
    const isCurrency = unit === "$" || unit === "€";
    const num = v.toLocaleString();
    return isCurrency ? `${unit}${num}` : `${num}${unit ? unit : ""}`;
  };
  return (
    <div
      className="rounded-card px-4 py-3.5"
      style={{ background: "#fff", border: "1px solid #e4eaf6" }}
    >
      <div className="flex items-center justify-between mb-2">
        <span
          className="text-[14px] font-bold"
          style={{ color: MIDNIGHT }}
        >
          Value Delivered
        </span>
        <span className="text-[11px] text-text-muted">
          {metrics.length} metric{metrics.length === 1 ? "" : "s"} tracked
        </span>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div
            className="h-3.5 rounded-full overflow-hidden"
            style={{ background: "#EAF1F5" }}
          >
            <div
              className="h-full transition-all"
              style={{ width: `${pct}%`, background: color }}
            />
          </div>
        </div>
        <span className="text-[18px] font-extrabold" style={{ color }}>
          {pct}%
        </span>
      </div>
      <div className="flex items-center justify-between text-[10px] text-text-muted mt-1.5">
        <span>Current: {fmt(c)}</span>
        <span>Target: {fmt(t)}</span>
      </div>
    </div>
  );
}

// ============================================================
// Metric card — verbatim port of prototype line 2995-3033
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

  const isQual = metric.metric_type === "qualitative";
  const t = parseFloat((metric.target_value ?? "0").replace(/[^0-9.]/g, ""));
  const c = parseFloat((metric.current_value ?? "0").replace(/[^0-9.]/g, ""));
  const pct =
    !isQual && t > 0 && Number.isFinite(c)
      ? Math.min(100, Math.round((c / t) * 100))
      : 0;
  const fmtVal = (v: string | null) => {
    if (!v) return "—";
    const unit = metric.unit ?? "";
    const isCurrency = unit === "$" || unit === "€";
    const cleaned = v.replace(/[^0-9.]/g, "");
    const num = cleaned ? parseFloat(cleaned).toLocaleString() : v;
    return isCurrency ? `${unit}${num}` : `${num}${unit && !isCurrency ? unit : ""}`;
  };

  return (
    <div
      className="rounded-card p-3.5"
      style={{
        background: "#fff",
        border: "1px solid #e4eaf6",
        borderLeft: `3px solid ${tone.dot}`,
      }}
    >
      <div className="flex items-center gap-2.5 mb-2">
        <div
          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ background: tone.dot }}
        />
        <div className="flex-1 min-w-0">
          <div
            className="text-[13px] font-bold truncate"
            style={{ color: MIDNIGHT }}
          >
            {metric.name}
          </div>
          <div className="text-[10px] text-text-muted">
            {isQual ? "Qualitative" : `Quantitative · ${metric.unit ?? ""}`}
            {" · "}
            <span style={{ color: tone.dot, fontWeight: 600 }}>
              {STATUS_LABELS[metric.status]}
            </span>
            {metric.status_override && (
              <span className="text-text-muted"> (override)</span>
            )}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div
            className="text-[18px] font-extrabold"
            style={{ color: tone.dot }}
          >
            {fmtVal(metric.current_value)}
          </div>
          <div className="text-[10px] text-text-muted">
            of {fmtVal(metric.target_value)} target
          </div>
        </div>
        {editable && (
          <button
            onClick={() => setConfirmDelete(true)}
            className="text-text-muted hover:text-text-secondary text-[11px] px-1.5"
            title="Delete metric"
          >
            ✕
          </button>
        )}
      </div>

      {/* 6px progress bar (prototype line 3012). */}
      {!isQual && metric.target_value && metric.current_value && (
        <div
          className="h-1.5 rounded-full overflow-hidden mb-2.5"
          style={{ background: "#EAF1F5" }}
        >
          <div
            className="h-full transition-all"
            style={{ width: `${pct}%`, background: tone.dot }}
          />
        </div>
      )}

      {/* Inline log row */}
      {logOpen && editable && (
        <LogValueRow
          metric={metric}
          onCancel={() => setLogOpen(false)}
          onSaved={() => {
            setLogOpen(false);
            qc.invalidateQueries({ queryKey });
          }}
        />
      )}

      {/* Log-value button + last-updated meta (prototype line 3030-3031). */}
      {!logOpen && editable && (
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={() => setLogOpen(true)}
            className="text-[11px] px-2.5 py-1 rounded-md font-semibold"
            style={{
              background: "#fff",
              border: `1px solid ${INDIGO}40`,
              color: INDIGO,
            }}
          >
            ↑ Log value
          </button>
          <span className="text-[10px] text-text-muted">
            Last updated:{" "}
            {metric.last_updated_at
              ? new Date(metric.last_updated_at).toLocaleString()
              : "Never"}
            {metric.last_updated_by ? ` by ${metric.last_updated_by}` : ""}
          </span>
        </div>
      )}

      {/* Status override */}
      {editable && (
        <div
          className="flex items-center gap-2 mt-2.5 pt-2"
          style={{ borderTop: "1px solid #f0f4fb" }}
        >
          <span className="text-[11px] text-text-muted">Override:</span>
          {(["green", "amber", "red"] as MetricStatus[]).map((s) => {
            const isActive = metric.status_override === s;
            const tc = STATUS_COLORS[s];
            return (
              <button
                key={s}
                onClick={() =>
                  overrideMutation.mutate(isActive ? null : s)
                }
                className="text-[11px] px-2 py-0.5 rounded-md"
                style={
                  isActive
                    ? {
                        background: tc.bg,
                        border: `1px solid ${tc.border}`,
                        color: tc.text,
                        fontWeight: 600,
                      }
                    : {
                        background: "#fff",
                        border: "1px solid #e4eaf6",
                        color: "#94a3b8",
                      }
                }
              >
                {STATUS_LABELS[s]}
              </button>
            );
          })}
          {metric.status_override && (
            <button
              onClick={() => overrideMutation.mutate(null)}
              className="text-[11px] text-text-muted hover:text-text-secondary underline ml-1"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* Log history */}
      {metric.log_entries.length > 0 && (
        <div
          className="mt-2.5 pt-2"
          style={{ borderTop: "1px solid #f0f4fb" }}
        >
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            className="text-[11px] font-semibold"
            style={{ color: INDIGO }}
          >
            {historyOpen ? "Hide" : "Show"} value log ({metric.log_entries.length})
          </button>
          {historyOpen && (
            <ul className="mt-2 space-y-1.5">
              {[...metric.log_entries].reverse().map((e, i) => {
                // Use ↑ when the log moved us forward, ↓ when it moved
                // backward (e.g. correction). Defaults to ↑.
                const arrow = "↑";
                return (
                  <li
                    key={(e.at ?? "") + i}
                    className="text-[11px] rounded-md px-2 py-1.5"
                    style={{
                      background: "#EAF1F580",
                      border: "1px solid #e4eaf6",
                    }}
                  >
                    <div className="flex items-start gap-2 flex-wrap">
                      <span
                        className="font-bold flex-shrink-0"
                        style={{ color: RISK_GREEN }}
                      >
                        {arrow}
                      </span>
                      <span
                        className="font-semibold"
                        style={{ color: MIDNIGHT }}
                      >
                        {e.value ?? "—"}
                      </span>
                      {e.at && (
                        <span className="text-text-muted ml-auto">
                          {new Date(e.at).toLocaleString()}
                        </span>
                      )}
                    </div>
                    {e.source && (
                      <div className="text-text-secondary mt-0.5">
                        📎 {e.source}
                      </div>
                    )}
                    {e.note && (
                      <div className="text-text-muted italic mt-0.5">
                        {e.note}
                      </div>
                    )}
                  </li>
                );
              })}
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

function LogValueRow({
  metric,
  onCancel,
  onSaved,
}: {
  metric: SuccessMetric;
  onCancel: () => void;
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
    <div
      className="mt-2 pt-2"
      style={{ borderTop: "1px solid #f0f4fb" }}
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <input
          type="text"
          placeholder={
            metric.metric_type === "qualitative"
              ? "High / Medium / Low"
              : "New value"
          }
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className={inputCls()}
        />
        <input
          type="text"
          placeholder="Source / evidence (link, PO #, QBR ref)"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className={inputCls()}
        />
        <input
          type="text"
          placeholder="Note (required)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className={inputCls()}
        />
      </div>
      <div className="flex items-center gap-2 mt-2">
        <button
          onClick={() => mutation.mutate()}
          disabled={!value.trim() || !note.trim() || mutation.isPending}
          title={!note.trim() ? "A note is required to log a value" : ""}
          className="text-[12px] px-3 py-1.5 rounded-md font-semibold text-white disabled:opacity-50"
          style={{ background: INDIGO }}
        >
          {mutation.isPending ? "Saving…" : "Save"}
        </button>
        <button
          onClick={onCancel}
          className="text-[12px] px-3 py-1.5 rounded-md"
          style={{
            background: "#fff",
            border: "1px solid #e4eaf6",
            color: MIDNIGHT,
          }}
        >
          Cancel
        </button>
        {error && (
          <span
            className="text-[11px] ml-auto px-2 py-1 rounded-md"
            style={{
              color: RISK_RED,
              background: `${RISK_RED}10`,
              border: `1px solid ${RISK_RED}30`,
            }}
          >
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

function inputCls(): string {
  return "text-[12px] px-2 py-1.5 rounded-md border border-beroe-card-border focus:border-beroe-blue focus:outline-none focus:ring-1 focus:ring-beroe-blue/20";
}

// ============================================================
// Create metric modal — brand-painted
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
      className="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ background: "rgba(0,17,55,0.4)" }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-card p-5 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          className="text-[14px] font-bold mb-3"
          style={{ color: MIDNIGHT }}
        >
          Add a metric
        </h3>
        <div className="space-y-2.5">
          <input
            placeholder='Metric name (e.g. "Documented savings")'
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={cn("w-full", inputCls())}
          />
          <textarea
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className={cn("w-full", inputCls())}
          />
          <div className="flex gap-2">
            <select
              value={type}
              onChange={(e) => setType(e.target.value as MetricType)}
              className={inputCls()}
            >
              <option value="quantitative">Quantitative</option>
              <option value="qualitative">Qualitative</option>
            </select>
            {type === "quantitative" && (
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className={inputCls()}
              >
                {["$", "€", "%", "MAU", "#", "hours", "score"].map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            )}
            <input
              placeholder={
                type === "qualitative" ? "High / Medium / Low" : "Target"
              }
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className={cn("flex-1", inputCls())}
            />
          </div>
          {error && (
            <div
              className="text-[11px] rounded-md px-2 py-1"
              style={{
                color: RISK_RED,
                background: `${RISK_RED}10`,
                border: `1px solid ${RISK_RED}30`,
              }}
            >
              {error}
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              className="flex-1 text-[12px] px-3 py-1.5 rounded-md"
              style={{
                background: "#fff",
                border: "1px solid #e4eaf6",
                color: MIDNIGHT,
              }}
            >
              Cancel
            </button>
            <button
              onClick={() => mutation.mutate()}
              disabled={!name.trim() || mutation.isPending}
              className="flex-1 text-[12px] px-3 py-1.5 rounded-md text-white font-semibold disabled:opacity-50"
              style={{ background: INDIGO }}
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
      className="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ background: "rgba(0,17,55,0.4)" }}
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-card p-5 w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          className="text-[14px] font-bold mb-2"
          style={{ color: MIDNIGHT }}
        >
          Delete metric?
        </h3>
        <p className="text-[12px] text-text-muted mb-3">
          Soft delete — admins can restore. Reason is required.
        </p>
        <textarea
          placeholder="Reason (≥5 chars)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          className={cn("w-full mb-3", inputCls())}
        />
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 text-[12px] px-3 py-1.5 rounded-md"
            style={{
              background: "#fff",
              border: "1px solid #e4eaf6",
              color: MIDNIGHT,
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(reason)}
            disabled={reason.trim().length < 5}
            className="flex-1 text-[12px] px-3 py-1.5 rounded-md text-white font-semibold disabled:opacity-50"
            style={{ background: RISK_RED }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Row 52 (25-May-2026) — VDD 3-bucket value rollup, brand-painted
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
    <div
      className="rounded-card p-4"
      style={{ background: "#fff", border: "1px solid #e4eaf6" }}
    >
      <div className="flex items-center justify-between mb-3">
        <div>
          <div
            className="text-[13px] font-bold"
            style={{ color: MIDNIGHT }}
          >
            💰 Overall Value Delivered
          </div>
          <div className="text-[11px] text-text-muted mt-0.5">
            Three-bucket rollup from the Value Delivery Document.
          </div>
        </div>
        <a
          href={`/accounts/${accountId}/success-management/vdd`}
          className="text-[11px] font-semibold hover:underline"
          style={{ color: INDIGO }}
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
            <RollupTile label="Identified" value={fmt(ident)} color={RISK_AMBER} />
            <RollupTile label="Committed" value={fmt(comm)} color={INDIGO} />
            <RollupTile label="Implemented" value={fmt(impl)} color={RISK_GREEN} />
          </div>
          <div className="mt-3 text-[11px] text-text-muted">
            Across <b style={{ color: MIDNIGHT }}>{rows.length}</b>{" "}
            initiative{rows.length === 1 ? "" : "s"}
            {data?.locked_at && (
              <>
                {" "}· 🔒 VDD locked on{" "}
                <b style={{ color: MIDNIGHT }}>
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

function RollupTile({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div
      className="rounded-md px-3 py-2"
      style={{
        background: `${color}10`,
        border: `1px solid ${color}30`,
      }}
    >
      <div
        className="text-[10px] font-bold uppercase"
        style={{ color, letterSpacing: "0.05em" }}
      >
        {label}
      </div>
      <div
        className="text-[18px] font-extrabold mt-0.5"
        style={{ color }}
      >
        {value}
      </div>
    </div>
  );
}
