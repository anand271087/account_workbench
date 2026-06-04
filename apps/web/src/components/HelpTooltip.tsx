// 03-Jun bug 6 — Inline section descriptions become a hover tooltip
// on a small italic "ⓘ" badge next to the title. Same visual pattern
// previously embedded in KindUploadCard + the Sales Hand-off /
// Contract Audit InlineTooltip atoms; consolidated here so every
// Section/Card helper can reach for the same primitive.

import { cn } from "@/lib/utils";

export function HelpTooltip({
  text,
  placement = "below",
  className,
}: {
  text: string | undefined | null;
  /** Where the popover renders relative to the icon. */
  placement?: "below" | "above";
  /** Extra utility classes on the outer wrapper. */
  className?: string;
}) {
  if (!text) return null;
  const popoverPos =
    placement === "above"
      ? "bottom-[140%]"
      : "top-[140%]";
  const arrowPos =
    placement === "above"
      ? "top-full border-x-transparent border-t-beroe-navy"
      : "bottom-full border-x-transparent border-b-beroe-navy";
  return (
    <span className={cn("relative inline-flex items-center group", className)}>
      <span
        tabIndex={0}
        role="button"
        aria-label="Show description"
        className="cursor-help w-3.5 h-3.5 inline-flex items-center justify-center rounded-full border border-beroe-card-border text-[10px] text-text-muted hover:text-beroe-blue hover:border-beroe-blue/40 focus:outline-none focus:ring-1 focus:ring-beroe-blue/40 italic"
        style={{ fontFamily: "Georgia, serif" }}
      >
        i
      </span>
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute left-0 z-50 w-[340px] rounded-md bg-beroe-navy text-white text-[11px] leading-[1.55] px-2.5 py-2 shadow-lg opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity whitespace-normal font-normal normal-case tracking-normal",
          popoverPos,
        )}
      >
        {text}
        <span
          className={cn(
            "absolute left-3 w-0 h-0 border-x-4 border-x-transparent",
            placement === "above" ? "border-t-4" : "border-b-4",
            arrowPos,
          )}
        />
      </span>
    </span>
  );
}
