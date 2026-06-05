// 05-Jun · Beroe Business Review deck — deck structure + cadence presets +
// HTML / PPT exporters. Faithful port of
// /Users/anandkaliappan/Desktop/Beroe/new protoypes/beroe_br_generator_proto.html
//
// Brand-locked palette only (replaces prototype's off-brand triad):
//   Risk Red #CF4548  (was #FD576B / dc2626)
//   Risk Amber #F0BC41 (was #EF9637 / d97706)
//   Risk Green #6EC457 (was #40CC8F / 059669)
//   Bumblebee #FFE61E  (was YELLOW #FFD100)
//
// Mondelez sample values in the slide bodies are ported verbatim from the
// prototype (demo-only). When live account data wires through (v1.1),
// every renderSlideXxx() function reads from the account context.

import PptxGenJS from "pptxgenjs";

// ---------------------------------------------------------------------------
// Deck structure
// ---------------------------------------------------------------------------
export interface Slide {
  id: string;
  name: string;
  readTime: number;
  hero?: boolean;
}
export interface DeckGroup {
  id: string;
  name: string;
  emoji: string;
  slides: Slide[];
}

export const DECK_STRUCTURE: DeckGroup[] = [
  {
    id: "context",
    name: "Context",
    emoji: "🧭",
    slides: [
      { id: "s1", name: "Title", readTime: 0.3 },
      { id: "s2", name: "Executive Snapshot", readTime: 1.0 },
      { id: "s3", name: "Contract Summary", readTime: 1.5 },
    ],
  },
  {
    id: "wins",
    name: "Wins",
    emoji: "🏆",
    slides: [
      { id: "s4", name: "Accomplishments & Milestones", readTime: 1.5 },
      { id: "s5", name: "Upsell & Expansion Pipeline", readTime: 1.2 },
    ],
  },
  {
    id: "health",
    name: "Health",
    emoji: "❤️",
    slides: [
      { id: "s6", name: "Account Health · 12 scores", readTime: 1.5 },
      { id: "s7", name: "Subscribers & Engagement", readTime: 1.0 },
    ],
  },
  {
    id: "modules",
    name: "Module Deep-dives",
    emoji: "🧩",
    slides: [
      { id: "s8", name: "Live.ai · Category Watch", readTime: 0.8, hero: true },
      { id: "s9", name: "MMD (Market Movement)", readTime: 0.8 },
      { id: "s10", name: "Abi", readTime: 0.8 },
      { id: "s11", name: "Supplier Discovery (+ Diverse)", readTime: 0.8 },
      { id: "s12", name: "Supplier Watch (Risk)", readTime: 0.8 },
      { id: "s13", name: "Inflation Watch GIT", readTime: 0.8, hero: true },
      { id: "s14", name: "Custom Credits", readTime: 0.8, hero: true },
      { id: "s15", name: "DataHub", readTime: 0.8 },
      { id: "s16", name: "Cirtuo", readTime: 0.8 },
      { id: "s17", name: "Sourcing Optimizer", readTime: 0.8 },
      { id: "s18", name: "nnamu", readTime: 0.8 },
      { id: "s19", name: "Upply", readTime: 0.8 },
      { id: "s20", name: "Alerts & Updates", readTime: 0.8 },
      { id: "s21", name: "Training & NPS", readTime: 0.8 },
    ],
  },
  {
    id: "wrap",
    name: "Wrap",
    emoji: "🤝",
    slides: [
      { id: "s22", name: "Risks · Open · Asks", readTime: 1.2 },
      { id: "s23", name: "Closing", readTime: 0.5 },
    ],
  },
];

export const TOTAL_SLIDES = DECK_STRUCTURE.reduce(
  (s, g) => s + g.slides.length,
  0,
);
export const ALL_SLIDE_IDS = DECK_STRUCTURE.flatMap((g) =>
  g.slides.map((s) => s.id),
);
export const HERO_MODULES = DECK_STRUCTURE.find((g) => g.id === "modules")!
  .slides.filter((s) => s.hero)
  .map((s) => s.id);

export type Cadence = "monthly" | "quarterly" | "renewal" | "custom";

export const CADENCE_PRESETS: Record<
  Cadence,
  { label: string; emoji: string; desc: string; slides: string[] }
> = {
  monthly: {
    label: "Monthly BR",
    emoji: "📅",
    desc: "Exec-summary level: Context + Wins + Health + top-3 hero modules + Wrap.",
    slides: [
      "s1",
      "s2",
      "s3",
      "s4",
      "s5",
      "s6",
      "s7",
      ...HERO_MODULES,
      "s22",
      "s23",
    ],
  },
  quarterly: {
    label: "Quarterly BR",
    emoji: "📊",
    desc: "Comprehensive — all 23 slides. Use for full QBR with client.",
    slides: [...ALL_SLIDE_IDS],
  },
  renewal: {
    label: "Renewal BR",
    emoji: "🛡",
    desc: "Comprehensive + pipeline-heavy emphasis. Use ahead of renewal cycle.",
    slides: [...ALL_SLIDE_IDS],
  },
  custom: {
    label: "Custom",
    emoji: "⚙",
    desc: "Pick sections manually. No pre-selection.",
    slides: [],
  },
};

export function slidesIn(set: Set<string>): Slide[] {
  return ALL_SLIDE_IDS.filter((id) => set.has(id))
    .map((id) => {
      for (const g of DECK_STRUCTURE) {
        const s = g.slides.find((x) => x.id === id);
        if (s) return s;
      }
      return null;
    })
    .filter((s): s is Slide => s !== null);
}
export function totalReadTime(set: Set<string>): number {
  return slidesIn(set).reduce((s, sl) => s + sl.readTime, 0);
}

// ---------------------------------------------------------------------------
// Brand-locked colors (no #) for PptxGenJS
// ---------------------------------------------------------------------------
const NAVY = "001137";
const BLUE = "4A00F8";
const YELLOW = "FFE61E"; // brand Bumblebee (replaces prototype #FFD100)
const GREEN = "6EC457"; // brand Risk Green (replaces #059669)
const AMBER = "F0BC41"; // brand Risk Amber (replaces #d97706)
const RED = "CF4548"; // brand Risk Red (replaces #dc2626)
const T1 = "0d1b2e";
const T2 = "3d4b6e";
const T3 = "7b87aa";
const FONT = "DM Sans";

