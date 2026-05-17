// Mirrors apps/api/app/schemas/document.py.

export type DocKind = "mom" | "vpd" | "recording" | "transcript" | "email" | "other";
export type AiStatus = "pending" | "processing" | "complete" | "failed";

export interface ExtractedEntities {
  people?: string[];
  decisions?: string[];
  action_items?: string[];
  dates?: string[];
  is_stub?: boolean;
}

export interface Document {
  id: string;
  account_id: string;
  kind: DocKind;
  filename: string;
  mime_type: string | null;
  size_bytes: number | null;
  meeting_date: string | null;
  uploaded_by: string | null;
  uploaded_at: string;
  ai_status: AiStatus;
  ai_summary_text: string | null;
  extracted_entities: ExtractedEntities | null;
  job_id: string | null;
  ai_edited: boolean;
  ai_edited_at: string | null;
  mom_extracted_fields: Record<string, unknown> | null;
  mom_extracted_at: string | null;
  vpd_extracted_fields: Record<string, unknown> | null;
  vpd_extracted_at: string | null;
  cs_goals_extracted: Record<string, unknown> | null;
  cs_goals_extracted_at: string | null;
  notes: string | null;
  deleted_at: string | null;
}

export interface DocumentListResponse {
  items: Document[];
  total: number;
  is_editable: boolean;
}

export interface DocumentUploadResponse {
  document: Document;
  job_id: string;
  duplicate: boolean;
}

export interface Job {
  id: string;
  kind: string;
  account_id: string | null;
  document_id: string | null;
  status: "pending" | "running" | "complete" | "failed";
  progress: number;
  error: string | null;
  result: Record<string, unknown> | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface DiscoverySummary {
  account_id: string;
  summary_text: string | null;
  source_document_ids: string[];
  generated_at: string | null;
}

export const DOC_KIND_LABELS: Record<DocKind, string> = {
  mom: "Meeting Minutes",
  vpd: "Value Proposition Deck",
  recording: "Recording",
  transcript: "Transcript",
  email: "Email",
  other: "Other",
};

export const AI_STATUS_LABELS: Record<AiStatus, string> = {
  pending: "Queued",
  processing: "Processing",
  complete: "Ready",
  failed: "Failed",
};
