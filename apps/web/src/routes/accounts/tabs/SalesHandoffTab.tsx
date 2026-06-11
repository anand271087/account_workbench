// 04-Jun — Sales Handoff page (full prototype port).
//
// Single-page mirror of beroe_sales_handoff_proto.html. Two-card layout:
//   Section A · Sales Handoff (purple)       — Sales captures value-def
//     validation, client stakeholders, engagement timeline, watch-outs,
//     contract docs. Lock to hand off to Contract Ops.
//   Section B · Contract Audit (amber)       — Contract Ops fills dates,
//     commercial terms, modules + per-module configs, caveats, geography,
//     other terms. Locks via /sign endpoint → handed off to CS.
//
// Two locks:
//   * sh_locked_at (Stage 1 → 2) via POST /sh-lock
//   * gate_signed=true (Stage 2 → 3) via POST /sign
//
// Demo state toggle (fixed top-right) mirrors the prototype's mock-toggle.

import { memo, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, ApiError } from "@/lib/api";
import { authProvider } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { useConfirm, useNotify, usePrompt } from "@/components/DialogProvider";
import { useAccountFromLayout } from "../AccountProfileLayout";
import { KindUploadCard } from "@/components/KindUploadCard";
import {
  EXTRACTION_APPLIED_EVENT,
  consumeHandoffSlice,
} from "@/lib/extractionDraft";
import type { HandoffExtractionResult } from "@/types/handoff_extraction";
import type {
  SigningGate,
  SignAccountBody,
  ModuleName,
  ModuleField,
} from "@/types/signing";
import {
  ALL_MODULES,
  BILLING_FREQ_OPTIONS,
  PAYMENT_TERM_OPTIONS,
  GEO_OPTIONS,
  FIRST_CP_OPTIONS,
  MODULE_CONFIG_SPECS,
} from "@/types/signing";
import type { Solutioning, SolutioningUpdate, ShValidation } from "@/types/solutioning";
import { SH_VALIDATION_LABELS } from "@/types/solutioning";
import type { Document } from "@/types/document";

// ─────────────────────────────────────────────────────────────
// Brand-locked palette (off-palette prototype hex mapped to tokens).
// ─────────────────────────────────────────────────────────────
const C = {
  BLUE: "#4A00F8",    // Indigo
  PURPLE: "#C344C7",  // Fuscia
  AMBER: "#F0BC41",   // Risk Amber / Bumblebee
  GREEN: "#6EC457",   // Risk Green
  RED: "#CF4548",     // Risk Red
  TEAL: "#35E1D4",    // Aqua
  NAVY: "#001137",    // Midnight
  T2: "#475569",
  T3: "#94a3b8",
  CB: "#e4eaf6",
  BG: "#EAF1F5",
};

interface ContactRow {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone?: string | null;
  is_spoc: boolean;
  is_sponsor: boolean;
  decision_power: string | null;
  seniority: string | null;
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function fd(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
function initials(name: string | null | undefined): string {
  if (!name) return "??";
  return name.replace(/[^A-Za-z ]/g, "").split(" ").filter(Boolean).slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? "").join("");
}
function yearsFromTerm(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = /(\d+)/.exec(t);
  return m ? parseInt(m[1], 10) : null;
}

// Per-module config status — drives the chip / card colour.
function moduleConfigStatus(
  mod: string,
  cfg: Record<string, unknown> | undefined,
): { filled: number; total: number; status: "complete" | "partial" | "empty" } {
  const spec = MODULE_CONFIG_SPECS[mod];
  if (!spec) return { filled: 0, total: 0, status: "empty" };
  const conf = cfg ?? {};
  const visible = spec.fields.filter((f) => !f.showIf || f.showIf(conf));
  const filled = visible.filter((f) => {
    const v = conf[f.key];
    if (Array.isArray(v)) return v.length > 0;
    return v !== undefined && v !== null && v !== "";
  }).length;
  const total = visible.length;
  const status = total === 0 ? "complete" : filled === total ? "complete" : filled > 0 ? "partial" : "empty";
  return { filled, total, status };
}

// ─────────────────────────────────────────────────────────────
// Section A — Sales Handoff (purple card)
// ─────────────────────────────────────────────────────────────
function SalesHandoffSection({
  account,
  gate,
  solutioning,
  contacts,
  contractDocs,
  onMutate,
}: {
  account: ReturnType<typeof useAccountFromLayout>;
  gate: SigningGate;
  solutioning: Solutioning | null;
  contacts: ContactRow[];
  contractDocs: Document[];
  onMutate: () => void;
}) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const promptDlg = usePrompt();
  const notify = useNotify();
  const locked = !!gate.sh_locked_at;
  const isAdmin = gate.can_sh_unlock;

  // 11-Jun · Editor open/close — driven by explicit user action only.
  // Defaults to false on every mount; previously a useEffect re-opened
  // the editor on tab return because validation was still revised /
  // partially_confirmed from a prior session. Now the editor opens
  // when the CSM picks Revised / Partially in the seg-control (see
  // onChange below) or clicks the "Edit again" link. Closes after a
  // successful Save.
  const [editorOpen, setEditorOpen] = useState(false);

