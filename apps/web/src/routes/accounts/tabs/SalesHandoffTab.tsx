// M13 — Sales Handoff & Signing.
//
// Three cards:
//   1. Sales Hand-off — value validation, engagement timeline, watch-outs,
//      handoff doc (sh_* fields on account_solutioning).
//   2. CLIENT SIGNED stage gate — before/after states. Before: Sales captures
//      signed date / ACV / term and confirms; after: signed metadata shown
//      with renewal date + VDD due date derived from term.
//   3. Handover Quality Check — 4 items, auto-detected with manual overrides.

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useUnsavedChangesGuard } from "@/lib/use-unsaved-changes";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import { useAccountFromLayout } from "../AccountProfileLayout";
import {
  SH_VALIDATION_LABELS,
  type ShValidation,
  type Solutioning,
  type SolutioningUpdate,
} from "@/types/solutioning";
import {
  HANDOVER_QC_ITEMS,
  MODULE_OPTIONS,
  PLATFORM_TIER_OPTIONS,
  SEGMENT_OPTIONS,
  TERM_OPTIONS,
  type ContractDocBody,
  type HandoverChecklistBody,
  type SignAccountBody,
  type SigningGate,
  type UnlockSigningBody,
} from "@/types/signing";

const SH_VALIDATION_OPTIONS: ShValidation[] = [
  "confirmed",
  "partially_confirmed",
  "revised",
];

