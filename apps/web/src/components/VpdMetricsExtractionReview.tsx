// 27-May Row 81 — Review modal for candidate Success Metrics extracted
// from a VPD.
//
// Triggered from the Solutioning tab "Autofill Success Metrics from VPD"
// button. Calls POST /documents/:id/extract-metrics on demand, lists N
// candidates with per-row checkbox + editable fields, then "Create
// selected" fans out POST /api/v1/accounts/:id/metrics × N.
//
// Mirrors VpdGoalsExtractionReview.tsx — same Promise.allSettled +
// per-row status pill pattern (idle / running / done / skipped / failed).

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import type {
  ExtractedMetric,
  MetricType,
  VpdMetricsExtractionResult,
} from "@/types/vpd_metrics_extraction";

type RowStatus = "idle" | "running" | "done" | "skipped" | "failed";

interface RowState extends ExtractedMetric {
  _selected: boolean;
  _status: RowStatus;
  _message?: string;
}

interface Props {
  accountId: string;
  documentName?: string;
  result: VpdMetricsExtractionResult;
  onClose: () => void;
}

const CONFIDENCE_TONES: Record<string, string> = {
  high: "bg-beroe-green/20 text-beroe-green border-beroe-green/30",
  medium: "bg-beroe-amber/20 text-beroe-amber border-beroe-amber/40",
  low: "bg-beroe-bg text-text-secondary border-beroe-card-border",
};

