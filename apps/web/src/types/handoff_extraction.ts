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

  // Direct columns on the `accounts` row.
  gate_signed_date?: string | null;        // YYYY-MM-DD
  gate_renewal_date?: string | null;       // YYYY-MM-DD
  gate_contract_acv_usd?: string | number | null;
  gate_contract_term?: string | null;
  gate_contract_modules?: string[] | null;
  gate_platform_tier?: string | null;
  gate_account_segment?: string | null;
  gate_subscribers?: string | null;

  // 05-Jun — Contract Audit "extras" (gate_contract_extras jsonb).
  tcv?: string | null;
  billing_freq?: string | null;            // Annual / Semi-Annual / Quarterly / Monthly / One-time
  payment_terms?: string | null;           // Net 30 / Net 45 / Net 60 / Net 90 / Net 120
  discount?: string | null;                // percent string ("12" / "12.5")
  discount_reason?: string | null;
  geography?: string | null;               // Global / NA / EU / APAC / LATAM / MEA
  module_caveats?: string | null;
  audit_notes?: string | null;
  other_terms?: string | null;

  confidence?: "low" | "medium" | "high";
  notes?: string | null;
}
