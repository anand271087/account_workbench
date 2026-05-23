// Pre-Meeting Brief — own top-level tab with two modes:
//   1. Presentation — read-only one-page render mirroring the prototype
//      `bMomBrief` (the stakeholders' expected layout, per 22-May Row 48).
//   2. Edit — the always-open MeetingBriefEditor with per-section AI suggest
//      buttons. Used to capture / regenerate brief content.
// Default mode is Presentation; switching to Edit opens the form below the
// presentation. Closing Edit reverts to the read view.

import { useState } from "react";

import { MeetingBriefEditor } from "@/components/MeetingBriefEditor";
import { MeetingBriefPresentation } from "@/components/MeetingBriefPresentation";
import { cn } from "@/lib/utils";
import { useAccountFromLayout } from "../AccountProfileLayout";

type Mode = "presentation" | "edit";

export default function BriefTab() {
  const account = useAccountFromLayout();
  const [mode, setMode] = useState<Mode>("presentation");

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-card border border-beroe-card-border px-5 py-4 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-bold text-text-primary">
            Pre-Meeting Brief
          </h2>
          <p className="text-xs text-text-muted mt-0.5">
            One-page brief for the next live meeting with this account — call
            info, attendees, objectives, minefields, cheat sheet.{" "}
            <b>Presentation</b> mode shows the printable layout;{" "}
            <b>Edit</b> mode opens the field-by-field editor.
          </p>
        </div>
        <div className="flex gap-1 bg-slate-100 rounded-md p-0.5">
          <button
            type="button"
            onClick={() => setMode("presentation")}
            className={cn(
              "text-[12px] px-3 py-1 rounded font-semibold transition-colors",
              mode === "presentation"
                ? "bg-white text-text-primary shadow-sm"
                : "text-text-muted hover:text-text-primary",
            )}
          >
            📄 Presentation
          </button>
          <button
            type="button"
            onClick={() => setMode("edit")}
            className={cn(
              "text-[12px] px-3 py-1 rounded font-semibold transition-colors",
              mode === "edit"
                ? "bg-white text-text-primary shadow-sm"
                : "text-text-muted hover:text-text-primary",
            )}
          >
            ✏️ Edit
          </button>
        </div>
      </div>
      {mode === "presentation" ? (
        <MeetingBriefPresentation
          accountId={account.id}
          accountName={account.name}
        />
      ) : (
        <MeetingBriefEditor accountId={account.id} />
      )}
    </div>
  );
}
