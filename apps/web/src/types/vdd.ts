// Mirrors apps/api/app/schemas/vdd.py.

export type SavingsLever = "cost" | "risk" | "adoption";
export type InitiativeStage =
  | "proposed"
  | "committed"
  | "in_flight"
  | "implemented"
  | "blocked"
  | "cancelled";

export interface MetricSnapshot {
  id?: string | null;
  name: string;
  target?: string | null;
  current?: string | null;
  status?: "green" | "amber" | "red" | "grey" | null;
}

export interface ApproachItem {
  initiative_id?: string | null;
  initiative_name: string;
  approach?: string | null;
  levers: SavingsLever[];
  stage?: InitiativeStage | null;
}

export interface ValueDeliveredItem {
  initiative_id?: string | null;
  initiative_name: string;
  identified_musd?: number | null;
  committed_musd?: number | null;
  implemented_musd?: number | null;
  note?: string | null;
}

export interface Vdd {
  account_id: string;
  client_strategic_priorities: string[];
  agreed_success_metrics: MetricSnapshot[];
  beroes_approach: ApproachItem[];
  value_delivered: ValueDeliveredItem[];
  exec_summary: string | null;
  locked_at: string | null;
  locked_by: string | null;
  auto_drafted: boolean;
  is_editable: boolean;
}

export interface VddUpdate {
  client_strategic_priorities?: string[] | null;
  agreed_success_metrics?: MetricSnapshot[] | null;
  beroes_approach?: ApproachItem[] | null;
  value_delivered?: ValueDeliveredItem[] | null;
  exec_summary?: string | null;
}

export const LEVERS: SavingsLever[] = ["cost", "risk", "adoption"];
export const LEVER_LABELS: Record<SavingsLever, string> = {
  cost: "Cost",
  risk: "Risk",
  adoption: "Adoption",
};
export const LEVER_TONES: Record<SavingsLever, string> = {
  cost: "bg-beroe-green/15 text-beroe-green border-beroe-green/30",
  risk: "bg-beroe-amber/15 text-beroe-amber border-beroe-amber/40",
  adoption: "bg-beroe-blue/10 text-beroe-blue border-beroe-blue/30",
};

export const STAGES: InitiativeStage[] = [
  "proposed",
  "committed",
  "in_flight",
  "implemented",
  "blocked",
  "cancelled",
];

/** Rollup totals across value_delivered for the attribution bar. */
export function attributionTotals(rows: ValueDeliveredItem[]) {
  const sum = (k: keyof ValueDeliveredItem) =>
    rows.reduce((acc, r) => acc + (Number(r[k]) || 0), 0);
  return {
    identified: sum("identified_musd"),
    committed: sum("committed_musd"),
    implemented: sum("implemented_musd"),
  };
}

export function fmtMusd(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  if (n === 0) return "$0";
  return `$${n.toFixed(2)}M`;
}
