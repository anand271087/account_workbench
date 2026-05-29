interface Props {
  title: string;
  milestone: string;
  description: string;
}

/** Generic empty-tab placeholder used until M5/M6/M7 fill these in. */
export function PlaceholderTab({ title, milestone, description }: Props) {
  return (
    <div className="bg-white rounded-xl border border-dashed border-slate-300 p-10 text-center">
      <div className="text-3xl mb-2">🚧</div>
      <h2 className="text-base font-bold text-text-primary mb-1">{title}</h2>
      <p className="text-sm text-text-secondary max-w-md mx-auto">{description}</p>
      <div className="inline-block mt-3 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-beroe-amber/10 text-beroe-amber border border-beroe-amber/40 font-bold">
        Ships in {milestone}
      </div>
    </div>
  );
}

export function ValueDefinitionPlaceholder() {
  return (
    <PlaceholderTab
      title="Value Definition"
      milestone="v1.1"
      description="Capture how Beroe value is measured for this account: KPIs, baselines, target deltas, evidence sources. Rolls up into the Success Management view."
    />
  );
}

export function GoalsInitiativesPlaceholder() {
  return (
    <PlaceholderTab
      title="Goals & Initiatives"
      milestone="v1.1"
      description="Track customer-side initiatives that Beroe supports — milestones, owners, due dates, status. Feeds the Account Plan + Health Score in v1.1."
    />
  );
}

export function PreSalesPlaceholder() {
  return (
    <PlaceholderTab
      title="Pre-Sales & Solutioning — Engagement Info"
      milestone="M5"
      description="The engagement objective, target categories, procurement maturity, AI penetration, and contact info captured during discovery."
    />
  );
}