export function VpdMetricsExtractionReview({
  accountId,
  documentName,
  result,
  onClose,
}: Props) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<RowState[]>(() =>
    result.metrics.map((m) => ({
      ...m,
      _selected: (m.confidence ?? "low") !== "low",
      _status: "idle",
    })),
  );
  const [running, setRunning] = useState(false);

  const summary = useMemo(() => {
    const sel = rows.filter((r) => r._selected).length;
    const done = rows.filter((r) => r._status === "done").length;
    const failed = rows.filter((r) => r._status === "failed").length;
    return { sel, done, failed };
  }, [rows]);

  const updateRow = (i: number, patch: Partial<RowState>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const onCreateSelected = async () => {
    setRunning(true);
    const targets = rows
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r._selected && r._status !== "done");
    targets.forEach(({ i }) =>
      updateRow(i, { _status: "running", _message: undefined }),
    );

    await Promise.allSettled(
      targets.map(async ({ r, i }) => {
        try {
          await api.post<{ id: string }>(
            `/api/v1/accounts/${accountId}/metrics`,
            {
              name: r.name,
              metric_type: r.metric_type,
              target_value: r.target_value ?? null,
              owner: r.owner ?? null,
            },
          );
          updateRow(i, { _status: "done", _message: "Created" });
        } catch (e) {
          const msg = e instanceof ApiError ? e.message : "Failed";
          // 409 conflicts are common when re-applying the same VPD —
          // surface as "skipped" not "failed" so the UX isn't noisy.
          const status =
            e instanceof ApiError && e.status === 409 ? "skipped" : "failed";
          updateRow(i, { _status: status, _message: msg });
        }
      }),
    );

    qc.invalidateQueries({ queryKey: ["metrics", accountId] });
    setRunning(false);
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-card w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-5 py-3 border-b border-beroe-card-border flex items-start justify-between gap-3">
          <div>
            <div className="text-[14px] font-bold text-text-primary">
              Autofill Success Metrics from VPD
              {result.is_stub && (
                <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-beroe-amber/15 text-beroe-amber border border-beroe-amber/40">
                  Stub AI
                </span>
              )}
            </div>
            <div className="text-[11px] text-text-muted mt-0.5">
              {documentName ? `From ${documentName}` : "VPD-extracted metrics"} ·
              Review, edit, and create selected as Success Metrics on Value Tracking.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[12px] text-text-muted hover:text-text-primary"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {rows.length === 0 ? (
            <div className="text-[12px] text-text-muted py-8 text-center">
              No success metrics could be extracted from this VPD.
            </div>
          ) : (
            <ul className="space-y-2.5">
              {rows.map((r, i) => (
                <li
                  key={i}
                  className={cn(
                    "border rounded-md p-3",
                    r._status === "done"
                      ? "border-beroe-green/30 bg-beroe-green/15/40"
                      : r._status === "failed"
                        ? "border-beroe-red/30 bg-beroe-red/10/40"
                        : r._status === "skipped"
                          ? "border-beroe-card-border bg-beroe-bg/40"
                          : "border-beroe-card-border",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={r._selected}
                      onChange={(e) =>
                        updateRow(i, { _selected: e.target.checked })
                      }
                      disabled={running || r._status === "done"}
                      className="mt-1 cursor-pointer"
                    />
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <input
                          type="text"
                          value={r.name}
                          onChange={(e) => updateRow(i, { name: e.target.value })}
                          disabled={running}
                          className="flex-1 text-[12px] font-semibold border-b border-transparent hover:border-beroe-card-border focus:border-beroe-blue focus:outline-none px-0.5"
                        />
                        {r.confidence && (
                          <span
                            className={cn(
                              "text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded-full border",
                              CONFIDENCE_TONES[r.confidence],
                            )}
                          >
                            {r.confidence}
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px]">
                        <label className="flex flex-col">
                          <span className="text-text-muted text-[9.5px] uppercase tracking-wider font-semibold">
                            Type
                          </span>
                          <select
                            value={r.metric_type}
                            onChange={(e) =>
                              updateRow(i, {
                                metric_type: e.target.value as MetricType,
                              })
                            }
                            disabled={running}
                            className="border border-beroe-card-border rounded px-1.5 py-0.5"
                          >
                            <option value="quantitative">Quantitative</option>
                            <option value="qualitative">Qualitative</option>
                          </select>
                        </label>
                        <label className="flex flex-col">
                          <span className="text-text-muted text-[9.5px] uppercase tracking-wider font-semibold">
                            Target
                          </span>
                          <input
                            type="text"
                            value={r.target_value ?? ""}
                            onChange={(e) =>
                              updateRow(i, {
                                target_value: e.target.value || null,
                              })
                            }
                            disabled={running}
                            placeholder="$2M / 80% / High"
                            className="border border-beroe-card-border rounded px-1.5 py-0.5"
                          />
                        </label>
                        <label className="flex flex-col">
                          <span className="text-text-muted text-[9.5px] uppercase tracking-wider font-semibold">
                            Owner
                          </span>
                          <input
                            type="text"
                            value={r.owner ?? ""}
                            onChange={(e) =>
                              updateRow(i, { owner: e.target.value || null })
                            }
                            disabled={running}
                            placeholder="Optional"
                            className="border border-beroe-card-border rounded px-1.5 py-0.5"
                          />
                        </label>
                      </div>
                      {r.rationale && (
                        <div className="text-[10.5px] text-text-muted italic">
                          {r.rationale}
                        </div>
                      )}
                      {r._status !== "idle" && (
                        <div
                          className={cn(
                            "text-[10px] font-bold uppercase tracking-wider",
                            r._status === "done"
                              ? "text-beroe-green"
                              : r._status === "failed"
                                ? "text-beroe-red"
                                : r._status === "skipped"
                                  ? "text-text-muted"
                                  : "text-beroe-blue",
                          )}
                        >
                          {r._status}
                          {r._message ? ` — ${r._message}` : ""}
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="px-5 py-3 border-t border-beroe-card-border bg-beroe-bg/40 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-[11px] text-text-muted">
            <b className="text-text-primary">{summary.sel}</b> selected
            {summary.done > 0 && (
              <>
                {" · "}
                <span className="text-beroe-green">{summary.done} created</span>
              </>
            )}
            {summary.failed > 0 && (
              <>
                {" · "}
                <span className="text-beroe-red">{summary.failed} failed</span>
              </>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="text-[12px] px-3 py-1.5 border border-beroe-card-border rounded-md font-semibold hover:bg-white"
            >
              {summary.done > 0 ? "Done" : "Cancel"}
            </button>
            <button
              type="button"
              onClick={onCreateSelected}
              disabled={running || summary.sel === 0}
              className="text-[12px] px-3 py-1.5 bg-beroe-blue text-white rounded-md font-semibold disabled:opacity-50"
            >
              {running ? "Creating…" : `Create ${summary.sel} selected →`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
