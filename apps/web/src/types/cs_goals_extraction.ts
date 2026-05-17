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
  cost_savings: "bg-green-50 text-green-700 border-green-200",
  base_rationalization: "bg-blue-50 text-blue-700 border-blue-200",
  risk_mitigation: "bg-amber-50 text-amber-700 border-amber-200",
  adoption: "bg-purple-50 text-purple-700 border-purple-200",
  other: "bg-slate-50 text-slate-700 border-slate-200",
};

export const CATEGORIES: CSGoalCategory[] = [
  "cost_savings",
  "base_rationalization",
  "risk_mitigation",
  "adoption",
  "other",
];

export const CONFIDENCE_TONES: Record<"high" | "medium" | "low", string> = {
  high: "bg-green-50 text-green-700 border-green-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  low: "bg-slate-50 text-slate-700 border-slate-200",
};
