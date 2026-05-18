// Mirrors apps/api/app/schemas/intel_news.py.

export type IntelCategory =
  | "financial_performance"
  | "supply_chain"
  | "supplier_strategy"
  | "expansion_capex"
  | "regulatory_compliance"
  | "sustainability_esg"
  | "digital_transformation"
  | "risk_geopolitical"
  | "product_innovation"
  | "m_and_a";

export type SignalRelevance = "high" | "medium" | "low";

export interface IntelNewsItem {
  id: string;
  account_id: string;
  category: IntelCategory;
  headline: string;
  summary: string | null;
  source: string | null;
  source_url: string | null;
  news_date: string | null;
  signal_relevance: SignalRelevance;
  is_new: boolean;
  signal_created: boolean;
  signal_id: string | null;
  ai_generated: boolean;
  hidden: boolean;
  added_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface IntelNewsListResponse {
  items: IntelNewsItem[];
  total: number;
  is_editable: boolean;
}

export interface IntelNewsCreate {
  category: IntelCategory;
  headline: string;
  summary?: string | null;
  source?: string | null;
  source_url?: string | null;
  news_date?: string | null;
  signal_relevance?: SignalRelevance;
}

export interface IntelRefreshResponse {
  created: number;
  is_stub: boolean;
}

// Display order matches the prototype's filter strip.
export const INTEL_CATEGORIES: IntelCategory[] = [
  "financial_performance",
  "supply_chain",
  "supplier_strategy",
  "expansion_capex",
  "regulatory_compliance",
  "sustainability_esg",
  "digital_transformation",
  "risk_geopolitical",
  "product_innovation",
  "m_and_a",
];

export const CATEGORY_LABELS: Record<IntelCategory, string> = {
  financial_performance: "Financial Performance & Cost Pressure",
  supply_chain: "Supply Chain Disruptions",
  supplier_strategy: "Supplier Strategy & Partnerships",
  expansion_capex: "Expansion & Capex Plans",
  regulatory_compliance: "Regulatory & Compliance Changes",
  sustainability_esg: "Sustainability & ESG Initiatives",
  digital_transformation: "Digital Transformation & Procurement Tech",
  risk_geopolitical: "Risk Signals & Geopolitical Exposure",
  product_innovation: "Product / Innovation Strategy",
  m_and_a: "M&A, Divestments & Restructuring",
};

// Mirrors the prototype's catCol palette.
export const CATEGORY_COLOR: Record<IntelCategory, string> = {
  financial_performance: "#e63950",
  supply_chain: "#FD576B",
  supplier_strategy: "#4A00F8",
  expansion_capex: "#2fb87a",
  regulatory_compliance: "#a830b0",
  sustainability_esg: "#40CC8F",
  digital_transformation: "#35E1D4",
  risk_geopolitical: "#e63950",
  product_innovation: "#EF9637",
  m_and_a: "#C344C7",
};

export const RELEVANCE_LABELS: Record<SignalRelevance, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};
