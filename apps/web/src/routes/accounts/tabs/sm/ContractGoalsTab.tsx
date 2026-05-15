import { SMStub } from "./_StubTab";

export default function ContractGoalsTab() {
  return (
    <SMStub
      title="Success Contract & Goals"
      milestone="M19"
      description="The CS team's commitment to the client. Locks the success metric, measurement method, and value narrative — then drives every downstream artefact (initiatives, checkpoints, VDD)."
      bullets={[
        "Success Contract — 3 locks: primary metric (+ unit), measurement method (data source + frequency + owner), value narrative",
        "Auto-drafts the contract from Sales Handoff data on first CSM entry",
        "Goals & Initiatives — extends M15 cs_goals with 3-phase alignment (A: what it means · B: groundwork · C: agreed target)",
        "Initiative value stages are category-aware (cost_savings: identified → committed → implemented; base_rationalization: baselined → in_progress → achieved; etc.)",
        "Goal history captures every state change with reason (auditable)",
        "Existing /goals top-level tab will fold into this view in M19",
      ]}
    />
  );
}
