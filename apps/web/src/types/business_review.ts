// Business Review types.
//
// Mirror of apps/api/app/schemas/business_review.py — the wire shape
// returned by the BR endpoints. The frontend never builds deck content
// client-side; it consumes the rendered HTML / PDF / PPTX from the
// backend.

export type BRCadence = "monthly" | "quarterly" | "renewal" | "custom";

export interface BROut {
  id: string;
  account_id: string;
  cadence: BRCadence;
  period_label: string;
  period_start: string | null; // ISO date
  period_end: string | null;
  generated_by: string | null;
  generated_by_name?: string | null;
  generated_at: string; // ISO datetime
}

export interface BRListResponse {
  items: BROut[];
  total: number;
}

export interface GenerateBRRequest {
  cadence: BRCadence;
  period_start?: string;
  period_end?: string;
  period_label?: string;
  slide_ids?: string[];
}

export const CADENCE_LABEL: Record<BRCadence, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  renewal: "Renewal",
  custom: "Custom",
};

// Slide catalogue — mirrors the order + IDs the backend renders.
// Grouped for the customize-slides picker.
export interface SlideDef {
  id: string;
  name: string;
  description: string;
}
export interface SlideGroup {
  id: string;
  name: string;
  emoji: string;
  slides: SlideDef[];
}

export const SLIDE_GROUPS: SlideGroup[] = [
  {
    id: "context",
    name: "Context",
    emoji: "🧭",
    slides: [
      { id: "s1", name: "Title slide", description: "Cover with account + period + cadence" },
      { id: "s4", name: "Executive Snapshot", description: "Health, ARR, cost avoidance, renewal, engagement KPIs" },
      { id: "s5", name: "Contract Summary", description: "Start / end / term / ACV / billing / sponsor / modules" },
    ],
  },
  {
    id: "credits",
    name: "Custom Credits",
    emoji: "💎",
    slides: [
      { id: "s2", name: "Custom Credits", description: "FTE, hours, fixed-fee instances, Infinity Slots" },
    ],
  },
  {
    id: "risks",
    name: "Risks & Asks",
    emoji: "⚠️",
    slides: [
      { id: "s3", name: "Risks · Open · Asks", description: "Open items, risks, client asks" },
    ],
  },
  {
    id: "wins",
    name: "Wins",
    emoji: "🏆",
    slides: [
      { id: "s6", name: "Accomplishments & Milestones", description: "Value-delivered cards with $ amounts" },
      { id: "s7", name: "Upsell & Expansion Pipeline", description: "Active conversations + status + value" },
    ],
  },
  {
    id: "health",
    name: "Health",
    emoji: "❤️",
    slides: [
      { id: "s8", name: "Account Health · 12 scores", description: "Composite + 11 sub-scores with bands" },
      { id: "s9", name: "Subscribers & Engagement", description: "Seats, active 30d, logins, hours + trend chart" },
    ],
  },
  {
    id: "modules",
    name: "Modules · deep dives",
    emoji: "📦",
    slides: [
      { id: "s10", name: "Live.ai · Category Watch", description: "Subscribers, categories, avg/user + top-cat bar chart" },
      { id: "s11", name: "Inflation Watch GIT", description: "Categories tracked, views, neg-prep + trend chart" },
      { id: "s13", name: "MMD · Module Activity", description: "Per-module usage totals (MMD / Abi / SD / DL / BM)" },
      { id: "s14", name: "Abi Intelligence", description: "Queries, complexity mix, top types, resolution rate" },
      { id: "s15", name: "Supplier Watch", description: "Tracked count, risk breakdown, top suppliers list" },
      { id: "s16", name: "Industry Benchmark", description: "This account vs industry averages across 5 KPIs" },
      { id: "s17", name: "NPS · Voice of Customer", description: "NPS score + promoters/passives/detractors + VoC quotes" },
      { id: "s18", name: "Super Users", description: "Top 5 power users by logins / CW / Abi / SD / hours" },
    ],
  },
  {
    id: "wrap",
    name: "Wrap",
    emoji: "👋",
    slides: [
      { id: "s12", name: "Closer / Thank You", description: "Next review + thank-you slide" },
    ],
  },
];

export const ALL_SLIDE_IDS: string[] = SLIDE_GROUPS.flatMap((g) =>
  g.slides.map((s) => s.id),
);
