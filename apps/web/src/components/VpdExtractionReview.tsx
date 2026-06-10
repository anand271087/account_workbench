// 09-Jun · Unified VPD review modal.
//
// 10-Jun · Stakeholder ask — "Goals" and "Success Metrics" collapsed
// into one concept. The Success Metrics tab is gone; only Goals
// renders. The `metrics` + `initialTab` props remain on the surface
// so call sites don't have to change, but they are no longer wired
// into the UI. (The worker still extracts candidate metrics into
// `doc.metrics_extracted` — we just don't surface them here.)
//
// Going forward, every Goal IS a Success Metric. The Solutioning
// "Lock and pass to Sales" gate enforces ≥1 cs_goals row.

import { VpdGoalsExtractionReview } from "@/components/VpdGoalsExtractionReview";
import type { CsGoalsExtractionResult } from "@/types/cs_goals_extraction";
import type { VpdMetricsExtractionResult } from "@/types/vpd_metrics_extraction";

interface Props {
  accountId: string;
  documentName?: string;
  goals?: CsGoalsExtractionResult | null;
  /** @deprecated 10-Jun — Metrics tab removed; prop kept so call sites
   *  don't break. */
  metrics?: VpdMetricsExtractionResult | null;
  /** @deprecated 10-Jun — Only "goals" is meaningful now. */
  initialTab?: "goals" | "metrics";
  onClose: () => void;
}

export function VpdExtractionReview({
  accountId,
  documentName,
  goals,
  onClose,
}: Props) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center pt-10 pb-10 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl w-[min(960px,95vw)] flex flex-col max-h-[calc(100vh-80px)]">
        {/* Title — single-purpose Goals review (Success Metrics merged in). */}
        <div className="px-5 py-3 border-b border-beroe-card-border flex items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted">
                Review extracted from VPD
              </div>
              {documentName && (
                <div className="text-[12px] text-text-muted">
                  {documentName}
                </div>
              )}
            </div>
            <span
              className="text-[11px] font-bold uppercase tracking-wider px-2 py-1 rounded-md bg-beroe-blue/10 text-beroe-blue"
            >
              Goals · Success Metrics
              {goals?.goals.length ? ` · ${goals.goals.length}` : ""}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary text-lg leading-none px-2"
          >
            ✕
          </button>
        </div>

        {/* Body — only the Goals review remains. */}
        {goals ? (
          <VpdGoalsExtractionReview
            embedded
            accountId={accountId}
            documentName={documentName}
            result={goals}
            onClose={onClose}
          />
        ) : (
          <EmptyTab kind="Goals" />
        )}
      </div>
    </div>
  );
}

function EmptyTab({ kind }: { kind: string }) {
  return (
    <div className="px-5 py-10 text-center text-[13px] text-text-muted italic">
      No {kind.toLowerCase()} were extracted from this VPD yet — the worker may
      still be running, or this VPD didn't contain anything the AI could
      surface. Re-run AI on the document to try again.
    </div>
  );
}
