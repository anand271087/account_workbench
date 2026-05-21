// M14 — CS Onboarding (Phase 5a).
//
// Three cards, gated by entry state:
//   1. CS-A: Entry Type picker (A clean handover / B mid-contract) — always
//      visible. Once an entry is picked, the rest of the page activates.
//   2. CS-B: Handover Checklist (Entry A) OR Baseline Context (Entry B).
//   3. CS-C: Stakeholder Map — 3 mandatory roles (Budget Owner / Champion /
//      Category Manager).
//
// Goals + alignment phases (CS-D) ship in Phase 5b — a "Goals →" placeholder
// at the bottom points there.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useUnsavedChangesGuard } from "@/lib/use-unsaved-changes";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import { useAccountFromLayout } from "../AccountProfileLayout";
import {
  CS_HANDOVER_ITEMS,
  STAKEHOLDER_ROLES,
  type CSEntryType,
  type CSOnboarding,
  type CSOnboardingUpdate,
  type Stakeholder,
} from "@/types/cs_onboarding";

export default function CSOnboardingTab() {
  const account = useAccountFromLayout();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<CSOnboarding>({
    queryKey: ["cs-onboarding", account.id],
    queryFn: () =>
      api.get<CSOnboarding>(`/api/v1/accounts/${account.id}/cs-onboarding`),
  });

  // Local form state — only the text fields and stakeholders get sticky
  // unsaved-changes behaviour. The entry-type picker + handover checklist
  // toggles save instantly (one PATCH per click) since they're discrete
  // actions that shouldn't sit dirty.
  const [form, setForm] = useState<CSOnboarding | null>(null);
  const [savingError, setSavingError] = useState<string | null>(null);
  useEffect(() => {
    if (data && !form) setForm(data);
  }, [data, form]);

  const dirty = useMemo(() => {
    if (!form || !data) return false;
    return JSON.stringify(serialise(form)) !== JSON.stringify(serialise(data));
  }, [form, data]);

  const save = useMutation({
    mutationFn: (body: CSOnboardingUpdate) =>
      api.patch<CSOnboarding>(
        `/api/v1/accounts/${account.id}/cs-onboarding`,
        body,
      ),
    onSuccess: (saved) => {
      qc.setQueryData(["cs-onboarding", account.id], saved);
      qc.invalidateQueries({ queryKey: ["account", account.id] });
      qc.invalidateQueries({ queryKey: ["activity", account.id] });
      setForm(saved);
      setSavingError(null);
    },
    onError: (e: ApiError) => setSavingError(e.message),
  });

  // For instant-save controls (entry type + checklist) we send a single-field
  // patch and merge the response back into `data`; the local `form` updates
  // via onSuccess.
  const instant = useMutation({
    mutationFn: (body: CSOnboardingUpdate) =>
      api.patch<CSOnboarding>(
        `/api/v1/accounts/${account.id}/cs-onboarding`,
        body,
      ),
    onSuccess: (saved) => {
      qc.setQueryData(["cs-onboarding", account.id], saved);
      qc.invalidateQueries({ queryKey: ["account", account.id] });
      setForm(saved);
      setSavingError(null);
    },
    onError: (e: ApiError) => setSavingError(e.message),
  });

  const saveDirty = () => {
    if (form && data) save.mutate(diff(form, data));
  };
  const guard = useUnsavedChangesGuard({
    dirty,
    isSaving: save.isPending,
    onSaveShortcut: saveDirty,
  });

  if (isLoading || !form) {
    return <div className="text-sm text-text-muted">Loading CS Onboarding…</div>;
  }

  const editable = form.is_editable;
  const activated = form.activated;

  // Block save when two stakeholder roles point at the same person (server
  // enforces the same rule with a 409; gating the button avoids the round trip).
  const hasStakeholderDup = STAKEHOLDER_ROLES.some((r) =>
    findStakeholderDuplicate(
      form.cs_stakeholders,
      r.key,
      form.cs_stakeholders[r.key] ?? { name: null, email: null, phone: null },
    ),
  );

  return (
    <div className="space-y-4">
      {/* ---------- Card 1: Entry type picker ---------- */}
      <Section title="CS Onboarding Entry">
        <p className="text-xs text-text-muted mb-3">
          Two ways into CS. Pick A when you got a clean handover from Sales
          on signing. Pick B when you're inheriting an account mid-contract
          and need to record what you're walking into.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <EntryButton
            label="Entry A — New Account (Clean Handover)"
            desc="Sales passed a complete handover package on signing."
            active={form.cs_entry_type === "A"}
            disabled={!editable || !account.gate_signed}
            disabledHint={
              !account.gate_signed
                ? "Account isn't signed yet — Entry A activates after signing."
                : undefined
            }
            tone="blue"
            onClick={() => setEntry("A")}
          />
          <EntryButton
            label="Entry B — Existing Account (Mid-Contract Pickup)"
            desc="CSM inherited this account with no formal handover. Capture baseline."
            active={form.cs_entry_type === "B"}
            disabled={!editable}
            tone="amber"
            onClick={() => setEntry("B")}
          />
        </div>
        {savingError && (
          <div className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {savingError}
          </div>
        )}
      </Section>

      {/* Idle state — neither entry chosen yet */}
      {!activated && form.cs_entry_type !== "A" && form.cs_entry_type !== "B" && (
        <div className="bg-slate-50 rounded-card border border-beroe-card-border p-5 text-xs text-text-muted">
          Pick an entry type above to start CS Onboarding. The handover
          checklist + stakeholder map appear once you do.
        </div>
      )}

      {/* ---------- Card 2A: Handover Checklist (Entry A) ---------- */}
      {form.cs_entry_type === "A" && account.gate_signed && (
        <Section title="Handover Quality Check — CSM side">
          <p className="text-xs text-text-muted mb-3">
            Confirm receipt of the four things Sales should pass on signing.
            Saves instantly. The Sales-side handshake lives on the Sales
            Hand-off tab — both columns must align.
          </p>
          {/* R20 — auto banner: complete (green) vs. incomplete (amber). */}
          {(() => {
            const checked = CS_HANDOVER_ITEMS.filter(
              (it) => !!form.cs_handover_checklist[it.key],
            ).length;
            const total = CS_HANDOVER_ITEMS.length;
            const complete = checked === total;
            return (
              <div
                className={cn(
                  "mb-3 rounded-lg border px-3 py-2 text-xs font-semibold flex items-center gap-2",
                  complete
                    ? "bg-green-50 border-green-200 text-green-800"
                    : "bg-amber-50 border-amber-200 text-amber-800",
                )}
              >
                <span>{complete ? "✓" : "⚠"}</span>
                <span>
                  {complete
                    ? "Handover complete — all 4 items confirmed."
                    : `Handover incomplete — ${checked} of ${total} items confirmed.`}
                </span>
              </div>
            );
          })()}
          <ul className="space-y-2">
            {CS_HANDOVER_ITEMS.map((it) => {
              const checked = !!form.cs_handover_checklist[it.key];
              return (
                <li
                  key={it.key}
                  className="flex items-start gap-3 bg-slate-50/40 border border-slate-200 rounded-lg px-3 py-2"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!editable || instant.isPending}
                    onChange={(e) =>
                      instant.mutate({
                        cs_handover_checklist: { [it.key]: e.target.checked },
                      })
                    }
                    className="mt-0.5"
                  />
                  <span className="text-sm text-text-primary">{it.label}</span>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {/* ---------- Card 2B: Baseline Context (Entry B) ---------- */}
      {form.cs_entry_type === "B" && (
        <Section title="Mid-contract baseline">
          <p className="text-xs text-text-muted mb-3">
            What you walked into. Don't try to perfect this — capture the
            facts as you know them so the rest of CS Onboarding has somewhere
            to anchor.
          </p>
          <Field label="Context — recent history, where the relationship is">
            <textarea
              rows={4}
              maxLength={8000}
              value={form.cs_entry_b_context ?? ""}
              onChange={(e) =>
                setForm({ ...form, cs_entry_b_context: e.target.value || null })
              }
              disabled={!editable}
              placeholder="e.g. Signed in 2024 under previous CSM. Renewal next quarter. Champion is engaged; CPO has gone quiet."
              className={textareaCls(editable)}
            />
          </Field>
          <Field label="Goals agreed with client (best understanding)">
            <textarea
              rows={4}
              maxLength={8000}
              value={form.cs_entry_b_goals ?? ""}
              onChange={(e) =>
                setForm({ ...form, cs_entry_b_goals: e.target.value || null })
              }
              disabled={!editable}
              placeholder="e.g. 1) Cocoa price intelligence drives Q2 contract negotiation. 2) RSPO compliance evidence by H2."
              className={textareaCls(editable)}
            />
          </Field>
        </Section>
      )}

      {/* ---------- Card 3: Stakeholder map ---------- */}
      {activated && (
        <Section
          title="Stakeholder Map"
          subtitle="Three mandatory roles. Names alone are fine to start; backfill email + phone as you confirm."
        >
          {/* Dedup banner — same person can't fill two roles. */}
          <StakeholderDuplicateBanner stakeholders={form.cs_stakeholders} />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {STAKEHOLDER_ROLES.map((r) => {
              const cur = form.cs_stakeholders[r.key] ?? {
                name: null,
                email: null,
                phone: null,
              };
              const dup = findStakeholderDuplicate(
                form.cs_stakeholders,
                r.key,
                cur,
              );
              return (
                <StakeholderCard
                  key={r.key}
                  label={r.label}
                  desc={r.desc}
                  value={cur}
                  editable={editable}
                  duplicateOf={dup}
                  onChange={(patch) =>
                    setForm({
                      ...form,
                      cs_stakeholders: {
                        ...form.cs_stakeholders,
                        [r.key]: { ...cur, ...patch },
                      },
                    })
                  }
                />
              );
            })}
          </div>
          <RoleCoverage stakeholders={form.cs_stakeholders} />
        </Section>
      )}

      {/* ---------- R21 — Goal Validation & Alignment surface ---------- */}
      {activated && <GoalAlignmentSurface accountId={account.id} />}

      {/* Sticky save bar — for the text-field changes (Entry B + stakeholders). */}
      {editable && (
        <div
          className={cn(
            "sticky bottom-0 -mx-6 px-6 py-3 flex items-center gap-3 border-t z-30 transition-colors",
            dirty
              ? "bg-amber-50 border-amber-300 shadow-[0_-4px_12px_rgba(0,0,0,0.05)]"
              : "bg-white border-beroe-card-border",
          )}
        >
          {savingError && (
            <span className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-1">
              {savingError}
            </span>
          )}
          {!savingError && dirty && (
            <span className="flex items-center gap-1.5 text-xs text-amber-800 font-bold">
              <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              Unsaved changes
              <span className="text-amber-700/70 font-normal ml-1">
                · Cmd / Ctrl + S to save
              </span>
            </span>
          )}
          {!dirty && !savingError && (
            <span className="text-xs text-text-muted">✓ All changes saved</span>
          )}
          <button
            onClick={() => data && setForm(data)}
            disabled={!dirty || save.isPending}
            className="ml-auto px-3 py-1.5 rounded-lg text-sm border border-slate-200 text-text-secondary disabled:opacity-50 bg-white"
          >
            Discard
          </button>
          <button
            onClick={saveDirty}
            disabled={!dirty || save.isPending || hasStakeholderDup}
            title={
              hasStakeholderDup
                ? "Resolve the duplicate stakeholder before saving — each role must be a different person."
                : ""
            }
            className="px-4 py-1.5 rounded-lg bg-beroe-blue text-white text-sm font-semibold disabled:opacity-50"
          >
            {save.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      )}

      {guard.pendingHref && (
        <UnsavedChangesDialog
          pendingHref={guard.pendingHref}
          saving={save.isPending}
          onSaveAndGo={async () => {
            try {
              if (form && data) await save.mutateAsync(diff(form, data));
              guard.proceed();
            } catch {
              /* savingError surfaces in UI */
            }
          }}
          onDiscardAndGo={() => {
            if (data) setForm(data);
            guard.proceed();
          }}
          onStay={guard.stay}
        />
      )}
    </div>
  );

  function setEntry(t: CSEntryType) {
    instant.mutate({ cs_entry_type: t });
  }
}

// ============================================================
// Sub-components
// ============================================================

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-card border border-beroe-card-border p-5">
      <h2 className="text-sm font-bold text-text-primary">{title}</h2>
      {subtitle && <p className="text-xs text-text-muted mt-0.5 mb-3">{subtitle}</p>}
      {!subtitle && <div className="mb-2" />}
      {children}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3 last:mb-0">
      <label className="block text-[11px] uppercase tracking-wider text-text-muted font-bold mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}

function EntryButton({
  label,
  desc,
  active,
  disabled,
  disabledHint,
  tone,
  onClick,
}: {
  label: string;
  desc: string;
  active: boolean;
  disabled: boolean;
  disabledHint?: string;
  tone: "blue" | "amber";
  onClick: () => void;
}) {
  const activeBorder = tone === "blue" ? "border-beroe-blue" : "border-amber-400";
  const activeBg = tone === "blue" ? "bg-beroe-blue/5" : "bg-amber-50";
  const activeText = tone === "blue" ? "text-beroe-blue" : "text-amber-900";
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={disabled ? disabledHint : ""}
      className={cn(
        "text-left rounded-lg border-2 px-4 py-3 transition-colors",
        active
          ? `${activeBorder} ${activeBg}`
          : "border-slate-200 bg-white hover:border-slate-300",
        disabled && "opacity-50 cursor-not-allowed",
      )}
    >
      <div
        className={cn(
          "text-sm font-bold mb-1",
          active ? activeText : "text-text-primary",
        )}
      >
        {label}
      </div>
      <div className="text-xs text-text-muted">{desc}</div>
      {disabled && disabledHint && (
        <div className="text-[11px] text-text-muted italic mt-1.5">
          {disabledHint}
        </div>
      )}
    </button>
  );
}

function StakeholderCard({
  label,
  desc,
  value,
  editable,
  duplicateOf,
  onChange,
}: {
  label: string;
  desc: string;
  value: Stakeholder;
  editable: boolean;
  duplicateOf: { roleLabel: string; field: "name" | "email" } | null;
  onChange: (patch: Partial<Stakeholder>) => void;
}) {
  const filled = !!value.name?.trim();
  return (
    <div
      className={cn(
        "rounded-lg border-2 p-3 transition-colors",
        duplicateOf
          ? "border-red-300 bg-red-50/40"
          : filled
            ? "border-green-200 bg-green-50/30"
            : "border-slate-200 bg-slate-50/30",
      )}
    >
      <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted mb-0.5">
        {label}
        {filled && <span className="ml-1 text-green-700">✓</span>}
      </div>
      <div className="text-[11px] text-text-muted mb-2">{desc}</div>
      <input
        type="text"
        maxLength={200}
        value={value.name ?? ""}
        placeholder="Name"
        onChange={(e) => onChange({ name: e.target.value || null })}
        disabled={!editable}
        className={inputCls(editable)}
      />
      <input
        type="email"
        maxLength={320}
        value={value.email ?? ""}
        placeholder="Email"
        onChange={(e) => onChange({ email: e.target.value || null })}
        disabled={!editable}
        className={cn(inputCls(editable), "mt-2")}
      />
      <input
        type="tel"
        maxLength={40}
        value={value.phone ?? ""}
        placeholder="Phone"
        onChange={(e) => onChange({ phone: e.target.value || null })}
        disabled={!editable}
        className={cn(inputCls(editable), "mt-2")}
      />
      {duplicateOf && (
        <div className="mt-2 text-[10px] text-red-700 font-semibold flex items-start gap-1">
          <span>⚠</span>
          <span>
            Same {duplicateOf.field} as the {duplicateOf.roleLabel} role —
            one person per role.
          </span>
        </div>
      )}
    </div>
  );
}

function findStakeholderDuplicate(
  stakeholders: Record<string, Stakeholder>,
  currentKey: string,
  current: Stakeholder,
): { roleLabel: string; field: "name" | "email" } | null {
  const curName = (current.name ?? "").trim().toLowerCase();
  const curEmail = (current.email ?? "").trim().toLowerCase();
  if (!curName && !curEmail) return null;
  for (const role of STAKEHOLDER_ROLES) {
    if (role.key === currentKey) continue;
    const other = stakeholders[role.key];
    if (!other) continue;
    const otherName = (other.name ?? "").trim().toLowerCase();
    const otherEmail = (other.email ?? "").trim().toLowerCase();
    if (curName && otherName && curName === otherName) {
      return { roleLabel: role.label, field: "name" };
    }
    if (curEmail && otherEmail && curEmail === otherEmail) {
      return { roleLabel: role.label, field: "email" };
    }
  }
  return null;
}

function StakeholderDuplicateBanner({
  stakeholders,
}: {
  stakeholders: Record<string, Stakeholder>;
}) {
  const dups = STAKEHOLDER_ROLES.filter((r) =>
    findStakeholderDuplicate(stakeholders, r.key, stakeholders[r.key] ?? {
      name: null,
      email: null,
      phone: null,
    }),
  );
  if (dups.length === 0) return null;
  return (
    <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
      <span className="font-bold">⚠ Duplicate stakeholders — </span>
      the same person appears in more than one role. Each role should be a
      different person, otherwise the coverage rollup overcounts.
    </div>
  );
}

function RoleCoverage({
  stakeholders,
}: {
  stakeholders: Record<string, Stakeholder>;
}) {
  const filled = STAKEHOLDER_ROLES.filter(
    (r) => !!stakeholders[r.key]?.name?.trim(),
  ).length;
  const total = STAKEHOLDER_ROLES.length;
  const complete = filled === total;
  return (
    <div
      className={cn(
        "mt-3 rounded-md px-3 py-2 text-xs border",
        complete
          ? "border-green-200 bg-green-50 text-green-800"
          : "border-amber-200 bg-amber-50 text-amber-900",
      )}
    >
      {complete ? (
        <>✓ All three roles named.</>
      ) : (
        <>
          {filled}/{total} roles named — fill in the remaining{" "}
          {total - filled} to unblock Goal Validation.
        </>
      )}
    </div>
  );
}

// ============================================================
// Helpers
// ============================================================

function inputCls(enabled: boolean) {
  return cn(
    "w-full px-3 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-beroe-blue",
    !enabled && "bg-slate-50 text-text-secondary cursor-not-allowed",
  );
}

function textareaCls(enabled: boolean) {
  return cn(
    "w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-beroe-blue",
    !enabled && "bg-slate-50 text-text-secondary cursor-not-allowed",
  );
}

/** Strip server-owned fields so dirty comparison is just user input. */
function serialise(c: CSOnboarding): unknown {
  const { activated, is_editable, ...rest } = c;
  void activated;
  void is_editable;
  return rest;
}

/** PATCH payload — only fields that actually changed. */
function diff(next: CSOnboarding, prev: CSOnboarding): CSOnboardingUpdate {
  const out: Record<string, unknown> = {};
  const keys: (keyof CSOnboardingUpdate)[] = [
    "cs_entry_type",
    "cs_entry_b_context",
    "cs_entry_b_goals",
    "cs_handover_checklist",
    "cs_stakeholders",
  ];
  for (const k of keys) {
    if (JSON.stringify(next[k]) !== JSON.stringify(prev[k])) {
      out[k] = next[k];
    }
  }
  return out;
}

// ============================================================
// R21 — Goal Validation & Alignment surface inside CS Onboarding
// ============================================================

type GoalRow = {
  id: string;
  title: string;
  category: string;
  alignment_status: "not_started" | "partial" | "aligned";
  phase_a?: Record<string, unknown> | null;
  phase_b?: Record<string, unknown> | null;
  phase_c?: Record<string, unknown> | null;
};

function GoalAlignmentSurface({ accountId }: { accountId: string }) {
  const { data, isLoading } = useQuery<{ items: GoalRow[] }>({
    queryKey: ["cs-goals", accountId, false],
    queryFn: () =>
      api.get<{ items: GoalRow[] }>(
        `/api/v1/accounts/${accountId}/cs-goals?include_deleted=false`,
      ),
  });
  const goals = data?.items ?? [];
  return (
    <Section
      title="Goal Validation & Alignment"
      subtitle="Each goal walks through three checks: what it means, the groundwork, and the agreed target. Click any row to expand."
    >
      <div className="flex items-center justify-end mb-2">
        <a
          href={`/accounts/${accountId}/goals`}
          className="text-xs text-beroe-blue font-semibold hover:underline"
        >
          Manage Goals →
        </a>
      </div>
      {isLoading ? (
        <div className="text-xs text-text-muted italic">Loading goals…</div>
      ) : goals.length === 0 ? (
        <div className="text-xs text-text-muted italic">
          No goals captured yet. Add the first goal from the Manage Goals page.
        </div>
      ) : (
        <ul className="space-y-2">
          {goals.map((g) => (
            <GoalAlignmentRow key={g.id} g={g} accountId={accountId} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function GoalAlignmentRow({
  g,
  accountId,
}: {
  g: GoalRow;
  accountId: string;
}) {
  const qc = useQueryClient();
  const dot =
    g.alignment_status === "aligned"
      ? "bg-emerald-500"
      : g.alignment_status === "partial"
        ? "bg-amber-500"
        : "bg-slate-400";
  const phaseA = (g.phase_a ?? {}) as Record<string, unknown>;
  const phaseB = (g.phase_b ?? {}) as Record<string, unknown>;
  const phaseC = (g.phase_c ?? {}) as Record<string, unknown>;

  // H42/43/44 — single PATCH-on-save mutation reused by all three editors.
  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.patch(`/api/v1/cs-goals/${g.id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cs-goals", accountId, false] }),
  });

  return (
    <li className="border border-beroe-card-border rounded-lg overflow-hidden">
      <details>
        <summary className="px-3 py-2 cursor-pointer hover:bg-slate-50 flex items-center gap-2">
          <span className={cn("w-2 h-2 rounded-full", dot)} />
          <span className="text-sm font-semibold text-text-primary">{g.title}</span>
          <span className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-slate-100 text-text-muted">
            {g.category.replace(/_/g, " ")}
          </span>
          <span className="ml-auto text-[10px] uppercase tracking-wider font-bold text-text-muted">
            {g.alignment_status}
          </span>
        </summary>
        <div className="px-3 py-2 grid grid-cols-1 md:grid-cols-3 gap-2 bg-slate-50/40">
          <PhaseAEditableBlock
            title="What does it mean?"
            phase={phaseA}
            saving={patch.isPending}
            onSave={(next) => patch.mutate({ phase_a: next })}
          />
          <PhaseBEditableBlock
            title="Groundwork"
            category={g.category}
            phase={phaseB}
            saving={patch.isPending}
            onSave={(next) => patch.mutate({ phase_b: next })}
          />
          <PhaseCEditableBlock
            title="Agreed target"
            phase={phaseC}
            saving={patch.isPending}
            onSave={(next) => patch.mutate({ phase_c: next })}
          />
        </div>
      </details>
    </li>
  );
}

// ---- Phase A editable block (validation note + goal type) ----
function PhaseAEditableBlock({
  title,
  phase,
  saving,
  onSave,
}: {
  title: string;
  phase: Record<string, unknown>;
  saving: boolean;
  onSave: (next: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    goal_type: String(phase.goal_type ?? ""),
    validation_note: String(phase.validation_note ?? ""),
  });
  const empty = !phase.goal_type && !phase.validation_note;
  const summary = empty
    ? "Not yet captured. Click to add."
    : [phase.goal_type ? `Type: ${String(phase.goal_type).replace(/_/g, " ")}` : null, phase.validation_note]
        .filter(Boolean)
        .join(" · ");
  return (
    <EditableShell title={title} open={open} setOpen={setOpen} summary={summary} empty={empty}>
      <input
        type="text"
        value={draft.goal_type}
        placeholder="Goal type (e.g. cost_savings, base_rationalization)"
        onChange={(e) => setDraft({ ...draft, goal_type: e.target.value })}
        className="w-full text-[12px] border border-beroe-card-border rounded px-2 py-1 mb-1.5"
      />
      <textarea
        rows={3}
        value={draft.validation_note}
        placeholder="What does this goal mean to the client?"
        onChange={(e) => setDraft({ ...draft, validation_note: e.target.value })}
        className="w-full text-[12px] border border-beroe-card-border rounded px-2 py-1"
      />
      <EditableActions
        saving={saving}
        onSave={() => {
          onSave({
            goal_type: draft.goal_type || null,
            validation_note: draft.validation_note || null,
          });
          setOpen(false);
        }}
        onCancel={() => {
          setDraft({
            goal_type: String(phase.goal_type ?? ""),
            validation_note: String(phase.validation_note ?? ""),
          });
          setOpen(false);
        }}
      />
    </EditableShell>
  );
}

// ---- Phase B editable block (3 groundwork selects, category-aware) ----
const GROUNDWORK_ITEMS_BY_CATEGORY: Record<string, { key: string; label: string }[]> = {
  cost_savings: [
    { key: "spend_analytics", label: "Spend Analytics" },
    { key: "opportunity_assessment", label: "Opportunity Assessment" },
    { key: "benchmarking", label: "Benchmarking" },
  ],
  base_rationalization: [
    { key: "catalog_coverage", label: "Catalog Coverage" },
    { key: "supplier_mapping", label: "Supplier Mapping" },
    { key: "spend_visibility", label: "Spend Visibility" },
  ],
  risk_mitigation: [
    { key: "risk_register", label: "Risk Register" },
    { key: "supplier_health", label: "Supplier Health Check" },
    { key: "contingency_coverage", label: "Contingency Coverage" },
  ],
  adoption: [
    { key: "user_roster", label: "User Roster" },
    { key: "training_plan", label: "Training Plan" },
    { key: "champion_identified", label: "Champion Identified" },
  ],
  other: [
    { key: "spend_analytics", label: "Spend Analytics" },
    { key: "opportunity_assessment", label: "Opportunity Assessment" },
    { key: "benchmarking", label: "Benchmarking" },
  ],
};

const GROUNDWORK_OPTIONS = [
  { v: "", l: "— Select —" },
  { v: "done_current", l: "Done — current" },
  { v: "done_outdated", l: "Done — outdated" },
  { v: "not_done", l: "Not done" },
  { v: "unknown", l: "Unknown" },
];

function PhaseBEditableBlock({
  title,
  category,
  phase,
  saving,
  onSave,
}: {
  title: string;
  category: string;
  phase: Record<string, unknown>;
  saving: boolean;
  onSave: (next: Record<string, unknown>) => void;
}) {
  const items =
    GROUNDWORK_ITEMS_BY_CATEGORY[category] ?? GROUNDWORK_ITEMS_BY_CATEGORY.other;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    items.forEach((it) => {
      init[it.key] = String(phase[it.key] ?? "");
    });
    return init;
  });
  const anyFilled = items.some((it) => phase[it.key]);
  const summary = anyFilled
    ? items
        .filter((it) => phase[it.key])
        .map((it) => `${it.label}: ${String(phase[it.key]).replace(/_/g, " ")}`)
        .join(" · ")
    : "Not yet captured. Click to fill.";
  return (
    <EditableShell title={title} open={open} setOpen={setOpen} summary={summary} empty={!anyFilled}>
      {items.map((it) => (
        <div key={it.key} className="mb-1.5">
          <label className="block text-[10px] text-text-muted mb-0.5">{it.label}</label>
          <select
            value={draft[it.key] ?? ""}
            onChange={(e) => setDraft({ ...draft, [it.key]: e.target.value })}
            className="w-full text-[12px] border border-beroe-card-border rounded px-2 py-1"
          >
            {GROUNDWORK_OPTIONS.map((o) => (
              <option key={o.v} value={o.v}>{o.l}</option>
            ))}
          </select>
        </div>
      ))}
      <EditableActions
        saving={saving}
        onSave={() => {
          const payload: Record<string, unknown> = {};
          for (const it of items) {
            payload[it.key] = draft[it.key] || null;
          }
          onSave(payload);
          setOpen(false);
        }}
        onCancel={() => {
          const reset: Record<string, string> = {};
          items.forEach((it) => {
            reset[it.key] = String(phase[it.key] ?? "");
          });
          setDraft(reset);
          setOpen(false);
        }}
      />
    </EditableShell>
  );
}

// ---- Phase C editable block (agreed target / measure / timeline) ----
function PhaseCEditableBlock({
  title,
  phase,
  saving,
  onSave,
}: {
  title: string;
  phase: Record<string, unknown>;
  saving: boolean;
  onSave: (next: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({
    agreed_target: String(phase.agreed_target ?? ""),
    measure_method: String(phase.measure_method ?? ""),
    timeline: String(phase.timeline ?? ""),
    baseline: String(phase.baseline ?? ""),
  });
  const empty = !phase.agreed_target && !phase.measure_method && !phase.timeline;
  const summary = empty
    ? "Not yet captured. Click to fill."
    : [
        phase.agreed_target ? `Target: ${String(phase.agreed_target)}` : null,
        phase.measure_method ? `Measure: ${String(phase.measure_method)}` : null,
        phase.timeline ? `Due ${String(phase.timeline)}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
  return (
    <EditableShell title={title} open={open} setOpen={setOpen} summary={summary} empty={empty}>
      <input
        type="text"
        value={draft.agreed_target}
        placeholder="Agreed target (e.g. 5% savings on indirect spend)"
        onChange={(e) => setDraft({ ...draft, agreed_target: e.target.value })}
        className="w-full text-[12px] border border-beroe-card-border rounded px-2 py-1 mb-1.5"
      />
      <input
        type="text"
        value={draft.measure_method}
        placeholder="How will it be measured?"
        onChange={(e) => setDraft({ ...draft, measure_method: e.target.value })}
        className="w-full text-[12px] border border-beroe-card-border rounded px-2 py-1 mb-1.5"
      />
      <input
        type="date"
        value={draft.timeline}
        onChange={(e) => setDraft({ ...draft, timeline: e.target.value })}
        className="w-full text-[12px] border border-beroe-card-border rounded px-2 py-1 mb-1.5"
      />
      <input
        type="text"
        value={draft.baseline}
        placeholder="Baseline (optional)"
        onChange={(e) => setDraft({ ...draft, baseline: e.target.value })}
        className="w-full text-[12px] border border-beroe-card-border rounded px-2 py-1"
      />
      <EditableActions
        saving={saving}
        onSave={() => {
          onSave({
            agreed_target: draft.agreed_target || null,
            measure_method: draft.measure_method || null,
            timeline: draft.timeline || null,
            baseline: draft.baseline || null,
          });
          setOpen(false);
        }}
        onCancel={() => {
          setDraft({
            agreed_target: String(phase.agreed_target ?? ""),
            measure_method: String(phase.measure_method ?? ""),
            timeline: String(phase.timeline ?? ""),
            baseline: String(phase.baseline ?? ""),
          });
          setOpen(false);
        }}
      />
    </EditableShell>
  );
}

function EditableShell({
  title,
  open,
  setOpen,
  summary,
  empty,
  children,
}: {
  title: string;
  open: boolean;
  setOpen: (v: boolean) => void;
  summary: string;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-beroe-card-border rounded-md px-2.5 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted">
          {title}
        </div>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="text-[10px] text-beroe-blue font-semibold hover:underline"
        >
          {open ? "Close" : empty ? "+ Add" : "Edit"}
        </button>
      </div>
      {!open && (
        <div
          className={cn(
            "text-[12px] mt-1 leading-snug cursor-pointer",
            empty ? "text-text-muted italic" : "text-text-primary",
          )}
          onClick={() => setOpen(true)}
        >
          {summary}
        </div>
      )}
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

function EditableActions({
  saving,
  onSave,
  onCancel,
}: {
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex gap-2 mt-2">
      <button
        type="button"
        onClick={onSave}
        disabled={saving}
        className="text-[11px] px-2.5 py-1 rounded-md bg-beroe-blue text-white font-semibold disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="text-[11px] px-2.5 py-1 rounded-md border border-beroe-card-border text-text-secondary"
      >
        Cancel
      </button>
    </div>
  );
}
