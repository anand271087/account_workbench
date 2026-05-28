// 27-May Row 81 — VPD success-metrics extraction shape.
// Mirrors apps/api/app/schemas/vpd_metrics_extraction.py.

export type MetricType = "quantitative" | "qualitative";

export interface ExtractedMetric {
  name: string;
  metric_type: MetricType;
  target_value: string | null;
  owner: string | null;
  confidence: "high" | "medium" | "low" | null;
  rationale: string | null;
}

export interface VpdMetricsExtractionResult {
  document_id: string | null;
  metrics: ExtractedMetric[];
  is_stub: boolean;
}
