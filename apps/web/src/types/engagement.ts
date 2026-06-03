// Mirrors apps/api/app/schemas/engagement.py.

export type MaturityLevel = "low" | "medium" | "high";

// ISO-4217 codes mirroring SpendCurrency in apps/api/app/schemas/engagement.py
// and the CHECK constraint in migration 0057.
export type SpendCurrency =
  | "USD" | "EUR" | "GBP" | "INR" | "JPY" | "CNY" | "AUD" | "CAD" | "CHF"
  | "SGD" | "AED" | "SAR" | "HKD" | "BRL" | "MXN" | "ZAR" | "SEK" | "NOK"
  | "DKK" | "NZD" | "KRW" | "THB" | "MYR" | "IDR" | "PHP" | "TRY" | "RUB";

export const SPEND_CURRENCIES: { code: SpendCurrency; label: string; symbol: string }[] = [
  { code: "USD", label: "US Dollar",       symbol: "$"   },
  { code: "EUR", label: "Euro",            symbol: "€"   },
  { code: "GBP", label: "Pound Sterling",  symbol: "£"   },
  { code: "INR", label: "Indian Rupee",    symbol: "₹"   },
  { code: "JPY", label: "Japanese Yen",    symbol: "¥"   },
  { code: "CNY", label: "Chinese Yuan",    symbol: "¥"   },
  { code: "AUD", label: "Australian Dollar", symbol: "A$" },
  { code: "CAD", label: "Canadian Dollar", symbol: "C$"  },
  { code: "CHF", label: "Swiss Franc",     symbol: "Fr"  },
  { code: "SGD", label: "Singapore Dollar", symbol: "S$" },
  { code: "AED", label: "UAE Dirham",      symbol: "د.إ" },
  { code: "SAR", label: "Saudi Riyal",     symbol: "﷼"   },
  { code: "HKD", label: "Hong Kong Dollar", symbol: "HK$"},
  { code: "BRL", label: "Brazilian Real",  symbol: "R$"  },
  { code: "MXN", label: "Mexican Peso",    symbol: "Mex$"},
  { code: "ZAR", label: "South African Rand", symbol: "R" },
  { code: "SEK", label: "Swedish Krona",   symbol: "kr"  },
  { code: "NOK", label: "Norwegian Krone", symbol: "kr"  },
  { code: "DKK", label: "Danish Krone",    symbol: "kr"  },
  { code: "NZD", label: "NZ Dollar",       symbol: "NZ$" },
  { code: "KRW", label: "South Korean Won", symbol: "₩"  },
  { code: "THB", label: "Thai Baht",       symbol: "฿"   },
  { code: "MYR", label: "Malaysian Ringgit", symbol: "RM" },
  { code: "IDR", label: "Indonesian Rupiah", symbol: "Rp" },
  { code: "PHP", label: "Philippine Peso", symbol: "₱"   },
  { code: "TRY", label: "Turkish Lira",    symbol: "₺"   },
  { code: "RUB", label: "Russian Ruble",   symbol: "₽"   },
];

export interface Engagement {
  account_id: string;
  sdr_lead: string | null;
  pre_discovery_date: string | null;
  discovery_lead: string | null;
  sales_lead: string | null;
  target_categories: string[];
  engagement_objective: string | null;
  procurement_maturity: MaturityLevel | null;
  ai_penetration: MaturityLevel | null;
  procurement_spend_musd: string | null;
  procurement_spend_currency: SpendCurrency | null;
  geographies: string[];
  spoc_text: string | null;
  sponsor_text: string | null;
  power_users_text: string | null;
  ai_quality_score: number | null;
  ai_quality_dismissed: boolean;
  updated_at: string;
  updated_by: string | null;
  is_editable: boolean;
}

export type EngagementUpdate = Partial<
  Omit<Engagement, "account_id" | "updated_at" | "updated_by" | "is_editable" | "ai_quality_score">
>;

export interface QualityCheckResponse {
  score: number; // 1..5
  comment: string;
  word_count: number;
  is_stub: boolean;
}
