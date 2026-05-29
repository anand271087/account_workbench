/** Three-button "you have unsaved changes" dialog.
 *  Save & continue / Discard & continue / Stay. */

import { useEffect } from "react";

const TAB_LABELS: Record<string, string> = {
  overview: "Overview",
  "pre-sales": "Pre-Sales",
  solutioning: "Solutioning",
  contacts: "Contacts",
  documents: "Documents",
  "value-def": "Value Definition",
  goals: "Goals & Initiatives",
};

/** Turn `/accounts/22222.../solutioning` into "Solutioning". */
function prettyDestination(href: string): string {
  try {
    const path = href.split("?")[0].split("#")[0];
    const segs = path.split("/").filter(Boolean);
    if (segs[0] === "accounts" && segs.length === 1) return "Accounts";
    if (segs[0] === "accounts" && segs.length >= 3) {
      const tab = segs[2];
      return TAB_LABELS[tab] ?? tab.replace(/-/g, " ");
    }
    if (segs[0] === "admin" && segs[1] === "users") return "Admin · Users";
    if (segs[0] === "login") return "Sign in";
    if (segs[0] === "reset-password") return "Reset password";
    return path;
  } catch {
    return href;
  }
}

export function UnsavedChangesDialog({
  pendingHref,
  saving,
  onSaveAndGo,
  onDiscardAndGo,
  onStay,
}: {
  pendingHref: string;
  saving: boolean;
  onSaveAndGo: () => void;
  onDiscardAndGo: () => void;
  onStay: () => void;
}) {
  // Esc cancels the navigation attempt.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onStay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onStay]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-card shadow-xl w-full max-w-md p-6">
        <div className="flex items-start gap-3">
          <div className="text-2xl">⚠️</div>
          <div className="flex-1">
            <h3 className="text-base font-bold text-text-primary">Unsaved changes</h3>
            <p className="text-sm text-text-secondary mt-1">
              You have edits on this page. Save them before leaving?
            </p>
            <p className="text-[11px] text-text-muted mt-2">
              Going to <span className="font-semibold text-text-secondary">{prettyDestination(pendingHref)}</span>
            </p>
          </div>
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-5">
          <button
            onClick={onStay}
            className="px-3 py-1.5 rounded-lg text-sm border border-beroe-card-border text-text-secondary hover:bg-beroe-bg/40"
          >
            Stay on page
          </button>
          <button
            onClick={onDiscardAndGo}
            className="px-3 py-1.5 rounded-lg text-sm border border-beroe-red/30 text-beroe-red hover:bg-beroe-red/10 font-semibold"
          >
            Discard & continue
          </button>
          <button
            onClick={onSaveAndGo}
            disabled={saving}
            className="px-4 py-1.5 rounded-lg bg-beroe-blue text-white text-sm font-semibold hover:bg-beroe-blue/90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save & continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
