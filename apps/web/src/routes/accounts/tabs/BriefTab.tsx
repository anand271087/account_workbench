// Pre-Meeting Brief — promoted from a collapsible inside Pre-Sales to its
// own top-level tab. The editor itself (MeetingBriefEditor) is unchanged;
// this tab just wraps it with consistent page chrome.

import { MeetingBriefEditor } from "@/components/MeetingBriefEditor";
import { useAccountFromLayout } from "../AccountProfileLayout";

export default function BriefTab() {
  const account = useAccountFromLayout();
  return (
    <div className="space-y-4">
      <div className="bg-white rounded-card border border-beroe-card-border px-5 py-4">
        <h2 className="text-sm font-bold text-text-primary">
          Pre-Meeting Brief
        </h2>
        <p className="text-xs text-text-muted mt-0.5">
          The one-page brief for the next live meeting with this account —
          call info, attendees, objectives, minefields, cheat sheet. Save
          changes as you go; the brief stays attached to the account.
        </p>
      </div>
      <MeetingBriefEditor accountId={account.id} />
    </div>
  );
}