export default function SalesHandoffTab() {
  const account = useAccountFromLayout();
  const qc = useQueryClient();
  const navigate = useNavigate();

  // ---- Queries ----
  const { data: gate, isLoading: gateLoading } = useQuery<SigningGate>({
    queryKey: ["signing-gate", account.id],
    queryFn: () => api.get<SigningGate>(`/api/v1/accounts/${account.id}/sign`),
  });
  const { data: sol, isLoading: solLoading } = useQuery<Solutioning>({
    queryKey: ["solutioning", account.id],
    queryFn: () => api.get<Solutioning>(`/api/v1/accounts/${account.id}/solutioning`),
  });

  // ---- Sales hand-off form state (sh_* fields on solutioning) ----
  const [form, setForm] = useState<Solutioning | null>(null);
  const [shError, setShError] = useState<string | null>(null);
  useEffect(() => {
    if (sol && !form) setForm(sol);
  }, [sol, form]);
  const dirty = useMemo(() => {
    if (!form || !sol) return false;
    return JSON.stringify(shSlice(form)) !== JSON.stringify(shSlice(sol));
  }, [form, sol]);

  const saveSh = useMutation({
    mutationFn: (body: SolutioningUpdate) =>
      api.patch<Solutioning>(`/api/v1/accounts/${account.id}/solutioning`, body),
    onSuccess: (saved) => {
      qc.setQueryData(["solutioning", account.id], saved);
      qc.invalidateQueries({ queryKey: ["activity", account.id] });
      setForm(saved);
      setShError(null);
    },
    onError: (e: ApiError) => setShError(e.message),
  });

  const saveDirty = () => {
    if (form && sol) saveSh.mutate(shDiff(form, sol));
  };
  const guard = useUnsavedChangesGuard({
    dirty,
    isSaving: saveSh.isPending,
    onSaveShortcut: saveDirty,
  });

  // ---- Signing gate mutations ----
  const [signError, setSignError] = useState<string | null>(null);
  const sign = useMutation({
    mutationFn: (body: SignAccountBody) =>
      api.post<SigningGate>(`/api/v1/accounts/${account.id}/sign`, body),
    onSuccess: (g) => {
      qc.setQueryData(["signing-gate", account.id], g);
      qc.invalidateQueries({ queryKey: ["account", account.id] });
      qc.invalidateQueries({ queryKey: ["activity", account.id] });
      setSignError(null);
    },
    onError: (e: ApiError) => setSignError(e.message),
  });
  const unlock = useMutation({
    mutationFn: (body: UnlockSigningBody) =>
      api.post<SigningGate>(`/api/v1/accounts/${account.id}/sign/unlock`, body),
    onSuccess: (g) => {
      qc.setQueryData(["signing-gate", account.id], g);
      qc.invalidateQueries({ queryKey: ["account", account.id] });
      setSignError(null);
    },
    onError: (e: ApiError) => setSignError(e.message),
  });
  const checklist = useMutation({
    mutationFn: (body: HandoverChecklistBody) =>
      api.patch<SigningGate>(`/api/v1/accounts/${account.id}/handover-checklist`, body),
    onSuccess: (g) => {
      qc.setQueryData(["signing-gate", account.id], g);
      setSignError(null);
    },
    onError: (e: ApiError) => setSignError(e.message),
  });
  const contractDoc = useMutation({
    mutationFn: (body: ContractDocBody) =>
      api.patch<SigningGate>(`/api/v1/accounts/${account.id}/contract-doc`, body),
    onSuccess: (g) => {
      qc.setQueryData(["signing-gate", account.id], g);
      setSignError(null);
    },
    onError: (e: ApiError) => setSignError(e.message),
  });

  // ---- Signing form state (before-signed only) ----
  const [signForm, setSignForm] = useState<SignAccountBody>({
    gate_signed_date: new Date().toISOString().slice(0, 10),
    gate_contract_acv: "",
    gate_contract_term: "",
    gate_contract_modules: [],
    gate_platform_tier: "",
    gate_account_segment: "",
    gate_subscribers: "",
  });

  if (gateLoading || solLoading || !form || !gate) {
    return <div className="text-sm text-text-muted">Loading sales hand-off…</div>;
  }

  const editable = form.is_editable;

  return (
    <div className="space-y-4">
      {/* 28-May — "Received from Solutioning" magenta pill (prototype
          line 5972-5975). Sales' team colour is #C344C7 (magenta).
          Renders only when sh_value_received_at is set. */}
      {form.sh_value_received_at && (
        <div
          className="rounded-card px-3 py-1.5 flex items-center gap-2"
          style={{
            background: "#C344C710",
            border: "1px solid #C344C730",
          }}
        >
          <span className="text-[13px]">📥</span>
          <span
            className="text-[11px] font-semibold"
            style={{ color: "#C344C7" }}
          >
            Received from Solutioning ·{" "}
            {new Date(form.sh_value_received_at).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </span>
        </div>
      )}

      {/* 28-May — Outer C) Sales Hand-off card (prototype line 5977-6034).
          Magenta "C" badge + "Sales" team pill. Opacity dims when
          locked at signing (gate signed & not unlocked). */}
      <div
        className={cn(
          "bg-white rounded-card border border-beroe-card-border p-5",
          gate?.gate_signed && !gate?.gate_unlocked && "opacity-[0.85]",
        )}
      >
        <div className="flex items-center gap-2 mb-3">
          <span
            className="w-[22px] h-[22px] rounded-md text-white text-[10px] font-extrabold flex items-center justify-center flex-shrink-0"
            style={{ background: "#C344C7" }}
          >
            C
          </span>
          <span className="text-[14px] font-bold text-text-primary">
            Sales Hand-off
          </span>
          <span
            className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
            style={{
              background: "#C344C715",
              color: "#C344C7",
              border: "1px solid #C344C730",
            }}
          >
            Sales
          </span>
        </div>

        {/* "Before starting" blue checklist banner (prototype line 5981-5983)
            when NOT yet locked at signing. When locked, surface the
            "Locked at signing on DATE" muted hint instead. */}
        {gate?.gate_signed && !gate?.gate_unlocked ? (
          <div className="text-[10px] text-text-muted mb-2 flex items-center gap-1.5">
            🔒 Locked at signing
            {gate.gate_signed_date && (
              <> · {new Date(gate.gate_signed_date).toLocaleDateString()}</>
            )}
          </div>
        ) : (
          <div
            className="rounded-lg px-3.5 py-2.5 mb-3 text-[11px] leading-relaxed"
            style={{
              background: "#EBF3FB",
              border: "1px solid #4A00F830",
              color: "#185FA5",
            }}
          >
            <b>Before starting</b> — make sure you have from Sales: (1)
            contract value and ACV, (2) at least one named stakeholder,
            (3) the agreed category list, (4) a stated savings target or
            success metric. Missing any of these? Resolve with Sales
            before proceeding.
          </div>
        )}

        <p className="text-xs text-text-muted mb-3">
          Continues from the Solutioning lock. Sales validates the value
          definition, fills in the engagement timeline, and notes any
          watch-outs before the signing event.
        </p>

        {/* 27-May Row 85 — Value Definition (received) + Value Themes
            merged into ONE violet box so Sales sees the full Solutioning
            output at a glance instead of two separate fields. */}
        <div className="rounded-xl border-2 border-violet-200 bg-violet-50/60 p-3 mb-3">
          <div className="text-[10px] uppercase tracking-wider font-bold text-violet-700 mb-1.5">
            From Solutioning
          </div>
          <div className="text-[11px] font-bold text-violet-900 mb-0.5">
            Value definition
          </div>
          {form.sh_value_from_solutioning ? (
            <div className="text-sm text-text-primary whitespace-pre-wrap mb-2">
              {form.sh_value_from_solutioning}
            </div>
          ) : (
            <div className="text-xs text-text-muted italic mb-2">
              Lock the Solutioning value definition first — the snapshot will
              appear here for Sales to validate.
            </div>
          )}
          {form.sh_value_themes_from_solutioning && (
            <>
              <div className="text-[11px] font-bold text-violet-900 mt-2 mb-0.5">
                Value themes
              </div>
              <div className="text-sm text-text-primary">
                {form.sh_value_themes_from_solutioning}
              </div>
            </>
          )}
          {form.sh_value_received_at && (
            <div className="text-[10px] text-violet-700/70 mt-2 italic">
              Received {new Date(form.sh_value_received_at).toLocaleString()}
            </div>
          )}
        </div>

        {/* GROUP 1 — Value Definition Validation (prototype line 5985). */}
        <Section variant="group" title="Value Definition Validation">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Sales validation">
              <select
                value={form.sh_value_validation ?? ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    sh_value_validation: (e.target.value || null) as ShValidation | null,
                  })
                }
                disabled={!editable}
                className={inputCls(editable)}
              >
                <option value="">— Select —</option>
                {SH_VALIDATION_OPTIONS.map((v) => (
                  <option key={v} value={v}>{SH_VALIDATION_LABELS[v]}</option>
                ))}
              </select>
            </Field>
            <Field label="Stakeholder sign-off">
              <input
                type="text"
                maxLength={600}
                value={form.sh_stakeholder_signoff ?? ""}
                placeholder="Who on the client side approved"
                onChange={(e) =>
                  setForm({ ...form, sh_stakeholder_signoff: e.target.value || null })
                }
                disabled={!editable}
                className={inputCls(editable)}
              />
            </Field>
          </div>

          <Field label="Validation notes">
            <textarea
              rows={3}
              maxLength={4000}
              value={form.sh_validation_notes ?? ""}
              placeholder="Anything Sales pushed back on or refined."
              onChange={(e) =>
                setForm({ ...form, sh_validation_notes: e.target.value || null })
              }
              disabled={!editable}
              className={textareaCls(editable)}
            />
          </Field>
        </Section>

        {/* GROUP 2 — Engagement Timeline (prototype line 6015). */}
        <Section variant="group" title="Engagement Timeline">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Go-live date">
            <input
              type="date"
              value={form.sh_go_live_date ?? ""}
              onChange={(e) =>
                setForm({ ...form, sh_go_live_date: e.target.value || null })
              }
              disabled={!editable}
              className={inputCls(editable)}
            />
          </Field>
          <Field label="First checkpoint">
            <input
              type="date"
              value={form.sh_first_checkpoint ?? ""}
              onChange={(e) =>
                setForm({ ...form, sh_first_checkpoint: e.target.value || null })
              }
              disabled={!editable}
              className={inputCls(editable)}
            />
          </Field>
        </div>

        <Field label="Commercial context">
          <textarea
            rows={3}
            maxLength={4000}
            value={form.sh_commercial_context ?? ""}
            placeholder="Pricing nuances, discounts, special terms."
            onChange={(e) =>
              setForm({ ...form, sh_commercial_context: e.target.value || null })
            }
            disabled={!editable}
            className={textareaCls(editable)}
          />
        </Field>

        <Field label="Watch-outs & risks">
          <textarea
            rows={3}
            maxLength={4000}
            value={form.sales_watchouts ?? ""}
            placeholder="What might bite us between sign and go-live."
            onChange={(e) =>
              setForm({ ...form, sales_watchouts: e.target.value || null })
            }
            disabled={!editable}
            className={textareaCls(editable)}
          />
        </Field>

        <Field label="Handoff document">
          <input
            type="text"
            maxLength={400}
            value={form.handoff_file_name ?? ""}
            placeholder="Filename of the signed handoff doc (upload via Documents)"
            onChange={(e) =>
              setForm({ ...form, handoff_file_name: e.target.value || null })
            }
            disabled={!editable}
            className={inputCls(editable)}
          />
        </Field>

        </Section>

        {/* Sticky save bar for sh_* fields */}
        {editable && (
          <div
            className={cn(
              "sticky bottom-0 -mx-5 px-5 py-3 flex items-center gap-3 border-t z-30 mt-3 transition-colors",
              dirty
                ? "bg-amber-50 border-amber-300 shadow-[0_-4px_12px_rgba(0,0,0,0.05)]"
                : "bg-white border-beroe-card-border",
            )}
          >
            {shError && (
              <span className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-1">
                {shError}
              </span>
            )}
            {!shError && dirty && (
              <span className="flex items-center gap-1.5 text-xs text-amber-800 font-bold">
                <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                Unsaved hand-off changes
              </span>
            )}
            {!dirty && !shError && (
              <span className="text-xs text-text-muted">✓ Hand-off saved</span>
            )}
            <button
              onClick={() => sol && setForm(sol)}
              disabled={!dirty || saveSh.isPending}
              className="ml-auto px-3 py-1.5 rounded-lg text-sm border border-slate-200 text-text-secondary disabled:opacity-50 bg-white"
            >
              Discard
            </button>
            <button
              onClick={saveDirty}
              disabled={!dirty || saveSh.isPending}
              className="px-4 py-1.5 rounded-lg bg-beroe-blue text-white text-sm font-semibold disabled:opacity-50"
            >
              {saveSh.isPending ? "Saving…" : "Save hand-off"}
            </button>
          </div>
        )}
      </div>

      {/* ---------- Card 2: CLIENT SIGNED stage gate ---------- */}
      <SigningGateCard
        gate={gate}
        signForm={signForm}
        setSignForm={setSignForm}
        sign={(b) => sign.mutate(b)}
        unlock={(reason) => unlock.mutate({ reason })}
        signing={sign.isPending}
        unlocking={unlock.isPending}
        error={signError}
        onContractDoc={(filename) =>
          contractDoc.mutate({ gate_contract_doc: filename })
        }
      />

      {/* ---------- Card 3: Handover Quality Check ---------- */}
      <HandoverQualityCheck
        account={account}
        gate={gate}
        onSet={(items) => checklist.mutate({ items })}
        saving={checklist.isPending}
      />

      {/* H40 — Success Metrics live INSIDE Sales Handoff after signing
          (was previously just a link card). Read-only summary with a
          "Manage in Value Tracking →" footer that deep-links the user out. */}
      {gate.gate_signed && !gate.gate_unlocked && (
        <InlineSuccessMetricsCard accountId={account.id} />
      )}

      {gate.gate_signed && !gate.gate_unlocked && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() =>
              navigate(`/accounts/${account.id}/success-management/contract-goals`)
            }
            className="bg-white rounded-card border border-beroe-card-border px-4 py-3 text-left hover:bg-slate-50 transition-colors"
          >
            <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted">
              Success Management
            </div>
            <div className="text-sm font-bold text-text-primary mt-0.5">
              Open Success Contract & Goals →
            </div>
            <div className="text-[11px] text-text-muted mt-0.5">
              Three-lock contract + CS goals from the value definition.
            </div>
          </button>
          <button
            type="button"
            onClick={() =>
              navigate(`/accounts/${account.id}/success-management/value-tracking`)
            }
            className="bg-white rounded-card border border-beroe-card-border px-4 py-3 text-left hover:bg-slate-50 transition-colors"
          >
            <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted">
              Value Tracking
            </div>
            <div className="text-sm font-bold text-text-primary mt-0.5">
              Manage Success Metrics →
            </div>
            <div className="text-[11px] text-text-muted mt-0.5">
              Add / log values on the full Value Tracking surface.
            </div>
          </button>
        </div>
      )}

      {guard.pendingHref && (
        <UnsavedChangesDialog
          pendingHref={guard.pendingHref}
          saving={saveSh.isPending}
          onSaveAndGo={async () => {
            try {
              if (form && sol) await saveSh.mutateAsync(shDiff(form, sol));
              guard.proceed();
            } catch {
              /* shError surfaces in UI */
            }
          }}
          onDiscardAndGo={() => {
            if (sol) setForm(sol);
            guard.proceed();
          }}
          onStay={guard.stay}
        />
      )}
    </div>
  );
}

