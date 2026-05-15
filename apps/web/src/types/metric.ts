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

export const STATUS_COLORS: Record<MetricStatus, { dot: string; bg: string; text: string; border: string }> = {
  green: { dot: "bg-green-500", bg: "bg-green-50", text: "text-green-700", border: "border-green-300" },
  amber: { dot: "bg-amber-500", bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-300" },
  red:   { dot: "bg-red-500",   bg: "bg-red-50",   text: "text-red-700",   border: "border-red-300"   },
  grey:  { dot: "bg-slate-400", bg: "bg-slate-50", text: "text-slate-600", border: "border-slate-300" },
};
