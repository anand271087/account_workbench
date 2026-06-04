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

/** Legacy flat-list checklist. Kept for back-compat — existing
 *  cs_handover_checklist rows reference these keys. */
export const CS_HANDOVER_ITEMS = [
  { key: "savings",        label: "Savings target defined" },
  { key: "stakeholders",   label: "Key stakeholders named" },
  { key: "categories",     label: "Agreed categories listed" },
  { key: "success_metric", label: "Success metric indicated" },
] as const;

/** 03-Jun bug — Handover Quality Check restructured into 3 main pointers
 *  with sub-checks under each. Contract Details + ACV get separate sub-
 *  checks (per the bug Expected). The legacy 4-item list above is the
 *  fallback for already-saved rows. */
export interface HandoverChecklistGroup {
  key: string;
  label: string;
  desc?: string;
  items: { key: string; label: string }[];
}

export const CS_HANDOVER_GROUPS: HandoverChecklistGroup[] = [
  {
    key: "contract",
    label: "Contract & Commercials",
    desc:
      "Contract Ops has audited the signed deal and the per-module configuration is captured.",
    items: [
      { key: "contract_details",  label: "Contract details captured (signed date, term, renewal)" },
      { key: "acv",               label: "ACV confirmed" },
      { key: "modules",           label: "Modules + per-module config recorded" },
      { key: "commercial_terms",  label: "Billing freq, payment terms, geography set" },
    ],
  },
  {
    key: "client",
    label: "Client Context",
    desc:
      "The CSM knows who they're talking to and the power-user roster is in place.",
    items: [
      { key: "spoc",        label: "SPOC named with title + email" },
      { key: "budget_owner", label: "Budget Owner named" },
      { key: "power_users", label: "≥1 Power User listed for adoption tracking" },
      { key: "stakeholders", label: "Stakeholder coverage flagged (no gaps)" },
    ],
  },
  {
    key: "engagement",
    label: "Engagement Plan",
    desc:
      "Kickoff is scheduled, the success metric is locked, and value themes are agreed.",
    items: [
      { key: "go_live",        label: "Go-Live / Kickoff date set" },
      { key: "first_checkpoint", label: "First Checkpoint cadence agreed" },
      { key: "success_metric", label: "Primary success metric defined" },
      { key: "value_themes",   label: "Value themes confirmed by Sales" },
    ],
  },
];
