// M31 — Static materials library. Ported verbatim from prototype
// DOC_MATERIALS so the Documents & Reports tab can browse Beroe's
// stock product collateral without a backend table.

export interface MaterialItem {
  name: string;
  summary: string;
}

export interface MaterialGroup {
  group: string;
  items: MaterialItem[];
}

export const DOC_MATERIALS: MaterialGroup[] = [
  {
    group: "Platform Overview",
    items: [
      {
        name: "Beroe Live.ai Introduction",
        summary:
          "Beroe Live.ai is a procurement intelligence platform combining AI-driven insights, real-time market data, and category intelligence across 1,800+ categories. Covers 95% of addressable procurement spend with always-on intelligence.",
      },
      {
        name: "About Beroe — Company Overview",
        summary:
          "Founded in 2006, Beroe serves 10,000+ procurement professionals across Fortune 500 companies. Offices in 7 countries. Recognized by Gartner, Forrester, and Spend Matters as a leader in procurement intelligence.",
      },
      {
        name: "AI & Intelligence Methodology",
        summary:
          "Beroe combines 450+ analysts, proprietary AI models, and 15M+ data points to deliver procurement intelligence. Abi (AI assistant) processes L1-L4 queries with increasing complexity and depth.",
      },
    ],
  },
  {
    group: "Product Modules",
    items: [
      {
        name: "Category Watch — Always-on Category Intelligence",
        summary:
          "Real-time category intelligence across 1,800+ categories. Includes price tracking, market dynamics, supplier landscape, forecasts, and risk indicators. Updated daily by analyst teams.",
      },
      {
        name: "Market Monitoring Dashboards (MMD)",
        summary:
          "Customizable dashboards tracking commodity prices, market indices, and category KPIs. Real-time alerts on price movements, supply disruptions, and market shifts.",
      },
      {
        name: "Abi — AI Procurement Assistant",
        summary:
          "AI-powered procurement assistant handling L1-L4 complexity queries. From quick price lookups to multi-document research synthesis. Supports natural language queries and generates formatted reports.",
      },
      {
        name: "Supplier Watch — Supplier Discovery & Profiling",
        summary:
          "Discover and profile suppliers across regions. Filter by capability, certification, risk score, and diversity. Supports RFI generation and supplier shortlisting.",
      },
      {
        name: "Risk Watch — Supply Chain Risk Monitoring",
        summary:
          "Real-time supplier risk monitoring across financial, operational, ESG, and geopolitical dimensions. Automated alerts and risk scoring for tracked suppliers.",
      },
    ],
  },
  {
    group: "Data & Integration",
    items: [
      {
        name: "Datahub & API Integration",
        summary:
          "REST APIs for integrating Beroe intelligence into existing procurement workflows, ERP systems, and BI tools. Supports real-time data feeds and batch exports.",
      },
      {
        name: "Enterprise Collaboration (Teams, Slack, Copilot)",
        summary:
          "Native integrations with Microsoft Teams, Slack, and Copilot. Receive alerts, query Abi, and share insights directly within collaboration tools.",
      },
      {
        name: "S2P Platform Integration",
        summary:
          "Pre-built connectors for Coupa, SAP Ariba, Jaggaer, and GEP. Embed Beroe intelligence directly into source-to-pay workflows.",
      },
    ],
  },
  {
    group: "Subscription Tiers",
    items: [
      {
        name: "EL Base Tier Overview",
        summary:
          "Entry-level tier: Category Watch (up to 50 categories), Abi (L1-L2 queries, 500/month), basic Market Monitor, standard support. Ideal for teams starting their intelligence journey.",
      },
      {
        name: "EL Plus Tier Overview",
        summary:
          "Mid-tier: Category Watch (up to 200 categories), Abi (L1-L3 queries, 2000/month), MMD, Supplier Discovery (basic), priority support. Best for growing procurement teams.",
      },
      {
        name: "EL Pro Tier Overview",
        summary:
          "Enterprise tier: Unlimited categories, Abi (L1-L4, unlimited), full MMD + Risk Watch + Supplier Watch, API access, dedicated CSM, custom research credits. For large enterprises.",
      },
      {
        name: "Tier Comparison Matrix",
        summary:
          "Side-by-side comparison: EL Base (50 cats, 500 Abi, basic MMD), EL Plus (200 cats, 2K Abi, MMD+SD), EL Pro (unlimited, full suite, API, custom research). Volume discounts available.",
      },
    ],
  },
  {
    group: "Use Cases & Case Studies",
    items: [
      {
        name: "8-Step Sourcing Process with Beroe",
        summary:
          "How Beroe intelligence maps to each sourcing step: 1) Category profiling, 2) Market analysis, 3) Supplier identification, 4) RFI/RFP support, 5) Negotiation prep, 6) Contract benchmarking, 7) Supplier monitoring, 8) Performance review.",
      },
      {
        name: "Enterprise Case Study — Health Insurance",
        summary:
          "A top-5 US health insurer consolidated 4 intelligence vendors into Beroe Live.ai. Results: 40% reduction in research time, $8.2M documented savings in Year 1, 92% platform adoption across 200 users.",
      },
      {
        name: "Custom Intelligence Overview",
        summary:
          "Beroe's custom research team delivers L3-L4 deep-dive reports on specific categories, markets, or suppliers. Typical turnaround: 5-15 business days. Formats: PDF report, executive briefing, or data pack.",
      },
    ],
  },
  {
    group: "Training & Enablement",
    items: [
      {
        name: "Platform Training Guide",
        summary:
          "Comprehensive training curriculum covering: Platform navigation, Category Watch deep-dive, Abi query optimization, Supplier Discovery workflows, MMD configuration, and report generation.",
      },
      {
        name: "Best Practice Playbooks",
        summary:
          "Playbooks for common use cases: Contract negotiation prep, supplier risk assessment, category strategy development, market monitoring setup, and executive reporting.",
      },
      {
        name: "Onboarding Checklist",
        summary:
          "30/60/90-day onboarding plan with milestones: Week 1-2 setup, Week 3-4 training, Month 2 adoption, Month 3 optimization. Includes role-based training tracks.",
      },
    ],
  },
];
