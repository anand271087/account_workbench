// Mirrors apps/api/app/schemas/signing.py.

export interface SigningGate {
  account_id: string;
  gate_signed: boolean;

  gate_signed_date: string | null;       // ISO yyyy-mm-dd
  gate_contract_acv: string | number | null;
  gate_contract_term: string | null;
  gate_renewal_date: string | null;
  gate_bvd_due_date: string | null;

  gate_confirmed_by: string | null;
  gate_confirmed_at: string | null;      // ISO datetime

  gate_unlocked: boolean;
  gate_unlock_reason: string | null;
  gate_unlocked_by: string | null;
  gate_unlocked_at: string | null;

  gate_contract_doc: string | null;
  gate_contract_doc_at: string | null;

  gate_contract_modules: string[];
  gate_platform_tier: string | null;
  gate_account_segment: string | null;
  gate_subscribers: string | null;

  handover_quality_check: Record<string, boolean>;

  can_sign: boolean;
  can_unlock: boolean;
}

export interface SignAccountBody {
  gate_signed_date: string; // yyyy-mm-dd
  gate_contract_acv: string | number;
  gate_contract_term: string;
  gate_contract_modules?: string[];
  gate_platform_tier?: string | null;
  gate_account_segment?: string | null;
  gate_subscribers?: string | null;
}

export interface UnlockSigningBody {
  reason: string;
}

export interface HandoverChecklistBody {
  items: Record<string, boolean>;
}

export interface ContractDocBody {
  gate_contract_doc: string | null;
}

/** The four canonical handover-quality items. The dict on the wire is
 * open-ended (jsonb), but these are the keys the UI renders. */
export const HANDOVER_QC_ITEMS = [
  { key: "savings",        label: "Savings target captured" },
  { key: "stakeholders",   label: "Stakeholder roster (3 roles)" },
  { key: "categories",     label: "Categories agreed in writing" },
  { key: "success_metric", label: "Success metric defined" },
] as const;

export const TERM_OPTIONS = [
  "1 year",
  "2 years",
  "3 years",
  "Custom",
] as const;
