import { IRStub } from "./_IRStub";

export default function AnalyticsTab() {
  return (
    <IRStub
      title="Analytics"
      milestone="M30"
      description="Deep-dive platform analytics: usage curves, module activity, category watch trends, Abi intelligence patterns, supplier discovery, supplier risk, custom credits, and super users. Chart.js renderer with number / chart view toggles."
      bullets={[
        "Usage & Logins — 12-month monthly logins + monthly active users + adoption breakdown",
        "Module Activity — Market Monitor / Abi / Supplier Discovery / Downloads / Benchmarks",
        "Category Watch — section-level + heat trends over time",
        "Abi Intelligence — complexity mix over time + query type evolution",
        "Supplier Discovery / Risk — pipeline metrics, country/region heatmaps",
        "Custom Credits + Super Users — exec-level usage signals",
        "Numbers / Charts mode toggle + per-section download (CSV)",
      ]}
    />
  );
}
