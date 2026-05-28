// 28-May — Escalations. Mirrors apps/api/app/schemas/escalation.py.

export type EscalationType = "director" | "sales" | "joint";
export type EscalationStatus = "open" | "in_progress" | "resolved";

export interface Escalation {
  id: string;
  raised_at: string;
  raised_by_user_id: string | null;
  raised_by_name: string | null;
  reason: string;
  escalation_type: EscalationType;
  owner: string;
  next_action: string | null;
  status: EscalationStatus;
  resolved_at: string | null;
  resolved_by_user_id: string | null;
  resolved_note: string | null;
}

export interface EscalationListResponse {
  items: Escalation[];
  total: number;
  open_count: number;
  is_editable: boolean;
  can_resolve: boolean;
  notify_emails: string[];
}

export interface EscalationCreate {
  reason: string;
  escalation_type: EscalationType;
  owner: string;
  next_action?: string | null;
}

export const ESCALATION_TYPE_LABELS: Record<EscalationType, string> = {
  director: "Director involvement",
  sales: "Sales involvement",
  joint: "Joint (Director + Sales)",
};
