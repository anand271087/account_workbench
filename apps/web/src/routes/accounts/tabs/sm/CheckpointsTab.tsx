import { SMStub } from "./_StubTab";

export default function CheckpointsTab() {
  return (
    <SMStub
      title="Checkpoints"
      milestone="M21"
      description="The cadence that proves value over the lifetime of the engagement. Four standard types, each with a structured sign-off the renewal team can rely on."
      bullets={[
        "Standard cadence: Kickoff → MBR (90d) → QBR (180d) → Renewal (T-14d). Auto-scheduled from gate_signed.",
        "Sign-off modal captures: initiatives reviewed (with stage), metrics discussed (with value), client acknowledgement note, next actions agreed",
        "Status: not_held → held → signed_off. Signed-off snapshots are immutable evidence at renewal.",
        "Overdue flagging (>7d past scheduled date), 'awaiting sign-off' state for held but not confirmed",
        "Snapshot persists everything reviewed — feeds Renewal Readiness in M23",
      ]}
    />
  );
}
