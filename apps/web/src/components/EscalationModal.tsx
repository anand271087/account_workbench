// 28-May — Escalation modal. Port of prototype's buildEscalationModal()
// (line 4114). On submit:
//   1. POST /api/v1/accounts/:id/escalations (persists to DB)
//   2. Auto-launch mailto: with CSM + Commercial Owner emails pre-filled
//      + a paste-ready subject/body so the escalation actually reports
//      "to everyone using email" (user's exact ask).

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import type {
  Escalation,
  EscalationCreate,
  EscalationListResponse,
  EscalationType,
} from "@/types/escalation";
import { ESCALATION_TYPE_LABELS } from "@/types/escalation";

interface Props {
  accountId: string;
  accountName: string;
  onClose: () => void;
}

const TYPES: EscalationType[] = ["director", "sales", "joint"];

export function EscalationModal({ accountId, accountName, onClose }: Props) {
  const qc = useQueryClient();
  const listKey = ["escalations", accountId];

  const listQ = useQuery<EscalationListResponse>({
    queryKey: listKey,
    queryFn: () =>
      api.get<EscalationListResponse>(
        `/api/v1/accounts/${accountId}/escalations`,
      ),
  });

  const [form, setForm] = useState<EscalationCreate>({
    reason: "",
    escalation_type: "director",
    owner: "",
    next_action: "",
  });
  const [err, setErr] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (body: EscalationCreate) =>
      api.post<Escalation>(
        `/api/v1/accounts/${accountId}/escalations`,
        body,
      ),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: listKey });
      qc.invalidateQueries({ queryKey: ["activity", accountId] });
      launchMailto(created);
      onClose();
    },
    onError: (e: ApiError) => setErr(e.message),
  });

  const launchMailto = (esc: Escalation) => {
    const emails = listQ.data?.notify_emails ?? [];
    const to = emails.join(",");
    const subject = `🚨 Escalation raised — ${accountName}`;
    const body = [
      `Account: ${accountName}`,
      `Type: ${ESCALATION_TYPE_LABELS[esc.escalation_type]}`,
      `Owner: ${esc.owner}`,
      `Raised by: ${esc.raised_by_name ?? "—"}`,
      `Raised at: ${new Date(esc.raised_at).toLocaleString()}`,
      "",
      "Reason:",
      esc.reason,
      "",
      esc.next_action ? `Next action: ${esc.next_action}` : "",
      "",
      "—",
      "Open Account Workbench to track this escalation.",
    ]
      .filter(Boolean)
      .join("\n");
    // Always try the mailto: launch — silent no-op if no handler.
    try {
      const a = document.createElement("a");
      a.href = `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      a.rel = "noopener";
      a.target = "_self";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      // ignore
    }
    // Also stash on clipboard in case mailto: doesn't fire (Chrome + Mac
    // with Outlook web etc.) so the user can paste into Gmail/Outlook.
    try {
      navigator.clipboard?.writeText(`Subject: ${subject}\nTo: ${to}\n\n${body}`);
    } catch {
      // ignore
    }
  };

  const onSubmit = () => {
    setErr(null);
    if (!form.reason.trim() || form.reason.trim().length < 5) {
      setErr("Reason must be at least 5 characters.");
      return;
    }
    if (!form.owner.trim() || form.owner.trim().length < 2) {
      setErr("Owner is required.");
      return;
    }
    createMutation.mutate(form);
  };

  const openItems = (listQ.data?.items ?? []).filter(
    (e) => e.status !== "resolved",
  );

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-card w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="px-5 py-3 border-b border-beroe-card-border flex items-start justify-between gap-3">
          <div>
            <div className="text-[14px] font-bold text-text-primary">
              🚨 Escalate {accountName}
            </div>
            <div className="text-[11px] text-text-muted mt-0.5">
              Notifies CSM + Commercial Owner via email + persists on the account history.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-[18px] text-text-muted hover:text-text-primary"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {openItems.length > 0 && (
            <div className="bg-beroe-red/10 border border-beroe-red/30 rounded-md px-3 py-2 text-[11px] text-beroe-red">
              <b>⚠ {openItems.length} open escalation(s) already on this account.</b>{" "}
              Adding another will appear alongside them in the history.
            </div>
          )}

          <Field label="Reason (required)">
            <textarea
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              rows={3}
              maxLength={2000}
              placeholder="Why does this need escalation? (e.g. CPO not engaged, CSM cannot unblock alone, commercial re-engagement needed)"
              className="w-full text-[12px] border border-beroe-card-border rounded-md px-2.5 py-1.5 focus:outline-none focus:border-beroe-blue"
            />
            <div className="text-[10px] text-text-muted mt-0.5">
              {form.reason.length}/2000 · min 5 chars
            </div>
          </Field>

          <Field label="Type (required)">
            <div className="flex gap-3 flex-wrap mt-1">
              {TYPES.map((t) => (
                <label
                  key={t}
                  className="text-[12px] flex items-center gap-1.5 cursor-pointer"
                >
                  <input
                    type="radio"
                    name="esc-type"
                    value={t}
                    checked={form.escalation_type === t}
                    onChange={() => setForm({ ...form, escalation_type: t })}
                  />
                  {ESCALATION_TYPE_LABELS[t]}
                </label>
              ))}
            </div>
          </Field>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Owner (required)">
              <input
                type="text"
                value={form.owner}
                onChange={(e) => setForm({ ...form, owner: e.target.value })}
                maxLength={200}
                placeholder="Who is leading this? (name)"
                className="w-full text-[12px] border border-beroe-card-border rounded-md px-2.5 py-1.5 focus:outline-none focus:border-beroe-blue"
              />
            </Field>
            <Field label="Next action">
              <input
                type="text"
                value={form.next_action ?? ""}
                onChange={(e) =>
                  setForm({ ...form, next_action: e.target.value })
                }
                maxLength={1000}
                placeholder="What is the immediate next step?"
                className="w-full text-[12px] border border-beroe-card-border rounded-md px-2.5 py-1.5 focus:outline-none focus:border-beroe-blue"
              />
            </Field>
          </div>

          {/* Notify emails preview */}
          <div className="text-[10px] text-text-muted">
            {listQ.data && listQ.data.notify_emails.length > 0 ? (
              <>
                On Raise → email opens pre-filled to:{" "}
                <b className="text-text-secondary">
                  {listQ.data.notify_emails.join(", ")}
                </b>
              </>
            ) : (
              <span className="italic">
                No CSM or Commercial Owner assigned — email step will skip.
              </span>
            )}
          </div>

          {err && (
            <div className="text-[11px] text-beroe-red bg-beroe-red/10 border border-beroe-red/30 rounded px-2 py-1">
              {err}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-beroe-card-border bg-beroe-bg/40 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="text-[12px] px-3 py-1.5 border border-beroe-card-border rounded-md font-semibold hover:bg-white"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={createMutation.isPending}
            className={cn(
              "text-[12px] px-3 py-1.5 rounded-md font-semibold text-white disabled:opacity-50",
            )}
            style={{ background: "#CF4548" }}
          >
            {createMutation.isPending ? "Raising…" : "🚨 Raise Escalation"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider font-semibold text-text-muted mb-1">
        {label}
      </div>
      {children}
    </div>
  );
}
