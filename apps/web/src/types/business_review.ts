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
}

export const CADENCE_LABEL: Record<BRCadence, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  renewal: "Renewal",
  custom: "Custom",
};
