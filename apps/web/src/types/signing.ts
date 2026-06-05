// Mirrors apps/api/app/schemas/signing.py.

export interface SigningGate {
  account_id: string;
  gate_signed: boolean;

  gate_signed_date: string | null;       // ISO yyyy-mm-dd
  gate_contract_acv: string | number | null;
  gate_contract_term: string | null;
  gate_renewal_date: string | null;
  gate_bvd_due_date: string | null;

  gate_confirmed_by: string | null;
  gate_confirmed_at: string | null;      // ISO datetime
  gate_confirmed_by_name: string | null; // H41 — resolved server-side

  gate_unlocked: boolean;
  gate_unlock_reason: string | null;
  gate_unlocked_by: string | null;
  gate_unlocked_at: string | null;

  gate_contract_doc: string | null;
  gate_contract_doc_at: string | null;

  gate_contract_modules: string[];
  gate_platform_tier: string | null;
  gate_account_segment: string | null;
  gate_subscribers: string | null;

  handover_quality_check: Record<string, boolean>;

  // 04-Jun — Sales Handoff prototype port (two-lock model).
  sh_locked_at: string | null;
  sh_locked_by: string | null;
  sh_locked_by_name: string | null;
  gate_module_configs: Record<string, Record<string, unknown>>;
  gate_contract_extras: Record<string, unknown>;

  can_sign: boolean;
  can_unlock: boolean;
  can_sh_lock: boolean;
  can_sh_unlock: boolean;
}

export interface ModuleConfigsBody {
  configs: Record<string, Record<string, unknown>>;
}

export interface ContractExtrasBody {
  extras: Record<string, unknown>;
}

export interface ShUnlockBody {
  reason: string;
}

// 04-Jun — full module catalog from beroe_sales_handoff_proto.html line 124.
// The legacy MODULE_OPTIONS list above is kept for backward compat.
export const ALL_MODULES = [
  "LiVE.Ai", "Supplier Watch", "MMD", "Custom Credits",
  "Commodity Forecasting", "Datahub", "GSA", "Cirtuo",
  "Sourcing Optimizer", "Alerts and Updates", "Inflation Watch",
  "Spend Analytics", "nnamu", "Prism", "Supply Chain Risk",
  "Opp Assessment", "Diverse Supplier Discovery", "Hackett",
  "Copilot", "Connector Fee",
] as const;
export type ModuleName = (typeof ALL_MODULES)[number];

