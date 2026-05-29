// Mirrors apps/api/app/schemas/platform_intel.py.

export type CatHeat = "hot" | "warm" | "whitespace" | "cold";
export type SupplierRisk = "high" | "med_high" | "med" | "low";
export type VocSentiment = "positive" | "neutral" | "negative";
export type CatInsightTone = "ok" | "warn" | "red";

export interface SectionAvg {
  price: number;
  supplier: number;
  market: number;
  forecast: number;
  risk: number;
}

export interface CatHeatItem {
  name: string;
  visits: number;
  heat: CatHeat;
}

export interface CatInsight {
  text: string;
  tone: CatInsightTone;
}

export interface CatIntel {
  section_avg: SectionAvg;
  top_cats: CatHeatItem[];
  insights: CatInsight[];
}

export interface SupplierByRisk {
  high: number;
  med_high: number;
  med: number;
  low: number;
}

export interface TrackedSupplier {
  name: string;
  cat: string | null;
  country: string | null;
  risk: SupplierRisk;
}

export interface SupplierWatch {
  tracked: number;
  by_risk: SupplierByRisk;
  suppliers: TrackedSupplier[];
}

export interface AbiComplexityMix {
  l1a: number;
  l1m: number;
  l2: number;
  l3: number;
  l4: number;
}

export interface AbiIntel {
  total_queries: number;
  queries_per_user: number;
  resolution_rate: string | null;
  avg_response: string | null;
  complexity_mix: AbiComplexityMix;
  top_types: string[];
  insight: string | null;
}

export interface BenchmarkAvgs {
  avg_health: number;
  avg_seat_pct: number;
  avg_abi: number;
  avg_logins: number;
  avg_engagement: number;
}

export interface UserSegmentation {
  cat_managers: number;
  buyers: number;
  sourcing_analysts: number;
  directors: number;
  exec_team: number;
  coe: number;
  cpo: number;
}

export interface EngagementIntel {
  alerts: number;
  newsletters: number;
  webinars: number;
  podcasts: number;
  training: number;
  user_segmentation: UserSegmentation;
}

export interface VocItem {
  quote: string;
  author: string | null;
  role: string | null;
  sentiment: VocSentiment;
  date: string | null;
}

export interface NpsIntel {
  score: number | null;
  voc: VocItem[];
}

export interface UsageIntel {
  months: string[];
  monthly_logins: number[];
  monthly_active: number[];
  licensed_users: number;
  active_seats: number;
  inactive_seats: number;
}

export interface ModulesMonthly {
  mmd: number[];
  abi: number[];
  sd: number[];
  dl: number[];
  bm: number[];
}

export interface ModulesIntel {
  mmd: number;
  abi: number;
  sd: number;
  dl: number;
  bm: number;
  monthly: ModulesMonthly;
}

export interface SuperUser {
  name: string;
  role: string | null;
  logins: number;
  cw_views: number;
  abi_queries: number;
  sd_searches: number;
  hours: number;
}

export interface PlatformIntel {
  account_id: string;
  cat_intel: CatIntel;
  supplier_watch: SupplierWatch;
  abi: AbiIntel;
  benchmark: BenchmarkAvgs;
  engagement: EngagementIntel;
  nps: NpsIntel;
  usage: UsageIntel;
  modules: ModulesIntel;
  super_users: SuperUser[];
  has_data: boolean;
  is_editable: boolean;
}

// Mirrors prototype heat icon mapping.
export const HEAT_ICON: Record<CatHeat, string> = {
  hot: "🔥",
  warm: "🤝",
  whitespace: "⭐",
  cold: "❄",
};

// Category-heat palette — brand-locked. Hot uses Risk Red (high
// engagement = hot/critical), warm uses Risk Amber, whitespace stays
// brand mid-grey, cold uses Soft Gray.
export const HEAT_COLOR: Record<CatHeat, string> = {
  hot: "#CF4548",
  warm: "#F0BC41",
  whitespace: "#94a3b8",
  cold: "#EAF1F5",
};

// Supplier-risk palette — brand RAG triad. high + med_high collapse
// to two shades of Risk Red; med = Risk Amber; low = Risk Green.
export const RISK_COLOR: Record<SupplierRisk, string> = {
  high: "#CF4548",
  med_high: "#CF454880",
  med: "#F0BC41",
  low: "#6EC457",
};

export const RISK_LABEL: Record<SupplierRisk, string> = {
  high: "High",
  med_high: "Med-High",
  med: "Medium",
  low: "Low",
};
