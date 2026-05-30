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
  TYPE_COLORS,
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

// Beroe brand palette anchors.
const INDIGO = "#4A00F8";
const MIDNIGHT = "#001137";
const RISK_GREEN = "#6EC457";
const RISK_RED = "#CF4548";

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

  const editable = !!data?.is_editable;
  const items = data?.items ?? [];

  const autoSchedule = useMutation({
    mutationFn: () =>
      api.post<CheckpointListResponse>(
        `/api/v1/accounts/${account.id}/checkpoints/auto-schedule`,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  const [quickAddType, setQuickAddType] = useState<CheckpointType | null>(null);
  const existingTypes = new Set(items.map((c) => c.type));

  return (
    <div className="space-y-3.5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div
            className="text-[11px] font-bold uppercase"
            style={{ color: "#35E1D4", letterSpacing: "0.05em" }}
          >
            Checkpoint Cadence
          </div>
          <p className="text-[11px] text-text-muted mt-0.5">
            The cadence that proves value. Kickoff → MBR (+90d) → QBR (+180d) →
            Renewal (T−14d). Sign-off snapshots become the evidence Renewal
            Readiness reads from.
          </p>
        </div>
        {/* Prototype line 4360 — one quick-add button per type. */}
        {editable && (
          <div className="flex gap-1.5 flex-wrap">
            {TYPES.map((t) => {
              const exists = existingTypes.has(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setQuickAddType(t)}
                  disabled={exists}
                  title={exists ? `${t} already scheduled` : `Add a ${t} checkpoint`}
                  className="text-[11px] px-2.5 py-1 rounded-md font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    background: "#fff",
                    border: `1px solid ${TYPE_COLORS[t]}40`,
                    color: TYPE_COLORS[t],
                  }}
                >
                  {TYPE_ICONS[t]} + {t}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {autoSchedule.error && (
        <div
          className="text-[12px] rounded-lg px-3 py-2"
          style={{
            color: RISK_RED,
            background: `${RISK_RED}10`,
            border: `1px solid ${RISK_RED}30`,
          }}
        >
          {(autoSchedule.error as ApiError).message}
        </div>
      )}

      <CheckpointReferenceCard />

      {isLoading && <div className="text-sm text-text-muted">Loading checkpoints…</div>}

      {!isLoading && items.length === 0 && (
        <div
          className="rounded-card text-center p-8"
          style={{ background: "#fff", border: "1px solid #e4eaf6" }}
        >
          <div className="text-[24px] mb-2">📅</div>
          <div
            className="text-[13px] font-bold mb-1"
            style={{ color: MIDNIGHT }}
          >
            No checkpoints scheduled yet
          </div>
          <p className="text-[11px] text-text-muted max-w-[400px] mx-auto">
            {account.gate_signed
              ? "Click Auto-schedule to lay down the standard cadence below."
              : "Once the account is signed, you can auto-schedule the standard cadence."}
          </p>
          {account.gate_signed && editable && (
            <>
              <button
                onClick={() => autoSchedule.mutate()}
                disabled={autoSchedule.isPending}
                className="mt-3 text-[12px] px-4 py-2 rounded-md font-semibold text-white disabled:opacity-50"
                style={{ background: INDIGO }}
              >
                {autoSchedule.isPending
                  ? "Scheduling…"
                  : "📅 Auto-schedule standard cadence"}
              </button>
              <div className="text-[10px] text-text-muted mt-1.5">
                Creates: Kickoff → MBR (90d) → QBR (180d) → Renewal (14d
                before expiry)
              </div>
            </>
          )}
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

      {quickAddType && (
        <CreateCheckpointModal
          accountId={account.id}
          initialType={quickAddType}
          existingTypes={existingTypes}
          onClose={() => setQuickAddType(null)}
          onCreated={() => {
            setQuickAddType(null);
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
    <div
      className="rounded-card p-3.5"
      style={{
        background: overdue ? `${RISK_RED}10` : "#fff",
        border: "1px solid #e4eaf6",
        borderLeft: `3px solid ${tone.dot}`,
      }}
    >
      <div className="flex items-start gap-3">
        <div className="text-[20px] flex-shrink-0 leading-none mt-0.5">
          {TYPE_ICONS[cp.type]}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3
              className="text-[13px] font-bold"
              style={{ color: MIDNIGHT }}
            >
              {cp.type}
            </h3>
            <span
              className="text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{
                background: tone.bg,
                border: `1px solid ${tone.border}`,
                color: tone.text,
              }}
            >
              {cp.status === "held" && !cp.signed_off_at
                ? "⏳ Awaiting sign-off"
                : STATUS_LABELS[cp.status]}
            </span>
            {overdue && (
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{
                  background: `${RISK_RED}15`,
                  color: RISK_RED,
                }}
              >
                ⚠ Overdue
              </span>
            )}
          </div>
          <div className="text-[10px] text-text-muted mt-0.5">
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
          <div className="flex flex-col gap-1.5 flex-shrink-0 items-end">
            {/* 29-May bug 29-38 — free status changer (Not Held / Held /
                Signed off). Picking "Signed off" routes through the
                existing SignOffModal so the permanent snapshot still
                gets captured; picking Not Held / Held PATCHes directly. */}
            <select
              value={cp.status}
              onChange={(e) => {
                const next = e.target.value as typeof cp.status;
                if (next === "signed_off") {
                  onSignOff();
                  return;
                }
                patchMutation.mutate(
                  next === "held"
                    ? {
                        status: "held",
                        held_date:
                          cp.held_date ?? new Date().toISOString().slice(0, 10),
                      }
                    : { status: "not_held", held_date: null },
                );
              }}
              className="text-[11px] px-2 py-1 rounded-md font-semibold border border-beroe-card-border bg-white"
              title="Change checkpoint status"
            >
              <option value="not_held">Not held</option>
              <option value="held">Held</option>
              <option value="signed_off">Signed off →</option>
            </select>
            {cp.status === "held" && (
              <button
                onClick={onSignOff}
                className="text-[11px] px-2.5 py-1 rounded-md font-semibold text-white"
                style={{ background: RISK_GREEN }}
              >
                ✓ Mark signed off
              </button>
            )}
            {cp.status === "not_held" && (
              <button
                onClick={() => {
                  if (confirm(`Delete ${cp.type} checkpoint?`)) deleteMutation.mutate();
                }}
                className="text-[11px] px-2 py-1 rounded-md"
                style={{
                  background: "#fff",
                  border: "1px solid #e4eaf6",
                  color: "#94a3b8",
                }}
                title="Delete checkpoint"
              >
                ✕
              </button>
            )}
          </div>
        )}
      </div>

      {/* Notes */}
      <div className="mt-2.5">
        {editingNotes && editable && !isSignedOff ? (
          <div className="flex flex-col gap-2">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="text-[12px] px-2.5 py-1.5 rounded-md border border-beroe-card-border focus:border-beroe-blue focus:outline-none focus:ring-1 focus:ring-beroe-blue/20"
              placeholder="Meeting notes, outcomes, decisions…"
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  patchMutation.mutate({ notes: notes || null });
                  setEditingNotes(false);
                }}
                className="text-[11px] px-3 py-1 rounded-md font-semibold text-white"
                style={{ background: INDIGO }}
              >
                Save notes
              </button>
              <button
                onClick={() => {
                  setNotes(cp.notes ?? "");
                  setEditingNotes(false);
                }}
                className="text-[11px] px-3 py-1 rounded-md"
                style={{
                  background: "#fff",
                  border: "1px solid #e4eaf6",
                  color: MIDNIGHT,
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : cp.notes ? (
          <div
            className={cn(
              "text-[11px] rounded-md px-3 py-2",
              editable && !isSignedOff && "cursor-pointer",
            )}
            style={{
              background: "#EAF1F580",
              border: "1px solid #e4eaf6",
              color: "#475569",
            }}
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
              className="text-[11px] font-semibold"
              style={{ color: INDIGO }}
            >
              + Add notes
            </button>
          )
        )}
      </div>

      {/* R31 — attachments (files / recordings). Stored as { name, url } pairs. */}
      <AttachmentsRow cp={cp} editable={editable && !isSignedOff} accountId={accountId} />

      {/* Signed-off snapshot — Risk-Green-tinted, brand palette. */}
      {isSignedOff && cp.signed_off_snapshot && (
        <div
          className="mt-3 pt-3"
          style={{ borderTop: "1px solid #f0f4fb" }}
        >
          <button
            onClick={() => setSnapshotOpen((v) => !v)}
            className="text-[11px] font-semibold"
            style={{ color: RISK_GREEN }}
          >
            📋 {snapshotOpen ? "Hide" : "Show"} sign-off snapshot
          </button>
          {snapshotOpen && (
            <div
              className="mt-2 rounded-md px-3 py-2.5 text-[11px] space-y-2"
              style={{
                background: `${RISK_GREEN}10`,
                border: `1px solid ${RISK_GREEN}30`,
              }}
            >
              {(cp.signed_off_snapshot.initiatives ?? []).length > 0 && (
                <div>
                  <div
                    className="font-bold mb-0.5"
                    style={{ color: "#1d6b35" }}
                  >
                    Initiatives reviewed
                  </div>
                  <ul className="list-disc list-inside text-text-secondary">
                    {cp.signed_off_snapshot.initiatives.map((i, n) => (
                      <li key={n}>
                        {i.name}{" "}
                        {i.stage && (
                          <span className="text-text-muted">— {i.stage}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {(cp.signed_off_snapshot.metrics ?? []).length > 0 && (
                <div>
                  <div
                    className="font-bold mb-0.5"
                    style={{ color: "#1d6b35" }}
                  >
                    Metrics discussed
                  </div>
                  <ul className="list-disc list-inside text-text-secondary">
                    {cp.signed_off_snapshot.metrics.map((m, n) => (
                      <li key={n}>
                        {m.name}: {m.value ?? "—"}
                        {m.target && (
                          <span className="text-text-muted">
                            {" "}/ {m.target}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {cp.signed_off_snapshot.client_acknowledgement && (
                <div>
                  <div
                    className="font-bold mb-0.5"
                    style={{ color: "#1d6b35" }}
                  >
                    Client acknowledgement
                  </div>
                  <p className="text-text-secondary italic">
                    &ldquo;{cp.signed_off_snapshot.client_acknowledgement}&rdquo;
                  </p>
                </div>
              )}
              {cp.signed_off_snapshot.next_actions && (
                <div>
                  <div
                    className="font-bold mb-0.5"
                    style={{ color: "#1d6b35" }}
                  >
                    Next actions
                  </div>
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
  initialType,
  existingTypes,
  onClose,
  onCreated,
}: {
  accountId: string;
  initialType?: CheckpointType;
  existingTypes: Set<CheckpointType>;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [type, setType] = useState<CheckpointType>(initialType ?? "MBR");
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
      <h3
        className="text-[14px] font-bold mb-3"
        style={{ color: MIDNIGHT }}
      >
        Add a checkpoint
      </h3>
      <div className="flex flex-col gap-2.5">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as CheckpointType)}
          className="text-[12px] px-2.5 py-1.5 rounded-md border border-beroe-card-border focus:border-beroe-blue focus:outline-none"
        >
          {TYPES.map((t) => (
            <option key={t} value={t} disabled={existingTypes.has(t)}>
              {TYPE_ICONS[t]} {t}
              {existingTypes.has(t) && " (already exists)"}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={scheduled}
          onChange={(e) => setScheduled(e.target.value)}
          className="text-[12px] px-2.5 py-1.5 rounded-md border border-beroe-card-border focus:border-beroe-blue focus:outline-none"
        />
        <div className="flex gap-2 mt-2">
          <button
            onClick={onClose}
            className="flex-1 text-[12px] px-3 py-1.5 rounded-md"
            style={{
              background: "#fff",
              border: "1px solid #e4eaf6",
              color: MIDNIGHT,
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="flex-1 text-[12px] px-3 py-1.5 rounded-md font-semibold text-white"
            style={{ background: INDIGO }}
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
          <div className="text-[11px] font-bold uppercase tracking-wide text-text-secondary mb-1 flex items-center justify-between">
            <span>Client acknowledgement</span>
            {/* 29-May bug 29-36 — AI bulb suggestion. Copies a
                checkpoint-context prompt to clipboard so the CSM can
                paste into Claude for a defensible 1-line ack. */}
            <button
              type="button"
              onClick={async () => {
                const prompt = `Draft a 1-sentence client acknowledgement we can record for the ${checkpoint.type} checkpoint. Initiatives reviewed: ${initiativeText || "none captured"}. Focus on a concrete commitment or confirmation made by the client. Plain prose, ≤200 chars.`;
                try {
                  await navigator.clipboard.writeText(prompt);
                  setClientAck((prev) =>
                    prev
                      ? prev
                      : "[Prompt copied to clipboard — paste into Claude / AI panel and paste the response back here.]",
                  );
                } catch {
                  // ignore
                }
              }}
              className="text-[10px] font-semibold px-2 py-0.5 rounded-md border border-beroe-blue/30 text-beroe-blue hover:bg-beroe-blue/10 normal-case tracking-normal"
              title="Copy an AI prompt to clipboard"
            >
              💡 AI suggest
            </button>
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
          <div
            className="text-[11px] rounded-md px-2 py-1"
            style={{
              color: RISK_RED,
              background: `${RISK_RED}10`,
              border: `1px solid ${RISK_RED}30`,
            }}
          >
            {error}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            onClick={onClose}
            className="flex-1 text-[12px] px-3 py-1.5 rounded-md"
            style={{
              background: "#fff",
              border: "1px solid #e4eaf6",
              color: MIDNIGHT,
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="flex-1 text-[12px] px-3 py-1.5 rounded-md font-semibold text-white disabled:opacity-50"
            style={{ background: RISK_GREEN }}
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
      className="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ background: "rgba(0,17,55,0.4)" }}
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
    <div
      className="mt-3 pt-3"
      style={{ borderTop: "1px solid #f0f4fb" }}
    >
      <div
        className="text-[10px] uppercase tracking-wider font-bold text-text-muted mb-1.5"
      >
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
              className="flex items-center gap-2 text-[11px] rounded-md px-2 py-1"
              style={{
                background: "#EAF1F580",
                border: "1px solid #e4eaf6",
              }}
            >
              <span className="text-[14px]">📎</span>
              {a.url ? (
                <a
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold hover:underline"
                  style={{ color: INDIGO }}
                >
                  {a.name}
                </a>
              ) : (
                <span
                  className="font-semibold"
                  style={{ color: MIDNIGHT }}
                >
                  {a.name}
                </span>
              )}
              {editable && (
                <button
                  onClick={() => removeAt(i)}
                  className="ml-auto text-text-muted hover:opacity-80"
                  style={{ color: "#94a3b8" }}
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
                className="text-[12px] px-2 py-1 rounded-md border border-beroe-card-border focus:border-beroe-blue focus:outline-none"
              />
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="URL (optional — paste a link to the file)"
                className="text-[12px] px-2 py-1 rounded-md border border-beroe-card-border focus:border-beroe-blue focus:outline-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={addOne}
                  disabled={!name.trim() || patch.isPending}
                  className="text-[11px] px-2.5 py-1 rounded-md font-semibold text-white disabled:opacity-50"
                  style={{ background: INDIGO }}
                >
                  Add
                </button>
                <button
                  onClick={() => {
                    setAdding(false);
                    setName("");
                    setUrl("");
                  }}
                  className="text-[11px] px-2.5 py-1 rounded-md"
                  style={{
                    background: "#fff",
                    border: "1px solid #e4eaf6",
                    color: MIDNIGHT,
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setAdding(true)}
              className="text-[11px] font-semibold"
              style={{ color: INDIGO }}
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

function CheckpointReferenceCard() {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="rounded-card"
      style={{ background: "#fff", border: "1px solid #e4eaf6" }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left"
      >
        <div>
          <div
            className="text-[12px] font-bold"
            style={{ color: MIDNIGHT }}
          >
            What must be shown at each checkpoint
          </div>
          <p className="text-[10px] text-text-muted">
            Stakeholder reference — what to review, decide, and sign off at
            Kickoff · MBR · QBR · Renewal.
          </p>
        </div>
        <span className="text-[11px] text-text-muted">
          {open ? "▴ Hide" : "▾ Show"}
        </span>
      </button>
      {open && (
        <div
          className="p-3 grid grid-cols-1 md:grid-cols-2 gap-3"
          style={{ borderTop: "1px solid #e4eaf6" }}
        >
          {TYPES.map((type) => {
            const g = CHECKPOINT_GUIDE[type];
            const col = TYPE_COLORS[type];
            return (
              <div
                key={type}
                className="rounded-lg p-3"
                style={{
                  background: `${col}08`,
                  border: `1px solid ${col}30`,
                }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[14px]">{TYPE_ICONS[type]}</span>
                  <span
                    className="text-[12px] font-bold"
                    style={{ color: col }}
                  >
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
