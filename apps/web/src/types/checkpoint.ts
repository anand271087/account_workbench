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

/** Brand-palette colours per checkpoint status (Beroe brand book Sept 2025).
 *  Hex values so callers can use them in inline styles. Mapping (prototype
 *  bCheckpoints line 4384 → brand):
 *    not_held    → brand grey #94a3b8
 *    held        → Indigo     #4A00F8 (on brand)
 *    signed_off  → Risk Green #6EC457 (was prototype #6EC457)
 */
export const STATUS_TONES: Record<
  CheckpointStatus,
  { dot: string; bg: string; border: string; text: string }
> = {
  not_held:   { dot: "#94a3b8", bg: "#94a3b815", border: "#94a3b830", text: "#475569" },
  held:       { dot: "#4A00F8", bg: "#4A00F810", border: "#4A00F830", text: "#4A00F8" },
  signed_off: { dot: "#6EC457", bg: "#6EC45715", border: "#6EC45740", text: "#1d6b35" },
};

/** Type icons — verbatim port of prototype line 4351-4354. */
export const TYPE_ICONS: Record<CheckpointType, string> = {
  Kickoff: "🚀",
  MBR:     "📊",
  QBR:     "🏆",
  Renewal: "✅",
};

/** Per-type brand colour for the Reference card tile + accents.
 *  Maps the 4 checkpoints to brand palette anchors:
 *    Kickoff → Indigo     (Pre-Sales / start)
 *    MBR     → Aqua       (mid-cycle)
 *    QBR     → Fuscia     (quarterly accent)
 *    Renewal → Risk Amber (decision gate, attention)
 */
export const TYPE_COLORS: Record<CheckpointType, string> = {
  Kickoff: "#4A00F8",
  MBR:     "#35E1D4",
  QBR:     "#C344C7",
  Renewal: "#F0BC41",
};

/** Days from today to the scheduled date. Negative = overdue. */
export function daysUntil(scheduled: string | null): number | null {
  if (!scheduled) return null;
  const ms = new Date(scheduled).getTime() - Date.now();
  return Math.round(ms / 86400000);
}
