// M15.1 — Review modal for candidate Goals extracted from a VPD.
//
// Triggered from the Documents tab on a VPD doc once
// `cs_goals_extracted` lands. Lists N candidate goals with per-row
// checkbox + editable fields, then "Create selected" fans out:
//   POST /api/v1/accounts/:id/cs-goals     × selected
//   PATCH /api/v1/cs-goals/:id            (if the row has initiatives)
// Status pills per-row reflect success / skipped / failed via
// Promise.allSettled. No retry — re-open the modal to try again.

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  CATEGORY_TONES,
  CONFIDENCE_TONES,
  type CsGoalsExtractionResult,
  type ExtractedGoal,
  type CSGoalCategory,
} from "@/types/cs_goals_extraction";

type RowStatus = "idle" | "running" | "done" | "skipped" | "failed";

interface RowState extends ExtractedGoal {
  _selected: boolean;
  _status: RowStatus;
  _message?: string;
}

interface Props {
  accountId: string;
  documentName?: string;
  result: CsGoalsExtractionResult;
  onClose: () => void;
}

export function VpdGoalsExtractionReview({
  accountId,
  documentName,
  result,
  onClose,
}: Props) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<RowState[]>(() =>
    result.goals.map((g) => ({
      ...g,
      _selected: (g.confidence ?? "low") !== "low",
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
    targets.forEach(({ i }) => updateRow(i, { _status: "running", _message: undefined }));

    await Promise.allSettled(
      targets.map(async ({ r, i }) => {
        try {
          const created = await api.post<{ id: string }>(
            `/api/v1/accounts/${accountId}/cs-goals`,
            {
              title: r.title,
              category: r.category,
              target_value: r.target_value ?? null,
              target_date: r.target_date ?? null,
              owner: r.owner ?? null,
            },
          );
          // If we have initiatives, follow up with a PATCH to attach them.
          if (r.initiatives && r.initiatives.length > 0) {
            await api.patch(`/api/v1/cs-goals/${created.id}`, {
              initiatives: r.initiatives.map((it) => ({
                name: it.name,
                description: it.description ?? null,
                stage: it.stage ?? null,
              })),
            });
          }
          updateRow(i, { _status: "done", _message: "Created" });
        } catch (e) {
          const msg = e instanceof ApiError ? e.message : "Failed";
          // 409 (duplicate title) gets recorded as skipped — same semantics
          // as the M16 contact-create fan-out.
          const isDup =
            e instanceof ApiError && e.status === 409
              ? true
              : /already/i.test(msg);
          updateRow(i, {
            _status: isDup ? "skipped" : "failed",
            _message: msg.slice(0, 200),
          });
        }
      }),
    );

    // Invalidate cs-goals for this account so the Contract & Goals tab refreshes.
    qc.invalidateQueries({ queryKey: ["cs-goals", accountId] });
    setRunning(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center pt-10 pb-10 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl w-[min(900px,95vw)] flex flex-col max-h-[calc(100vh-80px)]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-beroe-card-border flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted">
              VPD → Goals extraction
            </div>
            <div className="text-[15px] font-semibold text-text-primary">
              {result.goals.length} candidate goal{result.goals.length === 1 ? "" : "s"}
              {documentName && (
                <span className="text-text-muted font-normal text-[13px]">
                  {" "}
                  · from {documentName}
                </span>
              )}
            </div>
            {result.is_stub && (
              <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 uppercase tracking-wider font-semibold">
                Stub AI
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary text-lg leading-none px-2"
          >
            ✕
          </button>
        </div>

        {/* Rows */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {rows.length === 0 ? (
            <div className="text-[13px] text-text-muted italic">
              The AI didn't surface any candidate goals from this VPD.
            </div>
          ) : (
            rows.map((r, i) => (
              <GoalRow
                key={i}
                row={r}
                onChange={(patch) => updateRow(i, patch)}
                disabled={running}
              />
            ))
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-beroe-card-border flex items-center justify-between bg-beroe-bg/30">
          <div className="text-[12px] text-text-secondary">
            {summary.sel} selected
            {summary.done > 0 && (
              <> · <span className="text-green-700">{summary.done} created</span></>
            )}
            {summary.failed > 0 && (
              <> · <span className="text-red-700">{summary.failed} failed</span></>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="text-[12px] px-3 py-1.5 rounded-md border border-beroe-card-border hover:bg-beroe-bg/60"
            >
              Close
            </button>
            <button
              onClick={onCreateSelected}
              disabled={running || summary.sel === 0}
              className="text-[12px] px-3 py-1.5 rounded-md bg-beroe-navy text-white font-semibold disabled:opacity-50"
            >
              {running ? "Creating…" : `Create ${summary.sel} goal${summary.sel === 1 ? "" : "s"}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function GoalRow({
  row,
  onChange,
  disabled,
}: {
  row: RowState;
  onChange: (p: Partial<RowState>) => void;
  disabled: boolean;
}) {
  return (
    <div
      className={cn(
        "border rounded-md p-3 transition-colors",
        row._status === "done"
          ? "border-green-300 bg-green-50/40"
          : row._status === "failed"
            ? "border-red-300 bg-red-50/40"
            : row._status === "skipped"
              ? "border-slate-300 bg-slate-50"
              : "border-beroe-card-border bg-white",
      )}
    >
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={row._selected}
          onChange={(e) => onChange({ _selected: e.target.checked })}
          disabled={disabled || row._status === "done"}
          className="mt-1.5"
        />
        <div className="flex-1 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <input
              value={row.title}
              onChange={(e) => onChange({ title: e.target.value })}
              disabled={disabled}
              maxLength={200}
              className="flex-1 text-[13px] font-medium border-b border-transparent focus:border-beroe-card-border focus:outline-none px-1 py-0.5"
            />
            <div className="flex gap-1.5 flex-shrink-0">
              {row.confidence && (
                <span
                  className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded border uppercase tracking-wider font-semibold",
                    CONFIDENCE_TONES[row.confidence],
                  )}
                >
                  {row.confidence}
                </span>
              )}
              {row._status === "done" && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 border border-green-200 font-semibold uppercase tracking-wider">
                  ✓ Created
                </span>
              )}
              {row._status === "skipped" && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 border border-slate-300 font-semibold uppercase tracking-wider">
                  Skipped
                </span>
              )}
              {row._status === "failed" && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 border border-red-200 font-semibold uppercase tracking-wider">
                  Failed
                </span>
              )}
              {row._status === "running" && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 border border-blue-200 font-semibold uppercase tracking-wider">
                  …
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-12 gap-2 text-[12px]">
            <select
              value={row.category}
              onChange={(e) =>
                onChange({ category: e.target.value as CSGoalCategory })
              }
              disabled={disabled}
              className={cn(
                "col-span-4 px-2 py-1 rounded border text-[11px] font-medium",
                CATEGORY_TONES[row.category],
              )}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
            <input
              value={row.target_value ?? ""}
              onChange={(e) =>
                onChange({ target_value: e.target.value || null })
              }
              placeholder="Target (e.g. $2M, 80%)"
              disabled={disabled}
              maxLength={200}
              className="col-span-4 border border-beroe-card-border rounded px-2 py-1 disabled:bg-beroe-bg/40"
            />
            <input
              type="date"
              value={row.target_date ?? ""}
              onChange={(e) => onChange({ target_date: e.target.value || null })}
              disabled={disabled}
              className="col-span-2 border border-beroe-card-border rounded px-2 py-1 disabled:bg-beroe-bg/40"
            />
            <input
              value={row.owner ?? ""}
              onChange={(e) => onChange({ owner: e.target.value || null })}
              placeholder="Owner"
              disabled={disabled}
              maxLength={200}
              className="col-span-2 border border-beroe-card-border rounded px-2 py-1 disabled:bg-beroe-bg/40"
            />
          </div>

          {row.rationale && (
            <div className="text-[11px] text-text-muted italic">
              {row.rationale}
            </div>
          )}

          {row.initiatives && row.initiatives.length > 0 && (
            <div className="text-[11px] text-text-secondary">
              <span className="font-semibold uppercase tracking-wider text-text-muted">
                Initiatives ·
              </span>{" "}
              {row.initiatives.map((it) => it.name).join(" · ")}
            </div>
          )}

          {row._message && row._status !== "done" && (
            <div
              className={cn(
                "text-[11px]",
                row._status === "failed"
                  ? "text-red-700"
                  : "text-text-muted",
              )}
            >
              {row._message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