// ============================================================
// CLIENT SIGNED card
// ============================================================

function SigningGateCard({
  gate,
  signForm,
  setSignForm,
  sign,
  unlock,
  signing,
  unlocking,
  error,
  onContractDoc,
}: {
  gate: SigningGate;
  signForm: SignAccountBody;
  setSignForm: (v: SignAccountBody) => void;
  sign: (b: SignAccountBody) => void;
  unlock: (reason: string) => void;
  signing: boolean;
  unlocking: boolean;
  error: string | null;
  onContractDoc: (filename: string | null) => void;
}) {
  const isSigned = gate.gate_signed;
  const inEdit = !isSigned || gate.gate_unlocked;
  const renewalAfterBvd =
    gate.gate_renewal_date &&
    gate.gate_bvd_due_date &&
    gate.gate_bvd_due_date > gate.gate_renewal_date;

  return (
    <div
      className={cn(
        "rounded-card border-2 bg-white p-5",
        isSigned && !gate.gate_unlocked
          ? "border-green-300"
          : isSigned && gate.gate_unlocked
            ? "border-amber-300"
            : "border-slate-200",
      )}
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-extrabold tracking-wide uppercase">
          CLIENT SIGNED
        </h2>
        {isSigned && !gate.gate_unlocked && (
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-800">
            ✓ Live
          </span>
        )}
        {isSigned && gate.gate_unlocked && (
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900">
            🔓 Unlocked — needs re-confirm
          </span>
        )}
        {!isSigned && (
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-text-muted">
            Pending
          </span>
        )}
      </div>

      {error && (
        <div className="mb-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {/* Always-visible metadata grid — empty cells when unsigned. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <SignedStat label="Signed date" value={fmtDate(gate.gate_signed_date)} />
        <SignedStat label="Contract ACV" value={fmtMoney(gate.gate_contract_acv)} />
        <SignedStat label="Contract term" value={gate.gate_contract_term ?? "—"} />
        <SignedStat label="Renewal date" value={fmtDate(gate.gate_renewal_date)} />
        <SignedStat
          label="VDD due date"
          value={fmtDate(gate.gate_bvd_due_date)}
          warn={!!renewalAfterBvd}
        />
        <SignedStat
          label="Confirmed at"
          value={gate.gate_confirmed_at ? fmtDateTime(gate.gate_confirmed_at) : "—"}
        />
      </div>

      {/* Sign / re-sign form */}
      {inEdit && gate.can_sign && (
        <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 mb-3">
          <div className="text-[11px] uppercase tracking-wider text-text-muted font-bold mb-2">
            {isSigned ? "Re-confirm signing" : "Confirm signing"}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Field label="Signed date">
              <input
                type="date"
                value={signForm.gate_signed_date}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) =>
                  setSignForm({ ...signForm, gate_signed_date: e.target.value })
                }
                className={inputCls(true)}
              />
            </Field>
            <Field label="ACV ($)">
              <input
                type="number"
                min={0}
                step="0.01"
                value={signForm.gate_contract_acv}
                onChange={(e) =>
                  setSignForm({ ...signForm, gate_contract_acv: e.target.value })
                }
                className={inputCls(true)}
              />
            </Field>
            <Field label="Term">
              <select
                value={signForm.gate_contract_term}
                onChange={(e) =>
                  setSignForm({ ...signForm, gate_contract_term: e.target.value })
                }
                className={inputCls(true)}
              >
                <option value="">— Select —</option>
                {TERM_OPTIONS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </Field>
          </div>
          {/* R18 — additional metadata captured at signing time so CS Onboarding
              doesn't need a second PATCH right after. All optional.
              28-May — picker vocab ported from prototype line 6079-6092:
              modules = pill toggle list, tier/segment = fixed selects. */}
          <Field label="Modules contracted">
            <div className="flex flex-wrap gap-1.5">
              {MODULE_OPTIONS.map((m) => {
                const on = (signForm.gate_contract_modules ?? []).includes(m);
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      const cur = signForm.gate_contract_modules ?? [];
                      setSignForm({
                        ...signForm,
                        gate_contract_modules: on
                          ? cur.filter((x) => x !== m)
                          : [...cur, m],
                      });
                    }}
                    className={cn(
                      "text-[11px] px-2.5 py-1 rounded-full border font-semibold transition-colors",
                      on
                        ? "bg-beroe-blue/10 border-beroe-blue/40 text-beroe-blue"
                        : "bg-white border-beroe-card-border text-text-secondary hover:border-beroe-blue/30",
                    )}
                  >
                    {on ? "✓ " : ""}{m}
                  </button>
                );
              })}
            </div>
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
            <Field label="Platform tier">
              <select
                value={signForm.gate_platform_tier ?? ""}
                onChange={(e) =>
                  setSignForm({ ...signForm, gate_platform_tier: e.target.value })
                }
                className={inputCls(true)}
              >
                <option value="">— Select —</option>
                {PLATFORM_TIER_OPTIONS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </Field>
            <Field label="Segment">
              <select
                value={signForm.gate_account_segment ?? ""}
                onChange={(e) =>
                  setSignForm({ ...signForm, gate_account_segment: e.target.value })
                }
                className={inputCls(true)}
              >
                <option value="">— Select —</option>
                {SEGMENT_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="Subscribers">
              <input
                type="text"
                value={signForm.gate_subscribers ?? ""}
                onChange={(e) =>
                  setSignForm({ ...signForm, gate_subscribers: e.target.value })
                }
                placeholder="e.g. Unlimited (Enterprise)"
                className={inputCls(true)}
              />
            </Field>
          </div>
          <button
            onClick={() => {
              if (!signForm.gate_signed_date) {
                alert("Pick a signed date.");
                return;
              }
              if (!signForm.gate_contract_acv) {
                alert("Enter the contract ACV.");
                return;
              }
              if (!signForm.gate_contract_term) {
                alert("Pick a term.");
                return;
              }
              sign(signForm);
            }}
            disabled={signing}
            className="mt-3 px-4 py-1.5 rounded-lg bg-beroe-blue text-white text-sm font-semibold disabled:opacity-50"
          >
            {signing ? "Confirming…" : "✓ Confirm signing"}
          </button>
          <div className="mt-2 text-[10px] text-text-muted">
            The signed-by user + timestamp are recorded automatically from
            your account session.
          </div>
        </div>
      )}

      {/* Signed metadata footer — 22-May Row 47: ALWAYS show all 4 metadata
          fields in a labelled grid (with "—" placeholder when empty) so the
          structure is visible even if those fields weren't captured during
          signing. */}
      {isSigned && !gate.gate_unlocked && (
        <>
          <div className="border-t border-beroe-card-border pt-3 mb-3">
            <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted mb-1.5">
              Modules Contracted
            </div>
            <div className="flex flex-wrap gap-1 mb-3">
              {gate.gate_contract_modules.length > 0 ? (
                gate.gate_contract_modules.map((m) => (
                  <span
                    key={m}
                    className="text-[11px] px-2 py-0.5 rounded-full bg-beroe-blue/10 text-beroe-blue font-semibold"
                  >
                    {m}
                  </span>
                ))
              ) : (
                <span className="text-xs text-text-muted">None</span>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <SignedStat
                label="Platform Tier"
                value={gate.gate_platform_tier || "—"}
              />
              <SignedStat
                label="Segment"
                value={
                  gate.gate_account_segment
                    ? `Segment ${gate.gate_account_segment}`
                    : "—"
                }
              />
              <SignedStat
                label="Subscribers"
                value={gate.gate_subscribers || "—"}
              />
            </div>
          </div>
          {/* H41 — "Confirmed by NAME on DATE" line — always shown when signed. */}
          <div className="text-[11px] text-text-muted mb-3">
            ✓ Confirmed by{" "}
            <b className="text-text-primary">
              {gate.gate_confirmed_by_name ?? "—"}
            </b>{" "}
            on{" "}
            <b>
              {gate.gate_confirmed_at
                ? fmtDateTime(gate.gate_confirmed_at)
                : "—"}
            </b>
          </div>
          {/* Inline edit hint when fields are empty + user can sign. */}
          {gate.can_sign &&
            (gate.gate_contract_modules.length === 0 ||
              !gate.gate_platform_tier ||
              !gate.gate_account_segment ||
              !gate.gate_subscribers) && (
              <div className="text-[10px] text-amber-700 mb-3 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
                Some signing-metadata fields are empty. Use{" "}
                <b>🔓 Unlock for correction</b> below to re-confirm with the
                missing values.
              </div>
            )}
        </>
      )}

      {/* Contract document — 25-May Row 50 + 26-May Row 59: real file
          upload + last-3 download dropdown. Files flow through the
          Documents API (kind='contract'). The gate_contract_doc scalar
          stays in sync as the latest-uploaded-filename pointer.
          canUpload now derives from the documents endpoint's is_editable
          (server-side `can_write_documents(role, kind='contract')`)
          rather than the signing capability — CSMs receiving the
          handoff need to upload too, not just signers. */}
      {isSigned && (
        <ContractDocSection
          accountId={gate.account_id}
          onLatest={(filename) => onContractDoc(filename)}
        />
      )}

      {/* 27-May Row 84 — Unlock button visibility.
          Always render the button when the account is signed and not
          yet unlocked, but disable + explain for non-admin roles so
          stakeholders see the workflow exists rather than wondering
          where the unlock action lives. Server-side RBAC still
          enforces the actual permission. */}
      {isSigned && !gate.gate_unlocked && (
        <button
          onClick={() => {
            if (!gate.can_unlock) return;
            const reason = prompt(
              "Reason for unlocking the signing gate (min 10 chars):",
            );
            if (reason && reason.trim().length >= 10) {
              unlock(reason.trim());
            } else if (reason !== null) {
              alert("Reason must be at least 10 characters.");
            }
          }}
          disabled={unlocking || !gate.can_unlock}
          title={
            !gate.can_unlock
              ? "Unlock is restricted to Admin / CS Director — ask an admin to re-open the signing gate"
              : "Reopen the signing gate to amend signed contract details"
          }
          className="mt-3 text-xs px-3 py-1 rounded-md border border-amber-300 bg-amber-50 text-amber-900 font-semibold hover:bg-amber-100 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {unlocking ? "Unlocking…" : "🔓 Unlock for correction"}
          {!gate.can_unlock && " (admin only)"}
        </button>
      )}
      {gate.gate_unlocked && gate.gate_unlock_reason && (
        <div className="mt-2 text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-1">
          Unlocked: <b>{gate.gate_unlock_reason}</b>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Handover Quality Check
// ============================================================

function HandoverQualityCheck({
  account,
  gate,
  onSet,
  saving,
}: {
  account: { id: string };
  gate: SigningGate;
  onSet: (items: Record<string, boolean>) => void;
  saving: boolean;
}) {
  void account;
  const overrides = gate.handover_quality_check ?? {};
  // 28-May — literal port of prototype line 6055-6075. 2-column tile
  // grid: green (#f0fdf4 / #40CC8F30 / #2fb87a) when checked, red
  // (#fff0f2 / #FD576B30 / #e63950) when missing. Bottom status line
  // flips between red-italic "Incomplete handover" and green "Handover
  // complete". Tiles are clickable so a user with write access can flip
  // them in place.
  const items = HANDOVER_QC_ITEMS.map((it) => ({
    key: it.key,
    label: it.label,
    ok: !!overrides[it.key],
  }));
  const allGood = items.every((i) => i.ok);
  return (
    <Section title="Handover Quality Check">
      <p className="text-xs text-text-muted mb-3">
        Manual sign-off on the four things every Pre-Sales handover must
        deliver. Click a tile to toggle; the audit log records who
        confirmed what.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 mb-2">
        {items.map((i) => (
          <button
            key={i.key}
            type="button"
            disabled={saving}
            onClick={() => onSet({ [i.key]: !i.ok })}
            className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium text-left disabled:opacity-60"
            style={{
              background: i.ok ? "#f0fdf4" : "#fff0f2",
              border: `1px solid ${i.ok ? "#40CC8F30" : "#FD576B30"}`,
              color: i.ok ? "#2fb87a" : "#e63950",
            }}
          >
            <span className="text-[10px]">{i.ok ? "✓" : "✗"}</span>
            {i.label}
          </button>
        ))}
      </div>
      {allGood ? (
        <div className="text-[10px]" style={{ color: "#2fb87a" }}>
          ✓ Handover complete
        </div>
      ) : (
        <div className="text-[10px] italic" style={{ color: "#e63950" }}>
          ⚠️ Incomplete handover — flag missing items to Sales before
          proceeding to CS workflow.
        </div>
      )}
    </Section>
  );
}

// ============================================================
// Sub-components / helpers
// ============================================================

function Section({
  title,
  children,
  variant = "card",
}: {
  title: string;
  children: React.ReactNode;
  /**
   * "card"  → white card with border (legacy default).
   * "group" → 28-May port of prototype line 5985-format. UPPERCASE
   *           grey-blue label, no card border. Used inside the outer
   *           C) Sales Hand-off card to mirror the prototype's grouped
   *           layout.
   */
  variant?: "card" | "group";
}) {
  if (variant === "group") {
    return (
      <div className="mb-3">
        <div
          className="text-[12px] font-bold uppercase tracking-[0.05em] mb-2"
          style={{ color: "#6b7fa0" }}
        >
          {title}
        </div>
        {children}
      </div>
    );
  }
  return (
    <div className="bg-white rounded-card border border-beroe-card-border p-5">
      <h2 className="text-sm font-bold text-text-primary mb-2">{title}</h2>
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

function SignedStat({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2",
        warn ? "border-amber-300 bg-amber-50/40" : "border-slate-200 bg-slate-50/40",
      )}
    >
      <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold mb-0.5">
        {label}
      </div>
      <div
        className={cn(
          "text-sm font-bold",
          warn ? "text-amber-800" : "text-text-primary",
        )}
      >
        {value}
        {warn && <span className="ml-1" aria-label="warning">⚠</span>}
      </div>
    </div>
  );
}

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

function fmtDate(d: string | null): string {
  if (!d) return "—";
  // ISO yyyy-mm-dd or full ISO datetime — both parse.
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString();
}

function fmtDateTime(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleString();
}

function fmtMoney(v: string | number | null): string {
  if (v == null || v === "") return "—";
  const n = typeof v === "number" ? v : parseFloat(v);
  if (isNaN(n)) return String(v);
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

const SH_KEYS = [
  "sh_value_validation",
  "sh_validation_notes",
  "sh_go_live_date",
  "sh_first_checkpoint",
  "sh_stakeholder_signoff",
  "sh_commercial_context",
  "sales_watchouts",
  "handoff_file_name",
] as const;

/** Pull only the sh_* slice for dirty/diff comparison. */
function shSlice(s: Solutioning): Partial<Solutioning> {
  const out: Partial<Solutioning> = {};
  for (const k of SH_KEYS) {
    // @ts-expect-error — index into typed shape
    out[k] = s[k];
  }
  return out;
}

function shDiff(next: Solutioning, prev: Solutioning): SolutioningUpdate {
  const out: Record<string, unknown> = {};
  for (const k of SH_KEYS) {
    if (JSON.stringify(next[k]) !== JSON.stringify(prev[k])) {
      out[k] = next[k];
    }
  }
  return out as SolutioningUpdate;
}

// H40 — inline Success Metrics summary embedded in Sales Handoff. Read-only;
// edits go through the full Value Tracking surface via the deep-link below.
function InlineSuccessMetricsCard({ accountId }: { accountId: string }) {
  type Met = {
    id: string;
    name: string;
    metric_type: string;
    target_value: string | null;
    current_value: string | null;
    status: "green" | "amber" | "red" | "grey";
  };
  const { data, isLoading } = useQuery<{ items: Met[]; total: number }>({
    queryKey: ["metrics", accountId],
    queryFn: () =>
      api.get<{ items: Met[]; total: number }>(
        `/api/v1/accounts/${accountId}/metrics`,
      ),
  });
  const navigate = useNavigate();
  const items = data?.items ?? [];
  const counts = {
    green: items.filter((m) => m.status === "green").length,
    amber: items.filter((m) => m.status === "amber").length,
    red: items.filter((m) => m.status === "red").length,
    grey: items.filter((m) => m.status === "grey").length,
  };
  const dot = (s: Met["status"]) =>
    s === "green"
      ? "bg-emerald-500"
      : s === "amber"
        ? "bg-amber-500"
        : s === "red"
          ? "bg-red-500"
          : "bg-slate-300";
  return (
    <div className="bg-white border border-beroe-card-border rounded-card p-4">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div>
          <h3 className="text-sm font-bold text-text-primary">Success Metrics</h3>
          <p className="text-[11px] text-text-muted">
            Agreed at signing — tracked live. Edits happen on the Value Tracking tab.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-semibold">
            ✓ {counts.green}
          </span>
          <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-semibold">
            ⚠ {counts.amber}
          </span>
          <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-700 font-semibold">
            ✕ {counts.red}
          </span>
          {counts.grey > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-slate-50 text-slate-700 font-semibold">
              ○ {counts.grey}
            </span>
          )}
        </div>
      </div>
      {isLoading ? (
        <div className="text-xs text-text-muted italic">Loading metrics…</div>
      ) : items.length === 0 ? (
        <div className="text-xs text-text-muted italic">
          No metrics captured yet. Define them on the Value Tracking tab so the
          signing snapshot has measurement teeth.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {items.slice(0, 6).map((m) => (
            <li
              key={m.id}
              className="flex items-center gap-2 text-[12px] py-1 border-b border-beroe-card-border/60 last:border-b-0"
            >
              <span className={cn("w-2 h-2 rounded-full flex-shrink-0", dot(m.status))} />
              <span className="font-semibold text-text-primary flex-1 truncate">
                {m.name}
              </span>
              <span className="text-[11px] text-text-muted">
                {m.current_value ?? "—"}
                {m.target_value && (
                  <span className="text-text-muted/70"> / {m.target_value}</span>
                )}
              </span>
            </li>
          ))}
          {items.length > 6 && (
            <li className="text-[10px] text-text-muted italic pt-1">
              + {items.length - 6} more on Value Tracking
            </li>
          )}
        </ul>
      )}
      <div className="mt-3">
        <button
          type="button"
          onClick={() =>
            navigate(`/accounts/${accountId}/success-management/value-tracking`)
          }
          className="text-[11px] text-beroe-blue font-semibold hover:underline"
        >
          → Open Value Tracking to add or log values
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Row 50 — Contract document upload + last-3 download dropdown
// ============================================================

function ContractDocSection({
  accountId,
  onLatest,
}: {
  accountId: string;
  onLatest: (filename: string | null) => void;
}) {
  const qc = useQueryClient();
  const queryKey = ["documents", accountId, "contract"];
  const { data, isLoading } = useQuery<{
    items: ContractDoc[];
    total: number;
    is_editable: boolean;
  }>({
    queryKey,
    queryFn: () =>
      api.get<{ items: ContractDoc[]; total: number; is_editable: boolean }>(
        `/api/v1/accounts/${accountId}/documents?kind=contract`,
      ),
  });
  const canUpload = !!data?.is_editable;
  const [open, setOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("kind", "contract");
      return api.postForm<{ document: ContractDoc }>(
        `/api/v1/accounts/${accountId}/documents`,
        fd,
      );
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey });
      // Keep gate_contract_doc in sync as the "latest filename" pointer
      // so the existing scalar-based logic elsewhere still works.
      onLatest(r.document.filename);
      setUploadErr(null);
    },
    onError: (e: ApiError) => setUploadErr(e.message),
  });

  const items = (data?.items ?? [])
    .filter((d) => !d.deleted_at)
    .slice(0, 3);

  return (
    <div className="border-t border-slate-200 pt-3 mt-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-[11px] uppercase tracking-wider text-text-muted font-bold">
          Contract document
        </div>
        <div className="flex items-center gap-2 relative">
          {canUpload && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept=".pdf,.docx,.doc,.png,.jpg,.jpeg"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) upload.mutate(f);
                  if (e.target) e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={upload.isPending}
                className="text-[11px] px-2.5 py-1 rounded-md bg-beroe-blue text-white font-semibold disabled:opacity-50"
              >
                {upload.isPending ? "Uploading…" : "📤 Upload"}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            disabled={items.length === 0}
            className="text-[11px] px-2.5 py-1 rounded-md border border-beroe-card-border font-semibold disabled:opacity-50"
            title={
              items.length === 0
                ? "No contract documents uploaded yet"
                : `Download from last ${items.length} upload(s)`
            }
          >
            ⬇ Download
          </button>
          {open && items.length > 0 && (
            <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-beroe-card-border rounded-md shadow-lg min-w-[280px]">
              <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted px-3 py-1.5 border-b border-beroe-card-border/60">
                Last {items.length} upload{items.length === 1 ? "" : "s"}
              </div>
              <ul className="py-1">
                {items.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={async () => {
                        setOpen(false);
                        try {
                          const r = await api.get<{ url: string }>(
                            `/api/v1/documents/${d.id}/download-url`,
                          );
                          window.open(r.url, "_blank", "noopener");
                        } catch (e) {
                          alert(
                            e instanceof ApiError ? e.message : "Download failed",
                          );
                        }
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 text-[12px]"
                    >
                      <span>📄</span>
                      <span className="flex-1 truncate font-medium">
                        {d.filename}
                      </span>
                      <span className="text-[10px] text-text-muted whitespace-nowrap">
                        {new Date(d.uploaded_at).toLocaleDateString()}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
      {uploadErr && (
        <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 mb-2">
          {uploadErr}
        </div>
      )}
      {isLoading ? (
        <div className="text-xs text-text-muted italic">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-xs text-text-muted italic">
          {canUpload
            ? "No contract documents uploaded yet — click Upload to add one."
            : "No contract documents uploaded yet."}
        </div>
      ) : (
        <div className="text-[11px] text-text-muted">
          Latest:{" "}
          <b className="text-text-primary">{items[0].filename}</b>{" "}
          · uploaded{" "}
          {new Date(items[0].uploaded_at).toLocaleString()}
        </div>
      )}
    </div>
  );
}

type ContractDoc = {
  id: string;
  filename: string;
  uploaded_at: string;
  deleted_at: string | null;
};
