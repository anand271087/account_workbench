// Mirrors apps/api/app/schemas/cs_goals_extraction.py.

export type CSGoalCategory =
  | "cost_savings"
  | "base_rationalization"
  | "risk_mitigation"
  | "adoption"
  | "other";

export type InitiativeStage =
  | "proposed"
  | "committed"
  | "in_flight"
  | "implemented"
  | "blocked"
  | "cancelled";

export interface ExtractedInitiative {
  name: string;
  description?: string | null;
  stage?: InitiativeStage | null;
  levers: string[];
}

export interface ExtractedGoal {
  title: string;
  category: CSGoalCategory;
  target_value?: string | null;
  target_date?: string | null; // ISO YYYY-MM-DD
  owner?: string | null;
  initiatives: ExtractedInitiative[];
  confidence?: "high" | "medium" | "low" | null;
  rationale?: string | null;
}

export interface CsGoalsExtractionResult {
  document_id?: string | null;
  goals: ExtractedGoal[];
  is_stub: boolean;
}

export const CATEGORY_LABELS: Record<CSGoalCategory, string> = {
  cost_savings: "Cost savings",
  base_rationalization: "Base rationalization",
  risk_mitigation: "Risk mitigation",
  adoption: "Adoption",
  other: "Other",
};

export const CATEGORY_TONES: Record<CSGoalCategory, string> = {
  cost_savings: "bg-beroe-green/15 text-beroe-green border-beroe-green/30",
  base_rationalization: "bg-beroe-blue/10 text-beroe-blue border-beroe-blue/30",
  risk_mitigation: "bg-beroe-amber/15 text-beroe-amber border-beroe-amber/40",
  adoption: "bg-beroe-purple/10 text-beroe-purple border-beroe-purple/30",
  other: "bg-beroe-bg text-text-secondary border-beroe-card-border",
};

export const CATEGORIES: CSGoalCategory[] = [
  "cost_savings",
  "base_rationalization",
  "risk_mitigation",
  "adoption",
  "other",
];

export const CONFIDENCE_TONES: Record<"high" | "medium" | "low", string> = {
  high: "bg-beroe-green/15 text-beroe-green border-beroe-green/30",
  medium: "bg-beroe-amber/15 text-beroe-amber border-beroe-amber/40",
  low: "bg-beroe-bg text-text-secondary border-beroe-card-border",
};