// ---------------------------------------------------------------------------
// Mondelez sample content — ported verbatim from prototype.
// TODO v1.1 — replace with live account data when ETL ships.
// ---------------------------------------------------------------------------
const SAMPLE_CONTRACT_ROWS: [string, string][] = [
  ["Contract start", "1 Jan 2024"],
  ["Contract end / renewal", "31 Dec 2026 · 211 days"],
  ["Term", "3 years (auto-renew)"],
  ["ACV", "$850,000 USD"],
  ["Billing", "Annual · PO #MDLZ-PRO-22418"],
  ["Licensed seats", "124 (+25 in proposal)"],
  ["Geography", "Global · EU lead"],
  ["Sponsor", "R. Mendes · VP Procurement, Chocolate"],
];

const SAMPLE_MODULES_IN_SCOPE = [
  "Live.ai · Category Watch",
  "MMD",
  "Abi",
  "Supplier Discovery+",
  "Supplier Watch",
  "Inflation Watch GIT",
  "Custom Credits",
  "Cirtuo",
  "Upply",
  "nnamu",
  "DataHub (IMPL)",
];

const SAMPLE_WINS = [
  {
    hero: "$1.6M",
    title: "Cocoa renegotiation — Olam Q3",
    sub: "Chocolate BU · EU",
    desc: "Capped pass-through at ICE main-month delta.",
  },
  {
    hero: "$0.9M",
    title: "Flexible film RFP · VN/PL",
    sub: "Packaging · Bournville",
    desc: "62 surfaced → 11 shortlisted → Constantia awarded.",
  },
  {
    hero: "7",
    title: "EUDR readiness — Tier-2 map",
    sub: "Cocoa & palm origin",
    desc: "Audit-ready by Aug.",
  },
  {
    hero: "3",
    title: "Infinity Slots delivered",
    sub: "Cocoa · Sugar · Flex Film",
    desc: "Bi-weekly refresh cadence locked.",
  },
  {
    hero: "4",
    title: "Cirtuo strategies built",
    sub: "Cocoa · Sugar · SMP · Film",
    desc: "SMP approved by Procurement Council.",
  },
  {
    hero: "78",
    title: "Training attendance · Q1",
    sub: "6 sessions",
    desc: "Onboarded 78 unique users.",
  },
];

const SAMPLE_PIPELINE: [string, string, string][] = [
  ["DataHub · production tier", "CLOSING", "+$95K"],
  ["+25 seats · LATAM Biscuit", "CLOSING", "+$85K"],
  ["Sourcing Optimizer · pilot→prod", "DISCUSSION", "+$70K"],
  ["Diverse Supplier Discovery add-on", "DISCUSSION", "+$45K"],
];
const SAMPLE_ROADMAP_BULLETS = [
  "Prism (+$65K · Pitched)",
  "Opp Assessment (+$50K · Pitched)",
  "GSA (+$110K · Exploring)",
  "Hackett (+$40K · Exploring)",
  "Copilot (Roadmap)",
  "Connector Fee (+$25K · Roadmap)",
];

const SAMPLE_HEALTH_SCORES: [string, string, string][] = [
  ["Account Health (composite)", "73", "HEALTHY"],
  ["Product Score", "76", "HEALTHY"],
  ["Soft Signals Score", "70", "HEALTHY"],
  ["License Activation", "72%", "HEALTHY"],
  ["Usage Trend", "+18%", "HEALTHY"],
  ["Abi Engagement", "9.1", "HEALTHY"],
  ["Platform Breadth", "9 / 13", "HEALTHY"],
  ["Platform Depth", "4.6 hr", "HEALTHY"],
  ["Renewal Risk (DTR)", "211 days", "WATCH"],
  ["NPS", "52", "HEALTHY"],
  ["Stakeholder Coverage", "3 of 5", "WATCH"],
  ["Outcome Attribution", "$4.2M / $5M", "HEALTHY"],
];

const SAMPLE_S22 = {
  open: [
    "DataHub InfoSec sign-off · target 18 Jun",
    "Gum & Candy onboarding · 18 Jul",
    "Recurring cocoa-origin digest cadence",
    "Diverse Supplier Discovery ROI deck",
    "Sourcing Optimizer prod proposal",
  ],
  risks: [
    "Stakeholder coverage 3/5 — Bis VP not engaged",
    "Hours burn 70% with 5 mo left",
    "Gum & Candy adoption 14% — overdue",
    "Renewal in 211d — early-window opens Sep",
    "Olam CI alert needs MDLZ action owner",
  ],
  asks: [
    "InfoSec sign-off on DataHub slice",
    "Confirm Gum & Candy training attendees",
    "Owner for Olam CI alert action plan",
    "Q2 Inflation Watch category priorities",
    "Renewal stakeholder mapping (Bis + LATAM)",
  ],
};

// Module-slide KPI sets — keyed by slide id
const MODULE_SLIDES: Record<
  string,
  { title: string; emoji: string; kpis: string[]; footnote: string }
