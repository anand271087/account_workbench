// Mirrors apps/api/app/schemas/contact.py — BRD table 12.

export type ContactFunction =
  | "procurement"
  | "supply_chain"
  | "finance"
  | "operations"
  | "it"
  | "other";

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
  procurement: "Procurement",
  supply_chain: "Supply Chain",
  finance: "Finance",
  operations: "Operations",
  it: "IT",
  other: "Other",
};

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
