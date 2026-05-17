import { GPStub } from "./_GPStub";

export default function ExternalIntelTab() {
  return (
    <GPStub
      title="External Intelligence"
      milestone="M28"
      description="Market and competitor intel scoped to this account. Sourced from Beroe research feeds + the account's industry/category mappings."
      bullets={[
        "Category trend cards: $-volatility, supply tightness, supplier moves",
        "Competitor signals: new entrants, M&A, pricing changes",
        "Beroe research links + market briefs filtered by account scope",
        "AI summary: 'what changed this week for this account'",
      ]}
    />
  );
}
