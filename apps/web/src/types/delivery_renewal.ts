// Mirrors apps/api/app/schemas/delivery_renewal.py.

export type ExpandStage =
  | "value_proof"
  | "expand_ask"
  | "new_scope"
  | "close";

export type RedFlagType =
  | "missed_checkpoint"
  | "spoc_unresponsive"
  | "no_value_logged"
  | "escalation";

export type Outcome = "renewed" | "at_risk" | "not_renewed" | "undecided";

export type ReadinessAnswerValue = "yes" | "no" | "unknown";

export interface ExpandItem {
  id?: string | null;
  name: string;
  stage: ExpandStage;
  amount_musd?: number | null;
  note?: string | null;
}

export interface RedFlag {
  id?: string | null;
  type: RedFlagType;
  note?: string | null;
  raised_at?: string | null;
  raised_by?: string | null;
  resolved_at?: string | null;
  resolved_by?: string | null;
}

export interface ReadinessAnswer {
  answer: ReadinessAnswerValue;
  proof_note?: string | null;
}

export interface Readiness {
  delivered_metric: ReadinessAnswer;
  proof_data: ReadinessAnswer;
  client_acknowledged: ReadinessAnswer;
}

export interface Track1Derived {
  next_type: string | null;
  next_scheduled: string | null;
  next_days_until: number | null;
  overdue_count: number;
  signed_off_count: number;
  total: number;
}

export interface DeliveryRenewal {
  account_id: string;
  expand_value_proof: ExpandItem[];
  expand_expand_ask: ExpandItem[];
  expand_new_scope: ExpandItem[];
  expand_close: ExpandItem[];
  red_flags: RedFlag[];
  readiness: Readiness;
  track1: Track1Derived;
  expand_paused: boolean;
  readiness_score: number;
  outcome: Outcome | null;
  outcome_set_at: string | null;
  outcome_set_by: string | null;
  is_editable: boolean;
}

export interface DeliveryRenewalUpdate {
  expand_value_proof?: ExpandItem[] | null;
  expand_expand_ask?: ExpandItem[] | null;
  expand_new_scope?: ExpandItem[] | null;
  expand_close?: ExpandItem[] | null;
  readiness?: Readiness | null;
}

export const STAGES: ExpandStage[] = [
  "value_proof",
  "expand_ask",
  "new_scope",
  "close",
];

export const STAGE_LABELS: Record<ExpandStage, string> = {
  value_proof: "Value Proof",
  expand_ask: "Expand Ask",
  new_scope: "New Scope",
  close: "Close",
};

export const STAGE_COL_KEYS: Record<
  ExpandStage,
  | "expand_value_proof"
  | "expand_expand_ask"
  | "expand_new_scope"
  | "expand_close"
> = {
  value_proof: "expand_value_proof",
  expand_ask: "expand_expand_ask",
  new_scope: "expand_new_scope",
  close: "expand_close",
};

export const FLAG_TYPES: RedFlagType[] = [
  "missed_checkpoint",
  "spoc_unresponsive",
  "no_value_logged",
  "escalation",
];

export const FLAG_LABELS: Record<RedFlagType, string> = {
  missed_checkpoint: "Missed checkpoint",
  spoc_unresponsive: "SPOC unresponsive",
  no_value_logged: "No value logged",
  escalation: "Escalation raised",
};

export const OUTCOME_LABELS: Record<Outcome, string> = {
  renewed: "Renewed",
  at_risk: "At risk",
  not_renewed: "Not renewed",
  undecided: "Undecided",
};

export const OUTCOME_TONES: Record<Outcome, string> = {
  renewed: "bg-green-50 text-green-700 border-green-300",
  at_risk: "bg-amber-50 text-amber-700 border-amber-300",
  not_renewed: "bg-red-50 text-red-700 border-red-300",
  undecided: "bg-slate-50 text-slate-700 border-slate-300",
};

export const READINESS_QUESTIONS: Array<{
  key: keyof Readiness;
  label: string;
  hint: string;
}> = [
  {
    key: "delivered_metric",
    label: "Did we deliver the metric?",
    hint: "Compare current vs target on the agreed success metric.",
  },
  {
    key: "proof_data",
    label: "Can we prove it with data?",
    hint: "Dashboard, audit log, signed-off checkpoint snapshot, etc.",
  },
  {
    key: "client_acknowledged",
    label: "Does the client acknowledge it?",
    hint: "Written confirmation, MBR sign-off, or email on file.",
  },
];
