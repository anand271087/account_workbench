/**
 * Mirrors apps/api/app/schemas/handoff_extraction.py.
 *
 * Worker writes this to documents.handoff_extracted_fields after the AI
 * pass on a kind='contract' upload. The KindUploadCard auto-detects the
 * column landing and writes the fields to localStorage as the "handoff"
 * slice of ExtractionDraft. SalesHandoffTab consumes the slice and merges
 * it into its signForm state as a dirty draft.
 */

export interface HandoffExtractionResult {
  document_id?: string | null;
  is_stub: boolean;
  gate_signed_date?: string | null;        // YYYY-MM-DD
  gate_contract_acv_usd?: string | number | null;
  gate_contract_term?: string | null;
  gate_contract_modules?: string[] | null;
  gate_platform_tier?: string | null;
  gate_account_segment?: string | null;
  gate_subscribers?: string | null;
  confidence?: "low" | "medium" | "high";
  notes?: string | null;
}
