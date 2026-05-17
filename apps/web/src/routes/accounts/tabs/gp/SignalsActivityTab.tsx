import { GPStub } from "./_GPStub";

export default function SignalsActivityTab() {
  return (
    <GPStub
      title="Signals & Activity"
      milestone="M27"
      description="Soft signals (early indicators of account risk or opportunity) plus the per-account activity feed. Drives the Signal Mix component of the Appetite Score."
      bullets={[
        "Soft signals: expansion / positive / neutral / risk / critical — with resolve / hide / delete actions",
        "Activity feed: CSM calls, MoM imports, internal notes — sortable + filterable",
        "Tag activities to metrics so value-delivered traces back to a touchpoint",
        "Signals re-balance the Appetite Score in real time (25% weight)",
      ]}
    />
  );
}
