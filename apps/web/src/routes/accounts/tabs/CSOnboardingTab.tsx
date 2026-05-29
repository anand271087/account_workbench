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
    <div className="space-y-3">
      {/* CS Onboarding track divider — verbatim port of prototype
          line 6125-6130. */}
      <div className="flex items-center gap-2.5 mb-1 mt-1.5">
        <div className="flex-1 border-t-[1.5px] border-dashed border-beroe-card-border" />
        <span className="text-[10px] text-text-muted font-semibold whitespace-nowrap">
          CS Onboarding · Entry → Stakeholders → Success Management
        </span>
        <div className="flex-1 border-t-[1.5px] border-dashed border-beroe-card-border" />
      </div>

      {/* ---------- Card 1: Entry type picker ----------
          Prototype line 6132-6165: left-border 3px #4A00F8 violet,
          numbered badge "1", CS team badge. */}
      <NumberedCard
        n="1"
        title="CS Onboarding Entry"
        col="#4A00F8"
        teamLabel="CS"
      >
        <p className="text-xs text-text-muted mb-3">
          Two ways into CS. Pick A when you got a clean handover from Sales
          on signing. Pick B when you're inheriting an account mid-contract
          and need to record what you're walking into.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
          <EntryButton
            label="✅ Entry A — New Account (Clean Handover)"
            desc="Sales passed a complete handover package to CS"
            active={form.cs_entry_type === "A"}
            disabled={!editable || !account.gate_signed}
            disabledHint={
              !account.gate_signed
                ? "Account isn't signed yet — Entry A activates after signing."
                : undefined
            }
            col="#4A00F8"
            activeBg="#f3f0ff"
            onClick={() => setEntry("A")}
          />
          <EntryButton
            label="🔄 Entry B — Existing Account (Mid-Contract)"
            desc="CSM picks up account with no clean handover"
            active={form.cs_entry_type === "B"}
            disabled={!editable}
            col="#F0BC41"
            activeBg="#fff8eb"
            onClick={() => setEntry("B")}
          />
        </div>

        {/* When Entry A — inline handover quality checklist
            (prototype line 6148-6155). */}
        {form.cs_entry_type === "A" && account.gate_signed && (
          <HandoverChecklistInline
            checklist={form.cs_handover_checklist}
            editable={editable}
            saving={instant.isPending}
            onToggle={(k, v) =>
              instant.mutate({ cs_handover_checklist: { [k]: v } })
            }
          />
        )}

        {/* When Entry B — inline VDD baseline (prototype line 6156-6163). */}
        {form.cs_entry_type === "B" && (
          <EntryBBaselineInline
            form={form}
            editable={editable}
            onChange={setForm}
          />
        )}

        {savingError && (
          <div className="mt-3 text-xs text-beroe-red bg-beroe-red/10 border border-beroe-red/30 rounded-lg px-3 py-2">
            {savingError}
          </div>
        )}
      </NumberedCard>

      {/* Idle state — neither entry chosen yet (prototype line 6164). */}
      {!activated && form.cs_entry_type !== "A" && form.cs_entry_type !== "B" && (
        <div className="bg-beroe-bg rounded-card border border-beroe-card-border p-3 text-xs text-text-muted text-center">
          Select an entry type to begin CS onboarding.
        </div>
      )}

      {/* ---------- Card 2: Stakeholder Map ----------
          Prototype line 6167-6201: left-border 3px #C344C7 magenta,
          numbered badge "2", X/3 roles pill in header, 3-column grid
          with per-role colour + icon. */}
      {activated && (
        <NumberedCard
          n="2"
          title="Stakeholder Map"
          col="#C344C7"
          teamLabel="CS"
          trailing={<RoleCoveragePill stakeholders={form.cs_stakeholders} />}
        >
          <p className="text-[10px] text-text-muted mb-2.5">
            All 3 roles must be named before proceeding to goals and success
            contract.
          </p>
          <StakeholderDuplicateBanner stakeholders={form.cs_stakeholders} />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
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
                  col={r.col}
                  icon={r.icon}
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
        </NumberedCard>
      )}

      {/* ---------- Card 3: Goal Validation & Alignment ----------
          Prototype line 6203+: left-border 3px #4A00F8 violet,
          numbered badge "3". */}
      {activated && <GoalAlignmentSurface accountId={account.id} />}

      {/* Sticky save bar — for the text-field changes (Entry B + stakeholders). */}
      {editable && (
        <div
          className={cn(
            "sticky bottom-0 -mx-6 px-6 py-3 flex items-center gap-3 border-t z-30 transition-colors",
            dirty
              ? "bg-beroe-amber/15 border-beroe-amber/50 shadow-[0_-4px_12px_rgba(0,0,0,0.05)]"
              : "bg-white border-beroe-card-border",
          )}
        >
          {savingError && (
            <span className="text-xs text-beroe-red bg-beroe-red/10 border border-beroe-red/30 rounded-lg px-3 py-1">
              {savingError}
            </span>
          )}
          {!savingError && dirty && (
            <span className="flex items-center gap-1.5 text-xs text-beroe-amber font-bold">
              <span className="inline-block w-2 h-2 rounded-full bg-beroe-amber/150 animate-pulse" />
              Unsaved changes
              <span className="text-beroe-amber/70 font-normal ml-1">
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
            className="ml-auto px-3 py-1.5 rounded-lg text-sm border border-beroe-card-border text-text-secondary disabled:opacity-50 bg-white"
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

/** NumberedCard — verbatim port of prototype's
 *    `<div class="card" style="border-left:3px solid {col}">`
 *    + numbered badge + team badge pattern (line 6133-6137,
 *    6168-6173, 6203-6240).
 *    Used for all three CS Onboarding step cards. */
function NumberedCard({
  n,
  title,
  col,
  teamLabel,
  trailing,
  children,
}: {
  n: string;
  title: string;
  col: string;
  teamLabel?: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="bg-white rounded-card border border-beroe-card-border p-4 mb-3"
      style={{ borderLeft: `3px solid ${col}` }}
    >
      <div className="flex items-center gap-2 mb-2.5">
        <span
          className="inline-flex items-center justify-center w-[22px] h-[22px] rounded-md text-[10px] font-extrabold text-white"
          style={{ background: col }}
        >
          {n}
        </span>
        <span className="text-[14px] font-bold text-text-primary">{title}</span>
        {teamLabel && (
          <span
            className="text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wider"
            style={{ background: `${col}15`, color: col }}
          >
            {teamLabel}
          </span>
        )}
        {trailing && <span className="ml-2">{trailing}</span>}
      </div>
      {children}
    </div>
  );
}

/** Inline handover checklist — rows with green bg when checked,
 *  rounded checkbox icon, strike-through text. Prototype line 6149-6155. */
function HandoverChecklistInline({
  checklist,
  editable,
  saving,
  onToggle,
}: {
  checklist: Record<string, boolean>;
  editable: boolean;
  saving: boolean;
  onToggle: (key: string, v: boolean) => void;
}) {
  const allDone = CS_HANDOVER_ITEMS.every((it) => !!checklist[it.key]);
  return (
    <div className="mt-2">
      <div
        className="text-[11px] font-bold uppercase tracking-wider mb-2"
        style={{ color: "#6b7fa0" }}
      >
        Handover Quality Check — All 4 must be present
      </div>
      {CS_HANDOVER_ITEMS.map((it) => {
        const checked = !!checklist[it.key];
        return (
          <button
            key={it.key}
            type="button"
            disabled={!editable || saving}
            onClick={() => onToggle(it.key, !checked)}
            className="w-full flex items-center gap-2 px-2 py-1.5 mb-1 rounded-md text-left disabled:cursor-not-allowed"
            style={{ background: checked ? "#f0fdf4" : "#f8f9fc" }}
          >
            <span
              className="inline-flex items-center justify-center flex-shrink-0 text-white"
              style={{
                width: 18,
                height: 18,
                borderRadius: 4,
                border: `2px solid ${checked ? "#6EC457" : "#cbd5e1"}`,
                background: checked ? "#6EC457" : "#fff",
                fontSize: 10,
              }}
            >
              {checked ? "✓" : ""}
            </span>
            <span
              className="text-[12px]"
              style={{
                color: checked ? "#6EC457" : undefined,
                textDecoration: checked ? "line-through" : "none",
              }}
            >
              {it.label}
            </span>
          </button>
        );
      })}
      {allDone ? (
        <div
          className="mt-2 text-[11px] px-3 py-2 rounded-md"
          style={{
            background: "#f0fdf4",
            border: "1px solid #6EC45730",
            color: "#6EC457",
          }}
        >
          ✅ Handover complete. Proceed to stakeholder mapping and success
          contract.
        </div>
      ) : (
        <div
          className="mt-2 text-[11px] px-3 py-2 rounded-md"
          style={{
            background: "#fff8eb",
            border: "1px solid #F0BC4130",
            color: "#b45309",
          }}
        >
          ⚠️ Incomplete handover — resolve missing items with Sales before
          proceeding.
        </div>
      )}
    </div>
  );
}

/** Inline Entry-B VDD baseline block. Prototype line 6156-6163. */
function EntryBBaselineInline({
  form,
  editable,
  onChange,
}: {
  form: CSOnboarding;
  editable: boolean;
  onChange: (next: CSOnboarding) => void;
}) {
  const captured = !!form.cs_entry_b_context?.trim();
  return (
    <div className="mt-2">
      <div
        className="text-[11px] font-bold uppercase tracking-wider mb-1.5"
        style={{ color: "#6b7fa0" }}
      >
        Value Delivery Document (VDD) — Catch-up Baseline
      </div>
      <p className="text-[11px] text-text-muted mb-2">
        Upload or enter prior context. Goals must be agreed with budget owner
        and client SPOC.
      </p>
      <textarea
        rows={4}
        maxLength={8000}
        value={form.cs_entry_b_context ?? ""}
        onChange={(e) =>
          onChange({ ...form, cs_entry_b_context: e.target.value || null })
        }
        disabled={!editable}
        placeholder="Prior context, notes, activity history..."
        className={cn(textareaCls(editable), "mb-2")}
      />
      <textarea
        rows={3}
        maxLength={8000}
        value={form.cs_entry_b_goals ?? ""}
        onChange={(e) =>
          onChange({ ...form, cs_entry_b_goals: e.target.value || null })
        }
        disabled={!editable}
        placeholder="Goals agreed with budget owner and client SPOC..."
        className={textareaCls(editable)}
      />
      {captured ? (
        <div
          className="mt-2 text-[11px] px-3 py-2 rounded-md"
          style={{
            background: "#f0fdf4",
            border: "1px solid #6EC45730",
            color: "#6EC457",
          }}
        >
          ✅ Baseline captured. Proceed to stakeholder mapping.
        </div>
      ) : (
        <div
          className="mt-2 text-[11px] px-3 py-2 rounded-md"
          style={{
            background: "#fff8eb",
            border: "1px solid #F0BC4130",
            color: "#b45309",
          }}
        >
          ⚠️ Account not activated until VDD baseline is complete.
        </div>
      )}
    </div>
  );
}

/** "X/3 roles" pill in the Stakeholder Map header.
 *  Prototype line 6172: filled===3 → green, >0 → amber, 0 → red. */
function RoleCoveragePill({
  stakeholders,
}: {
  stakeholders: Record<string, Stakeholder>;
}) {
  const filled = STAKEHOLDER_ROLES.filter(
    (r) => !!stakeholders[r.key]?.name?.trim(),
  ).length;
  const total = STAKEHOLDER_ROLES.length;
  const tone =
    filled === total
      ? { bg: "#dcfce7", fg: "#166534" }
      : filled > 0
        ? { bg: "#fef3c7", fg: "#92400e" }
        : { bg: "#fee2e2", fg: "#991b1b" };
  return (
    <span
      className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
      style={{ background: tone.bg, color: tone.fg }}
    >
      {filled}/{total} roles
    </span>
  );
}

/** EntryButton — verbatim port of prototype line 6139-6146.
 *  When active: border 2px solid {col} + bg {activeBg} + text {col}.
 *  When inactive: border 2px solid card-border + bg white + text default. */
function EntryButton({
  label,
  desc,
  active,
  disabled,
  disabledHint,
  col,
  activeBg,
  onClick,
}: {
  label: string;
  desc: string;
  active: boolean;
  disabled: boolean;
  disabledHint?: string;
  col: string;
  activeBg: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      title={disabled ? disabledHint : ""}
      className={cn(
        "text-left rounded-[10px] p-3 transition-colors",
        disabled && "opacity-50 cursor-not-allowed",
      )}
      style={{
        border: `2px solid ${active ? col : "#e4eaf6"}`,
        background: active ? activeBg : "#fff",
      }}
    >
      <div
        className="text-[12px] font-bold mb-1"
        style={{ color: active ? col : "#1f2937" }}
      >
        {label}
      </div>
      <div className="text-[10px] text-text-muted">{desc}</div>
      {disabled && disabledHint && (
        <div className="text-[10px] text-text-muted italic mt-1.5">
          {disabledHint}
        </div>
      )}
    </button>
  );
}

/** StakeholderCard — verbatim port of prototype line 6183-6198.
 *  When filled: bg {col}08 + border 1.5px {col}30 + role title in {col}.
 *  When empty: bg #f8f9fc + border 1.5px card-border. Per-role icon
 *  next to the label, ✓ badge when filled. */
function StakeholderCard({
  label,
  desc,
  col,
  icon,
  value,
  editable,
  duplicateOf,
  onChange,
}: {
  label: string;
  desc: string;
  col: string;
  icon: string;
  value: Stakeholder;
  editable: boolean;
  duplicateOf: { roleLabel: string; field: "name" | "email" } | null;
  onChange: (patch: Partial<Stakeholder>) => void;
}) {
  const filled = !!value.name?.trim();
  return (
    <div
      className="rounded-card p-3 transition-colors"
      style={{
        background: duplicateOf
          ? "#fff0f2"
          : filled
            ? `${col}08`
            : "#f8f9fc",
        border: `1.5px solid ${duplicateOf ? "#CF454830" : filled ? `${col}30` : "#e4eaf6"}`,
      }}
    >
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-[14px]">{icon}</span>
        <span
          className="text-[12px] font-bold flex-1"
          style={{ color: col }}
        >
          {label}
        </span>
        {filled && (
          <span className="text-[10px]" style={{ color: "#6EC457" }}>
            ✓
          </span>
        )}
      </div>
      <div className="text-[10px] text-text-muted mb-2">{desc}</div>
      <input
        type="text"
        maxLength={200}
        value={value.name ?? ""}
        placeholder="Name"
        onChange={(e) => onChange({ name: e.target.value || null })}
        disabled={!editable}
        className={cn(inputCls(editable), "mb-1.5")}
      />
      <input
        type="email"
        maxLength={320}
        value={value.email ?? ""}
        placeholder="Email"
        onChange={(e) => onChange({ email: e.target.value || null })}
        disabled={!editable}
        className={cn(inputCls(editable), "mb-1.5")}
      />
      <input
        type="tel"
        maxLength={40}
        value={value.phone ?? ""}
        placeholder="Phone"
        onChange={(e) => onChange({ phone: e.target.value || null })}
        disabled={!editable}
        className={inputCls(editable)}
      />
      {duplicateOf && (
        <div className="mt-2 text-[10px] font-semibold flex items-start gap-1" style={{ color: "#CF4548" }}>
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
    <div className="mb-3 rounded-md border border-beroe-red/30 bg-beroe-red/10 px-3 py-2 text-xs text-beroe-red">
      <span className="font-bold">⚠ Duplicate stakeholders — </span>
      the same person appears in more than one role. Each role should be a
      different person, otherwise the coverage rollup overcounts.
    </div>
  );
}


// ============================================================
// Helpers
// ============================================================

function inputCls(enabled: boolean) {
  return cn(
    "w-full px-3 py-1.5 rounded-lg border border-beroe-card-border text-sm focus:outline-none focus:border-beroe-blue",
    !enabled && "bg-beroe-bg text-text-secondary cursor-not-allowed",
  );
}

function textareaCls(enabled: boolean) {
  return cn(
    "w-full px-3 py-2 rounded-lg border border-beroe-card-border text-sm focus:outline-none focus:border-beroe-blue",
    !enabled && "bg-beroe-bg text-text-secondary cursor-not-allowed",
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

  // Status message ported from prototype line 6215.
  const aligned = goals.filter((g) => g.alignment_status === "aligned").length;
  const total = goals.length;
  const statusMsg =
    total === 0
      ? ""
      : aligned === total
        ? "🟢 All goals aligned — initiatives ready"
        : aligned > 0
          ? `🟡 Alignment in progress — ${aligned} of ${total} goals aligned`
          : "🔴 Not started — validate goals before picking initiatives";

  return (
    <NumberedCard
      n="3"
      title="🎯 Goal Validation & Alignment"
      col="#4A00F8"
      trailing={
        statusMsg && (
          <span className="text-[10px] font-semibold text-text-secondary">
            {statusMsg}
          </span>
        )
      }
    >
      <div className="flex items-start justify-between gap-3 mb-2.5">
        <p className="text-[10px] text-text-muted">
          Validate each goal before defining initiatives. This step ensures
          you and the client are aligned on what success means.
        </p>
        <a
          href={`/accounts/${accountId}/goals`}
          className="text-[10px] text-beroe-blue font-semibold hover:underline whitespace-nowrap"
        >
          Manage Goals →
        </a>
      </div>
      {isLoading ? (
        <div className="text-xs text-text-muted italic">Loading goals…</div>
      ) : goals.length === 0 ? (
        <div className="text-xs text-text-muted italic px-2 py-2">
          Goals will appear here from the Sales handover. If none are showing,
          check the Sales Hand-off section above.
        </div>
      ) : (
        <ul className="space-y-2">
          {goals.map((g) => (
            <GoalAlignmentRow key={g.id} g={g} accountId={accountId} />
          ))}
        </ul>
      )}
    </NumberedCard>
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
      ? "bg-beroe-green"
      : g.alignment_status === "partial"
        ? "bg-beroe-amber/150"
        : "bg-text-muted";
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
        <summary className="px-3 py-2 cursor-pointer hover:bg-beroe-bg flex items-center gap-2">
          <span className={cn("w-2 h-2 rounded-full", dot)} />
          <span className="text-sm font-semibold text-text-primary">{g.title}</span>
          <span className="text-[10px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-beroe-bg text-text-muted">
            {g.category.replace(/_/g, " ")}
          </span>
          <span className="ml-auto text-[10px] uppercase tracking-wider font-bold text-text-muted">
            {g.alignment_status}
          </span>
        </summary>
        <div className="px-3 py-2 grid grid-cols-1 md:grid-cols-3 gap-2 bg-beroe-bg/40">
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