  // Patch the Solutioning row for the sh_* edits (the existing PATCH
  // /accounts/:id/solutioning accepts sh_* fields).
  // 11-Jun · Optimistic update so the validation seg-control + every
  // other patch feels instant. Cache is mutated synchronously before
  // the network round-trip; on error we roll back to the prior data
  // snapshot. Final invalidate runs on settle so the server's
  // authoritative response (e.g. revision-history append) lands.
  const patchSol = useMutation({
    mutationFn: (body: SolutioningUpdate) =>
      api.patch<Solutioning>(`/api/v1/accounts/${account.id}/solutioning`, body),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: ["solutioning", account.id] });
      const prev = qc.getQueryData<Solutioning>(["solutioning", account.id]);
      if (prev) {
        // Body's optional/null fields are assignment-compatible with
        // the cached Solutioning shape only after spread merging — the
        // type system can't infer that, so we cast. Runtime correctness
        // matters here, not the surface type: any nulls are exactly
        // what the user just typed and the server will reflect back on
        // settle.
        qc.setQueryData<Solutioning>(
          ["solutioning", account.id],
          { ...prev, ...body } as Solutioning,
        );
      }
      return { prev };
    },
    onError: (e: ApiError, _body, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData(["solutioning", account.id], ctx.prev);
      }
      notify({ title: "Save failed", body: e.message, tone: "error" });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["solutioning", account.id] });
    },
  });

  const shLock = useMutation({
    mutationFn: () =>
      api.post<SigningGate>(`/api/v1/accounts/${account.id}/sh-lock`, {}),
    onSuccess: () => {
      onMutate();
      notify({ title: "Sales Handoff locked for onboarding", tone: "success" });
    },
    onError: (e: ApiError) =>
      notify({ title: "Lock failed", body: e.message, tone: "error" }),
  });
  const shUnlock = useMutation({
    mutationFn: (reason: string) =>
      api.post<SigningGate>(`/api/v1/accounts/${account.id}/sh-unlock`, { reason }),
    onSuccess: () => {
      onMutate();
      notify({ title: "Sales Handoff unlocked", tone: "info" });
    },
    onError: (e: ApiError) =>
      notify({ title: "Unlock failed", body: e.message, tone: "error" }),
  });

  const spoc = contacts.find((c) => c.is_spoc) ?? null;
  const budgetOwner =
    contacts.find((c) => !c.is_spoc && (c.is_sponsor || c.decision_power === "executive_sponsor")) ?? null;
  const powerUsers = contacts.filter(
    (c) => !c.is_spoc && !c.is_sponsor && c.decision_power !== "executive_sponsor",
  ).slice(0, 5);

  // 11-Jun · Read the LIVE value_definition from Solutioning (was
  // sh_value_from_solutioning, the frozen snapshot). Sales sees
  // whatever's currently in Solutioning — including edits made via
  // the revision-history Restore button on the Solutioning tab.
  const vfsLead = (solutioning?.value_definition ?? "").trim();
  const themes = (solutioning?.value_themes ?? []).map((t) => t.trim()).filter(Boolean);

  // Sales validation seg-control state. The schema uses snake_case
  // values; surface the title-cased labels via SH_VALIDATION_LABELS.
  const validationKeys: ShValidation[] = ["confirmed", "partially_confirmed", "revised"];
  const validationLabels = validationKeys.map((k) => SH_VALIDATION_LABELS[k]);

  // Ready-check rollup.
  // 11-Jun · "Revised" now counts as validated too. Sales reviewed
  // the value definition AND wrote new content for it — that's
  // explicit validation, just with edits. Previously only
  // confirmed / partially_confirmed ticked this check, which left
  // the lock blocked after a legitimate Sales-revision flow.
  const checks: Array<[string, boolean]> = [
    ["Value definition validated",
      solutioning?.sh_value_validation === "confirmed" ||
      solutioning?.sh_value_validation === "partially_confirmed" ||
      solutioning?.sh_value_validation === "revised"],
    ["Watch-outs & risks captured", !!solutioning?.sales_watchouts?.trim()],
    ["SPOC named", !!spoc],
    ["Budget Owner named", !!budgetOwner],
    ["≥1 Power User added", powerUsers.length > 0],
    ["≥1 Contract document uploaded", contractDocs.length > 0],
  ];
  const allOk = checks.every(([, ok]) => ok);

  async function onLock() {
    if (!allOk) return;
    const ok = await confirm({
      title: "Lock Sales Handoff for Onboarding?",
      body: "Contract Operations will audit the deal next. Sales-side fields become read-only until an admin unlocks.",
      confirmLabel: "Lock & hand off",
      tone: "info",
    });
    if (ok) shLock.mutate();
  }
  async function onUnlock() {
    const reason = await promptDlg({
      title: "Unlock the Sales Handoff?",
      body: "Provide a reason — it's recorded in the audit log. Minimum 10 characters.",
      placeholder: "e.g. Sales needs to add a new power user before audit.",
      minLength: 10,
      maxLength: 600,
      multiline: true,
      confirmLabel: "Unlock",
      tone: "warning",
    });
    if (reason && reason.trim().length >= 10) shUnlock.mutate(reason.trim());
  }

  return (
    <Card opaqueWhenLocked={locked}>
      <SectionHead
        n="A"
        color={C.PURPLE}
        title="Sales Handoff"
        tooltip="Sales captures the value-definition validation, client stakeholders, watch-outs/risks, and supporting contract docs. Lock to hand off to Contract Operations for audit."
        teamLabel="Sales"
        teamColor={C.PURPLE}
        trailing={locked ? (
          <span
            className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={{ background: "#d4f5e5", color: "#146a45" }}
          >
            🔒 Locked · {fd(gate.sh_locked_at)}
          </span>
        ) : undefined}
      />
      {locked && (
        <div className="text-[11px] text-text-muted mb-2.5">
          Locked for onboarding on {fd(gate.sh_locked_at)} by {gate.sh_locked_by_name ?? "—"}. Fields read-only.
        </div>
      )}

      {/* Value Definition Validation */}
      <GroupHead>Value Definition Validation</GroupHead>
      <div
        className="border rounded-[8px] px-3.5 py-3 mb-2.5"
        style={{ background: "#f3f0ff", borderColor: "#d0c5f5" }}
      >
        <div className="text-[10px] font-semibold mb-1" style={{ color: C.BLUE }}>
          Received from Solutioning · {fd(solutioning?.sh_value_received_at)}
        </div>
        {vfsLead && (
          <div className="text-[12px] leading-[1.6]" style={{ color: "#2d1870" }}>{vfsLead}</div>
        )}
        {themes.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {themes.map((t) => (
              <span
                key={t}
                className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
                style={{ background: "#ede6ff", color: "#3800CC" }}
              >
                {t}
              </span>
            ))}
          </div>
        )}
        {!vfsLead && themes.length === 0 && (
          <div className="text-[11px] text-text-muted italic">
            No value definition handed over from Solutioning yet.
          </div>
        )}
      </div>
      <Field label="Sales Validation">
        <SegControl
          options={validationLabels}
          value={
            solutioning?.sh_value_validation
              ? SH_VALIDATION_LABELS[solutioning.sh_value_validation]
              : null
          }
          disabled={locked}
          onChange={(label) => {
            const key = validationKeys.find((k) => SH_VALIDATION_LABELS[k] === label) ?? null;
            patchSol.mutate({ sh_value_validation: key });
            // 11-Jun · Open the editor only when the user explicitly
            // selects a "needs edit" validation. Confirmed → close.
            // This is the only auto-open path; tab return no longer
            // triggers it.
            setEditorOpen(key === "revised" || key === "partially_confirmed");
          }}
        />
      </Field>

      {/* 11-Jun · Sales edits value_definition (revised OR
          partially_confirmed). Local draft state + explicit Save
          button so the CSM commits intentionally (was onBlur, which
          some testers missed entirely). Save writes to the LIVE
          solutioning.value_definition; the PATCH route appends a
          source='user' entry to value_definition_history. */}
      {(solutioning?.sh_value_validation === "revised" ||
        solutioning?.sh_value_validation === "partially_confirmed") && (
        editorOpen ? (
          <ValueDefEditor
            locked={locked}
            current={solutioning?.value_definition ?? ""}
            saving={patchSol.isPending}
            onSave={(v) =>
              patchSol.mutate(
                { value_definition: v.trim() || null },
                {
                  // Collapse the editor after a successful Save. The
                  // upper "Value Definition Validation" card already
                  // reads the live value_definition, so the new text
                  // surfaces there automatically.
                  onSuccess: () => setEditorOpen(false),
                },
              )
            }
          />
        ) : (
          <div className="mt-1 mb-2">
            <button
              type="button"
              onClick={() => setEditorOpen(true)}
              disabled={locked}
              className="text-[11px] font-semibold text-beroe-blue underline disabled:opacity-40"
            >
              ✏️ Edit value definition again
            </button>
          </div>
        )
      )}
      <Field label="Sales Validation Notes">
        <TextArea
          value={solutioning?.sh_validation_notes ?? ""}
          disabled={locked}
          onBlur={(v) =>
            v !== (solutioning?.sh_validation_notes ?? "") &&
            patchSol.mutate({ sh_validation_notes: v.trim() || null })
          }
        />
      </Field>

      {/* Client Stakeholders */}
      <GroupHead>Client Stakeholders</GroupHead>
      <ClientStakeholdersRoster
        accountId={account.id}
        spoc={spoc}
        budgetOwner={budgetOwner}
        powerUsers={powerUsers}
        locked={locked}
        onMutate={onMutate}
      />

      {/* Engagement Timeline */}
      <GroupHead>Engagement Timeline</GroupHead>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-2.5">
        <Field label="Go-Live / Kickoff Date">
          <Input
            type="date"
            value={solutioning?.sh_go_live_date ?? ""}
            disabled={locked}
            onBlur={(v) =>
              v !== (solutioning?.sh_go_live_date ?? "") &&
              patchSol.mutate({ sh_go_live_date: v || null })
            }
          />
        </Field>
        <Field label="First Checkpoint">
          <Select
            value={solutioning?.sh_first_checkpoint ?? ""}
            disabled={locked}
            onChange={(v) => patchSol.mutate({ sh_first_checkpoint: v || null })}
          >
            <option value="">--</option>
            {FIRST_CP_OPTIONS.map((o) => <option key={o}>{o}</option>)}
          </Select>
        </Field>
      </div>
      <Field label="Commercial Context">
        <TextArea
          value={solutioning?.sh_commercial_context ?? ""}
          disabled={locked}
          onBlur={(v) =>
            v !== (solutioning?.sh_commercial_context ?? "") &&
            patchSol.mutate({ sh_commercial_context: v.trim() || null })
          }
        />
      </Field>
      <Field label="Watch-outs & Risks">
        <TextArea
          value={solutioning?.sales_watchouts ?? ""}
          disabled={locked}
          onBlur={(v) =>
            v !== (solutioning?.sales_watchouts ?? "") &&
            patchSol.mutate({ sales_watchouts: v.trim() || null })
          }
        />
      </Field>

      {/* Contract Documents — 08-Jun · swapped from the bespoke
          ContractDocsList to KindUploadCard so this section matches
          the MoM / VPD upload UX (drag-drop, AI status pill, summary,
          AI-assisted badge) and rides on KindUploadCard's built-in
          contract auto-apply that stashes handoff_extracted_fields
          into the localStorage draft → the drain() effect above
          consumes it → Contract Audit fields populate. */}
      <GroupHead>Contract Documents</GroupHead>
      <KindUploadCard
        accountId={account.id}
        kind="contract"
        title="Signed Contract"
        description="Upload the signed contract (MSA or Signed Proposal). AI reads it and auto-populates the Contract Audit fields below — signed date, term, ACV, modules, tier, segment, subscribers, plus payment terms and other contract clauses when present. Review and adjust anything that's off."
        emptyHint="No contracts yet. Drag a .pdf, .docx or .txt onto the card above."
      />

      {/* Lock CTA */}
      {!locked && gate.can_sh_lock && (
        <div className="mt-4 pt-3.5 border-t border-beroe-card-border">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mb-2.5">
            {checks.map(([label, ok]) => (
              <div
                key={label}
                className="flex items-center gap-1.5 px-2 py-1 rounded-[6px] text-[11px]"
                style={{
                  background: ok ? "#f0fdf4" : "#fff0f2",
                  color: ok ? "#2fb87a" : "#e63950",
                }}
              >
                <span>{ok ? "✓" : "✗"}</span> {label}
              </div>
            ))}
          </div>
          <button
            type="button"
            disabled={!allOk || shLock.isPending}
            onClick={onLock}
            className="w-full px-4 py-3.5 rounded-[12px] text-white text-left flex items-center gap-3.5 disabled:opacity-40 disabled:cursor-not-allowed transition"
            style={{
              background: allOk
                ? `linear-gradient(135deg,${C.BLUE},#3800CC)`
                : "linear-gradient(135deg,#94a3b8,#64748b)",
            }}
          >
            <span className="text-[22px]">🔒</span>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-bold">Lock Sales Handoff for Onboarding</div>
              <div className="text-[11px] opacity-90 leading-[1.4]">
                {allOk
                  ? "All checks passed. Once locked, Contract Operations will audit the deal."
                  : "Complete the checks above to enable locking."}
              </div>
            </div>
            <span className="text-[18px]">→</span>
          </button>
        </div>
      )}
      {locked && isAdmin && (
        <div className="mt-3">
          <button
            type="button"
            onClick={onUnlock}
            disabled={shUnlock.isPending}
            className="px-3 py-1.5 rounded-[8px] text-[11px] font-semibold border bg-white text-beroe-amber"
            style={{ borderColor: `${C.AMBER}50` }}
          >
            🔓 Unlock for edits (admin)
          </button>
        </div>
      )}
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────
// Client stakeholders roster — SPOC + Budget Owner + 5 power users
// ─────────────────────────────────────────────────────────────
function ClientStakeholdersRoster({
  accountId,
  spoc,
  budgetOwner,
  powerUsers,
  locked,
  onMutate,
}: {
  accountId: string;
  spoc: ContactRow | null;
  budgetOwner: ContactRow | null;
  powerUsers: ContactRow[];
  locked: boolean;
  onMutate: () => void;
}) {
  // Inline-edit each row's name/title/email + add/remove via the
  // existing /contacts endpoints.
  const qc = useQueryClient();
  const notify = useNotify();

  const patchContact = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<ContactRow> }) =>
      api.patch(`/api/v1/contacts/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contacts", accountId] }),
    onError: (e: ApiError) =>
      notify({ title: "Save failed", body: e.message, tone: "error" }),
  });
  const createContact = useMutation({
    mutationFn: (body: { name: string; title?: string | null; is_spoc?: boolean; is_sponsor?: boolean }) =>
      api.post(`/api/v1/accounts/${accountId}/contacts`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts", accountId] });
      onMutate();
    },
    onError: (e: ApiError) =>
      notify({ title: "Add failed", body: e.message, tone: "error" }),
  });
  const deleteContact = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/contacts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["contacts", accountId] }),
  });

  return (
    <>
      {/* 09-Jun bug — RoleRow used to be defined INSIDE this component's
          body, which gave it a fresh function identity on every parent
          re-render. React then unmounted + remounted each row on every
          keystroke, losing input focus and discarding the typed value
          before blur could fire. Tester saw: SPOC text "wouldn't come",
          Budget Owner row stuck on blank Title / Email fields. RoleRow
          is now hoisted to module scope — see below. */}
      <RoleRow
        label="Primary Contact (SPOC / Gatekeeper)"
        c={spoc}
        role="spoc"
        locked={locked}
        onPatch={(id, body) => patchContact.mutate({ id, body })}
        onCreate={(body) => createContact.mutate(body)}
      />
      <RoleRow
        label="Budget Owner"
        c={budgetOwner}
        role="budget_owner"
        locked={locked}
        onPatch={(id, body) => patchContact.mutate({ id, body })}
        onCreate={(body) => createContact.mutate(body)}
      />
      <div className="mt-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
            Power Users to Track{" "}
            <span className="font-medium normal-case tracking-normal">(max 5 · adoption metrics)</span>
          </span>
          <span className="text-[10px] font-semibold text-text-muted">
            {powerUsers.filter((u) => u.name).length}/5
          </span>
        </div>
        {powerUsers.map((u) => (
          <PowerUserRow
            key={u.id}
            user={u}
            locked={locked}
            onPatch={(body) => patchContact.mutate({ id: u.id, body })}
            onRemove={() => deleteContact.mutate(u.id)}
          />
        ))}
        {!locked && powerUsers.length < 5 && (
          <button
            type="button"
            onClick={() => {
              const name = window.prompt("Power user name (min 3 chars):");
              if (name && name.trim().length >= 3) {
                createContact.mutate({ name: name.trim() });
              }
            }}
            className="text-[11px] px-2.5 py-1 rounded-[6px] font-semibold mt-1"
            style={{ background: "#ede6ff", color: C.BLUE, border: "1px solid #c9b5ff" }}
          >
            + Add power user ({powerUsers.length}/5)
          </button>
        )}
      </div>
    </>
  );
}

// 09-Jun bug — hoisted from inside ClientStakeholdersRoster. Defining
// this as a nested function gave it a new identity on every parent
// render, which made React unmount the input on every keystroke and
// drop typed text. Module-level definition keeps the component
// reference stable so the local Name / Title / Email state survives.
function RoleRow({
  label,
  c,
  role,
  locked,
  onPatch,
  onCreate,
}: {
  label: string;
  c: ContactRow | null;
  role: "spoc" | "budget_owner";
  locked: boolean;
  onPatch: (id: string, body: Partial<ContactRow>) => void;
  onCreate: (body: {
    name: string;
    title?: string | null;
    email?: string | null;
    is_spoc?: boolean;
    is_sponsor?: boolean;
  }) => void;
}) {
  const [name, setName] = useState(c?.name ?? "");
  const [title, setTitle] = useState(c?.title ?? "");
  const [email, setEmail] = useState(c?.email ?? "");
  useEffect(() => {
    setName(c?.name ?? "");
    setTitle(c?.title ?? "");
    setEmail(c?.email ?? "");
  }, [c]);

  const flagBody =
    role === "spoc" ? { is_spoc: true } : { is_sponsor: true };

  function saveRow() {
    if (c) {
      const body: Partial<ContactRow> = {};
      if (name !== (c.name ?? "")) body.name = name;
      if (title !== (c.title ?? "")) body.title = title;
      if (email !== (c.email ?? "")) body.email = email;
      if (Object.keys(body).length > 0) onPatch(c.id, body);
    } else if (name.trim().length >= 3) {
      onCreate({
        name: name.trim(),
        title: title.trim() || null,
        email: email.trim() || null,
        ...flagBody,
      });
    }
  }

  return (
    <div className="mb-2.5">
      <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">
        {label}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[1.4fr_1fr_1.2fr] gap-2">
        <Input
          value={name}
          disabled={locked}
          onChange={setName}
          onBlur={saveRow}
          placeholder="Name"
        />
        <Input
          value={title}
          disabled={locked}
          onChange={setTitle}
          onBlur={saveRow}
          placeholder="Title"
        />
        <Input
          type="email"
          value={email}
          disabled={locked}
          onChange={setEmail}
          onBlur={saveRow}
          placeholder="Email"
        />
      </div>
    </div>
  );
}

function PowerUserRow({
  user, locked, onPatch, onRemove,
}: {
  user: ContactRow;
  locked: boolean;
  onPatch: (body: Partial<ContactRow>) => void;
  onRemove: () => void;
}) {
  const [name, setName] = useState(user.name);
  const [title, setTitle] = useState(user.title ?? "");
  useEffect(() => { setName(user.name); setTitle(user.title ?? ""); }, [user]);

  function save() {
    const body: Partial<ContactRow> = {};
    if (name !== user.name) body.name = name;
    if (title !== (user.title ?? "")) body.title = title;
    if (Object.keys(body).length > 0) onPatch(body);
  }

  return (
    <div
      className="grid grid-cols-[24px_1fr_1fr_30px] gap-2 items-center px-2.5 py-1.5 bg-white border border-beroe-card-border rounded-[7px] mb-1"
    >
      <div
        className="w-6 h-6 rounded-full inline-flex items-center justify-center text-[10px] font-extrabold"
        style={{ background: `${C.PURPLE}25`, color: C.PURPLE, border: `1.5px solid ${C.PURPLE}` }}
      >
        {initials(name)}
      </div>
      <Input value={name} disabled={locked} onChange={setName} onBlur={save} placeholder="Name" />
      <Input value={title} disabled={locked} onChange={setTitle} onBlur={save} placeholder="Title" />
      {locked ? <span /> : (
        <button
          type="button"
          onClick={onRemove}
          className="text-[14px] text-text-muted hover:text-beroe-red"
          aria-label="Remove power user"
        >
          ×
        </button>
      )}
    </div>
  );
}


// ─────────────────────────────────────────────────────────────
// Section B — Contract Audit (amber card)
// 08-Jun · React.memo'd so it doesn't re-render every time the
// parent SalesHandoffTab refetches a sibling query (in particular
// the document-polling that KindUploadCard fires every 1.5s while
// an upload is processing — that was forcing ~20 inputs to re-render
// per tick and caused typing lag).
// ─────────────────────────────────────────────────────────────
const ContractAuditSection = memo(function ContractAuditSection({
  account,
  gate,
  onMutate,
}: {
  account: ReturnType<typeof useAccountFromLayout>;
  gate: SigningGate;
  onMutate: () => void;
}) {
  const notify = useNotify();
  const confirm = useConfirm();
  const promptDlg = usePrompt();
  const qc = useQueryClient();
  const locked = gate.gate_signed && !gate.gate_unlocked;
  const showCard = !!gate.sh_locked_at; // Section B unlocks once Sales locks.
  const audited_at = (gate.gate_contract_extras as { audited_at?: string } | undefined)?.audited_at
    ?? gate.gate_confirmed_at;
  const audited_by =
    (gate.gate_contract_extras as { audited_by?: string } | undefined)?.audited_by
    ?? gate.gate_confirmed_by_name
    ?? "—";

  const patchExtras = useMutation({
    mutationFn: (extras: Record<string, unknown>) =>
      api.patch<SigningGate>(`/api/v1/accounts/${account.id}/contract-extras`, { extras }),
    // 08-Jun · Cache-write the response instead of the broad invalidateAll
    // (solutioning + contacts + documents + account aren't affected by
    // an extras edit). Removes ~600ms of waterfall per blur.
    onSuccess: (fresh) =>
      qc.setQueryData(["signing-gate", account.id], fresh),
    onError: (e: ApiError) =>
      notify({ title: "Save failed", body: e.message, tone: "error" }),
  });
  const patchSignMeta = useMutation({
    // PATCH /api/v1/accounts/:id — for the typed gate_* fields (acv, term, dates, modules, tier, segment).
    mutationFn: (body: Record<string, unknown>) =>
      api.patch(`/api/v1/accounts/${account.id}`, body),
    // 09-Jun bug (Bug Tracker · Jun-8 #4) — patch was non-optimistic, so
    // after filling Signed date / Contract term / ACV the user saw red X
    // on the Contract Audit checklist for ~300-600ms until the refetch
    // landed. They could (and did) hit "Complete Audit" while the cache
    // still had the OLD null values and the checklist was still red. Now
    // we flip the cache instantly in onMutate so the checklist responds
    // in the same tick. The refetch on onSuccess re-syncs with server.
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: ["signing-gate", account.id] });
      const prev = qc.getQueryData<SigningGate>([
        "signing-gate",
        account.id,
      ]);
      qc.setQueryData<SigningGate>(["signing-gate", account.id], (g) =>
        g ? { ...g, ...(body as Partial<SigningGate>) } : g,
      );
      return { prev };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["signing-gate", account.id] });
      qc.invalidateQueries({ queryKey: ["account", account.id] });
    },
    onError: (e: ApiError, _body, ctx) => {
      if (ctx?.prev) {
        qc.setQueryData(["signing-gate", account.id], ctx.prev);
      }
      notify({ title: "Save failed", body: e.message, tone: "error" });
    },
  });

  // 05-Jun — Auto-apply contract-extraction draft. When a contract doc is
  // uploaded, the worker writes the extracted fields to documents.handoff_
  // extracted_fields. KindUploadCard polls the table, sees the column land,
  // and stashes the slice in localStorage. This effect picks the slice up
  // on mount (or via EXTRACTION_APPLIED_EVENT if the tab is already open)
  // and PATCHes ONLY the fields the account doesn't already have set —
  // so manual edits aren't overwritten.
  useEffect(() => {
    if (locked) return;
    let cancelled = false;

    const drain = () => {
      const slice = consumeHandoffSlice(account.id);
      if (!slice || cancelled) return;
      applyHandoffSlice({
        slice,
        gate,
        extras: (gate.gate_contract_extras ?? {}) as Record<string, unknown>,
        patchGate: (body) => patchSignMeta.mutate(body),
        patchExtras: (body) => patchExtras.mutate(body),
        onApplied: (count) =>
          count > 0 &&
          notify({
            title: "Contract Audit fields auto-populated",
            body: `${count} field${count === 1 ? "" : "s"} filled from the contract upload. Review and adjust as needed.`,
            tone: "success",
          }),
      });
    };

    drain();
    const onEvt = (e: Event) => {
      const detail = (e as CustomEvent).detail as { accountId?: string } | undefined;
      if (detail?.accountId === account.id) drain();
    };
    window.addEventListener(EXTRACTION_APPLIED_EVENT, onEvt);
    return () => {
      cancelled = true;
      window.removeEventListener(EXTRACTION_APPLIED_EVENT, onEvt);
    };
    // We intentionally read gate at effect-fire time — re-running on every
    // gate change would re-replay the slice. Effect re-fires only when the
    // account or lock state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id, locked]);
  // 08-Jun · Module-configs PATCH is fired in parallel with patchSignMeta
  // when toggleModule un-ticks a module. The module-configs handler
  // returns SigningGate including the CURRENT server gate_contract_modules,
  // which still has the un-ticked module if patchSignMeta hasn't been
  // applied yet (races at the backend). Writing that stale response into
  // cache via setQueryData re-added the un-ticked module. Invalidating
  // instead defers truth to the authoritative refetch — slower by one
  // round-trip but never reverts the optimistic un-tick.
  const patchModuleConfigs = useMutation({
    mutationFn: (configs: Record<string, Record<string, unknown>>) =>
      api.patch<SigningGate>(`/api/v1/accounts/${account.id}/module-configs`, { configs }),
    // 08-Jun · Optimistic update — checkbox / radio / select selections
    // were waiting ~3s for the network round-trip before reflecting in
    // the UI. onMutate writes the merged configs into the cache before
    // the request goes out so the chip ticks immediately. Rollback on
    // error so a failed save reverts the UI.
    onMutate: async (configs) => {
      await qc.cancelQueries({ queryKey: ["signing-gate", account.id] });
      const prev = qc.getQueryData<SigningGate>(["signing-gate", account.id]);
      qc.setQueryData<SigningGate>(["signing-gate", account.id], (g) =>
        g
          ? {
              ...g,
              gate_module_configs: {
                ...(g.gate_module_configs ?? {}),
                ...Object.fromEntries(
                  Object.entries(configs).map(([k, v]) => [
                    k,
                    { ...((g.gate_module_configs ?? {})[k] ?? {}), ...v },
                  ]),
                ),
              },
            }
          : g,
      );
      return { prev };
    },
    onError: (e: ApiError, _vars, ctx) => {
      // Roll the cache back so the UI matches the actual server state.
      if (ctx && (ctx as { prev?: SigningGate }).prev) {
        qc.setQueryData(["signing-gate", account.id], (ctx as { prev: SigningGate }).prev);
      }
      notify({ title: "Save failed", body: e.message, tone: "error" });
    },
    onSettled: () =>
      qc.invalidateQueries({ queryKey: ["signing-gate", account.id] }),
  });

  const signMutation = useMutation({
    mutationFn: (body: SignAccountBody) =>
      api.post<SigningGate>(`/api/v1/accounts/${account.id}/sign`, body),
    onSuccess: () => {
      onMutate();
      notify({ title: "Audited & handed off to CS", tone: "success" });
    },
    onError: (e: ApiError) =>
      notify({ title: "Audit failed", body: e.message, tone: "error" }),
  });
  const unlockMutation = useMutation({
    mutationFn: (reason: string) =>
      api.post<SigningGate>(`/api/v1/accounts/${account.id}/sign/unlock`, { reason }),
    onSuccess: () => {
      onMutate();
      notify({ title: "Audit unlocked", tone: "info" });
    },
    onError: (e: ApiError) =>
      notify({ title: "Unlock failed", body: e.message, tone: "error" }),
  });

  if (!showCard) return null;

  const extras = gate.gate_contract_extras ?? {};
  const cfgs = gate.gate_module_configs ?? {};
  const acvNum = parseFloat(String(gate.gate_contract_acv ?? "")) || 0;
  const yrs = yearsFromTerm(gate.gate_contract_term) ?? 0;
  const autoTcv = yrs * acvNum;

  // 09-Jun bug — accounts can have STALE / PHANTOM entries in
  // gate_contract_modules: names that no longer match any in
  // ALL_MODULES (renamed modules, hand-imported data, old test
  // rows). Those phantoms aren't rendered as chips (chip strip
  // iterates ALL_MODULES) so the user can't uncheck them — but
  // they DO count toward modules.length and the "All module
  // configs filled" check, which then can never go green.
  //
  // Fix: derive `validModules` (= modules ∩ ALL_MODULES) and use
  // that for every count + completeness check. Phantoms stay in
  // the DB until the user next toggles a module, at which point
  // toggleModule's rebuild prunes them (see below).
  const ALL_MODULE_SET = new Set<string>(ALL_MODULES);
  const rawModules = gate.gate_contract_modules ?? [];
  const modules = rawModules.filter((m) => ALL_MODULE_SET.has(m));
  const allConfigsFilled = modules.every(
    (m) => moduleConfigStatus(m, cfgs[m] as Record<string, unknown>).status === "complete",
  );

  // Defaults shown in the dropdowns but only persisted after the user
  // either picks them OR clicks Complete Audit (the onCompleteAudit
  // handler eager-PATCHes any unset defaults before /sign fires).
  const effectiveBilling = (extras.billing_freq as string | undefined) ?? "Annual";
  const effectivePayment = (extras.payment_terms as string | undefined) ?? "Net 30";
  const effectiveGeography = (extras.geography as string | undefined) ?? "Global";

  const checks: Array<[string, boolean]> = [
    ["Signed date", !!gate.gate_signed_date],
    ["Contract term", !!gate.gate_contract_term],
    ["ACV", !!gate.gate_contract_acv],
    ["Billing frequency", !!effectiveBilling],
    ["Payment terms", !!effectivePayment],
    ["≥1 module contracted", modules.length > 0],
    ["All module configs filled", modules.length > 0 && allConfigsFilled],
    ["Geography defined", !!effectiveGeography],
  ];
  const allOk = checks.every(([, ok]) => ok);

  async function onCompleteAudit() {
    if (!allOk) return;
    const ok = await confirm({
      title: "Complete audit & hand off to CS?",
      body: "Locks the audit. CS team will be notified and the account moves into the CS workflow.",
      confirmLabel: "Complete & hand off",
      tone: "success",
    });
    if (!ok) return;
    // Persist any dropdown defaults the user didn't explicitly touch
    // so the saved audit record matches what was on screen.
    const pendingExtras: Record<string, unknown> = {};
    if (!extras.billing_freq)   pendingExtras.billing_freq   = effectiveBilling;
    if (!extras.payment_terms)  pendingExtras.payment_terms  = effectivePayment;
    if (!extras.geography)      pendingExtras.geography      = effectiveGeography;
    if (Object.keys(pendingExtras).length > 0) {
      try {
        await patchExtras.mutateAsync(pendingExtras);
      } catch {
        // Toast already raised by the mutation's onError; bail.
        return;
      }
    }
    signMutation.mutate({
      gate_signed_date: gate.gate_signed_date ?? new Date().toISOString().slice(0, 10),
      gate_contract_acv: gate.gate_contract_acv ?? 0,
      gate_contract_term: gate.gate_contract_term ?? "1 year",
      gate_contract_modules: gate.gate_contract_modules,
      gate_platform_tier: gate.gate_platform_tier,
      gate_account_segment: gate.gate_account_segment,
      gate_subscribers: gate.gate_subscribers,
    });
  }

  async function onUnlock() {
    const reason = await promptDlg({
      title: "Unlock the contract audit?",
      body: "Reason is recorded in the audit log. Minimum 10 characters.",
      placeholder: "e.g. Customer requested addendum; re-audit on Friday.",
      minLength: 10,
      maxLength: 600,
      multiline: true,
      confirmLabel: "Unlock",
      tone: "warning",
    });
    if (reason && reason.trim().length >= 10) unlockMutation.mutate(reason.trim());
  }

  function toggleModule(m: ModuleName) {
    const next = modules.includes(m) ? modules.filter((x) => x !== m) : [...modules, m];
    // 08-Jun · Optimistic update — flip the chip in the signing-gate
    // cache immediately so the UI responds in the same tick. Without
    // this the chip waited ~600ms for two sequential PATCHes + their
    // refetches before re-rendering. The mutations below still fire
    // and the server response replaces the cache on success.
    qc.setQueryData<SigningGate>(["signing-gate", account.id], (prev) =>
      prev ? { ...prev, gate_contract_modules: next } : prev,
    );
    patchSignMeta.mutate({ gate_contract_modules: next });
    if (modules.includes(m)) {
      // Clear that module's config too.
      const cleared = { ...cfgs };
      delete cleared[m];
      patchModuleConfigs.mutate({ [m]: {} });
    } else if (!cfgs[m]) {
      patchModuleConfigs.mutate({ [m]: {} });
    }
  }

  return (
    <Card leftBorderColor={C.AMBER}>
      <SectionHead
        n="B"
        color={C.AMBER}
        title="Contract Audit"
        tooltip="Contract Operations — verify every field against the executed contract document. Capture per-module config so analytics can later answer 'how many accounts have X, configured how.' Once complete, click Complete Audit & Hand off to CS."
        teamLabel="Contract Ops"
        teamColor={C.AMBER}
        trailing={
          locked ? (
            <span
              className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full"
              style={{ background: "#d4f5e5", color: "#146a45" }}
            >
              🔒 Audited · {fd(audited_at)}
            </span>
          ) : (
            <span
              className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full"
              style={{ background: "#fff3e0", color: "#b85b00" }}
            >
              In progress
            </span>
          )
        }
      />
      {locked && (
        <div className="text-[11px] text-text-muted mb-2.5">
          Audited by {audited_by} on {fd(audited_at)}. Fields read-only.
        </div>
      )}

      {/* Contract Dates */}
      <GroupHead>Contract Dates</GroupHead>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-2.5">
        <Field label="Signed Date">
          <Input
            type="date"
            value={gate.gate_signed_date ?? ""}
            disabled={locked}
            onBlur={(v) => v !== (gate.gate_signed_date ?? "") &&
              patchSignMeta.mutate({ gate_signed_date: v || null })}
          />
        </Field>
        <Field label="Contract Term">
          <Select
            value={gate.gate_contract_term ?? ""}
            disabled={locked}
            onChange={(v) => patchSignMeta.mutate({ gate_contract_term: v || null })}
          >
            <option value="">--</option>
            {["1 year","2 years","3 years","4 years","5 years","Custom"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </Select>
        </Field>
        <Field label="Renewal Date">
          <Input
            type="date"
            value={gate.gate_renewal_date ?? ""}
            disabled={locked}
            onBlur={(v) => v !== (gate.gate_renewal_date ?? "") &&
              patchSignMeta.mutate({ gate_renewal_date: v || null })}
          />
        </Field>
      </div>

      {/* Commercial Terms */}
      <GroupHead>Commercial Terms</GroupHead>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-2.5">
        <Field label="ACV (USD)">
          <Input
            type="number"
            value={gate.gate_contract_acv != null ? String(gate.gate_contract_acv) : ""}
            disabled={locked}
            placeholder="310000"
            onBlur={(v) => v !== String(gate.gate_contract_acv ?? "") &&
              patchSignMeta.mutate({ gate_contract_acv: v ? parseFloat(v) : null })}
          />
        </Field>
        <Field label="TCV (auto: ACV × years)">
          <Input
            type="number"
            value={(extras.tcv as string | undefined) ?? (autoTcv ? String(autoTcv) : "")}
            disabled={locked}
            placeholder={autoTcv ? String(autoTcv) : "—"}
            onBlur={(v) => v !== ((extras.tcv as string | undefined) ?? "") &&
              patchExtras.mutate({ tcv: v || null })}
          />
          {autoTcv > 0 && !extras.tcv && (
            <div className="text-[10px] text-text-muted mt-0.5">
              Auto = ${autoTcv.toLocaleString("en-US")}. Override if needed.
            </div>
          )}
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-2.5">
        <Field label="Billing Frequency">
          <Select
            value={(extras.billing_freq as string | undefined) ?? "Annual"}
            disabled={locked}
            onChange={(v) => patchExtras.mutate({ billing_freq: v })}
          >
            {BILLING_FREQ_OPTIONS.map((f) => <option key={f}>{f}</option>)}
          </Select>
        </Field>
        <Field label="Payment Terms">
          <Select
            value={(extras.payment_terms as string | undefined) ?? "Net 30"}
            disabled={locked}
            onChange={(v) => patchExtras.mutate({ payment_terms: v })}
          >
            {PAYMENT_TERM_OPTIONS.map((p) => <option key={p}>{p}</option>)}
          </Select>
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-2.5 mb-2.5">
        <Field label="Discount">
          <div className="flex items-center">
            <Input
              type="number"
              value={(extras.discount as string | undefined) ?? ""}
              disabled={locked}
              placeholder="0"
              onBlur={(v) => v !== ((extras.discount as string | undefined) ?? "") &&
                patchExtras.mutate({ discount: v || null })}
              className="rounded-r-none"
            />
            <span
              className="px-2.5 py-1.5 border border-l-0 rounded-r-[7px] text-[12px] text-text-secondary self-stretch flex items-center"
              style={{ background: C.CB, borderColor: C.CB }}
            >
              %
            </span>
          </div>
        </Field>
        <Field label="Discount Reason">
          <Input
            type="text"
            value={(extras.discount_reason as string | undefined) ?? ""}
            disabled={locked}
            placeholder="Multi-year prepay, early-signing incentive, etc."
            onBlur={(v) => v !== ((extras.discount_reason as string | undefined) ?? "") &&
              patchExtras.mutate({ discount_reason: v.trim() || null })}
          />
        </Field>
      </div>

      {/* What Was Sold — module picker + per-module config cards */}
      <GroupHead>
        What Was Sold{" "}
        <span className="font-medium text-text-muted normal-case tracking-normal">
          — tick modules, then fill each module&rsquo;s config below for analytics
        </span>
      </GroupHead>
      <ModulePicker
        modules={modules}
        cfgs={cfgs as Record<string, Record<string, unknown>>}
        disabled={locked}
        onToggle={(m) => toggleModule(m as ModuleName)}
      />
      {modules.length > 0 ? (
        <div className="mb-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1.5">
            Module Configuration{" "}
            <span className="font-medium normal-case tracking-normal">
              — {modules.filter((m) => moduleConfigStatus(m, cfgs[m] as Record<string, unknown>).status === "complete").length} of {modules.length} complete
            </span>
          </div>
          {modules.map((m) => (
            <ModuleConfigCard
              key={m}
              mod={m}
              cfg={(cfgs[m] as Record<string, unknown>) ?? {}}
              locked={locked}
              onPatch={(next) => patchModuleConfigs.mutate({ [m]: next })}
              onRemove={() => toggleModule(m as ModuleName)}
            />
          ))}
        </div>
      ) : (
        <div
          className="border border-dashed rounded-[8px] px-5 py-5 text-center text-[12px] text-text-muted mb-3"
          style={{ background: "#fafbfd", borderColor: C.CB }}
        >
          Pick at least one module above to begin configuration capture.
        </div>
      )}

      <Field label="Caveats for Modules (carry-overs, side-letter commitments)">
        <TextArea
          value={(extras.module_caveats as string | undefined) ?? ""}
          disabled={locked}
          placeholder="E.g. Custom Credits capped at 400 hrs/year. Power BI connector to be delivered within 90d of go-live."
          onBlur={(v) => v !== ((extras.module_caveats as string | undefined) ?? "") &&
            patchExtras.mutate({ module_caveats: v.trim() || null })}
        />
      </Field>
      <Field label="Notes">
        <TextArea
          value={(extras.audit_notes as string | undefined) ?? ""}
          disabled={locked}
          placeholder="Pricing protection, rate-card terms, etc."
          onBlur={(v) => v !== ((extras.audit_notes as string | undefined) ?? "") &&
            patchExtras.mutate({ audit_notes: v.trim() || null })}
        />
      </Field>
      <Field label="Geography / Region Coverage">
        <Select
          value={(extras.geography as string | undefined) ?? "Global"}
          disabled={locked}
          onChange={(v) => patchExtras.mutate({ geography: v })}
        >
          {GEO_OPTIONS.map((g) => <option key={g}>{g}</option>)}
        </Select>
      </Field>
      <Field label="Any Other Specific Term to be Noted">
        <TextArea
          value={(extras.other_terms as string | undefined) ?? ""}
          disabled={locked}
          placeholder="Exit clauses, audit rights, QBR cadence, side-letter commitments, etc."
          onBlur={(v) => v !== ((extras.other_terms as string | undefined) ?? "") &&
            patchExtras.mutate({ other_terms: v.trim() || null })}
        />
      </Field>

      {!locked && gate.can_sign && (
        <div className="mt-4 pt-3.5 border-t border-beroe-card-border">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mb-2.5">
            {checks.map(([label, ok]) => (
              <div
                key={label}
                className="flex items-center gap-1.5 px-2 py-1 rounded-[6px] text-[11px]"
                style={{
                  background: ok ? "#f0fdf4" : "#fff0f2",
                  color: ok ? "#2fb87a" : "#e63950",
                }}
              >
                <span>{ok ? "✓" : "✗"}</span> {label}
              </div>
            ))}
          </div>
          <button
            type="button"
            disabled={!allOk || signMutation.isPending}
            onClick={onCompleteAudit}
            className="w-full px-4 py-3.5 rounded-[12px] text-white text-left flex items-center gap-3.5 disabled:opacity-40 disabled:cursor-not-allowed transition"
            style={{
              background: allOk
                ? `linear-gradient(135deg,${C.AMBER},#d57400)`
                : "linear-gradient(135deg,#94a3b8,#64748b)",
            }}
          >
            <span className="text-[22px]">🔒</span>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-bold">Complete Audit & Hand off to CS</div>
              <div className="text-[11px] opacity-90 leading-[1.4]">
                {allOk
                  ? "All fields verified. CS team will be notified and the account moves into the CS workflow."
                  : "Complete all checks above. Module configs included."}
              </div>
            </div>
            <span className="text-[18px]">→</span>
          </button>
        </div>
      )}
      {locked && gate.can_unlock && (
        <div className="mt-3">
          <button
            type="button"
            onClick={onUnlock}
            disabled={unlockMutation.isPending}
            className="px-3 py-1.5 rounded-[8px] text-[11px] font-semibold border bg-white text-beroe-amber"
            style={{ borderColor: `${C.AMBER}50` }}
          >
            🔓 Unlock for corrections (admin)
          </button>
        </div>
      )}
    </Card>
  );
});

