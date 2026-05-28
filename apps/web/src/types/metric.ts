// Mirrors apps/api/app/schemas/metric.py.

export type MetricType = "quantitative" | "qualitative";
export type MetricStatus = "green" | "amber" | "red" | "grey";

export interface MetricLogEntry {
  at: string;
  by?: string | null;
  by_name?: string | null;
  value: string | null;
  source?: string | null;
  note?: string | null;
  [k: string]: unknown;
}

export interface SuccessMetric {
  id: string;
  account_id: string;
  name: string;
  description: string | null;
  metric_type: MetricType;
  unit: string | null;
  target_value: string | null;
  current_value: string | null;
  status_override: MetricStatus | null;
  log_entries: MetricLogEntry[];
  source: string;
  last_updated_at: string | null;
  last_updated_by: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  deleted_reason: string | null;
  status: MetricStatus;
  is_editable: boolean;
}

export interface MetricListResponse {
  items: SuccessMetric[];
  total: number;
  is_editable: boolean;
}

export interface MetricCreate {
  name: string;
  description?: string | null;
  metric_type: MetricType;
  unit?: string | null;
  target_value?: string | null;
}

export interface MetricValueLog {
  value: string;
  source?: string | null;
  note?: string | null;
}

export const STATUS_LABELS: Record<MetricStatus, string> = {
  green: "On track",
  amber: "At risk",
  red: "Off track",
  grey: "No data",
};

/** Brand-palette colours per metric status (Beroe brand book Sept 2025).
 *  Values are raw hex so callers can use them in inline styles instead
 *  of the previous Tailwind utility classes — those drifted off-palette
 *  (e.g. green-500 ≠ Risk Green). Mapping:
 *    green → Risk Green  #6EC457
 *    amber → Risk Amber  #F0BC41
 *    red   → Risk Red    #CF4548
 *    grey  → brand mid-grey (Midnight-tinted)
 */
export const STATUS_COLORS: Record<
  MetricStatus,
  { dot: string; bg: string; border: string; text: string }
> = {
  green: { dot: "#6EC457", bg: "#6EC45715", border: "#6EC45740", text: "#1d6b35" },
  amber: { dot: "#F0BC41", bg: "#F0BC4115", border: "#F0BC4140", text: "#854F0B" },
  red:   { dot: "#CF4548", bg: "#CF454810", border: "#CF454830", text: "#7F1D1D" },
  grey:  { dot: "#94a3b8", bg: "#94a3b815", border: "#94a3b830", text: "#475569" },
};
