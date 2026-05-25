// M21 — Checkpoints.
//
// Timeline of the four standard checkpoints (Kickoff/MBR/QBR/Renewal)
// plus any custom additions. Each card supports:
//   * status transitions (not_held → held → signed_off)
//   * note editing (until signed off)
//   * sign-off modal that snapshots reviewed initiatives + metrics +
//     client acknowledgement + next actions
// Signed-off rows are immutable evidence — show the snapshot inline.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAccountFromLayout } from "../../AccountProfileLayout";
import {
  daysUntil,
  STATUS_LABELS,
  STATUS_TONES,
  TYPE_ICONS,
  type Checkpoint,
  type CheckpointAttachment,
  type CheckpointListResponse,
  type CheckpointSignOffPayload,
  type CheckpointUpdate,
  type CheckpointType,
  type InitiativeSnapshot,
  type MetricSnapshot,
} from "@/types/checkpoint";
import type { MetricListResponse } from "@/types/metric";

const TYPES: CheckpointType[] = ["Kickoff", "MBR", "QBR", "Renewal"];

export default function CheckpointsTab() {
  const account = useAccountFromLayout();
  const qc = useQueryClient();
  const queryKey = ["checkpoints", account.id];

  const { data, isLoading } = useQuery<CheckpointListResponse>({
    queryKey,
    queryFn: () =>
      api.get<CheckpointListResponse>(
        `/api/v1/accounts/${account.id}/checkpoints`,
      ),
  });

  const [signOffFor, setSignOffFor] = useState<Checkpoint | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const editable = !!data?.is_editable;
  const items = data?.items ?? [];

  const autoSchedule = useMutation({
    mutationFn: () =>
      api.post<CheckpointListResponse>(
        `/api/v1/accounts/${account.id}/checkpoints/auto-schedule`,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-[14px] font-bold text-text-primary">Checkpoints</h2>
          <p className="text-[11px] text-text-muted">
            The cadence that proves value. Kickoff → MBR (+90d) → QBR (+180d) →
            Renewal (T−14d). Sign-off snapshots become the evidence Renewal
            Readiness reads from.
          </p>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {editable && items.length === 0 && (
            <button
              onClick={() => autoSchedule.mutate()}
              disabled={autoSchedule.isPending}
              className="text-[12px] px-3 py-1.5 rounded-lg bg-beroe-blue text-white font-semibold disabled:opacity-50"
              title={
                !account.gate_signed
                  ? "Account must be signed before auto-scheduling"
                  : undefined
              }
            >
              {autoSchedule.isPending ? "Scheduling…" : "📅 Auto-schedule"}
            </button>
          )}
          {editable && (
            <button
              onClick={() => setShowCreate(true)}
              className="text-[12px] px-3 py-1.5 rounded-lg border border-beroe-card-border text-text-secondary"
            >
              + Add checkpoint
            </button>
          )}
        </div>
      </div>

      {autoSchedule.error && (
        <div className="text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {(autoSchedule.error as ApiError).message}
        </div>
      )}

      <CheckpointReferenceCard />

      {isLoading && <div className="text-sm text-text-muted">Loading checkpoints…</div>}

      {!isLoading && items.length === 0 && (
        <div className="bg-white border border-beroe-card-border rounded-card p-8 text-center">
          <div className="text-[13px] font-semibold text-text-primary mb-1">
            No checkpoints yet
          </div>
          <p className="text-[12px] text-text-muted">
            {account.gate_signed
              ? "Click Auto-schedule to lay down the standard Kickoff/MBR/QBR/Renewal cadence."
              : "Once the account is signed, you can auto-schedule the standard cadence."}
          </p>
        </div>
      )}

      <div className="space-y-3">
        {items.map((cp) => (
          <CheckpointCard
            key={cp.id}
            cp={cp}
            editable={editable}
            onSignOff={() => setSignOffFor(cp)}
            accountId={account.id}
          />
        ))}
      </div>

      {showCreate && (
        <CreateCheckpointModal
          accountId={account.id}
          existingTypes={new Set(items.map((c) => c.type))}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            qc.invalidateQueries({ queryKey });
          }}
        />
      )}

      {signOffFor && (
        <SignOffModal
          accountId={account.id}
          checkpoint={signOffFor}
          onClose={() => setSignOffFor(null)}
          onDone={() => {
            setSignOffFor(null);
            qc.invalidateQueries({ queryKey });
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// Card
// ============================================================

function CheckpointCard({
  cp,
  editable,
  onSignOff,
  accountId,
}: {
  cp: Checkpoint;
  editable: boolean;
  onSignOff: () => void;
  accountId: string;
}) {
  const qc = useQueryClient();
  const queryKey = ["checkpoints", accountId];
  const tone = STATUS_TONES[cp.status];
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState(cp.notes ?? "");
  const [snapshotOpen, setSnapshotOpen] = useState(false);

  const isSignedOff = cp.status === "signed_off";
  const overdue =
    !isSignedOff &&
    cp.scheduled_date !== null &&
    (daysUntil(cp.scheduled_date) ?? 0) < -7;

  const patchMutation = useMutation({
    mutationFn: (body: CheckpointUpdate) =>
      api.patch<Checkpoint>(`/api/v1/checkpoints/${cp.id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/api/v1/checkpoints/${cp.id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  return (
    <div className="bg-white border border-beroe-card-border rounded-card p-4">
      <div className="flex items-start gap-3">
        <div className="text-[24px] flex-shrink-0 leading-none mt-0.5">
          {TYPE_ICONS[cp.type]}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-[14px] font-bold text-text-primary">{cp.type}</h3>
            <span
              className={cn(
                "text-[10px] font-bold px-2 py-0.5 rounded-full",
                tone.bg,
                tone.text,
              )}
            >
              {STATUS_LABELS[cp.status]}
            </span>
            {overdue && (
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                ⚠ Overdue
              </span>
            )}
          </div>
          <div className="text-[11px] text-text-muted mt-0.5">
            {cp.scheduled_date && (
              <span>
                Scheduled {new Date(cp.scheduled_date).toLocaleDateString()}
              </span>
            )}
            {cp.held_date && (
              <span> · Held {new Date(cp.held_date).toLocaleDateString()}</span>
            )}
            {cp.signed_off_at && (
              <span> · Signed off {new Date(cp.signed_off_at).toLocaleString()}</span>
            )}
          </div>
        </div>
        {editable && !isSignedOff && (
          <div className="flex gap-1.5 flex-shrink-0">
            {cp.status === "not_held" && (
              <button
                onClick={() =>
                  patchMutation.mutate({
                    status: "held",
                    held_date: new Date().toISOString().slice(0, 10),
                  })
                }
                className="text-[11px] px-2.5 py-1 rounded-md border border-beroe-card-border text-text-secondary hover:bg-beroe-bg/60"
              >
                Mark held
              </button>
            )}
            {cp.status === "held" && (
              <button
                onClick={onSignOff}
                className="text-[11px] px-2.5 py-1 rounded-md bg-green-600 text-white font-semibold"
              >
                🔒 Sign off
              </button>
            )}
            {cp.status === "not_held" && (
              <button
                onClick={() => {
                  if (confirm(`Delete ${cp.type} checkpoint?`)) deleteMutation.mutate();
                }}
                className="text-[11px] px-2 py-1 rounded-md border border-beroe-card-border text-text-muted hover:text-red-700 hover:border-red-300"
              >
                ✕
              </button>
            )}
          </div>
        )}
      </div>

      {/* Notes */}
      <div className="mt-3">
        {editingNotes && editable && !isSignedOff ? (
          <div className="flex flex-col gap-2">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="text-[12px] px-2.5 py-1.5 rounded-md border border-beroe-card-border focus:border-beroe-blue focus:outline-none"
              placeholder="Meeting notes, outcomes, decisions…"
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  patchMutation.mutate({ notes: notes || null });
                  setEditingNotes(false);
                }}
                className="text-[11px] px-3 py-1 rounded-md bg-beroe-blue text-white font-semibold"
              >
                Save notes
              </button>
              <button
                onClick={() => {
                  setNotes(cp.notes ?? "");
                  setEditingNotes(false);
                }}
                className="text-[11px] px-3 py-1 rounded-md border border-beroe-card-border"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : cp.notes ? (
          <div
            className={cn(
              "text-[12px] text-text-secondary bg-beroe-bg/40 rounded-md px-3 py-2",
              editable && !isSignedOff && "cursor-pointer hover:bg-beroe-bg/70",
            )}
            onClick={() => {
              if (editable && !isSignedOff) setEditingNotes(true);
            }}
          >
            {cp.notes}
          </div>
        ) : (
          editable && !isSignedOff && (
            <button
              onClick={() => setEditingNotes(true)}
              className="text-[11px] text-beroe-blue"
            >
              + Add notes
            </button>
          )
        )}
      </div>

      {/* R31 — attachments (files / recordings). Stored as { name, url } pairs. */}
      <AttachmentsRow cp={cp} editable={editable && !isSignedOff} accountId={accountId} />

      {/* Signed-off snapshot */}
      {isSignedOff && cp.signed_off_snapshot && (
        <div className="mt-3 pt-3 border-t border-beroe-card-border/60">
          <button
            onClick={() => setSnapshotOpen((v) => !v)}
            className="text-[11px] font-semibold text-green-700"
          >
            {snapshotOpen ? "Hide" : "Show"} sign-off snapshot
          </button>
          {snapshotOpen && (
            <div className="mt-2 bg-green-50/60 border border-green-200 rounded-md px-3 py-2.5 text-[11px] space-y-2">
              {(cp.signed_off_snapshot.initiatives ?? []).length > 0 && (
                <div>
                  <div className="font-bold text-green-800 mb-0.5">Initiatives reviewed</div>
                  <ul className="list-disc list-inside text-text-secondary">
                    {cp.signed_off_snapshot.initiatives.map((i, n) => (
                      <li key={n}>
                        {i.name} {i.stage && <span className="text-text-muted">— {i.stage}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {(cp.signed_off_snapshot.metrics ?? []).length > 0 && (
                <div>
                  <div className="font-bold text-green-800 mb-0.5">Metrics discussed</div>
                  <ul className="list-disc list-inside text-text-secondary">
                    {cp.signed_off_snapshot.metrics.map((m, n) => (
                      <li key={n}>
                        {m.name}: {m.value ?? "—"}
                        {m.target && <span className="text-text-muted"> / {m.target}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {cp.signed_off_snapshot.client_acknowledgement && (
                <div>
                  <div className="font-bold text-green-800 mb-0.5">Client acknowledgement</div>
                  <p className="text-text-secondary italic">
                    “{cp.signed_off_snapshot.client_acknowledgement}”
                  </p>
                </div>
              )}
              {cp.signed_off_snapshot.next_actions && (
                <div>
                  <div className="font-bold text-green-800 mb-0.5">Next actions</div>
                  <p className="text-text-secondary">
                    {cp.signed_off_snapshot.next_actions}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Create modal
// ============================================================

function CreateCheckpointModal({
  accountId,
  existingTypes,
  onClose,
  onCreated,
}: {
  accountId: string;
  existingTypes: Set<CheckpointType>;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [type, setType] = useState<CheckpointType>("MBR");
  const [scheduled, setScheduled] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      api.post<Checkpoint>(`/api/v1/accounts/${accountId}/checkpoints`, {
        type,
        scheduled_date: scheduled || null,
      }),
    onSuccess: () => onCreated(),
  });

  return (
    <Modal onClose={onClose}>
      <h3 className="text-[14px] font-bold mb-3">Add a checkpoint</h3>
      <div className="flex flex-col gap-2.5">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as CheckpointType)}
          className="text-[12px] px-2.5 py-1.5 rounded-md border border-beroe-card-border"
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_ICONS[t]} {t}
              {existingTypes.has(t) && " (already exists)"}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={scheduled}
          onChange={(e) => setScheduled(e.target.value)}
          className="text-[12px] px-2.5 py-1.5 rounded-md border border-beroe-card-border"
        />
        <div className="flex gap-2 mt-2">
          <button
            onClick={onClose}
            className="flex-1 text-[12px] px-3 py-1.5 rounded-md border border-beroe-card-border"
          >
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="flex-1 text-[12px] px-3 py-1.5 rounded-md bg-beroe-blue text-white font-semibold"
          >
            {mutation.isPending ? "Adding…" : "Add"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ============================================================
// Sign-off modal — picks initiatives / metrics from this account
// ============================================================

function SignOffModal({
  accountId,
  checkpoint,
  onClose,
  onDone,
}: {
  accountId: string;
  checkpoint: Checkpoint;
  onClose: () => void;
  onDone: () => void;
}) {
  // Pull live metrics so the user can tick which were discussed.
  const { data: metricsData } = useQuery<MetricListResponse>({
    queryKey: ["metrics", accountId],
    queryFn: () =>
      api.get<MetricListResponse>(`/api/v1/accounts/${accountId}/metrics`),
  });
  const metrics = metricsData?.items ?? [];

  const [selectedMetricIds, setSelectedMetricIds] = useState<Set<string>>(new Set());
  const [initiativeText, setInitiativeText] = useState("");
  const [clientAck, setClientAck] = useState("");
  const [nextActions, setNextActions] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      const initiatives: InitiativeSnapshot[] = initiativeText
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
          // "name — stage" optional separator
          const [name, stage] = line.split(/\s+[—-]\s+/, 2);
          return { name: name.trim(), stage: stage?.trim() ?? null };
        });
      const metricSnapshots: MetricSnapshot[] = metrics
        .filter((m) => selectedMetricIds.has(m.id))
        .map((m) => ({
          id: m.id,
          name: m.name,
          value: m.current_value,
          target: m.target_value,
          status: m.status,
        }));
      const body: CheckpointSignOffPayload = {
        initiatives,
        metrics: metricSnapshots,
        client_acknowledgement: clientAck || null,
        next_actions: nextActions || null,
      };
      return api.post<Checkpoint>(
        `/api/v1/checkpoints/${checkpoint.id}/sign-off`,
        body,
      );
    },
    onSuccess: () => onDone(),
    onError: (e: ApiError) => setError(e.message),
  });

  const toggleMetric = (id: string) => {
    setSelectedMetricIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Modal onClose={onClose} wide>
      <h3 className="text-[14px] font-bold mb-1">
        Sign off — {checkpoint.type}
      </h3>
      <p className="text-[11px] text-text-muted mb-3">
        Capture what was reviewed. This snapshot is permanent evidence — used
        by Renewal Readiness (M23) and the VDD (M22). Signed-off checkpoints
        can't be edited.
      </p>

      <div className="space-y-3">
        {/* Initiatives */}
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-text-secondary mb-1">
            Initiatives reviewed
            <span className="font-normal text-text-muted ml-1">
              (one per line · optional "name — stage" suffix)
            </span>
          </div>
          <textarea
            rows={3}
            value={initiativeText}
            onChange={(e) => setInitiativeText(e.target.value)}
            placeholder={"Cocoa renegotiation — implemented\nWheat spec harmonisation — committed"}
            className="w-full text-[12px] px-2.5 py-1.5 rounded-md border border-beroe-card-border focus:border-beroe-blue focus:outline-none font-mono"
          />
        </div>

        {/* Metrics */}
        {metrics.length > 0 && (
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wide text-text-secondary mb-1">
              Metrics discussed
              <span className="font-normal text-text-muted ml-1">(tick what was reviewed)</span>
            </div>
            <div className="flex flex-col gap-1 max-h-40 overflow-y-auto border border-beroe-card-border rounded-md p-2 bg-beroe-bg/40">
              {metrics.map((m) => (
                <label
                  key={m.id}
                  className="text-[12px] flex items-center gap-2 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selectedMetricIds.has(m.id)}
                    onChange={() => toggleMetric(m.id)}
                  />
                  <span className="font-semibold">{m.name}</span>
                  <span className="text-text-muted">
                    {m.current_value ?? "—"} / {m.target_value ?? "—"}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Client acknowledgement */}
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-text-secondary mb-1">
            Client acknowledgement
          </div>
          <textarea
            rows={2}
            value={clientAck}
            onChange={(e) => setClientAck(e.target.value)}
            placeholder='e.g. "Jordan confirmed the $1.8M savings figure at QBR"'
            className="w-full text-[12px] px-2.5 py-1.5 rounded-md border border-beroe-card-border focus:border-beroe-blue focus:outline-none"
          />
        </div>

        {/* Next actions */}
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-text-secondary mb-1">
            Next actions
          </div>
          <textarea
            rows={2}
            value={nextActions}
            onChange={(e) => setNextActions(e.target.value)}
            placeholder='e.g. "Deliver Power BI by Feb 15. Re-engage Dave Kowalski."'
            className="w-full text-[12px] px-2.5 py-1.5 rounded-md border border-beroe-card-border focus:border-beroe-blue focus:outline-none"
          />
        </div>

        {error && (
          <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-md px-2 py-1">
            {error}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 text-[12px] px-3 py-1.5 rounded-md border border-beroe-card-border text-text-secondary"
          >
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="flex-1 text-[12px] px-3 py-1.5 rounded-md bg-green-600 text-white font-semibold disabled:opacity-50"
          >
            {mutation.isPending ? "Signing off…" : "🔒 Sign off — final"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Modal({
  children,
  onClose,
  wide,
}: {
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className={cn(
          "bg-white rounded-card p-5 w-full",
          wide ? "max-w-2xl" : "max-w-md",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

// ============================================================
// R31 — Attachments
// ============================================================

function AttachmentsRow({
  cp,
  editable,
  accountId,
}: {
  cp: Checkpoint;
  editable: boolean;
  accountId: string;
}) {
  const qc = useQueryClient();
  const queryKey = ["checkpoints", accountId];
  const attachments = cp.attachments ?? [];
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");

  const patch = useMutation({
    mutationFn: (next: CheckpointAttachment[]) =>
      api.patch<Checkpoint>(`/api/v1/checkpoints/${cp.id}`, {
        attachments: next,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  const addOne = () => {
    if (!name.trim()) return;
    patch.mutate([...attachments, { name: name.trim(), url: url.trim() || null }]);
    setName("");
    setUrl("");
    setAdding(false);
  };
  const removeAt = (idx: number) =>
    patch.mutate(attachments.filter((_, i) => i !== idx));

  if (attachments.length === 0 && !editable) return null;

  return (
    <div className="mt-3 pt-3 border-t border-beroe-card-border/60">
      <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted mb-1.5">
        Attachments
      </div>
      {attachments.length === 0 ? (
        <div className="text-[11px] text-text-muted italic">
          No files or recordings attached.
        </div>
      ) : (
        <ul className="space-y-1">
          {attachments.map((a, i) => (
            <li
              key={i}
              className="flex items-center gap-2 text-[11px] bg-slate-50 border border-beroe-card-border rounded-md px-2 py-1"
            >
              <span className="text-[14px]">📎</span>
              {a.url ? (
                <a
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-beroe-blue font-semibold hover:underline"
                >
                  {a.name}
                </a>
              ) : (
                <span className="font-semibold text-text-primary">{a.name}</span>
              )}
              {editable && (
                <button
                  onClick={() => removeAt(i)}
                  className="ml-auto text-text-muted hover:text-red-700"
                  title="Remove attachment"
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <div className="mt-1.5">
          {adding ? (
            <div className="flex flex-col gap-1.5">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="File / recording name (e.g. QBR-deck.pdf, call-recording.mp4)"
                className="text-[12px] px-2 py-1 rounded-md border border-beroe-card-border"
              />
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="URL (optional — paste a link to the file)"
                className="text-[12px] px-2 py-1 rounded-md border border-beroe-card-border"
              />
              <div className="flex gap-2">
                <button
                  onClick={addOne}
                  disabled={!name.trim() || patch.isPending}
                  className="text-[11px] px-2.5 py-1 rounded-md bg-beroe-blue text-white font-semibold disabled:opacity-50"
                >
                  Add
                </button>
                <button
                  onClick={() => {
                    setAdding(false);
                    setName("");
                    setUrl("");
                  }}
                  className="text-[11px] px-2.5 py-1 rounded-md border border-beroe-card-border"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="text-[11px] text-beroe-blue font-semibold"
            >
              + Attach file / recording
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Reference — What Must Be Shown at Each Checkpoint
// ============================================================

const CHECKPOINT_GUIDE: Record<
  CheckpointType,
  { tagline: string; review: string[]; decide: string[]; signoff: string[] }
> = {
  Kickoff: {
    tagline: "Set scope, success metrics, owners, cadence.",
    review: [
      "Engagement scope + categories in play",
      "Stakeholder map (sponsor, champion, budget owner)",
      "Baseline data + starting metrics",
    ],
    decide: [
      "Primary success metric + measurement method",
      "Cadence (MBR/QBR dates, monthly check-ins)",
      "Engagement plan + first 90-day initiatives",
    ],
    signoff: [
      "Success contract (3 locks)",
      "Initiatives committed for first quarter",
      "Client acknowledgement of scope + cadence",
    ],
  },
  MBR: {
    tagline: "Usage trajectory + early wins after first 90 days.",
    review: [
      "Logins, active users, module adoption vs target",
      "Initiatives in flight + blockers",
      "Early value identified (savings, risk avoided, time saved)",
    ],
    decide: [
      "Course-correct stalled initiatives",
      "Onboard new users / categories if usage lagging",
      "Confirm QBR agenda + invitees",
    ],
    signoff: [
      "Updated success metrics with current vs target",
      "Next-90-day initiative list",
      "Client acknowledgement on usage trend",
    ],
  },
  QBR: {
    tagline: "Value delivered + commercial signal half-way through term.",
    review: [
      "All success metrics with green/amber/red status",
      "Value delivered ($ identified / committed / implemented)",
      "Adoption + super-user roster",
      "Soft signals (positive + risk) since Kickoff",
    ],
    decide: [
      "Renewal posture (expand / retain / at-risk)",
      "Expansion plays to pitch (modules, categories, geos)",
      "Renewal Readiness gaps to close before T−14d",
    ],
    signoff: [
      "Value Delivery Document checkpoint snapshot",
      "Initiatives for next 90 days + expansion proposal",
      "Client acknowledgement on renewal direction",
    ],
  },
  Renewal: {
    tagline: "Lock the outcome — renewed / at-risk / not renewed.",
    review: [
      "Full-term Value Delivery Document (all 4 sections)",
      "Final ARR delivered vs committed",
      "Outstanding red flags + resolution status",
      "Renewal Readiness 3-question grid",
    ],
    decide: [
      "Renewal terms (ACV, modules, duration)",
      "Outcome: renewed / at-risk / not renewed",
      "Hand-off plan if not renewing",
    ],
    signoff: [
      "Signed renewal contract OR documented exit",
      "Final VDD locked",
      "Outcome stamped on Delivery & Renewal",
    ],
  },
};

const CHECKPOINT_TONES: Record<CheckpointType, string> = {
  Kickoff: "border-sky-200 bg-sky-50",
  MBR: "border-indigo-200 bg-indigo-50",
  QBR: "border-violet-200 bg-violet-50",
  Renewal: "border-amber-200 bg-amber-50",
};

function CheckpointReferenceCard() {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-beroe-card-border rounded-card bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left"
      >
        <div>
          <div className="text-[12px] font-bold text-text-primary">
            What must be shown at each checkpoint
          </div>
          <p className="text-[10px] text-text-muted">
            Stakeholder reference — what to review, decide, and sign off at
            Kickoff · MBR · QBR · Renewal.
          </p>
        </div>
        <span className="text-[11px] text-text-muted">{open ? "▴ Hide" : "▾ Show"}</span>
      </button>
      {open && (
        <div className="border-t border-beroe-card-border p-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          {TYPES.map((type) => {
            const g = CHECKPOINT_GUIDE[type];
            return (
              <div
                key={type}
                className={cn(
                  "rounded-lg border p-3",
                  CHECKPOINT_TONES[type],
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[14px]">{TYPE_ICONS[type]}</span>
                  <span className="text-[12px] font-bold text-text-primary">
                    {type}
                  </span>
                </div>
                <p className="text-[10px] text-text-muted mb-2 italic">
                  {g.tagline}
                </p>
                <div className="space-y-1.5">
                  <ReferenceList label="Review" items={g.review} />
                  <ReferenceList label="Decide" items={g.decide} />
                  <ReferenceList label="Sign off" items={g.signoff} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ReferenceList({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wide font-semibold text-text-muted">
        {label}
      </div>
      <ul className="mt-0.5 space-y-0.5">
        {items.map((it, i) => (
          <li key={i} className="text-[11px] text-text-secondary leading-snug">
            • {it}
          </li>
        ))}
      </ul>
    </div>
  );
}