// ─────────────────────────────────────────────────────────────
// Module picker (20 chips) + per-module config card
// ─────────────────────────────────────────────────────────────
function ModulePicker({
  modules, cfgs, disabled, onToggle,
}: {
  modules: string[];
  cfgs: Record<string, Record<string, unknown>>;
  disabled: boolean;
  onToggle: (m: string) => void;
}) {
  return (
    <div
      className="flex flex-wrap gap-1.5 mb-3 p-2.5 border rounded-[9px]"
      style={{ background: "#fafbfd", borderColor: C.CB }}
    >
      {ALL_MODULES.map((m) => {
        const sel = modules.includes(m);
        const st = sel ? moduleConfigStatus(m, cfgs[m]).status : null;
        const unfilled = sel && st !== "complete";
        return (
          <button
            key={m}
            type="button"
            disabled={disabled}
            onClick={() => onToggle(m)}
            className={cn(
              "px-3 py-1 rounded-full border-[1.5px] text-[11.5px] font-medium transition inline-flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed",
              sel ? "font-bold" : "hover:border-beroe-blue/40 hover:text-beroe-blue",
            )}
            style={
              !sel
                ? { background: "#fff", borderColor: C.CB, color: C.T2 }
                : unfilled
                  ? { background: "#fff8eb", borderColor: C.AMBER, color: "#854F0B" }
                  : { background: "#ede6ff", borderColor: C.BLUE, color: "#3800CC" }
            }
          >
            {sel && (st === "complete" ? "✓" : "⚠")} {m}
          </button>
        );
      })}
    </div>
  );
}

