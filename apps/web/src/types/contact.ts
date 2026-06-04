// Mirrors apps/api/app/schemas/contact.py — BRD table 12.

export type ContactFunction =
  // Legacy (preserved for back-compat)
  | "procurement"
  | "supply_chain"
  | "finance"
  | "operations"
  | "it"
  | "other"
  // 03-Jun prototype additions
  | "executive_leadership"
  | "research_development"
  | "manufacturing"
  | "legal"
  | "marketing"
  | "sales";

// 03-Jun bug — Salutation dropdown before name.
export type ContactSalutation =
  | "Mr." | "Mrs." | "Ms." | "Miss" | "Dr." | "Prof." | "Mx."
  | "Sir" | "Madam" | "Rev." | "Prefer not to say";

export const SALUTATION_OPTIONS: ContactSalutation[] = [
  "Mr.", "Mrs.", "Ms.", "Miss", "Dr.", "Prof.", "Mx.",
  "Sir", "Madam", "Rev.", "Prefer not to say",
];

export type ContactSeniority = "cxo" | "vp" | "director" | "manager" | "other";

export type ContactDecisionPower =
  | "executive_sponsor"
  | "influencer"
  | "champion"
  | "detractor"
  | "unknown";

export interface Contact {
  id: string;
  account_id: string;
  salutation: ContactSalutation | null;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  function: ContactFunction | null;
  seniority: ContactSeniority | null;
  decision_power: ContactDecisionPower | null;
  notes: string | null;
  is_spoc: boolean;
  is_sponsor: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ContactListResponse {
  items: Contact[];
  total: number;
  is_editable: boolean;
}

export interface ContactCreate {
  salutation?: ContactSalutation | null;
  name: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  function?: ContactFunction | null;
  seniority?: ContactSeniority | null;
  decision_power?: ContactDecisionPower | null;
  notes?: string | null;
  is_spoc?: boolean;
  is_sponsor?: boolean;
}

export type ContactUpdate = Partial<ContactCreate>;

export const FUNCTION_LABELS: Record<ContactFunction, string> = {
  // Legacy
  procurement: "Procurement / Sourcing",
  supply_chain: "Supply Chain",
  finance: "Finance",
  operations: "Operations",
  it: "IT",
  other: "Other",
  // 03-Jun prototype additions
  executive_leadership: "Executive / Leadership",
  research_development: "Research & Development",
  manufacturing: "Manufacturing / Production",
  legal: "Legal",
  marketing: "Marketing",
  sales: "Sales",
};

/** New-row dropdown order (03-Jun spec). Legacy keys still load on
 *  existing rows via FUNCTION_LABELS but aren't surfaced in this list. */
export const FUNCTION_OPTIONS_NEW: ContactFunction[] = [
  "procurement",          // "Procurement / Sourcing" label
  "supply_chain",
  "executive_leadership",
  "finance",
  "research_development",
  "manufacturing",
  "it",
  "legal",
  "marketing",
  "sales",
  "operations",
  "other",
];

export const SENIORITY_LABELS: Record<ContactSeniority, string> = {
  cxo: "CXO",
  vp: "VP",
  director: "Director",
  manager: "Manager",
  other: "Other",
};

export const DECISION_POWER_LABELS: Record<ContactDecisionPower, string> = {
  executive_sponsor: "Executive Sponsor",
  influencer: "Influencer",
  champion: "Champion",
  detractor: "Detractor",
  unknown: "Unknown",
};
