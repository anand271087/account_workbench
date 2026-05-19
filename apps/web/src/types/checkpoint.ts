// Mirrors apps/api/app/schemas/checkpoint.py.

export type CheckpointType = "Kickoff" | "MBR" | "QBR" | "Renewal";
export type CheckpointStatus = "not_held" | "held" | "signed_off";

export interface InitiativeSnapshot {
  id?: string | null;
  name: string;
  stage?: string | null;
  [k: string]: unknown;
}

export interface MetricSnapshot {
  id: string;
  name: string;
  value?: string | null;
  target?: string | null;
  status?: string | null;
}

export interface SignedOffSnapshot {
  initiatives: InitiativeSnapshot[];
  metrics: MetricSnapshot[];
  client_acknowledgement?: string | null;
  next_actions?: string | null;
}

export interface CheckpointAttachment {
  name: string;
  url?: string | null;
}

export interface Checkpoint {
  id: string;
  account_id: string;
  type: CheckpointType;
  scheduled_date: string | null;
  held_date: string | null;
  status: CheckpointStatus;
  notes: string | null;
  signed_off_at: string | null;
  signed_off_by: string | null;
  signed_off_snapshot: SignedOffSnapshot | null;
  attachments: CheckpointAttachment[];
  created_at: string;
  updated_at: string;
  is_editable: boolean;
}

export interface CheckpointListResponse {
  items: Checkpoint[];
  total: number;
  is_editable: boolean;
}

export interface CheckpointCreate {
  type: CheckpointType;
  scheduled_date?: string | null;
}

export interface CheckpointUpdate {
  scheduled_date?: string | null;
  held_date?: string | null;
  status?: CheckpointStatus | null;
  notes?: string | null;
  attachments?: CheckpointAttachment[] | null;
}

export interface CheckpointSignOffPayload {
  initiatives?: InitiativeSnapshot[];
  metrics?: MetricSnapshot[];
  client_acknowledgement?: string | null;
  next_actions?: string | null;
  held_date?: string | null;
}

export const STATUS_LABELS: Record<CheckpointStatus, string> = {
  not_held: "Not held",
  held: "Held",
  signed_off: "Signed off",
};

export const STATUS_TONES: Record<CheckpointStatus, { bg: string; text: string; border: string }> = {
  not_held:    { bg: "bg-slate-50",  text: "text-slate-700",  border: "border-slate-300" },
  held:        { bg: "bg-blue-50",   text: "text-blue-700",   border: "border-blue-300" },
  signed_off:  { bg: "bg-green-50",  text: "text-green-700",  border: "border-green-300" },
};

export const TYPE_ICONS: Record<CheckpointType, string> = {
  Kickoff: "🚀",
  MBR:     "📊",
  QBR:     "🏆",
  Renewal: "🔄",
};

/** Days from today to the scheduled date. Negative = overdue. */
export function daysUntil(scheduled: string | null): number | null {
  if (!scheduled) return null;
  const ms = new Date(scheduled).getTime() - Date.now();
  return Math.round(ms / 86400000);
}
