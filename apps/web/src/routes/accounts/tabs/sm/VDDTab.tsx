import { SMStub } from "./_StubTab";

export default function VDDTab() {
  return (
    <SMStub
      title="Value Delivery Document"
      milestone="M22"
      description="The single source of truth for what Beroe committed to and what was delivered. Reviewed at every checkpoint. Primary input to the renewal conversation."
      bullets={[
        "Four sections: Client Strategic Priorities · Agreed Success Metrics · Beroe's Approach Per Initiative · Value Delivered (CSM attributed)",
        "CSM attribution rollup: pulls $Identified / $Committed / $Implemented from initiative stage tracking",
        "Savings Lever Framework (3-lever model)",
        "AI-draft button + PPT/PDF export",
      ]}
    />
  );
}
