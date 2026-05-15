import { SMStub } from "./_StubTab";

export default function DeliveryRenewalTab() {
  return (
    <SMStub
      title="Delivery & Renewal"
      milestone="M23"
      description="The post-delivery view. Dual-track lifecycle (renewal first, expand second) plus the 3-question Renewal Readiness assessment that gates the renewal conversation."
      bullets={[
        "Track 1 — Renewal: Kickoff → MBR → QBR → Renewal. Deliver on initiatives. Prove ROI.",
        "Track 2 — Expand: Value Proof → Expand Ask → New Scope → Close. Auto-pauses when Track 1 hits a red flag.",
        "Red-flag triggers: missed checkpoint >7d, client SPOC unresponsive >2w, no value logged <60d to renewal, escalation raised.",
        "Renewal Readiness — 3 questions with proof: (1) Did we deliver the metric? (2) Can we prove it with data? (3) Does the client acknowledge it?",
        "Outcome: renewed / at_risk / not_renewed — feeds the leadership view's forecast tier",
      ]}
    />
  );
}
