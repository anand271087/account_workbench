// Account ↔ Beroe product roster types.
// Mirrors apps/api/app/routes/account_products.py.

export interface ProductRow {
  product_key: string;        // snake_case, e.g. "category_watch"
  label: string;              // pretty name, e.g. "Category Watch"
  purchased: boolean | null;  // true = Yes, false = No, null = unknown
  source: "import" | "manual" | "api" | null;
  updated_at: string | null;
}

export interface ProductsResponse {
  account_id: string;
  items: ProductRow[];
}

// Catalogue order — frontend renders the grid in this exact order so
// rows are deterministic and match the XLSX import column order.
// Keep in sync with PRODUCT_KEYS in services/account_import.py.
export const PRODUCT_CATALOGUE: { key: string; label: string }[] = [
  { key: "category_watch",              label: "Category Watch" },
  { key: "category_watch_2",            label: "Category Watch 2" },
  { key: "abi",                         label: "ABI" },
  { key: "supplier_discovery",          label: "Supplier Discovery" },
  { key: "supplier_monitoring_risk",    label: "Supplier Monitoring Risk" },
  { key: "custom_credits",              label: "Custom Credits" },
  { key: "thought_leadership",          label: "Thought Leadership" },
  { key: "datahub",                     label: "DataHub" },
  { key: "inflation_watch_git",         label: "Inflation Watch GIT" },
  { key: "cirtuo",                      label: "Cirtuo" },
  { key: "nnamu",                       label: "nnamu" },
  { key: "upply",                       label: "Upply" },
  { key: "alerts",                      label: "Alerts" },
  { key: "commodity_forecasting",       label: "Commodity Forecasting" },
  { key: "sourcing_optimizer",          label: "Sourcing Optimizer" },
  { key: "gsa",                         label: "GSA" },
  { key: "spend_analytics",             label: "Spend Analytics" },
  { key: "opp_assessment",              label: "Opp Assessment" },
  { key: "diverse_supplier_discovery",  label: "Diverse Supplier Discovery" },
  { key: "hackett",                     label: "Hackett" },
  { key: "abi_on_copilot",              label: "Abi on CoPilot" },
  { key: "abi_on_teams",                label: "ABI on Teams" },
  { key: "abi_hitl",                    label: "ABI HITL" },
  { key: "abi_pro_compare_suppliers",   label: "ABI Pro · Compare Suppliers" },
  { key: "abi_pro_negotiation_prep",    label: "ABI Pro · Negotiation Prep" },
  { key: "analyst_validation",          label: "Analyst Validation" },
  { key: "prism",                       label: "Prism" },
  { key: "procurability_reports",       label: "Procurability Reports" },
];
