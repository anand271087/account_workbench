// Mirrors apps/api/app/schemas/cs_onboarding.py.

export type CSEntryType = "A" | "B";

export interface Stakeholder {
  name: string | null;
  email: string | null;
  phone: string | null;
}

/** 03-Jun — CS Handoff state. Realignment is null when none is in
 *  flight; `started` flips true when the CSM clicks "Start Success
 *  Journey" after every ready-check passes. */
export interface CSHandoffRealignment {
  block: "Commercial" | "Client" | "Commitment";
  note: string;
  sent_at: string; // ISO date
  sent_to: string; // free-text — Sales / Contract Ops lead name
}

export interface CSHandoffState {
  realignment?: CSHandoffRealignment | null;
  started?: boolean;
  started_at?: string | null;
}

export interface CSOnboarding {
  account_id: string;
  cs_entry_type: CSEntryType | null;
  cs_entry_b_context: string | null;
  cs_entry_b_goals: string | null;
  cs_handover_checklist: Record<string, boolean>;
  cs_stakeholders: Record<string, Stakeholder>;
  cs_handoff: CSHandoffState;
  activated: boolean;
  is_editable: boolean;
}

export interface CSOnboardingUpdate {
  cs_entry_type?: CSEntryType | null;
  cs_entry_b_context?: string | null;
  cs_entry_b_goals?: string | null;
  cs_handover_checklist?: Record<string, boolean>;
  cs_stakeholders?: Record<string, Partial<Stakeholder>>;
  cs_handoff?: CSHandoffState | null;
}

/** Three canonical CS stakeholder roles, in render order.
 *
 * `col` + `icon` ported verbatim from prototype line 6176-6180 so the
 * card colour matches the visual reference exactly. */
export const STAKEHOLDER_ROLES = [
  {
    key: "commercial",
    label: "Budget Owner",
    desc: "Signed the contract. Holds the budget. Renewal decision rests here.",
    col: "#4A00F8",
    icon: "💼",
  },
  {
    key: "champion",
    label: "Day-to-day Champion",
    desc: "Client SPOC. Uses Beroe regularly. Validates value at checkpoints.",
    col: "#6EC457",
    icon: "⭐",
  },
  {
    key: "category",
    label: "Category Manager",
    desc: "Implements initiatives. Confirms savings realised. Key voice at QBR.",
    col: "#F0BC41",
    icon: "📊",
  },
] as const;

/** Four items in the CSM-side handover checklist. */
export const CS_HANDOVER_ITEMS = [
  { key: "savings",        label: "Savings target defined" },
  { key: "stakeholders",   label: "Key stakeholders named" },
  { key: "categories",     label: "Agreed categories listed" },
  { key: "success_metric", label: "Success metric indicated" },
] as const;
