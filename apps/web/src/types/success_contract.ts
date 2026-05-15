// Mirrors apps/api/app/schemas/success_contract.py.

export type MeasureFreq = "Monthly" | "Quarterly" | "Bi-annual" | "Annual";

export interface SuccessContract {
  account_id: string;
  metric1: string | null;
  metric1_unit: string | null;
  metric2: string | null;
  measure_source: string | null;
  measure_freq: MeasureFreq | null;
  measure_owner: string | null;
  value_narrative: string | null;
  locked_at: string | null;
  locked_by: string | null;
  auto_drafted: boolean;
  is_editable: boolean;
}

export interface SuccessContractUpdate {
  metric1?: string | null;
  metric1_unit?: string | null;
  metric2?: string | null;
  measure_source?: string | null;
  measure_freq?: MeasureFreq | null;
  measure_owner?: string | null;
  value_narrative?: string | null;
}

export const METRIC_UNITS: string[] = ["$", "€", "%", "MAU", "#", "hours", "score"];
export const MEASURE_FREQS: MeasureFreq[] = ["Monthly", "Quarterly", "Bi-annual", "Annual"];

/** Returns the three lock states for the 3-lock UI checklist. */
export function locksState(sc: Partial<SuccessContract>) {
  const lock1 = Boolean(sc.metric1 && sc.metric1_unit);
  const lock2 = Boolean(sc.measure_source && sc.measure_freq);
  const lock3 = Boolean(
    sc.value_narrative && sc.value_narrative.trim().length >= 10,
  );
  return { lock1, lock2, lock3, allLocked: lock1 && lock2 && lock3 };
}
