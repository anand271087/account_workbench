import { SMStub } from "./_StubTab";

export default function ValueTrackingTab() {
  return (
    <SMStub
      title="Value Tracking"
      milestone="M20"
      description="Where ongoing metric values are logged with evidence. Each metric flows from the success contract and shows current vs target with auto-derived status."
      bullets={[
        "Per-metric: current value, target, unit, status (green/amber/red/grey)",
        "Value log entries — every update captured with source/evidence + who logged it",
        "Status auto-derived from progress vs target (lower-is-better for hours/days metrics)",
        "Linked entries from activity feed, signals, VDD deliveries — full audit trail per metric",
        "Top of-page progress bar against the primary success-contract metric",
      ]}
    />
  );
}