// 04-Jun — Document subtype taxonomy (9 canonical types).
export const DOC_TYPES = [
  "Signed Proposal", "Unsigned Proposal", "Work Order",
  "MSA", "Purchase Order", "Invoice", "SOW", "Amendment", "NDA",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const BILLING_FREQ_OPTIONS = ["Annual", "Quarterly", "Monthly", "Bi-annual"] as const;
export const PAYMENT_TERM_OPTIONS = [
  "Net 15", "Net 30", "Net 45", "Net 60", "Net 90",
  "Upon receipt", "Custom",
] as const;
export const GEO_OPTIONS = [
  "Global", "North America", "EMEA", "APAC", "LATAM",
  "Multi-region (custom)",
] as const;
// 04-Jun bug — First checkpoint dropdown reverted to 30/45/60-day
// options (stakeholder asked for the longer cadence spread; 15 days
// was too aggressive for a kick-off cadence).
export const FIRST_CP_OPTIONS = ["30 days", "45 days", "60 days"] as const;

// 04-Jun — Per-module field schemas ported verbatim from prototype
// `MODULE_CONFIGS` (line 138-217). Drives the dynamic config form per
// module. Field types: number / text / select (dropdown) / seg
// (segmented buttons) / multi (chip multi-select).
export interface ModuleField {
  key: string;
  label: string;
  type: "number" | "text" | "select" | "seg" | "multi";
  options?: readonly string[];
  ph?: string;
  suffix?: string;
  full?: boolean;
  showIf?: (cfg: Record<string, unknown>) => boolean;
}

export interface ModuleSpec {
  icon: string;
  fields: ModuleField[];
}

export const MODULE_CONFIG_SPECS: Record<string, ModuleSpec> = {
  "LiVE.Ai": {
    icon: "🤖",
    fields: [
      { key: "tier", label: "Tier", type: "seg", options: ["EL Base", "EL Plus", "EL Pro"] },
      { key: "users", label: "# of Users", type: "number", ph: "95" },
      { key: "categoryWatch", label: "Category Watch", type: "seg", options: ["Limited", "Unlimited"] },
      { key: "limitedCount", label: "# of Categories", type: "number", ph: "30",
        showIf: (c) => c.categoryWatch === "Limited" },
      { key: "limitedPacks", label: "Packs (free-text)", type: "text",
        ph: "Indirect pack, Mining pack, ...", full: true,
        showIf: (c) => c.categoryWatch === "Limited" },
    ],
  },
  "Supplier Watch": {
    icon: "🛡",
    fields: [
      { key: "suppliers", label: "# of Suppliers", type: "number", ph: "22" },
      { key: "datapoints", label: "Datapoints Subscribed", type: "multi", full: true,
        options: ["D&B (Credit Score)", "CreditSafe", "Creditor Watch", "Dow Jones",
          "AME (Adverse Media)", "Sanctions", "PEP", "Security Scorecard",
          "Supplier Events", "ESG (Kloopify)", "D&B BYOL",
          "Ecovadis BYOL (ESG & IQ+Score)"] },
    ],
  },
  "MMD": {
    icon: "📊",
    fields: [
      { key: "categories", label: "# of Categories / Dashboards", type: "number", ph: "12" },
      { key: "sources", label: "Data Sources", type: "multi", full: true,
        options: ["Intratec", "Bloomberg", "Mintec Index", "Polymerupdate", "PPI",
          "ARGUS Metals", "Fastmarkets Metal Bulletin", "RISI", "SCI99",
          "Upply Freight Index", "Packtrax", "PriceWatch"] },
    ],
  },
  "Custom Credits": {
    icon: "⚡",
    fields: [
      { key: "ftes", label: "FTEs", type: "number", ph: "1", suffix: "FTE" },
      { key: "hours", label: "Hours", type: "number", ph: "400", suffix: "hrs" },
      { key: "instances", label: "Instances", type: "number", ph: "15", suffix: "instances" },
      { key: "infinitySlots", label: "Infinity Slots", type: "number", ph: "3", suffix: "slots" },
      { key: "slotCategories", label: "Infinity Slot Categories", type: "text",
        ph: "Cocoa, Sugar, Flexible Film", full: true },
    ],
  },
  "Commodity Forecasting": {
    icon: "📈",
    fields: [
      { key: "commodities", label: "# of Commodities", type: "number", ph: "9" },
      { key: "horizonMonths", label: "Forecast Horizon", type: "number", ph: "6", suffix: "months" },
    ],
  },
  "Datahub": {
    icon: "🗄",
    fields: [
      { key: "connectorType", label: "Connector Type", type: "select",
        options: ["SAP", "Coupa", "Ariba", "Oracle", "Custom"] },
      { key: "dataSlices", label: "# of Data Slices", type: "number", ph: "3" },
    ],
  },
  "GSA": {
    icon: "📋",
    fields: [
      { key: "count", label: "# of GSAs", type: "number", ph: "3" },
      { key: "duration", label: "Duration", type: "text", ph: "e.g., 6 months, 12 weeks, 1 year" },
    ],
  },
  "Cirtuo": {
    icon: "🎯",
    fields: [{ key: "categories", label: "# of Categories Enabled", type: "number", ph: "4" }],
  },
  "Sourcing Optimizer": {
    icon: "⚙",
    fields: [{ key: "events", label: "# of Events / year", type: "number", ph: "6" }],
  },
  "Alerts and Updates": {
    icon: "🔔",
    fields: [
      { key: "subscribers", label: "# of Subscribers", type: "number", ph: "98" },
      { key: "channels", label: "Channels", type: "multi", full: true,
        options: ["Email", "Teams", "In-app", "Slack"] },
    ],
  },
  "Inflation Watch": {
    icon: "📊",
    fields: [{ key: "categories", label: "# of Categories Tracked", type: "number", ph: "12" }],
  },
  "Spend Analytics": {
    icon: "📉",
    fields: [
      { key: "cubes", label: "# of Spend Cubes", type: "number", ph: "2" },
      { key: "categoriesAnalyzed", label: "# of Categories Analyzed", type: "number", ph: "25" },
    ],
  },
  "nnamu": {
    icon: "🌐",
    fields: [{ key: "users", label: "# of Users", type: "number", ph: "28" }],
  },
  "Prism": {
    icon: "🔮",
    fields: [{ key: "costModels", label: "# of Cost Models", type: "number", ph: "5" }],
  },
  "Supply Chain Risk": {
    icon: "🌍",
    fields: [
      { key: "supplyChains", label: "# of Supply Chains", type: "number", ph: "3" },
      { key: "tierDepth", label: "Tier Depth", type: "select",
        options: ["T1", "T1+T2", "T1+T2+T3", "Beyond T3"] },
    ],
  },
  "Opp Assessment": {
    icon: "🧭",
    fields: [{ key: "assessments", label: "# of Assessments / year", type: "number", ph: "4" }],
  },
  "Diverse Supplier Discovery": {
    icon: "🌟",
    fields: [
      { key: "searches", label: "# of Searches / year", type: "number", ph: "12" },
      { key: "classifications", label: "Diversity Classifications", type: "multi", full: true,
        options: ["Women-owned", "Minority-owned", "Veteran-owned",
          "LGBTQ+-owned", "Small Business", "Disability-owned"] },
    ],
  },
  "Hackett": {
    icon: "🏛",
    fields: [{ key: "benchmarks", label: "# of Benchmarks", type: "number", ph: "6" }],
  },
  "Copilot": {
    icon: "🤝",
    fields: [{ key: "users", label: "# of Users", type: "number", ph: "50" }],
  },
  "Connector Fee": {
    icon: "🔌",
    fields: [
      { key: "connectorName", label: "Connector Name", type: "text", ph: "Power BI, Tableau, etc." },
      { key: "connections", label: "# of Connections", type: "number", ph: "1" },
    ],
  },
};

export interface SignAccountBody {
  gate_signed_date: string; // yyyy-mm-dd
  gate_contract_acv: string | number;
  gate_contract_term: string;
  gate_contract_modules?: string[];
  gate_platform_tier?: string | null;
  gate_account_segment?: string | null;
  gate_subscribers?: string | null;
}

export interface UnlockSigningBody {
  reason: string;
}

export interface HandoverChecklistBody {
  items: Record<string, boolean>;
}

export interface ContractDocBody {
  gate_contract_doc: string | null;
}

/** The four canonical handover-quality items. The dict on the wire is
 * open-ended (jsonb), but these are the keys the UI renders. */
export const HANDOVER_QC_ITEMS = [
  { key: "savings",        label: "Savings target captured" },
  { key: "stakeholders",   label: "Stakeholder roster (3 roles)" },
  { key: "categories",     label: "Categories agreed in writing" },
  { key: "success_metric", label: "Success metric defined" },
] as const;

export const TERM_OPTIONS = [
  "1 year",
  "2 years",
  "3 years",
  "Custom",
] as const;

// 28-May — vocab ported verbatim from prototype line 6079-6092.
// Modules = pill-toggle list (multi-select); Platform Tier + Segment =
// fixed selects. Subscribers stays free-text since the prototype shows
// values like "Unlimited (Enterprise)" / numeric seat counts side by
// side.
export const MODULE_OPTIONS = [
  "Category Watch",
  "Abi Intelligence",
  "Benchmarks",
  "Custom Credits",
  "Supplier Discovery",
  "Risk Watch",
  "MMD",
] as const;

export const PLATFORM_TIER_OPTIONS = [
  "EL Plus",
  "EL Base",
  "Professional",
  "Starter",
  "N/A",
] as const;

export const SEGMENT_OPTIONS = ["A", "B", "C", "D"] as const;
