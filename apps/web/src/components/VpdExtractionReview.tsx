// 09-Jun · Unified VPD review modal.
//
// Hosts the two existing extraction modals (VpdGoalsExtractionReview +
// VpdMetricsExtractionReview) under one backdrop with a tab strip. Both
// candidate sets come from the same VPD upload — Goals land in cs_goals
// (Contract & Goals tab), Metrics land in success_metrics (Value
// Tracking tab). Worker writes both columns; this wrapper exposes them
// in one review surface so the CSM doesn't have two separate CTAs to
// hunt for.
//
// If only one of the two columns has candidates, the wrapper still
// works — tab strip auto-defaults to whichever side has content and
// the empty tab shows the "nothing extracted" copy from the child.

import { useState } from "react";

import { VpdGoalsExtractionReview } from "@/components/VpdGoalsExtractionReview";
import { VpdMetricsExtractionReview } from "@/components/VpdMetricsExtractionReview";
import { cn } from "@/lib/utils";
import type { CsGoalsExtractionResult } from "@/types/cs_goals_extraction";
import type { VpdMetricsExtractionResult } from "@/types/vpd_metrics_extraction";

type Tab = "goals" | "metrics";

interface Props {
  accountId: string;
  documentName?: string;
  goals?: CsGoalsExtractionResult | null;
  metrics?: VpdMetricsExtractionResult | null;
  initialTab?: Tab;
  onClose: () => void;
}

export function VpdExtractionReview({
  accountId,
  documentName,
  goals,
  metrics,
  initialTab,
  onClose,
}: Props) {
  const goalsCount = goals?.goals.length ?? 0;
  const metricsCount = metrics?.metrics.length ?? 0;

  // Default to whichever side has candidates. If both, prefer Goals
  // (the autofill story starts with the higher-level objective then
  // drills into the metrics that measure it).
  const defaultTab: Tab =
    initialTab ??
    (goalsCount > 0 ? "goals" : metricsCount > 0 ? "metrics" : "goals");
  const [tab, setTab] = useState<Tab>(defaultTab);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center pt-10 pb-10 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl w-[min(960px,95vw)] flex flex-col max-h-[calc(100vh-80px)]">
        {/* Title + tabs */}
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
            <div className="flex gap-1 ml-2">
              <TabButton
                active={tab === "goals"}
                count={goalsCount}
                label="Goals"
                onClick={() => setTab("goals")}
              />
              <TabButton
                active={tab === "metrics"}
                count={metricsCount}
                label="Success Metrics"
                onClick={() => setTab("metrics")}
              />
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary text-lg leading-none px-2"
          >
            ✕
          </button>
        </div>

        {/* Active tab body — each child renders header + body + footer
            (embedded mode skips the outer chrome). */}
        {tab === "goals" && goals && (
          <VpdGoalsExtractionReview
            embedded
            accountId={accountId}
            documentName={documentName}
            result={goals}
            onClose={onClose}
          />
        )}
        {tab === "metrics" && metrics && (
          <VpdMetricsExtractionReview
            embedded
            accountId={accountId}
            documentName={documentName}
            result={metrics}
            onClose={onClose}
          />
        )}
        {tab === "goals" && !goals && <EmptyTab kind="Goals" />}
        {tab === "metrics" && !metrics && <EmptyTab kind="Success Metrics" />}
      </div>
    </div>
  );
}

function TabButton({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "text-[12px] font-semibold px-3 py-1.5 rounded-md transition-colors",
        active
          ? "bg-beroe-navy text-white"
          : "text-text-secondary hover:bg-beroe-bg/60 border border-beroe-card-border",
      )}
    >
      {label}
      <span
        className={cn(
          "ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full",
          active
            ? "bg-white/20 text-white"
            : "bg-beroe-bg text-text-secondary",
        )}
      >
        {count}
      </span>
    </button>
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
