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
      // Mirrors the 17 sub-tabs of the Analytics tab so the BR deck can
      // cover every module surface 1:1. Some IDs overlap with other
      // groups (e.g. s8 also lives in Health) — that's intentional: the
      // picker shows the slide in whichever group makes sense for the
      // user. Duplicates are de-duped at render time.
      { id: "s10", name: "Category Watch", description: "Subscribers, categories, avg/user, top-cat bar chart (Live.ai)" },
      { id: "s14", name: "Abi", description: "Queries, complexity mix, top types, resolution rate" },
      { id: "s19", name: "Supplier Discovery", description: "Discovery searches + supplier shortlist activity" },
      { id: "s15", name: "Supplier Monitoring", description: "Tracked count, risk breakdown, top suppliers list" },
      { id: "s20", name: "Custom Usage", description: "Custom Credits deep dive — slots, instances, hours" },
      { id: "s21", name: "Thought Leadership", description: "Content views, downloads, top reads" },
      { id: "s22", name: "DataHub", description: "DataHub adoption, queries, datasets pulled" },
      { id: "s11", name: "Inflation Watch GIT", description: "Categories tracked, views, neg-prep + trend chart" },
      { id: "s23", name: "Cirtuo", description: "Sourcing-strategy plans built, strategies in flight" },
      { id: "s24", name: "nnamu", description: "nnamu engagement and module usage" },
      { id: "s25", name: "Upply", description: "Upply integration usage, search depth" },
      { id: "s26", name: "Alerts", description: "Alert subscriptions, fires, response rate" },
      { id: "s27", name: "Platform Training", description: "Sessions, attendees, completion rate" },
      { id: "s17", name: "NPS · Voice of Customer", description: "NPS score + breakdown + VoC quotes" },
      { id: "s18", name: "Super Users", description: "Top 5 power users by logins / CW / Abi / SD / hours" },
      { id: "s8",  name: "Auto-computed Scores · 12", description: "Composite + 11 sub-scores with bands (also in Health group)" },
      { id: "s13", name: "MMD · Module Activity", description: "Per-module usage totals (MMD / Abi / SD / DL / BM)" },
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

// De-duped: a slide can appear in multiple groups (e.g. s8 in both Health
// and Modules) but ALL_SLIDE_IDS should only carry each id once.
export const ALL_SLIDE_IDS: string[] = Array.from(
  new Set(SLIDE_GROUPS.flatMap((g) => g.slides.map((s) => s.id))),
);