> = {
  s8: {
    title: "Live.ai · Category Watch",
    emoji: "🤖",
    kpis: [
      "Subscribers: 89 of 124",
      "Categories unlocked: 65 (47 Ent + 18 Non-Ent)",
      "Avg cat/user: 2.4 (benchmark 1.8)",
      "New cat added Q1: 6",
      "Category visits Q1: 1,242",
      "Revisit %: 58%",
      "Industry-relevant %: 78%",
      "Time spent Q1: 142 hr",
    ],
    footnote:
      "Tier: EL Plus · Heat: 12 hot / 18 warm / 11 cold / 6 whitespace",
  },
  s9: {
    title: "MMD (Market Movement Dashboard)",
    emoji: "📊",
    kpis: [
      "Subscribers MMD: 67",
      "Pages viewed Q1: 1,840",
      "Time on MMD Q1: 142 hr",
      "Grades viewed: 24 of 41 mapped",
      "Reports downloaded: 82",
      "MMD vs Cat Reports: 58/42",
      "Top grade · time: Cocoa (38hr)",
      "Revisit %: 62%",
    ],
    footnote:
      "Sources subscribed: Bloomberg · Mintec Index · Intratec · Fastmarkets Metal Bulletin · Upply Freight Index · RISI",
  },
  s10: {
    title: "Abi",
    emoji: "🤖",
    kpis: [
      "Queries Q1: 812",
      "Queries May: 287 (↑6% MoM)",
      "Avg / active user: 9.1 (benchmark 6.5)",
      "Avg rating: 4.4★ of 5",
      "SLA met: 98%",
      "AI SWAT / BASICS: 62/38",
      "Escalation rate: 19%",
      "Top deliverable: Nego brief (38%)",
    ],
    footnote: "L1A: 412 · L1M: 156 · L2: 9 · L3: 3 · L4: 1 · Other: 231",
  },
  s11: {
    title: "Supplier Discovery (+ Diverse)",
    emoji: "🔍",
    kpis: [
      "Scouting projects Q1: 14 (8 closed · 6 active)",
      "Searches run: 28",
      "Suppliers profiled: 412",
      "Shortlisted: 47 (11% conversion)",
      "Progressed to RFP: 11",
      "Validate & Select used: 6 projects",
      "Diverse-supplier focus: 3 projects",
      "Time-to-shortlist (avg): 11d",
    ],
    footnote:
      "Diverse: 14 women-owned · 9 minority-owned · 3 veteran-owned surfaced",
  },
  s12: {
    title: "Supplier Watch (Risk)",
    emoji: "🛡",
    kpis: [
      "Suppliers monitored: 56",
      "D&B linked: 48 (86%)",
      "ESG (Kloopify) scored: 32 (57%)",
      "EUDR-exposed: 7",
      "Alerts May: 12 (2 crit · 5 high · 5 med)",
      "Alerts Q1: 38",
      "Adverse-media hits: 19",
      "Sanctions / PEPs: 0",
    ],
    footnote: "Risk distribution: 4 critical · 11 high · 22 medium · 19 low",
  },
  s13: {
    title: "Inflation Watch GIT",
    emoji: "📉",
    kpis: [
      "Categories tracked: 12 of 14 in scope",
      "Views Q1: 418",
      "Negotiation prep runs: 9",
      "Scenarios modelled: 23",
      "Cost avoidance attributed: $4.2M (84% of $5M)",
      "Top mover up: Cocoa Mass +15.9%",
      "Top mover down: Refined Sugar -3.1%",
      "Active power users: 14",
    ],
    footnote:
      "Top outcomes: Cocoa Olam Q3 $1.6M · Film $0.9M · SMP $0.6M",
  },
  s14: {
    title: "Custom Credits",
    emoji: "⚙",
    kpis: [
      "FTE allocation: 1.0 FTE",
      "Hours purchased: 400 hr",
      "Hours consumed YTD: 280 hr (70%)",
      "Hours remaining: 120 hr (5 mo left)",
      "Fixed-fee instances: 12 / 15 (80%)",
      "Instances in flight: 2",
      "Infinity Slots active: 3",
      "Slot refresh cadence: 2 wk",
    ],
    footnote:
      "Slots: Cocoa Mass (R. Mendes) · Refined Sugar NY11 (L. Costa) · Flexible Film (K. Adamski)",
  },
  s15: {
    title: "DataHub",
    emoji: "🗄",
    kpis: [
      "Status: IMPL (InfoSec review in flight)",
      "Data slices scoped: 3 (Choc spend · supplier · contracts)",
      "Sample slice received: 28 Apr",
      "Use cases mapped: 7",
      "Production go-live: Aug '26",
      "Expected uplift: +$95K ARR",
      "Connector type: SAP",
      "Refresh cadence: Weekly (at go-live)",
    ],
    footnote:
      "Milestone: Scoping ✓ · Sample ✓ · InfoSec ⏳ · UAT · Production",
  },
  s16: {
    title: "Cirtuo",
    emoji: "🎯",
    kpis: [
      "Categories enabled: 4",
      "Strategies built: 3 (SMP approved by Council)",
      "Saved scenarios: 8",
      "Power users: 9",
      "Hours on Cirtuo Q1: 48 hr",
      "Strategies in draft: 2 (Hazelnut · Palm)",
      "Avg time-to-strategy: 22d (vs 60+ internal)",
      "Pipeline: +2 cats quoted at $30K",
    ],
    footnote:
      "Mondelez strategies: SMP · Cocoa · Flex Film (approved); Sugar (draft)",
  },
  s17: {
    title: "Sourcing Optimizer",
    emoji: "⚙",
    kpis: [
      "Sourcing events run: 6 (3 awarded · 3 in flight)",
      "Bid scenarios solved: 18",
      "Suppliers in events: 42",
      "Bid lots / lines: 340",
      "Optimization $: $2.1M cost reduction modelled",
      "Time saved vs manual: ~60%",
      "Pilot status: 3/3 awarded events successful",
      "Convert to prod: Q3 '26",
    ],
    footnote:
      "Awarded: Flex Film $0.9M · Almond Paste $0.4M · Aluminum Foil $0.6M",
  },
  s18: {
    title: "nnamu",
    emoji: "🔗",
    kpis: [
      "Subscribers: 28 (22% of active)",
      "Queries Q1: 142",
      "Suppliers researched: 86",
      "Parent-co maps built: 18",
      "M&A alerts triggered: 7 (2 affected tier-1)",
      "Ultimate-owner discrepancies: 4",
      "Avg rating: 4.2★",
      "Top use-case: TPRM",
    ],
    footnote:
      "Recent alerts: Olam IPO progression · Wilmar palm divestment rumour · Constantia PE owner change",
  },
  s19: {
    title: "Upply",
    emoji: "📦",
    kpis: [
      "Commodities tracked: 9",
      "Forecasts requested Q1: 18",
      "Supply-chain reports: 6",
      "Horizon max: 12 mo",
      "Forecast accuracy (back-test): 87%",
      "Subscribers: 22",
      "Alerts received: 14",
      "Top use-case: Budget H2 FY26",
    ],
    footnote:
      "Top movers: Cocoa +15.9% · Palm +6.2% · Sugar -3.1% · Freight -2.4%",
  },
  s20: {
    title: "Alerts & Updates",
    emoji: "🔔",
    kpis: [
      "Alerts sent May: 84 (↑12% MoM)",
      "Alerts sent Q1: 241",
      "Open rate: 67% (benchmark 52%)",
      "Click-through: 38%",
      "Critical alerts: 12 (all acknowledged)",
      "Subscribers: 98 (79% of licensed)",
      "Channels: Email · in-app · MS Teams",
      "Unsubscribes Q1: 2",
    ],
    footnote:
      "Type mix: Risk 38% · Inflation 28% · Cat Updates 18% · Thought Leadership 10%",
  },
  s21: {
    title: "Training & NPS",
    emoji: "🎓",
    kpis: [
      "Sessions delivered Q1: 6",
      "Unique attendees: 78 (63% of licensed)",
      "Avg attendance: 13 / session",
      "Session NPS: 62",
      "Platform NPS: 52",
      "CSAT (rolling): 4.4★",
      "Thought leadership reads: 412",
      "Next session: 18 Jul (Gum & Candy onboarding)",
    ],
    footnote:
      "NPS verbatim: 'Inflation Watch saved us a tense quarter' — R. Mendes",
  },
};

