import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, ApiError } from "@/lib/api";
import { useHasRole } from "@/components/AuthProvider";
import { cn } from "@/lib/utils";
import { useAccountFromLayout } from "../AccountProfileLayout";
import {
  type Contact,
  type ContactCreate,
  type ContactDecisionPower,
  type ContactFunction,
  type ContactListResponse,
  type ContactSeniority,
  type ContactUpdate,
  DECISION_POWER_LABELS,
  FUNCTION_LABELS,
  SENIORITY_LABELS,
} from "@/types/contact";

const FUNCTION_OPTIONS: ContactFunction[] = [
  "procurement", "supply_chain", "finance", "operations", "it", "other",
];
const SENIORITY_OPTIONS: ContactSeniority[] = ["cxo", "vp", "director", "manager", "other"];
const DECISION_POWER_OPTIONS: ContactDecisionPower[] = [
  "executive_sponsor", "influencer", "champion", "detractor", "unknown",
];

type SortKey = "name" | "title" | "function" | "seniority" | "decision_power" | "email" | "created_at";

export default function ContactsTab() {
  const account = useAccountFromLayout();
  const isAdmin = useHasRole("admin");
  const qc = useQueryClient();

  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [creating, setCreating] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const queryKey = ["contacts", account.id, includeDeleted, sortBy, sortDir];
  const { data, isLoading, isError } = useQuery<ContactListResponse>({
    queryKey,
    queryFn: () => {
      const qs = new URLSearchParams();
      if (includeDeleted) qs.set("include_deleted", "true");
      if (sortBy) {
        qs.set("sort_by", sortBy);
        qs.set("sort_dir", sortDir);
      }
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      return api.get<ContactListResponse>(`/api/v1/accounts/${account.id}/contacts${suffix}`);
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["contacts", account.id] });
    qc.invalidateQueries({ queryKey: ["activity", account.id] });
  };

  const createMutation = useMutation({
    mutationFn: (body: ContactCreate) =>
      api.post<Contact>(`/api/v1/accounts/${account.id}/contacts`, body),
    onSuccess: () => {
      invalidate();
      setCreating(false);
    },
  });

  const patchMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: ContactUpdate }) =>
      api.patch<Contact>(`/api/v1/contacts/${id}`, body),
    onSuccess: () => {
      invalidate();
      setEditing(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/v1/contacts/${id}`),
    onSuccess: invalidate,
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => api.post<Contact>(`/api/v1/contacts/${id}/restore`),
    onSuccess: invalidate,
  });

  const onSortClick = (key: SortKey) => {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir("asc");
    }
  };

  if (isLoading) return <div className="text-sm text-text-muted">Loading contacts…</div>;
  if (isError || !data) return <div className="text-sm text-beroe-red">Failed to load contacts.</div>;

  const visible = data.items;
  const activeCount = visible.filter((c) => !c.deleted_at).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-text-primary">Client contacts</h2>
          <p className="text-xs text-text-muted">
            {activeCount} active
            {includeDeleted && data.total > activeCount && (
              <span> · {data.total - activeCount} deleted</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={includeDeleted}
                onChange={(e) => setIncludeDeleted(e.target.checked)}
              />
              Show deleted
            </label>
          )}
          {data.is_editable && (
            <button
              onClick={() => setCreating(true)}
              className="px-3 py-1.5 rounded-lg bg-beroe-blue text-white text-xs font-semibold hover:bg-beroe-blue/90"
            >
              + Add contact
            </button>
          )}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="bg-white rounded-card border border-beroe-card-border p-10 text-center text-sm text-text-muted">
          No contacts yet.
          {data.is_editable && " Click + Add contact to add your first one."}
        </div>
      ) : (
        <div className="bg-white rounded-card border border-beroe-card-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-beroe-bg text-[11px] uppercase tracking-wider text-text-muted">
              <tr>
                <SortableTh label="Name" k="name" current={sortBy} dir={sortDir} onClick={onSortClick} />
                <SortableTh label="Title" k="title" current={sortBy} dir={sortDir} onClick={onSortClick} />
                <th className="text-left font-bold px-4 py-2.5">Email · Phone</th>
                <SortableTh label="Function" k="function" current={sortBy} dir={sortDir} onClick={onSortClick} />
                <SortableTh label="Seniority" k="seniority" current={sortBy} dir={sortDir} onClick={onSortClick} />
                <SortableTh label="Power" k="decision_power" current={sortBy} dir={sortDir} onClick={onSortClick} />
                <th className="text-left font-bold px-4 py-2.5">Flags</th>
                <th className="text-right font-bold px-4 py-2.5">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => (
                <tr
                  key={c.id}
                  className={cn(
                    "border-t border-beroe-card-border/60 hover:bg-beroe-bg/60",
                    c.deleted_at && "opacity-50",
                  )}
                >
                  <td className="px-4 py-2.5 font-semibold text-text-primary">
                    {c.name}
                    {c.deleted_at && (
                      <span className="ml-2 text-[10px] text-beroe-red bg-beroe-red/10 border border-beroe-red/30 rounded-full px-1.5 py-0.5">
                        deleted
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-text-secondary">{c.title ?? "—"}</td>
                  <td className="px-4 py-2.5 text-xs text-text-secondary">
                    {c.email && <div>{c.email}</div>}
                    {c.phone && <div>{c.phone}</div>}
                    {!c.email && !c.phone && "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    {c.function ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-beroe-bg text-text-secondary">
                        {FUNCTION_LABELS[c.function]}
                      </span>
                    ) : <span className="text-text-muted">—</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    {c.seniority ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-beroe-bg text-text-secondary">
                        {SENIORITY_LABELS[c.seniority]}
                      </span>
                    ) : <span className="text-text-muted">—</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    {c.decision_power ? <DecisionPowerPill p={c.decision_power} /> : <span className="text-text-muted">—</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-1">
                      {c.is_spoc && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-beroe-blue/15 text-beroe-blue">
                          SPOC
                        </span>
                      )}
                      {c.is_sponsor && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-beroe-purple/15 text-beroe-purple">
                          Sponsor
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {c.deleted_at ? (
                      isAdmin && (
                        <button
                          onClick={() => restoreMutation.mutate(c.id)}
                          disabled={restoreMutation.isPending}
                          className="text-xs text-beroe-blue hover:underline font-semibold"
                        >
                          Restore
                        </button>
                      )
                    ) : (
                      data.is_editable && (
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => setEditing(c)}
                            className="text-xs text-beroe-blue hover:underline font-semibold"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => {
                              if (confirm(`Soft-delete ${c.name}? Admins can restore within 30 days.`)) {
                                deleteMutation.mutate(c.id);
                              }
                            }}
                            className="text-xs text-beroe-red hover:underline font-semibold"
                          >
                            Delete
                          </button>
                        </div>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <ContactFormModal
          title="Add contact"
          existing={data?.items ?? []}
          onClose={() => setCreating(false)}
          onSubmit={(body) => createMutation.mutateAsync(body)}
          isPending={createMutation.isPending}
        />
      )}

      {editing && (
        <ContactFormModal
          title={`Edit ${editing.name}`}
          initial={editing}
          existing={data?.items ?? []}
          onClose={() => setEditing(null)}
          onSubmit={(body) => patchMutation.mutateAsync({ id: editing.id, body })}
          isPending={patchMutation.isPending}
        />
      )}
    </div>
  );
}

function SortableTh({
  label, k, current, dir, onClick,
}: {
  label: string;
  k: SortKey;
  current: SortKey | null;
  dir: "asc" | "desc";
  onClick: (k: SortKey) => void;
}) {
  const active = current === k;
  return (
    <th className="text-left font-bold px-4 py-2.5">
      <button
        onClick={() => onClick(k)}
        className={cn(
          "uppercase tracking-wider text-[11px] font-bold inline-flex items-center gap-1",
          active ? "text-beroe-blue" : "text-text-muted hover:text-text-secondary",
        )}
      >
        {label}
        {active && <span aria-hidden>{dir === "asc" ? "↑" : "↓"}</span>}
      </button>
    </th>
  );
}

function DecisionPowerPill({ p }: { p: ContactDecisionPower }) {
  const tone =
    p === "executive_sponsor"
      ? "bg-beroe-purple/15 text-beroe-purple"
      : p === "champion"
        ? "bg-beroe-green/20 text-beroe-green"
        : p === "detractor"
          ? "bg-beroe-red/15 text-beroe-red"
          : p === "influencer"
            ? "bg-beroe-amber/20 text-beroe-amber"
            : "bg-beroe-bg text-text-secondary";
  return (
    <span className={cn("text-xs px-2 py-0.5 rounded-full font-semibold", tone)}>
      {DECISION_POWER_LABELS[p]}
    </span>
  );
}

function ContactFormModal({
  title,
  initial,
  existing,
  onClose,
  onSubmit,
  isPending,
}: {
  title: string;
  initial?: Contact;
  existing: Contact[];
  onClose: () => void;
  onSubmit: (body: ContactCreate) => Promise<unknown>;
  isPending: boolean;
}) {
  const [form, setForm] = useState<ContactCreate>({
    name: initial?.name ?? "",
    title: initial?.title ?? "",
    email: initial?.email ?? "",
    phone: initial?.phone ?? "",
    function: initial?.function ?? null,
    seniority: initial?.seniority ?? null,
    decision_power: initial?.decision_power ?? null,
    notes: initial?.notes ?? "",
    is_spoc: initial?.is_spoc ?? false,
    is_sponsor: initial?.is_sponsor ?? false,
  });
  const [error, setError] = useState<string | null>(null);

  // Bug 4 — preflight dedup on name OR email (case-insensitive). Backend
  // already enforces email uniqueness via ux_client_contacts_account_email
  // and 409s, but stakeholder feedback was the UI should warn before the
  // POST so duplicates don't even submit. Also catches name-only dupes,
  // which the DB index doesn't cover.
  const nameKey = form.name.trim().toLowerCase();
  const emailKey = (form.email ?? "").trim().toLowerCase();
  const dup = existing.find(
    (c) =>
      c.id !== initial?.id &&
      !c.deleted_at &&
      ((nameKey && c.name.trim().toLowerCase() === nameKey) ||
        (emailKey &&
          (c.email ?? "").trim().toLowerCase() === emailKey)),
  );

  const handleSubmit = async () => {
    setError(null);
    if (form.name.trim().length < 3) {
      setError("Name must be at least 3 characters.");
      return;
    }
    if (dup) {
      const which =
        emailKey && (dup.email ?? "").trim().toLowerCase() === emailKey
          ? "email"
          : "name";
      setError(
        `A contact with this ${which} already exists on this account: "${dup.name}". ` +
          `Edit the existing row instead of creating a duplicate.`,
      );
      return;
    }
    if (form.title && form.title.trim().length > 0 && form.title.trim().length < 2) {
      setError("Title must be at least 2 characters or empty.");
      return;
    }
    if (form.notes && form.notes.length > 500) {
      setError("Notes must be 500 characters or fewer.");
      return;
    }
    const cleaned: ContactCreate = {
      name: form.name.trim(),
      title: form.title?.trim() || null,
      email: form.email?.trim() || null,
      phone: form.phone?.trim() || null,
      function: form.function || null,
      seniority: form.seniority || null,
      decision_power: form.decision_power || null,
      notes: form.notes?.trim() || null,
      is_spoc: !!form.is_spoc,
      is_sponsor: !!form.is_sponsor,
    };
    try {
      await onSubmit(cleaned);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Save failed.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-text-primary">{title}</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-xl leading-none">
            ×
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <ModalField label="Name *" full>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={modalInputCls}
              autoFocus
              minLength={3}
            />
          </ModalField>
          <ModalField label="Title">
            <input
              type="text"
              value={form.title ?? ""}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className={modalInputCls}
            />
          </ModalField>
          <ModalField label="Email">
            <input
              type="email"
              value={form.email ?? ""}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className={modalInputCls}
            />
          </ModalField>
          <ModalField label="Phone">
            <input
              type="tel"
              value={form.phone ?? ""}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className={modalInputCls}
            />
          </ModalField>
          <ModalField label="Function">
            <select
              value={form.function ?? ""}
              onChange={(e) =>
                setForm({ ...form, function: (e.target.value || null) as ContactFunction | null })
              }
              className={modalInputCls}
            >
              <option value="">— Select —</option>
              {FUNCTION_OPTIONS.map((f) => (
                <option key={f} value={f}>{FUNCTION_LABELS[f]}</option>
              ))}
            </select>
          </ModalField>
          <ModalField label="Seniority">
            <select
              value={form.seniority ?? ""}
              onChange={(e) =>
                setForm({ ...form, seniority: (e.target.value || null) as ContactSeniority | null })
              }
              className={modalInputCls}
            >
              <option value="">— Select —</option>
              {SENIORITY_OPTIONS.map((s) => (
                <option key={s} value={s}>{SENIORITY_LABELS[s]}</option>
              ))}
            </select>
          </ModalField>
          <ModalField label="Decision-making power" full>
            <select
              value={form.decision_power ?? ""}
              onChange={(e) =>
                setForm({ ...form, decision_power: (e.target.value || null) as ContactDecisionPower | null })
              }
              className={modalInputCls}
            >
              <option value="">— Select —</option>
              {DECISION_POWER_OPTIONS.map((p) => (
                <option key={p} value={p}>{DECISION_POWER_LABELS[p]}</option>
              ))}
            </select>
          </ModalField>
          <ModalField label={`Notes (${(form.notes ?? "").length}/500)`} full>
            <textarea
              value={form.notes ?? ""}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
              maxLength={500}
              className={cn(modalInputCls, "resize-none")}
            />
          </ModalField>
          <div className="col-span-2 flex items-center gap-4 mt-1">
            <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={!!form.is_spoc}
                onChange={(e) => setForm({ ...form, is_spoc: e.target.checked })}
              />
              SPOC (single point of contact)
            </label>
            <label className="flex items-center gap-1.5 text-xs text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={!!form.is_sponsor}
                onChange={(e) => setForm({ ...form, is_sponsor: e.target.checked })}
              />
              Pin as sponsor
            </label>
          </div>
        </div>

        {error && (
          <div className="mt-3 text-xs text-beroe-red bg-beroe-red/10 border border-beroe-red/30 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-sm border border-beroe-card-border text-text-secondary"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending || !!dup}
            title={dup ? `Duplicate: "${dup.name}" already exists` : undefined}
            className="px-4 py-1.5 rounded-lg bg-beroe-blue text-white text-sm font-semibold disabled:opacity-50"
          >
            {isPending ? "Saving…" : dup ? "Duplicate detected" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ModalField({
  label,
  full,
  children,
}: {
  label: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={full ? "col-span-2" : ""}>
      <label className="block text-[11px] uppercase tracking-wider text-text-muted font-bold mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}

const modalInputCls =
  "w-full px-3 py-1.5 rounded-lg border border-beroe-card-border text-sm focus:outline-none focus:border-beroe-blue";