function ModuleConfigCard({
  mod, cfg, locked, onPatch, onRemove,
}: {
  mod: string;
  cfg: Record<string, unknown>;
  locked: boolean;
  onPatch: (next: Record<string, unknown>) => void;
  onRemove: () => void;
}) {
  const spec = MODULE_CONFIG_SPECS[mod];
  if (!spec) return null;
  const st = moduleConfigStatus(mod, cfg);

  function updateField(key: string, val: unknown) {
    onPatch({ ...cfg, [key]: val });
  }
  function toggleMulti(key: string, opt: string) {
    const cur = (cfg[key] as string[] | undefined) ?? [];
    const next = cur.includes(opt) ? cur.filter((x) => x !== opt) : [...cur, opt];
    onPatch({ ...cfg, [key]: next });
  }

  return (
    <div
      className="border rounded-[9px] p-3 mb-2"
      style={{
        background: st.status === "empty" ? "#fffbf2" : "#fff",
        borderColor: C.CB,
        borderLeft: `3px solid ${st.status === "empty" ? C.AMBER : C.BLUE}`,
      }}
    >
      <div className="flex items-center gap-2 mb-2.5 pb-2 border-b border-dashed border-beroe-card-border">
        <div
          className="w-[26px] h-[26px] rounded-[6px] inline-flex items-center justify-center text-[15px]"
          style={{ background: "#f3f0ff" }}
        >
          {spec.icon}
        </div>
        <div className="text-[13px] font-bold flex-1 truncate">{mod}</div>
        <span
          className="text-[9.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
          style={
            st.status === "complete"
              ? { background: "#d4f5e5", color: "#146a45" }
              : st.status === "partial"
                ? { background: "#fef0c0", color: "#8a4510" }
                : { background: "#fff0e5", color: "#c45010" }
          }
        >
          {st.status === "complete"
            ? "✓ Complete"
            : st.status === "partial"
              ? `${st.filled}/${st.total} filled`
              : "Empty"}
        </span>
        {!locked && (
          <button
            type="button"
            onClick={onRemove}
            className="text-[10px] px-2 py-0.5 rounded-[6px] border bg-white text-text-secondary"
            style={{ borderColor: C.CB }}
            title="Remove module"
          >
            ×
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {spec.fields.map((f) => (
          <ConfigField
            key={f.key}
            field={f}
            value={cfg[f.key]}
            cfg={cfg}
            locked={locked}
            onUpdate={(v) => updateField(f.key, v)}
            onToggleMulti={(opt) => toggleMulti(f.key, opt)}
          />
        ))}
      </div>
    </div>
  );
}

function ConfigField({
  field, value, cfg, locked, onUpdate, onToggleMulti,
}: {
  field: ModuleField;
  value: unknown;
  cfg: Record<string, unknown>;
  locked: boolean;
  onUpdate: (v: unknown) => void;
  onToggleMulti: (opt: string) => void;
}) {
  if (field.showIf && !field.showIf(cfg)) return null;
  const full = field.full ? "sm:col-span-2" : "";
  const inputStyle = "w-full px-2.5 py-1.5 border rounded-[7px] text-[12px] focus:outline-none focus:border-beroe-blue disabled:bg-beroe-bg/40 disabled:cursor-not-allowed";

  // 08-Jun · Text/number fields use local state + onBlur save. Without
  // this, every keystroke fired patchModuleConfigs → invalidate →
  // refetch → input value snapped back to the in-flight server value,
  // dropping characters. Typing "12" landed as "2". Now typing is
  // purely local; the save fires only when the field loses focus.
  if (field.type === "number") {
    return (
      <div className={full}>
        <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">{field.label}</div>
        <div className="flex items-center gap-1.5">
          <DeferredInput
            type="number"
            placeholder={field.ph ?? ""}
            value={String((value as string | number | undefined) ?? "")}
            disabled={locked}
            onCommit={(v) => onUpdate(v)}
            className={inputStyle}
          />
          {field.suffix && (
            <span className="text-[11px] text-text-muted font-semibold whitespace-nowrap">{field.suffix}</span>
          )}
        </div>
      </div>
    );
  }
  if (field.type === "text") {
    return (
      <div className={full}>
        <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">{field.label}</div>
        <DeferredInput
          type="text"
          placeholder={field.ph ?? ""}
          value={(value as string | undefined) ?? ""}
          disabled={locked}
          onCommit={(v) => onUpdate(v)}
          className={inputStyle}
        />
      </div>
    );
  }
  if (field.type === "select") {
    return (
      <div className={full}>
        <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">{field.label}</div>
        <select
          value={(value as string | undefined) ?? ""}
          disabled={locked}
          onChange={(e) => onUpdate(e.target.value)}
          className={inputStyle + " bg-white"}
          style={{ borderColor: C.CB }}
        >
          <option value="">--</option>
          {field.options?.map((o) => <option key={o}>{o}</option>)}
        </select>
      </div>
    );
  }
  if (field.type === "seg") {
    return (
      <div className={full}>
        <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">{field.label}</div>
        <SegControl
          options={field.options ? [...field.options] : []}
          value={(value as string | undefined) ?? null}
          disabled={locked}
          onChange={(v) => onUpdate(v)}
        />
      </div>
    );
  }
  if (field.type === "multi") {
    const arr = (value as string[] | undefined) ?? [];
    return (
      <div className={full}>
        <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1 flex items-center">
          {field.label}
          {arr.length > 0 && (
            <span
              className="ml-1.5 text-[10px] font-semibold"
              style={{ color: C.BLUE }}
            >
              {arr.length} selected
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1 mt-0.5">
          {field.options?.map((o) => {
            const sel = arr.includes(o);
            return (
              <button
                key={o}
                type="button"
                disabled={locked}
                onClick={() => onToggleMulti(o)}
                className={cn(
                  "px-2.5 py-1 rounded-full text-[10.5px] font-semibold border transition",
                  !sel && "hover:border-beroe-blue/40 hover:text-beroe-blue",
                )}
                style={
                  sel
                    ? { background: "#ede6ff", borderColor: C.BLUE, color: C.BLUE }
                    : { background: "#fff", borderColor: C.CB, color: C.T2 }
                }
              >
                {sel ? "✓ " : ""}{o}
              </button>
            );
          })}
        </div>
      </div>
    );
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// Stage indicator + handed-off banner
// ─────────────────────────────────────────────────────────────
function StageIndicator({ gate }: { gate: SigningGate }) {
  const s1 = !!gate.sh_locked_at;
  const s2 = gate.gate_signed && !gate.gate_unlocked;
  const s3 = s2;
  return (
    <div className="flex items-center gap-1.5 mb-4 bg-white rounded-[12px] border border-beroe-card-border px-3.5 py-2.5">
      <StageStep label="Sales Handoff" sub="Sales" done={s1} current={!s1} />
      <StageConn done={s1} />
      <StageStep label="Contract Audit" sub="Contract Ops" done={s2} current={s1 && !s2} pending={!s1} />
      <StageConn done={s2} />
      <StageStep label="Handed off to CS" sub="CS lead" done={s3} pending={!s2} />
    </div>
  );
}
function StageStep({
  label, sub, done, current, pending,
}: { label: string; sub: string; done: boolean; current?: boolean; pending?: boolean }) {
  return (
    <div className="flex items-center gap-2 flex-1 min-w-0">
      <div
        className="w-6 h-6 rounded-full text-[11px] font-extrabold text-white flex items-center justify-center flex-shrink-0"
        style={{
          background: done ? C.GREEN : pending ? "#cbd5e1" : current ? C.AMBER : C.BLUE,
          boxShadow: current ? `0 0 0 4px ${C.BLUE}20` : undefined,
        }}
      >
        {done ? "✓" : "·"}
      </div>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold text-text-primary truncate">{label}</div>
        <div className="text-[9px] text-text-muted truncate">{sub}</div>
      </div>
    </div>
  );
}
function StageConn({ done }: { done: boolean }) {
  return (
    <div className="flex-1 h-[2px] max-w-[60px]" style={{ background: done ? C.GREEN : C.CB }} />
  );
}

function HandedOffBanner({
  gate, modulesCount,
}: { gate: SigningGate; modulesCount: number }) {
  // 11-Jun · Bug — the banner persisted after Unlock because we only
  // checked gate_signed. When the contract is unlocked for edits the
  // handoff is implicitly retracted; banner must disappear.
  if (!gate.gate_signed || gate.gate_unlocked) return null;
  const handedAt = gate.gate_confirmed_at;
  return (
    <div
      className="rounded-[12px] border-[1.5px] p-4 mb-3 flex items-center gap-3.5"
      style={{ background: "linear-gradient(135deg,#f0fdf4,#dcfce7)", borderColor: C.GREEN }}
    >
      <span className="text-[30px]">🤝</span>
      <div className="flex-1 min-w-0">
        <div className="text-[14px] font-bold" style={{ color: "#146a45" }}>
          Audited and handed off to CS · {fd(handedAt)}
        </div>
        <div className="text-[11px] mt-0.5" style={{ color: "#2fb87a" }}>
          {modulesCount} module{modulesCount === 1 ? "" : "s"} configured · ready for Success Management.
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
function Card({
  children, leftBorderColor, opaqueWhenLocked,
}: {
  children: React.ReactNode;
  leftBorderColor?: string;
  opaqueWhenLocked?: boolean;
}) {
  return (
    <div
      className={cn("bg-white rounded-[14px] border border-beroe-card-border px-5 py-4 mb-3",
        opaqueWhenLocked && "opacity-85")}
      style={leftBorderColor ? { borderLeft: `4px solid ${leftBorderColor}` } : undefined}
    >
      {children}
    </div>
  );
}
function SectionHead({
  n, color, title, tooltip, teamLabel, teamColor, trailing,
}: {
  n: string;
  color: string;
  title: string;
  tooltip?: string;
  teamLabel?: string;
  teamColor?: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="text-[14px] font-bold mb-3 flex items-center gap-2 flex-wrap">
      <span
        className="w-[22px] h-[22px] rounded-[6px] text-white text-[10px] font-extrabold flex items-center justify-center flex-shrink-0"
        style={{ background: color }}
      >
        {n}
      </span>
      <span>{title}</span>
      {tooltip && <InlineTooltip text={tooltip} />}
      {teamLabel && teamColor && (
        <span
          className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border"
          style={{ background: `${teamColor}15`, color: teamColor, borderColor: `${teamColor}40` }}
        >
          {teamLabel}
        </span>
      )}
      {trailing}
    </div>
  );
}
function InlineTooltip({ text }: { text: string }) {
  return (
    <span className="relative inline-flex items-center group">
      <span
        className="w-[18px] h-[18px] rounded-full border flex items-center justify-center text-[11px] font-bold cursor-help italic"
        style={{ background: "#f1f5f9", color: C.T2, borderColor: C.CB, fontFamily: "Georgia, serif" }}
      >
        i
      </span>
      <span
        className="pointer-events-none absolute left-0 bottom-[calc(100%+8px)] z-50 w-[340px] rounded-[8px] px-3 py-2.5 text-[11px] leading-[1.6] opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ background: "#0d1b2e", color: "#fff", fontWeight: 400 }}
      >
        {text}
      </span>
    </span>
  );
}
function GroupHead({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-bold text-text-muted mt-3.5 mb-2 uppercase tracking-wider">
      {children}
    </div>
  );
}
// 11-Jun · Explicit-Save value-definition editor used on the Sales
// Handoff tab when sh_value_validation is "revised" or
// "partially_confirmed". Local draft so the textarea is fully
// controlled by the CSM; Save button only enables when content
// genuinely changed.
function ValueDefEditor({
  locked,
  current,
  saving,
  onSave,
}: {
  locked: boolean;
  current: string;
  saving: boolean;
  onSave: (v: string) => void;
}) {
  const [draft, setDraft] = useState<string>(current);
  // Reset the draft when the upstream value changes (e.g. another
  // user edited it, or Save just committed and onSettled refetched).
  useEffect(() => setDraft(current), [current]);

  const dirty = draft.trim() !== current.trim();

  return (
    <Field label="Edit Value Definition">
      <TextArea
        value={draft}
        disabled={locked}
        placeholder="Rewrite the value definition — click Save to commit. Adds an entry to revision history."
        onBlur={(v) => setDraft(v)}
      />
      <div className="flex items-center justify-between mt-1.5 gap-2">
        <div className="text-[10px]" style={{ color: "#854F0B" }}>
          ⚠ Your edits replace Solutioning's value definition.
          Every save adds an entry to the revision history visible
          on the Solutioning tab.
        </div>
        <button
          type="button"
          disabled={locked || saving || !dirty}
          onClick={() => onSave(draft)}
          className="text-[11px] font-bold px-3 py-1.5 rounded-md bg-beroe-blue text-white hover:opacity-90 disabled:opacity-40 shrink-0"
          title={
            dirty
              ? "Save edits to Solutioning's value definition"
              : "No changes to save"
          }
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </Field>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2.5">
      <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">{label}</div>
      {children}
    </div>
  );
}
function Input({
  type = "text", value, disabled, placeholder, onChange, onBlur, className,
}: {
  type?: string;
  value: string;
  disabled?: boolean;
  placeholder?: string;
  onChange?: (v: string) => void;
  onBlur?: (v: string) => void;
  className?: string;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <input
      type={type}
      value={v}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => { setV(e.target.value); onChange?.(e.target.value); }}
      onBlur={() => onBlur?.(v)}
      className={cn(
        "w-full px-2.5 py-1.5 border rounded-[7px] text-[12px] focus:outline-none focus:border-beroe-blue disabled:bg-beroe-bg/40 disabled:cursor-not-allowed",
        className,
      )}
      style={{ borderColor: C.CB }}
    />
  );
}
function TextArea({
  value, disabled, placeholder, onBlur,
}: { value: string; disabled?: boolean; placeholder?: string; onBlur: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <textarea
      value={v}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onBlur(v)}
      className="w-full px-2.5 py-1.5 border rounded-[7px] text-[12px] focus:outline-none focus:border-beroe-blue disabled:bg-beroe-bg/40 disabled:cursor-not-allowed leading-[1.6] resize-y min-h-[50px]"
      style={{ borderColor: C.CB }}
    />
  );
}
function Select({
  value, disabled, onChange, children,
}: {
  value: string;
  disabled?: boolean;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-2.5 py-1.5 border rounded-[7px] text-[12px] bg-white focus:outline-none focus:border-beroe-blue disabled:bg-beroe-bg/40 disabled:cursor-not-allowed"
      style={{ borderColor: C.CB }}
    >
      {children}
    </select>
  );
}
function SegControl({
  options, value, disabled, onChange,
}: {
  options: string[];
  value: string | null;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="inline-flex gap-0.5 p-0.5 rounded-[6px]" style={{ background: "#edf0f9" }}>
      {options.map((o) => {
        const active = value === o;
        return (
          <button
            key={o}
            type="button"
            disabled={disabled}
            onClick={() => onChange(o)}
            className={cn(
              "px-2.5 py-1 rounded-[5px] text-[10px] font-semibold transition disabled:opacity-60",
              active ? "bg-white font-bold shadow-sm" : "text-text-secondary hover:text-beroe-blue bg-transparent",
            )}
            style={active ? { color: C.BLUE } : undefined}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Default export
// ─────────────────────────────────────────────────────────────
export default function SalesHandoffTab() {
  const account = useAccountFromLayout();
  const qc = useQueryClient();
  // notify hook removed alongside DemoStateToggle (11-Jun).

  const gateQ = useQuery<SigningGate>({
    queryKey: ["signing-gate", account.id],
    queryFn: () => api.get<SigningGate>(`/api/v1/accounts/${account.id}/sign`),
    staleTime: 15_000,
  });
  const solQ = useQuery<Solutioning>({
    queryKey: ["solutioning", account.id],
    queryFn: () => api.get<Solutioning>(`/api/v1/accounts/${account.id}/solutioning`),
    staleTime: 30_000,
  });
  const contactsQ = useQuery<{ items: ContactRow[]; total: number }>({
    queryKey: ["contacts", account.id],
    queryFn: () => api.get(`/api/v1/accounts/${account.id}/contacts`),
    staleTime: 30_000,
  });
  const docsQ = useQuery<{ items: Document[]; total: number; is_editable: boolean }>({
    queryKey: ["documents", account.id, "contract"],
    queryFn: () => api.get(`/api/v1/accounts/${account.id}/documents?kind=contract`),
    staleTime: 15_000,
  });

  // 08-Jun · The earlier polling+stash useEffect was removed once
  // ContractDocsList → KindUploadCard. KindUploadCard owns the
  // contract auto-apply (poll for handoff_extracted_fields landing →
  // saveExtractionDraft → drain() consumes → form patched).

  // Force auth header injection — same as KindUploadCard for postForm.
  useEffect(() => { void authProvider.getAccessToken().catch(() => null); }, []);

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ["signing-gate", account.id] });
    qc.invalidateQueries({ queryKey: ["solutioning", account.id] });
    qc.invalidateQueries({ queryKey: ["contacts", account.id] });
    qc.invalidateQueries({ queryKey: ["documents", account.id, "contract"] });
    qc.invalidateQueries({ queryKey: ["account", account.id] });
  }

  if (gateQ.isLoading || !gateQ.data) {
    return <div className="text-[12px] text-text-muted">Loading Sales Handoff…</div>;
  }
  const gate = gateQ.data;
  const contacts = contactsQ.data?.items ?? [];
  const contractDocs = (docsQ.data?.items ?? []).filter((d) => !d.deleted_at);

  return (
    <div>
      {/* 11-Jun · Removed the fixed top-right DemoStateToggle widget
          per stakeholder ask — it was prototype-only mock UX. */}
      <StageIndicator gate={gate} />
      <HandedOffBanner gate={gate} modulesCount={(gate.gate_contract_modules ?? []).length} />
      <SalesHandoffSection
        account={account}
        gate={gate}
        solutioning={solQ.data ?? null}
        contacts={contacts}
        contractDocs={contractDocs}
        onMutate={invalidateAll}
      />
      <ContractAuditSection
        account={account}
        gate={gate}
        onMutate={invalidateAll}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 05-Jun — Auto-apply the handoff extraction draft.
//
// Splits the extracted fields into:
//   • gate columns (PATCH /accounts/:id with patchSignMeta)
//   • extras (PATCH /contract-extras with patchExtras)
// Skips any field the account already has set ("fill-blank-only") so
// CSM edits aren't trampled. Returns the total count of fields applied
// so the caller can surface a toast.
// ─────────────────────────────────────────────────────────────
function applyHandoffSlice(args: {
  slice: HandoffExtractionResult;
  gate: SigningGate;
  extras: Record<string, unknown>;
  patchGate: (body: Record<string, unknown>) => void;
  patchExtras: (body: Record<string, unknown>) => void;
  onApplied: (count: number) => void;
}): void {
  const { slice, gate, extras, patchGate, patchExtras, onApplied } = args;

  // ---------- gate columns ----------
  const gateBody: Record<string, unknown> = {};
  if (slice.gate_signed_date && !gate.gate_signed_date)
    gateBody.gate_signed_date = slice.gate_signed_date;
  if (slice.gate_renewal_date && !gate.gate_renewal_date)
    gateBody.gate_renewal_date = slice.gate_renewal_date;
  if (
    slice.gate_contract_acv_usd != null &&
    (gate.gate_contract_acv == null || gate.gate_contract_acv === "")
  ) {
    const n =
      typeof slice.gate_contract_acv_usd === "string"
        ? parseFloat(slice.gate_contract_acv_usd)
        : slice.gate_contract_acv_usd;
    if (Number.isFinite(n)) gateBody.gate_contract_acv = n;
  }
  if (slice.gate_contract_term && !gate.gate_contract_term)
    gateBody.gate_contract_term = slice.gate_contract_term;
  if (
    (slice.gate_contract_modules?.length ?? 0) > 0 &&
    (gate.gate_contract_modules ?? []).length === 0
  )
    gateBody.gate_contract_modules = slice.gate_contract_modules;
  if (slice.gate_platform_tier && !gate.gate_platform_tier)
    gateBody.gate_platform_tier = slice.gate_platform_tier;
  if (slice.gate_account_segment && !gate.gate_account_segment)
    gateBody.gate_account_segment = slice.gate_account_segment;
  if (slice.gate_subscribers && !gate.gate_subscribers)
    gateBody.gate_subscribers = slice.gate_subscribers;

  // ---------- extras (gate_contract_extras jsonb) ----------
  const extrasBody: Record<string, unknown> = {};
  const E = extras;
  const setIfBlank = (key: string, value: unknown) => {
    if (value == null || value === "") return;
    const existing = E[key];
    if (existing == null || existing === "") extrasBody[key] = value;
  };
  setIfBlank("tcv", slice.tcv);
  setIfBlank("billing_freq", slice.billing_freq);
  setIfBlank("payment_terms", slice.payment_terms);
  setIfBlank("discount", slice.discount);
  setIfBlank("discount_reason", slice.discount_reason);
  setIfBlank("geography", slice.geography);
  setIfBlank("module_caveats", slice.module_caveats);
  setIfBlank("audit_notes", slice.audit_notes);
  setIfBlank("other_terms", slice.other_terms);

  const applied = Object.keys(gateBody).length + Object.keys(extrasBody).length;
  if (applied === 0) {
    onApplied(0);
    return;
  }

  if (Object.keys(gateBody).length > 0) patchGate(gateBody);
  if (Object.keys(extrasBody).length > 0) patchExtras(extrasBody);

  onApplied(applied);
}

// 08-Jun · Local-state input that defers commit to onBlur. Used by
// the module-config fields where the prior onChange-per-keystroke
// pattern dropped characters because each keystroke fired a PATCH +
// invalidate + refetch — typing "12" landed as "2".
function DeferredInput({
  type = "text", value, placeholder, disabled, onCommit, className,
}: {
  type?: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  onCommit: (v: string) => void;
  className?: string;
}) {
  const [v, setV] = useState(value);
  // Resync from parent when the server-known value changes AND the
  // local draft is no longer dirty (i.e. equals the previous value).
  // Without this, the input would clobber the user's mid-edit value
  // every time a refetch landed.
  useEffect(() => {
    setV((prev) => (prev === "" || prev === value ? value : prev));
  }, [value]);
  return (
    <input
      type={type}
      value={v}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v !== value) onCommit(v);
      }}
      className={className}
      style={{ borderColor: C.CB }}
    />
  );
}