// ---------------------------------------------------------------------------
// PPT generator
// ---------------------------------------------------------------------------
export async function exportBrPpt(
  selectedIds: string[],
  cadence: Cadence,
  accountName: string,
): Promise<string> {
  const slides = slidesIn(new Set(selectedIds));
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = `${accountName} Business Review`;
  pptx.author = "Beroe";
  slides.forEach((sl, i) =>
    renderSlideToPPT(pptx, sl, i, slides.length, accountName),
  );
  const fileName = `Beroe_BR_${accountName.replace(/\W+/g, "_")}_${cadence}_${new Date().toISOString().slice(0, 10)}.pptx`;
  await pptx.writeFile({ fileName });
  return fileName;
}

function renderSlideToPPT(
  pptx: PptxGenJS,
  sl: Slide,
  idx: number,
  total: number,
  accountName: string,
) {
  const s = pptx.addSlide();

  // Title / Closing — dark hero
  if (sl.id === "s1" || sl.id === "s23") {
    s.background = { color: NAVY };
    s.addText(sl.name === "Title" ? accountName : `Thank you, ${accountName}`, {
      x: 0.5,
      y: 2.2,
      w: 12,
      h: 1.2,
      fontSize: 44,
      bold: true,
      color: "FFFFFF",
      fontFace: FONT,
      align: sl.id === "s23" ? "center" : "left",
    });
    s.addText(
      sl.id === "s1"
        ? `${new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" })}`
        : "Next monthly review · Next QBR",
      {
        x: 0.5,
        y: 3.5,
        w: 12,
        h: 0.6,
        fontSize: 22,
        color: YELLOW,
        fontFace: FONT,
        align: sl.id === "s23" ? "center" : "left",
      },
    );
    s.addText("COMPREHENSIVE BUSINESS REVIEW", {
      x: 0.5,
      y: 1.4,
      w: 12,
      h: 0.4,
      fontSize: 11,
      bold: true,
      color: "FFFFFF",
      fontFace: FONT,
      charSpacing: 3,
      align: sl.id === "s23" ? "center" : "left",
    });
    s.addText("Beroe", {
      x: 11.5,
      y: 0.3,
      w: 1,
      h: 0.4,
      fontSize: 14,
      bold: true,
      color: YELLOW,
      fontFace: FONT,
      align: "right",
    });
    return;
  }

  // Standard slide header
  s.background = { color: "FFFFFF" };
  s.addText("·  " + sl.name.toUpperCase(), {
    x: 0.5,
    y: 0.3,
    w: 12,
    h: 0.3,
    fontSize: 10,
    bold: true,
    color: BLUE,
    fontFace: FONT,
    charSpacing: 2,
  });
  s.addText(sl.name, {
    x: 0.5,
    y: 0.55,
    w: 12,
    h: 0.55,
    fontSize: 26,
    bold: true,
    color: T1,
    fontFace: FONT,
  });
  s.addShape(pptx.ShapeType.line, {
    x: 0.5,
    y: 1.18,
    w: 12,
    h: 0,
    line: { color: "e5e7ef", width: 1 },
  });

  renderSlideContent(s, pptx, sl, accountName);

  // Footer
  s.addText(
    `${accountName} · BR · ${new Date().toLocaleDateString("en-GB", { month: "short", year: "numeric" })}`,
    {
      x: 0.5,
      y: 6.95,
      w: 6,
      h: 0.3,
      fontSize: 9,
      color: T3,
      fontFace: FONT,
    },
  );
  s.addText(`Slide ${idx + 1} of ${total}`, {
    x: 9.5,
    y: 6.95,
    w: 3,
    h: 0.3,
    fontSize: 9,
    color: T3,
    fontFace: FONT,
    align: "right",
  });
}

function renderSlideContent(
  // PptxGenJS slide type isn't exported on its own — use any locally.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  s: any,
  pptx: PptxGenJS,
  sl: Slide,
  _accountName: string,
) {
  const kpiTile = (
    x: number,
    y: number,
    w: number,
    h: number,
    label: string,
    value: string,
    sub?: string,
    color?: string,
  ) => {
    s.addShape(pptx.ShapeType.rect, {
      x,
      y,
      w,
      h,
      fill: { color: "FFFFFF" },
      line: { color: "e5e7ef", width: 1 },
    });
    s.addText(label, {
      x: x + 0.15,
      y: y + 0.1,
      w: w - 0.3,
      h: 0.25,
      fontSize: 9,
      bold: true,
      color: T3,
      fontFace: FONT,
      charSpacing: 1,
    });
    s.addText(value, {
      x: x + 0.15,
      y: y + 0.35,
      w: w - 0.3,
      h: 0.5,
      fontSize: 22,
      bold: true,
      color: color || T1,
      fontFace: FONT,
    });
    if (sub)
      s.addText(sub, {
        x: x + 0.15,
        y: y + 0.85,
        w: w - 0.3,
        h: 0.25,
        fontSize: 10,
        color: T3,
        fontFace: FONT,
      });
  };
  const bulletList = (
    x: number,
    y: number,
    w: number,
    bullets: string[],
    color?: string,
  ) => {
    const text = bullets.map((b) => ({
      text: b,
      options: {
        bullet: { type: "bullet" as const },
        color: color || T2,
        fontFace: FONT,
        fontSize: 13,
        paraSpaceAfter: 4,
      },
    }));
    s.addText(text, { x, y, w, h: 5, valign: "top" });
  };

  switch (sl.id) {
    case "s2": {
      // Executive snapshot
      kpiTile(
        0.5,
        1.4,
        2.9,
        1.2,
        "ACCOUNT HEALTH",
        "73 / 100",
        "↑ 6 pts QoQ · Healthy",
        GREEN,
      );
      kpiTile(
        3.5,
        1.4,
        2.9,
        1.2,
        "ARR IN SCOPE",
        "$850K",
        "+25 seat expansion in flight",
        BLUE,
      );
      kpiTile(
        6.5,
        1.4,
        2.9,
        1.2,
        "COST AVOIDANCE Q1",
        "$4.2M",
        "84% of $5M target",
        GREEN,
      );
      kpiTile(
        9.5,
        1.4,
        2.9,
        1.2,
        "RENEWAL",
        "31 Dec '26",
        "211 days · early-window opens Sep",
        AMBER,
      );
      s.addText("Engagement", {
        x: 0.5,
        y: 2.9,
        w: 4,
        h: 0.3,
        fontSize: 11,
        bold: true,
        color: BLUE,
        fontFace: FONT,
      });
      bulletList(0.5, 3.2, 4, [
        "Active 30d: 89 / 124 (72%)",
        "Logins Q1: 5,127 (↑18%)",
        "Hours Q1: 412",
        "Abi queries Q1: 812",
      ]);
      s.addText("Value", {
        x: 4.7,
        y: 2.9,
        w: 4,
        h: 0.3,
        fontSize: 11,
        bold: true,
        color: NAVY,
        fontFace: FONT,
      });
      bulletList(4.7, 3.2, 4, [
        "Scouting projects: 14",
        "Suppliers shortlisted: 47",
        "Research delivered: 12",
        "NPS: 52",
      ]);
      s.addText("Risk", {
        x: 8.9,
        y: 2.9,
        w: 4,
        h: 0.3,
        fontSize: 11,
        bold: true,
        color: AMBER,
        fontFace: FONT,
      });
      bulletList(8.9, 3.2, 4, [
        "Suppliers monitored: 56",
        "Alerts May: 12 (2 crit)",
        "EUDR-flagged: 7",
        "Open actions: 4",
      ]);
      break;
    }
    case "s3": {
      // Contract summary
      SAMPLE_CONTRACT_ROWS.forEach((r, i) => {
        s.addText(r[0], {
          x: 0.5,
          y: 1.4 + i * 0.45,
          w: 3.5,
          h: 0.4,
          fontSize: 11,
          bold: true,
          color: T2,
          fontFace: FONT,
        });
        s.addText(r[1], {
          x: 4,
          y: 1.4 + i * 0.45,
          w: 5,
          h: 0.4,
          fontSize: 11,
          color: T1,
          fontFace: FONT,
        });
      });
      s.addText("Modules in scope", {
        x: 9.5,
        y: 1.4,
        w: 3.5,
        h: 0.3,
        fontSize: 11,
        bold: true,
        color: T2,
        fontFace: FONT,
      });
      bulletList(9.5, 1.7, 3.5, SAMPLE_MODULES_IN_SCOPE);
      break;
    }
    case "s4": {
      // Accomplishments
      SAMPLE_WINS.forEach((w, i) => {
        const col = i % 3;
        const row = Math.floor(i / 3);
        const x = 0.5 + col * 4.2;
        const y = 1.4 + row * 2.6;
        s.addShape(pptx.ShapeType.rect, {
          x,
          y,
          w: 4,
          h: 2.4,
          fill: { color: "FFFFFF" },
          line: { color: "e5e7ef", width: 1 },
        });
        s.addText(w.hero, {
          x: x + 0.15,
          y: y + 0.1,
          w: 1.5,
          h: 0.5,
          fontSize: 20,
          bold: true,
          color: BLUE,
          fontFace: FONT,
        });
        s.addText(w.title, {
          x: x + 0.15,
          y: y + 0.65,
          w: 3.7,
          h: 0.4,
          fontSize: 12,
          bold: true,
          color: T1,
          fontFace: FONT,
        });
        s.addText(w.sub, {
          x: x + 0.15,
          y: y + 1.05,
          w: 3.7,
          h: 0.3,
          fontSize: 9,
          color: T3,
          fontFace: FONT,
        });
        s.addText(w.desc, {
          x: x + 0.15,
          y: y + 1.4,
          w: 3.7,
          h: 0.9,
          fontSize: 10,
          color: T2,
          fontFace: FONT,
        });
      });
      break;
    }
    case "s5": {
      // Pipeline — dark
      s.background = { color: NAVY };
      s.addText(sl.name, {
        x: 0.5,
        y: 0.55,
        w: 12,
        h: 0.55,
        fontSize: 26,
        bold: true,
        color: "FFFFFF",
        fontFace: FONT,
      });
      s.addText("Active conversations", {
        x: 0.5,
        y: 1.4,
        w: 5,
        h: 0.3,
        fontSize: 11,
        bold: true,
        color: YELLOW,
        fontFace: FONT,
      });
      SAMPLE_PIPELINE.forEach((p, i) => {
        s.addShape(pptx.ShapeType.rect, {
          x: 0.5,
          y: 1.75 + i * 0.85,
          w: 5.5,
          h: 0.75,
          fill: { color: "0d1f4d" },
          line: { color: "1a2d47", width: 1 },
        });
        s.addText(p[0], {
          x: 0.7,
          y: 1.85 + i * 0.85,
          w: 4,
          h: 0.3,
          fontSize: 12,
          bold: true,
          color: "FFFFFF",
          fontFace: FONT,
        });
        s.addText(p[1] + " · " + p[2], {
          x: 0.7,
          y: 2.15 + i * 0.85,
          w: 4,
          h: 0.3,
          fontSize: 9,
          color: YELLOW,
          fontFace: FONT,
        });
      });
      s.addText("Roadmap modules · ~$565K incremental ARR", {
        x: 6.5,
        y: 1.4,
        w: 6,
        h: 0.3,
        fontSize: 11,
        bold: true,
        color: YELLOW,
        fontFace: FONT,
      });
      bulletList(6.5, 1.7, 6, SAMPLE_ROADMAP_BULLETS, "FFFFFF");
      break;
    }
    case "s6": {
      // Health 12 scores
      SAMPLE_HEALTH_SCORES.forEach((sc, i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = 0.5 + col * 6.3;
        const y = 1.4 + row * 0.45;
        const stColor =
          sc[2] === "HEALTHY" ? GREEN : sc[2] === "WATCH" ? AMBER : RED;
        s.addText(sc[0], {
          x,
          y,
          w: 3.5,
          h: 0.4,
          fontSize: 11,
          color: T2,
          fontFace: FONT,
        });
        s.addText(sc[1], {
          x: x + 3.5,
          y,
          w: 1.5,
          h: 0.4,
          fontSize: 11,
          bold: true,
          color: T1,
          fontFace: FONT,
        });
        s.addText(sc[2], {
          x: x + 5,
          y,
          w: 1.3,
          h: 0.4,
          fontSize: 9,
          bold: true,
          color: stColor,
          fontFace: FONT,
          charSpacing: 1,
        });
      });
      break;
    }
    case "s7": {
      // Subscribers
      kpiTile(
        0.5,
        1.4,
        2.9,
        1.15,
        "LICENSED SEATS",
        "124",
        "+25 in proposal",
      );
      kpiTile(
        3.5,
        1.4,
        2.9,
        1.15,
        "ACTIVE 30d",
        "89",
        "72% activation",
        GREEN,
      );
      kpiTile(6.5, 1.4, 2.9, 1.15, "LOGINS Q1", "5,127", "↑18% QoQ");
      kpiTile(
        9.5,
        1.4,
        2.9,
        1.15,
        "SUPER USERS (TOP 5%)",
        "6",
        "all in Chocolate BU",
      );
      s.addText("Active users by BU", {
        x: 0.5,
        y: 2.75,
        w: 5,
        h: 0.3,
        fontSize: 11,
        bold: true,
        color: T2,
        fontFace: FONT,
      });
      bulletList(0.5, 3.05, 6, [
        "Chocolate Procurement: 38 (82%)",
        "Biscuit Procurement: 26 (55%)",
        "Packaging: 18 (38%)",
        "Gum & Candy: 7 (14%) · LOW — onboarding overdue",
      ]);
      s.addText("Top super users · Q1", {
        x: 6.7,
        y: 2.75,
        w: 5,
        h: 0.3,
        fontSize: 11,
        bold: true,
        color: T2,
        fontFace: FONT,
      });
      bulletList(6.7, 3.05, 5.8, [
        "R. Mendes (Choc) · 184 logins",
        "K. Adamski (Pkg) · 156",
        "S. Mukherjee (Choc) · 142",
        "L. Costa (Bis) · 128",
        "T. Yamamoto (Bis) · 118",
      ]);
      break;
    }
    case "s22": {
      // Risks · Open · Asks
      s.addText("Open items (Beroe-side)", {
        x: 0.5,
        y: 1.4,
        w: 4,
        h: 0.3,
        fontSize: 11,
        bold: true,
        color: BLUE,
        fontFace: FONT,
      });
      bulletList(0.5, 1.7, 4, SAMPLE_S22.open);
      s.addText("Risks & watch-outs", {
        x: 4.7,
        y: 1.4,
        w: 4,
        h: 0.3,
        fontSize: 11,
        bold: true,
        color: AMBER,
        fontFace: FONT,
      });
      bulletList(4.7, 1.7, 4, SAMPLE_S22.risks);
      s.addText("Asks from Mondelez", {
        x: 8.9,
        y: 1.4,
        w: 4,
        h: 0.3,
        fontSize: 11,
        bold: true,
        color: RED,
        fontFace: FONT,
      });
      bulletList(8.9, 1.7, 4, SAMPLE_S22.asks);
      break;
    }
    default: {
      // Module slides (s8…s21) — 8-tile KPI grid + footnote band
      const mod = MODULE_SLIDES[sl.id];
      if (mod) {
        mod.kpis.forEach((k, i) => {
          const col = i % 4;
          const row = Math.floor(i / 4);
          const x = 0.5 + col * 3.15;
          const y = 1.4 + row * 1.2;
          const parts = k.split(": ");
          s.addShape(pptx.ShapeType.rect, {
            x,
            y,
            w: 3.0,
            h: 1.05,
            fill: { color: "f8f9fc" },
            line: { color: "e5e7ef", width: 1 },
          });
          s.addText(parts[0], {
            x: x + 0.15,
            y: y + 0.18,
            w: 3.0 - 0.3,
            h: 0.55,
            fontSize: 11,
            color: T2,
            fontFace: FONT,
          });
          s.addText(parts[1] || "", {
            x: x + 0.15,
            y: y + 0.62,
            w: 3.0 - 0.3,
            h: 0.4,
            fontSize: 14,
            bold: true,
            color: T1,
            fontFace: FONT,
          });
        });
        s.addShape(pptx.ShapeType.rect, {
          x: 0.5,
          y: 4,
          w: 12.5,
          h: 0.7,
          fill: { color: "ede6ff" },
          line: { color: "d0c5f5", width: 1 },
        });
        s.addText(mod.footnote, {
          x: 0.7,
          y: 4.1,
          w: 12.1,
          h: 0.5,
          fontSize: 11,
          color: "3800CC",
          fontFace: FONT,
          italic: true,
        });
      } else {
        s.addText("Slide content — " + sl.name, {
          x: 0.5,
          y: 3,
          w: 12,
          h: 0.5,
          fontSize: 14,
          color: T2,
          fontFace: FONT,
          align: "center",
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// HTML deck generator (self-contained, print-friendly)
// ---------------------------------------------------------------------------
export function generateBrHtml(
  selectedIds: string[],
  cadence: Cadence,
  accountName: string,
): string {
  const slides = slidesIn(new Set(selectedIds));
  const cadenceLabel = CADENCE_PRESETS[cadence].label;

  const slidesHtml = slides
    .map((sl, i) => slideHtml(sl, i, slides.length, accountName))
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Beroe BR — ${accountName} — ${cadenceLabel}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:"DM Sans",system-ui,sans-serif;background:#EAF1F5;color:#0d1b2e;font-size:14px;line-height:1.5}
.deck{max-width:1200px;margin:0 auto;padding:20px}
.slide{background:#fff;border-radius:14px;padding:36px 44px;margin-bottom:22px;min-height:600px;page-break-after:always;border:1px solid #e4eaf6;box-shadow:0 4px 16px rgba(0,0,0,.04)}
.slide.dark{background:#001137;color:#fff}
.slide-eyebrow{font-size:11px;font-weight:700;color:#4A00F8;letter-spacing:.18em;text-transform:uppercase}
.slide.dark .slide-eyebrow{color:#FFE61E}
.slide-title{font-size:30px;font-weight:800;margin-top:8px;margin-bottom:6px}
.slide-divider{height:1px;background:#e4eaf6;margin:14px 0 22px}
.slide.dark .slide-divider{background:#1a2d47}
.slide-foot{display:flex;justify-content:space-between;font-size:10px;color:#7b87aa;margin-top:24px;border-top:1px solid #e4eaf6;padding-top:8px}
.slide.dark .slide-foot{color:#FFE61E;border-color:#1a2d47}
.kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}
.kpi{background:#fff;border:1px solid #e5e7ef;border-radius:10px;padding:14px 16px}
.kpi-lbl{font-size:10px;font-weight:700;color:#7b87aa;letter-spacing:.12em;text-transform:uppercase}
.kpi-val{font-size:26px;font-weight:800;color:#0d1b2e;margin-top:4px}
.kpi-val.green{color:#6EC457}.kpi-val.amber{color:#F0BC41}.kpi-val.red{color:#CF4548}.kpi-val.blue{color:#4A00F8}
.kpi-sub{font-size:11px;color:#7b87aa;margin-top:4px}
.col-3{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.col-h{font-size:12px;font-weight:700;margin-bottom:8px;letter-spacing:.06em;text-transform:uppercase}
.col-h.blue{color:#4A00F8}.col-h.navy{color:#001137}.col-h.amber{color:#F0BC41}.col-h.red{color:#CF4548}
ul{padding-left:18px}
li{font-size:13px;color:#3d4b6e;line-height:1.65}
.contract-row{display:grid;grid-template-columns:200px 1fr;gap:12px;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px}
.contract-row b{color:#3d4b6e;font-weight:700}
.win-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.win{background:#fff;border:1px solid #e5e7ef;border-radius:10px;padding:14px}
.win-hero{font-size:26px;font-weight:800;color:#4A00F8}
.win-title{font-size:14px;font-weight:700;margin-top:4px}
.win-sub{font-size:11px;color:#7b87aa;margin-top:2px}
.win-desc{font-size:12px;color:#3d4b6e;margin-top:8px}
.pipe-row{background:#0d1f4d;border:1px solid #1a2d47;border-radius:10px;padding:12px 14px;margin-bottom:8px}
.pipe-row .pipe-t{font-size:14px;font-weight:700;color:#fff}
.pipe-row .pipe-meta{font-size:11px;color:#FFE61E;margin-top:2px}
.score-row{display:grid;grid-template-columns:1fr auto auto;gap:12px;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px;align-items:baseline}
.score-pill{font-size:10px;font-weight:700;padding:2px 8px;border-radius:99px;letter-spacing:.06em}
.score-pill.HEALTHY{background:#d4f5e5;color:#146a45}
.score-pill.WATCH{background:#fef0c0;color:#8a4510}
.score-pill.RISK{background:#fff0f2;color:#8a1010}
.modkpi{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px}
.modkpi-tile{background:#f8f9fc;border:1px solid #e5e7ef;border-radius:9px;padding:10px 12px}
.modkpi-l{font-size:11px;color:#3d4b6e;line-height:1.4}
.modkpi-v{font-size:15px;font-weight:700;color:#0d1b2e;margin-top:4px}
.foot-band{background:#ede6ff;border:1px solid #d0c5f5;border-radius:9px;padding:12px 14px;font-size:12px;color:#3800CC;font-style:italic}
.title-eye{font-size:11px;font-weight:700;letter-spacing:.3em;color:#fff;opacity:.7}
.title-h{font-size:54px;font-weight:900;color:#fff;margin-top:30px}
.title-sub{font-size:22px;color:#FFE61E;margin-top:14px;font-weight:600}
@media print {
  body{background:#fff;padding:0}
  .deck{max-width:none;padding:0}
  .slide{box-shadow:none;border:none;border-radius:0;margin:0;page-break-after:always}
}
</style>
</head>
<body>
<div class="deck">
${slidesHtml}
</div>
</body>
</html>`;
}

function slideHtml(
  sl: Slide,
  idx: number,
  total: number,
  accountName: string,
): string {
  const today = new Date().toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
  });
  // Title / Closing slides — dark
  if (sl.id === "s1") {
    return `<section class="slide dark">
      <div class="title-eye">COMPREHENSIVE BUSINESS REVIEW</div>
      <div class="title-h">${escapeHtml(accountName)}</div>
      <div class="title-sub">${today}</div>
      <div class="slide-foot"><span>Beroe</span><span>Slide ${idx + 1} of ${total}</span></div>
    </section>`;
  }
  if (sl.id === "s23") {
    return `<section class="slide dark" style="text-align:center">
      <div class="title-eye">COMPREHENSIVE BUSINESS REVIEW</div>
      <div class="title-h">Thank you, ${escapeHtml(accountName)}</div>
      <div class="title-sub">Next monthly review · Next QBR</div>
      <div class="slide-foot"><span>Beroe</span><span>Slide ${idx + 1} of ${total}</span></div>
    </section>`;
  }

  const header = `<div class="slide-eyebrow">·  ${sl.name.toUpperCase()}</div>
    <div class="slide-title">${escapeHtml(sl.name)}</div>
    <div class="slide-divider"></div>`;
  const footer = `<div class="slide-foot"><span>${escapeHtml(accountName)} · BR · ${today}</span><span>Slide ${idx + 1} of ${total}</span></div>`;

  if (sl.id === "s2") {
    return `<section class="slide">${header}
      <div class="kpi-grid">
        ${kpi("ACCOUNT HEALTH", "73 / 100", "↑ 6 pts QoQ · Healthy", "green")}
        ${kpi("ARR IN SCOPE", "$850K", "+25 seat expansion in flight", "blue")}
        ${kpi("COST AVOIDANCE Q1", "$4.2M", "84% of $5M target", "green")}
        ${kpi("RENEWAL", "31 Dec '26", "211 days · early-window opens Sep", "amber")}
      </div>
      <div class="col-3">
        <div><div class="col-h blue">Engagement</div><ul>${["Active 30d: 89 / 124 (72%)", "Logins Q1: 5,127 (↑18%)", "Hours Q1: 412", "Abi queries Q1: 812"].map((b) => `<li>${b}</li>`).join("")}</ul></div>
        <div><div class="col-h navy">Value</div><ul>${["Scouting projects: 14", "Suppliers shortlisted: 47", "Research delivered: 12", "NPS: 52"].map((b) => `<li>${b}</li>`).join("")}</ul></div>
        <div><div class="col-h amber">Risk</div><ul>${["Suppliers monitored: 56", "Alerts May: 12 (2 crit)", "EUDR-flagged: 7", "Open actions: 4"].map((b) => `<li>${b}</li>`).join("")}</ul></div>
      </div>
      ${footer}
    </section>`;
  }
  if (sl.id === "s3") {
    return `<section class="slide">${header}
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:32px">
        <div>${SAMPLE_CONTRACT_ROWS.map((r) => `<div class="contract-row"><b>${escapeHtml(r[0])}</b><span>${escapeHtml(r[1])}</span></div>`).join("")}</div>
        <div><div class="col-h navy">Modules in scope</div><ul>${SAMPLE_MODULES_IN_SCOPE.map((m) => `<li>${escapeHtml(m)}</li>`).join("")}</ul></div>
      </div>
      ${footer}
    </section>`;
  }
  if (sl.id === "s4") {
    return `<section class="slide">${header}
      <div class="win-grid">
        ${SAMPLE_WINS.map((w) => `<div class="win"><div class="win-hero">${escapeHtml(w.hero)}</div><div class="win-title">${escapeHtml(w.title)}</div><div class="win-sub">${escapeHtml(w.sub)}</div><div class="win-desc">${escapeHtml(w.desc)}</div></div>`).join("")}
      </div>
      ${footer}
    </section>`;
  }
  if (sl.id === "s5") {
    return `<section class="slide dark">
      <div class="slide-eyebrow">·  ${sl.name.toUpperCase()}</div>
      <div class="slide-title" style="color:#fff">${escapeHtml(sl.name)}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:24px">
        <div>
          <div class="col-h" style="color:#FFE61E">Active conversations</div>
          ${SAMPLE_PIPELINE.map((p) => `<div class="pipe-row"><div class="pipe-t">${escapeHtml(p[0])}</div><div class="pipe-meta">${escapeHtml(p[1])} · ${escapeHtml(p[2])}</div></div>`).join("")}
        </div>
        <div>
          <div class="col-h" style="color:#FFE61E">Roadmap modules · ~$565K incremental ARR</div>
          <ul style="color:#fff">${SAMPLE_ROADMAP_BULLETS.map((b) => `<li style="color:#fff">${escapeHtml(b)}</li>`).join("")}</ul>
        </div>
      </div>
      <div class="slide-foot"><span>${escapeHtml(accountName)} · BR · ${today}</span><span>Slide ${idx + 1} of ${total}</span></div>
    </section>`;
  }
  if (sl.id === "s6") {
    return `<section class="slide">${header}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:30px">
        ${[0, 1].map((col) => `<div>${SAMPLE_HEALTH_SCORES.filter((_, i) => i % 2 === col).map((sc) => `<div class="score-row"><span>${escapeHtml(sc[0])}</span><b>${escapeHtml(sc[1])}</b><span class="score-pill ${sc[2]}">${escapeHtml(sc[2])}</span></div>`).join("")}</div>`).join("")}
      </div>
      ${footer}
    </section>`;
  }
  if (sl.id === "s7") {
    return `<section class="slide">${header}
      <div class="kpi-grid">
        ${kpi("LICENSED SEATS", "124", "+25 in proposal", "")}
        ${kpi("ACTIVE 30d", "89", "72% activation", "green")}
        ${kpi("LOGINS Q1", "5,127", "↑18% QoQ", "")}
        ${kpi("SUPER USERS (TOP 5%)", "6", "all in Chocolate BU", "")}
      </div>
      <div class="col-3" style="grid-template-columns:1fr 1fr">
        <div><div class="col-h navy">Active users by BU</div><ul>${["Chocolate Procurement: 38 (82%)", "Biscuit Procurement: 26 (55%)", "Packaging: 18 (38%)", "Gum & Candy: 7 (14%) · LOW — onboarding overdue"].map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul></div>
        <div><div class="col-h navy">Top super users · Q1</div><ul>${["R. Mendes (Choc) · 184 logins", "K. Adamski (Pkg) · 156", "S. Mukherjee (Choc) · 142", "L. Costa (Bis) · 128", "T. Yamamoto (Bis) · 118"].map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul></div>
      </div>
      ${footer}
    </section>`;
  }
  if (sl.id === "s22") {
    return `<section class="slide">${header}
      <div class="col-3">
        <div><div class="col-h blue">Open items (Beroe-side)</div><ul>${SAMPLE_S22.open.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul></div>
        <div><div class="col-h amber">Risks & watch-outs</div><ul>${SAMPLE_S22.risks.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul></div>
        <div><div class="col-h red">Asks from ${escapeHtml(accountName)}</div><ul>${SAMPLE_S22.asks.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul></div>
      </div>
      ${footer}
    </section>`;
  }

  // Module slides
  const mod = MODULE_SLIDES[sl.id];
  if (mod) {
    return `<section class="slide">${header}
      <div class="modkpi">
        ${mod.kpis.map((k) => { const p = k.split(": "); return `<div class="modkpi-tile"><div class="modkpi-l">${escapeHtml(p[0])}</div><div class="modkpi-v">${escapeHtml(p[1] || "")}</div></div>`; }).join("")}
      </div>
      <div class="foot-band">${escapeHtml(mod.footnote)}</div>
      ${footer}
    </section>`;
  }

  return `<section class="slide">${header}
    <div style="text-align:center;padding:60px 0;color:#7b87aa">Slide content — ${escapeHtml(sl.name)}</div>
    ${footer}
  </section>`;
}

function kpi(label: string, value: string, sub: string, color: string): string {
  const cls = color ? ` ${color}` : "";
  return `<div class="kpi"><div class="kpi-lbl">${escapeHtml(label)}</div><div class="kpi-val${cls}">${escapeHtml(value)}</div><div class="kpi-sub">${escapeHtml(sub)}</div></div>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
