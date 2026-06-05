import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useUnsavedChangesGuard } from "@/lib/use-unsaved-changes";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import { useConfirm } from "@/components/DialogProvider";
import { KindUploadCard } from "@/components/KindUploadCard";
import { HelpTooltip } from "@/components/HelpTooltip";
import { MeetingBriefEditor } from "@/components/MeetingBriefEditor";
import {
  EXTRACTION_APPLIED_EVENT,
  consumeEngagementSlice,
} from "@/lib/extractionDraft";
import { useAccountFromLayout } from "../AccountProfileLayout";
import type {
  Engagement,
  EngagementUpdate,
  MaturityLevel,
  QualityCheckResponse,
  SpendCurrency,
} from "@/types/engagement";
import { SPEND_CURRENCIES } from "@/types/engagement";
import type { ExtractedEngagement } from "@/types/mom_extraction";
import type { Category, Geography } from "@/types/lookup";

const MIN_OBJECTIVE_WORDS = 120;

export default function PreSalesTab() {
  const account = useAccountFromLayout();
  const qc = useQueryClient();
  const navigate = useNavigate();
  // 03-Jun bug — handover button (and its mutation + confirm dialog)
  // removed; Solutioning is reachable from the Account Kit sub-nav.

  const { data, isLoading, isError } = useQuery<Engagement>({
    queryKey: ["engagement", account.id],
    queryFn: () => api.get<Engagement>(`/api/v1/accounts/${account.id}/engagement`),
  });

  // Local form state — initialised once when the server payload arrives.
  const [form, setForm] = useState<Engagement | null>(null);
  const [savingError, setSavingError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<QualityCheckResponse | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    if (data && !form) {
      // First mount with server data → check for an MoM-extraction draft and
      // merge it over the server value so the form opens dirty.
      const draft = consumeEngagementSlice(account.id);
      setForm(draft ? mergeEngagementDraft(data, draft) : data);
    }
  }, [data, form, account.id]);

  // The user can click "Extract fields" while already on this tab — listen
  // for the broadcast event and merge the draft into the live form state.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ accountId: string }>).detail;
      if (!detail || detail.accountId !== account.id) return;
      const draft = consumeEngagementSlice(account.id);
      if (!draft) return;
      setForm((prev) => (prev ? mergeEngagementDraft(prev, draft) : prev));
    };
    window.addEventListener(EXTRACTION_APPLIED_EVENT, handler);
    return () => window.removeEventListener(EXTRACTION_APPLIED_EVENT, handler);
  }, [account.id]);

  const dirty = useMemo(() => {
    if (!form || !data) return false;
    return JSON.stringify(serialise(form)) !== JSON.stringify(serialise(data));
  }, [form, data]);

  const saveMutation = useMutation({
    mutationFn: (body: EngagementUpdate) =>
      api.patch<Engagement>(`/api/v1/accounts/${account.id}/engagement`, body),
    onSuccess: (saved) => {
      qc.setQueryData(["engagement", account.id], saved);
      qc.invalidateQueries({ queryKey: ["activity", account.id] });
      setForm(saved);
      setSavingError(null);
      setAiResult(null);
    },
    onError: (e: ApiError) => {
      setSavingError(e.message);
      // 28-May — Same revert-on-lock pattern as SolutioningTab. If the
      // server rejects the save (409 lock / 403 RBAC), clear the dirty
      // state so the user can navigate freely. The banner / 403 redirect
      // already communicates why edits aren't possible.
      if ((e.status === 409 || e.status === 403) && data) {
        setForm(data);
      }
    },
  });

  const aiMutation = useMutation({
    mutationFn: (text: string) =>
      api.post<QualityCheckResponse>("/api/v1/ai/quality-check", { text }),
    onSuccess: (r) => {
      setAiResult(r);
      setAiError(null);
    },
    onError: (e: ApiError) => setAiError(e.message),
  });

  // Unsaved-changes guard — beforeunload + in-app nav intercept + Cmd/S.
  const saveDirty = () => {
    if (form && data) saveMutation.mutate(diff(form, data));
    // 28-May — cross-save event to keep Solutioning (sibling in the
    // merged tab) in lockstep. See matching listener in SolutioningTab.
    window.dispatchEvent(
      new CustomEvent("kit:save-companion", { detail: { accountId: account.id } }),
    );
  };

  // 28-May — Listen for companion save signal (Solutioning saved →
  // we save ourselves if dirty). Both directions wired so either
  // tab's Save button saves the other.
  useEffect(() => {
    const onCompanion = (e: Event) => {
      const detail = (e as CustomEvent<{ accountId: string }>).detail;
      if (!detail || detail.accountId !== account.id) return;
      if (!form || !data || saveMutation.isPending) return;
      // 28-May — respect lock state. If Pre-Sales engagement is
      // read-only for this user (e.g. account signed + locked), skip
      // the companion save; the server would just 403.
      if (!form.is_editable) return;
      const changes = diff(form, data);
      if (Object.keys(changes).length > 0) {
        saveMutation.mutate(changes);
      }
    };
    window.addEventListener("kit:save-companion", onCompanion);
    return () => window.removeEventListener("kit:save-companion", onCompanion);
  }, [form, data, account.id, saveMutation]);
  const guard = useUnsavedChangesGuard({
    dirty,
    isSaving: saveMutation.isPending,
    onSaveShortcut: saveDirty,
  });

  if (isLoading || !form) {
    return <div className="text-sm text-text-muted">Loading engagement info…</div>;
  }
  if (isError) {
    return <div className="text-sm text-beroe-red">Failed to load engagement info.</div>;
  }

  const wordCount = countWords(form.engagement_objective ?? "");
  const showWarning =
    !form.ai_quality_dismissed &&
    aiResult !== null &&
    aiResult.score < 3;

  return (
    <div className="space-y-4">
      {/* 28-May — Pre-Sales track divider (prototype line 5837-5841).
          Dashed line on either side with the workflow caption in muted
          grey: "Pre-Sales track · SDR → Solutioning → Sales". */}
      <div className="flex items-center gap-2.5">
        <div
          className="flex-1 border-t-[1.5px] border-dashed"
          style={{ borderColor: "var(--cb, #e4eaf6)" }}
        />
        <span
          className="text-[10px] font-semibold whitespace-nowrap"
          style={{ color: "var(--t3, #94a3b8)" }}
        >
          Pre-Sales track · SDR → Solutioning → Sales
        </span>
        <div
          className="flex-1 border-t-[1.5px] border-dashed"
          style={{ borderColor: "var(--cb, #e4eaf6)" }}
        />
      </div>

      {/* R13 — Signing-state banner. Surfaces here so Pre-Sales editors know
          when the gate has been re-opened (Sales is mid-correction) or
          locked-in, without having to bounce to the Sales Handoff tab. */}
      {account.gate_signed && (
        <div
          className={cn(
            "rounded-card border px-4 py-3 flex items-center gap-3",
            account.gate_unlocked
              ? "bg-beroe-amber/15 border-beroe-amber/40"
              : "bg-beroe-green/15 border-beroe-green/30",
          )}
        >
          <span className="text-[18px]">
            {account.gate_unlocked ? "🔓" : "🔒"}
          </span>
          <div className="flex-1 text-[12px]">
            {account.gate_unlocked ? (
              <>
                <b className="text-beroe-amber">Signing unlocked</b> — Sales is
                re-confirming contract details. Engagement edits made here may
                be revisited after re-confirmation.
              </>
            ) : (
              // 27-May Row 78 — verbiage change to make the locked
              // state explicit ("section is locked", not just "signed").
              <>
                <b className="text-beroe-green">This section is locked</b>
                {" "}— the account has been signed
                {account.gate_signed_date && (
                  <span className="text-text-secondary">
                    {" "}on {new Date(account.gate_signed_date).toLocaleDateString()}
                  </span>
                )}
                . Showing historical context only.
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => navigate(`/accounts/${account.id}/account-kit/sales-handoff`)}
            className="text-[11px] font-semibold text-beroe-blue hover:underline"
          >
            Open Sales Hand-off →
          </button>
        </div>
      )}

      {/* 05-Jun — Pre-Meeting Brief inline ABOVE the MoM upload. The brief
          auto-populates from the most recent MoM upload (same wiring as
          the previous overlay). User explicitly asked for the entire
          presentation + edit experience to live above the MoM, not as a
          separate popup. */}
      <PreMeetingBriefInline accountId={account.id} />

      {/* MoM uploads — sits BELOW the brief now. The brief reads from the
          most recent MoM extraction draft and merges it section by section. */}
      <KindUploadCard
        accountId={account.id}
        kind="mom"
        title="Meeting Minutes (MoM)"
        description="Upload discovery / kick-off / cadence MoMs. Claude will summarise each and auto-extract structured fields into Engagement, Brief, and Contacts."
        emptyHint="No MoMs uploaded yet. Drag a .docx, .pdf, .txt, .vtt or .eml onto the card above."
      />

      {/* 05-Jun — Pre-Meeting Brief no longer lives as a separate overlay.
          Component sits above the MoM upload card (PreMeetingBriefInline). */}

      {/* 28-May — Wrap all Pre-Sales fields inside the prototype's outer
          A) Pre-Sales & Discovery card (line 5848-5912). Single white
          card with violet "A" badge header and "SDR / Presales" team
          pill. Inner sections render as grey-blue UPPERCASE group
          labels (Section variant="group") instead of separate cards.
          Opacity dims to 0.85 when locked, matching the prototype. */}
      <div
        className={cn(
          "bg-white rounded-card border border-beroe-card-border p-5",
          account.gate_signed && !account.gate_unlocked && "opacity-[0.85]",
        )}
      >
        <div className="flex items-center gap-2 mb-3">
          <span
            className="w-[22px] h-[22px] rounded-md text-white text-[10px] font-extrabold flex items-center justify-center flex-shrink-0"
            style={{ background: "#4A00F8" }}
          >
            A
          </span>
          <span className="text-[14px] font-bold text-text-primary">
            Pre-Sales & Discovery
          </span>
          <span
            className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
            style={{
              background: "#4A00F815",
              color: "#4A00F8",
              border: "1px solid #4A00F830",
            }}
          >
            SDR / Presales
          </span>
        </div>

        {/* R14 — Engagement Info. 27-May Row 76 — field order is now
            Discovery Date → Discovery Lead → Sales Lead, with SDR
            (existing field, kept for data continuity) moved to the
            end of the section. Categories + Engagement Objective +
            Procurement Maturity follow per the stakeholder sequence. */}
        <Section variant="group" title="Engagement Info">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Discovery Date">
              <input
                type="date"
                value={form.pre_discovery_date ?? ""}
                max={todayISO()}
                onChange={(e) =>
                  setForm({ ...form, pre_discovery_date: e.target.value || null })
                }
                disabled={!form.is_editable}
                className={inputCls(form.is_editable)}
              />
              <div className="text-[10px] text-text-muted mt-0.5">
                Must be today or earlier — discovery is a past event.
              </div>
            </Field>
            <Field label="Discovery lead">
              <BeroeUserPicker
                value={form.discovery_lead ?? null}
                onChange={(v) => setForm({ ...form, discovery_lead: v })}
                disabled={!form.is_editable}
                placeholder="Pick the teammate running discovery"
              />
            </Field>
            <Field label="Sales lead">
              <BeroeUserPicker
                value={form.sales_lead ?? null}
                onChange={(v) => setForm({ ...form, sales_lead: v })}
                disabled={!form.is_editable}
                placeholder="Pick the sales owner for this account"
              />
            </Field>
            <Field label="SDR / lead source">
              <BeroeUserPicker
                value={form.sdr_lead ?? null}
                onChange={(v) => setForm({ ...form, sdr_lead: v })}
                disabled={!form.is_editable}
                placeholder="Pick the SDR who sourced this account"
              />
            </Field>
          </div>
        </Section>

        {/* 27-May Row 76 — Target categories now sits before the
            Engagement Objective per the stakeholder's sequence. */}
        <Section variant="group" title="Target categories" subtitle="What's in scope for this engagement.">
          <CategoryPicker
            selected={form.target_categories}
            onChange={(cats) => setForm({ ...form, target_categories: cats })}
            disabled={!form.is_editable}
          />
        </Section>

        {/* Engagement objective + AI quality check */}
        <Section
          variant="group"
          title="Engagement objective"
          subtitle={`Recommended ≥ ${MIN_OBJECTIVE_WORDS} words. Be specific about the outcome and the metric.`}
        >
          <textarea
            rows={6}
            value={form.engagement_objective ?? ""}
            onChange={(e) =>
              setForm({ ...form, engagement_objective: e.target.value, ai_quality_dismissed: false })
            }
            disabled={!form.is_editable}
            placeholder="What does success look like? Include the outcome, the metric, and the timeframe…"
            className={cn(
              "w-full px-3 py-2 rounded-lg border border-beroe-card-border text-sm focus:outline-none focus:border-beroe-blue",
              !form.is_editable && "bg-beroe-bg text-text-secondary cursor-not-allowed",
            )}
          />
          <div className="flex items-center gap-2 mt-2 text-xs">
            <span
              className={cn(
                "font-semibold",
                wordCount < MIN_OBJECTIVE_WORDS ? "text-beroe-amber" : "text-beroe-green",
              )}
            >
              {wordCount} word{wordCount === 1 ? "" : "s"}
            </span>
            {wordCount < MIN_OBJECTIVE_WORDS && wordCount > 0 && (
              <span className="text-text-muted">
                · {MIN_OBJECTIVE_WORDS - wordCount} more for the recommended length
              </span>
            )}
            <button
              onClick={() => aiMutation.mutate(form.engagement_objective ?? "")}
              disabled={!form.engagement_objective || aiMutation.isPending}
              className="ml-auto text-xs px-2 py-1 rounded-md border border-beroe-blue text-beroe-blue font-semibold hover:bg-beroe-blue/5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {aiMutation.isPending ? "Checking…" : "✨ AI quality check"}
            </button>
          </div>

          {aiError && (
            <div className="mt-2 text-xs text-beroe-red bg-beroe-red/10 border border-beroe-red/30 rounded-lg px-3 py-2">
              {aiError}
            </div>
          )}

          {aiResult && (
            <div
              className={cn(
                "mt-2 rounded-lg px-3 py-2 text-xs border",
                aiResult.score >= 4
                  ? "bg-beroe-green/15 border-beroe-green/30 text-beroe-green"
                  : aiResult.score === 3
                    ? "bg-beroe-blue/10 border-beroe-blue/30 text-beroe-blue"
                    : "bg-beroe-amber/15 border-beroe-amber/40 text-beroe-amber",
              )}
            >
              <div className="font-bold">
                {scoreLabel(aiResult.score)} ({aiResult.score}/5)
                {aiResult.is_stub && (
                  <span className="ml-2 text-[10px] font-normal opacity-70">
                    [stub — Anthropic key not configured]
                  </span>
                )}
              </div>
              <div className="mt-0.5">{aiResult.comment}</div>
              {showWarning && form.is_editable && (
                <button
                  onClick={() =>
                    saveMutation.mutate({ ai_quality_dismissed: true })
                  }
                  className="mt-2 text-[11px] underline"
                >
                  Dismiss this warning
                </button>
              )}
            </div>
          )}
        </Section>

        {/* Geographies */}
        <Section variant="group" title="Geographies">
          <GeographyPicker
            selected={form.geographies}
            onChange={(g) => setForm({ ...form, geographies: g })}
            disabled={!form.is_editable}
          />
        </Section>

        {/* Procurement maturity + AI penetration + spend */}
        <Section variant="group" title="Profile">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <MaturitySelect
              label="Procurement maturity"
              value={form.procurement_maturity}
              onChange={(v) => setForm({ ...form, procurement_maturity: v })}
              disabled={!form.is_editable}
            />
            <MaturitySelect
              label="AI penetration"
              value={form.ai_penetration}
              onChange={(v) => setForm({ ...form, ai_penetration: v })}
              disabled={!form.is_editable}
            />
            <Field
              label={`Procurement spend (M ${form.procurement_spend_currency ?? "USD"})`}
            >
              <div className="flex gap-1.5">
                <CurrencyPicker
                  value={form.procurement_spend_currency ?? "USD"}
                  onChange={(code) =>
                    setForm({ ...form, procurement_spend_currency: code })
                  }
                  disabled={!form.is_editable}
                />
                <input
                  type="number"
                  step="0.01"
                  min={0}
                  value={form.procurement_spend_musd ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    // Strip a leading minus on the fly so users can't even type
                    // negatives (server enforces ge=0 too as belt-and-braces).
                    const cleaned = v.replace(/^-/, "");
                    setForm({
                      ...form,
                      procurement_spend_musd: cleaned === "" ? null : cleaned,
                      // Default currency to USD if the user enters an amount
                      // before picking a currency, so the server gets a code.
                      procurement_spend_currency:
                        form.procurement_spend_currency ?? "USD",
                    });
                  }}
                  disabled={!form.is_editable}
                  className={cn(inputCls(form.is_editable), "flex-1 min-w-0")}
                  placeholder="0"
                />
              </div>
            </Field>
          </div>
        </Section>
      </div>

      {/* 27-May Row 77 — Merged "Client Contacts" section replacing the
          old Stakeholders free-text column + the separate Manage Contacts
          shortcut. Surfaces SPOC / Executive Sponsor / Power Users
          INLINE from the real client_contacts table (not the engagement
          jsonb free-text), with full Name / Title / Function / Influence
          per row. Standalone /accounts/:id/contacts route still works
          for full management (deep-links, bulk operations). */}
      <div className="lg:col-span-3">
        <ClientContactsInline accountId={account.id} />
      </div>

      {/* 28-May — Handoff gate restyled to mirror prototype line 5907-5911.
          Three states:
            1) editable + not handed off → full-width VIOLET button with
               2px dashed violet top border above + caption below
            2) already handed off       → small green pill "Handed off
               to Solutioning on DATE" with check icon
            3) locked (signed)          → handoff is no longer relevant;
               banner at top already covers locked-state messaging
          The amber "📤 Handed off to Solutioning · DATE" strip from
          Row 79 lives below this and stays unchanged. */}
      {/* 03-Jun bug — "Hand off to Solutioning" button removed from
          Pre-Sales per stakeholder spec. Solutioning is reachable from
          the Account Kit sub-nav directly; no separate handover gate. */}

      {/* 27-May Row 79 — Handed-to-Solutioning date at end of Pre-Sales.
          Always visible (not gated on form.is_editable) so locked
          accounts still surface the milestone. Renders only when the
          handover has actually happened. */}
      {account.handed_off_to_solutioning && account.handed_off_at && (
        <div className="lg:col-span-3 bg-beroe-amber/15 border border-beroe-amber/40 rounded-card px-4 py-2.5 flex items-center gap-2.5">
          <span className="text-[16px]">📤</span>
          <div className="text-[12px] text-beroe-amber">
            <b>Handed off to Solutioning · </b>
            {new Date(account.handed_off_at).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </div>
        </div>
      )}

      {/* 03-Jun bug 8 — Standalone Pre-Meeting Brief disclosure removed;
          the brief is now opened via the BriefOverlayButton on the MoM
          upload card at the top of this tab. */}

      {/* Sticky save bar — pulses when dirty */}
      {form.is_editable && (
        <div
          className={cn(
            "lg:col-span-3 sticky bottom-0 -mx-4 px-4 py-3 flex items-center gap-3 border-t z-30 transition-colors rounded-b-card",
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
            onClick={() => setForm(data!)}
            disabled={!dirty || saveMutation.isPending}
            className="ml-auto px-3 py-1.5 rounded-lg text-sm border border-beroe-card-border text-text-secondary disabled:opacity-50 bg-white"
          >
            Discard
          </button>
          <button
            onClick={saveDirty}
            disabled={!dirty || saveMutation.isPending}
            className="px-4 py-1.5 rounded-lg bg-beroe-blue text-white text-sm font-semibold disabled:opacity-50"
          >
            {saveMutation.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      )}

      {/* Unsaved-changes guard dialog */}
      {guard.pendingHref && (
        <UnsavedChangesDialog
          pendingHref={guard.pendingHref}
          saving={saveMutation.isPending}
          onSaveAndGo={async () => {
            try {
              if (form && data) await saveMutation.mutateAsync(diff(form, data));
              guard.proceed();
            } catch {
              /* error already surfaces in savingError; user can retry or discard */
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
}

// ---------- Sub-components ----------

function Section({
  title,
  subtitle,
  children,
  variant = "card",
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  /**
   * "card"  → outer white card with border (legacy default)
   * "group" → 28-May port of prototype line 5853-format. UPPERCASE
   *           grey-blue label, no card border. Use inside a parent
   *           wrapper card (e.g. PreSalesDiscoveryCard) to mirror the
   *           prototype's grouped layout.
   */
  variant?: "card" | "group";
}) {
  // 03-Jun bug 6 — `subtitle` is now rendered as a hover tooltip on
  // a small italic ⓘ badge next to the title, not as inline muted text.
  if (variant === "group") {
    return (
      <div className="mb-3">
        <div
          className="flex items-center gap-1.5 mb-2"
          style={{ color: "#6b7fa0" }}
        >
          <div className="text-[12px] font-bold uppercase tracking-[0.05em]">{title}</div>
          <HelpTooltip text={subtitle} />
        </div>
        {children}
      </div>
    );
  }
  return (
    <div className="bg-white rounded-card border border-beroe-card-border p-5">
      <div className="flex items-center gap-1.5 mb-3">
        <h2 className="text-sm font-bold text-text-primary">{title}</h2>
        <HelpTooltip text={subtitle} />
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3 last:mb-0">
      <label className="block text-[11px] uppercase tracking-wider text-text-muted font-bold mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}

function MaturitySelect({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: MaturityLevel | null;
  onChange: (v: MaturityLevel | null) => void;
  disabled: boolean;
}) {
  return (
    <Field label={label}>
      <select
        value={value ?? ""}
        onChange={(e) => onChange((e.target.value || null) as MaturityLevel | null)}
        disabled={disabled}
        className={inputCls(!disabled)}
      >
        <option value="">— Select —</option>
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
      </select>
    </Field>
  );
}

function CategoryPicker({
  selected,
  onChange,
  disabled,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
  disabled: boolean;
}) {
  // Migration 0050 grew the canonical list to ~2,879 categories across
  // 22 domains. Listing them all as buttons caused unusable scroll, so
  // this picker is now:
  //   - selected chips on top (clickable to remove)
  //   - domain filter dropdown (top of suggestions)
  //   - typeahead search input (case-insensitive substring)
  //   - results capped at 30 matches; "Show all N" expands
  //   - propose-new at the bottom (unchanged flow)
  const qc = useQueryClient();
  const { data: categories } = useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/api/v1/lookups/categories"),
    staleTime: 60_000,
  });
  const [proposeText, setProposeText] = useState("");
  const [proposeError, setProposeError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [domainFilter, setDomainFilter] = useState<string>("");
  const [showAllMatches, setShowAllMatches] = useState(false);
  const proposeMutation = useMutation({
    mutationFn: (name: string) => api.post<Category>("/api/v1/lookups/categories", { name }),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: ["categories"] });
      onChange([...selected, c.name]);
      setProposeText("");
      setProposeError(null);
    },
    onError: (e: ApiError) => setProposeError(e.message),
  });

  // Stable identity per render so useMemo deps don't churn.
  const all = useMemo(() => categories ?? [], [categories]);

  // Unique domain list for the dropdown — sorted alphabetically, with
  // "Other" sinking to the end so the meaningful buckets surface first.
  const domains = useMemo(() => {
    const set = new Set<string>();
    for (const c of all) if (c.domain) set.add(c.domain);
    const arr = Array.from(set);
    arr.sort((a, b) => {
      if (a === "Other") return 1;
      if (b === "Other") return -1;
      return a.localeCompare(b);
    });
    return arr;
  }, [all]);

  // Filter pipeline: domain → search → drop already-selected.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((c) => {
      if (selected.includes(c.name)) return false;
      if (domainFilter && c.domain !== domainFilter) return false;
      if (q && !c.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [all, search, domainFilter, selected]);

  // Render cap to keep the panel small — typing further narrows results.
  const RENDER_CAP = 30;
  const visible = showAllMatches ? filtered : filtered.slice(0, RENDER_CAP);

  // Reset "show all" when the search/domain changes so a fresh query
  // doesn't dump thousands of rows.
  useEffect(() => {
    setShowAllMatches(false);
  }, [search, domainFilter]);

  return (
    <div>
      <div className="flex flex-wrap gap-1 mb-2">
        {selected.map((name) => (
          <Pill key={name} onRemove={disabled ? undefined : () => onChange(selected.filter((n) => n !== name))}>
            {name}
          </Pill>
        ))}
        {selected.length === 0 && (
          <span className="text-xs text-text-muted">No categories selected.</span>
        )}
      </div>

      {!disabled && (
        <>
          {/* Search + domain filter row */}
          <div className="flex flex-col sm:flex-row gap-2 mb-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`🔍 Search ${all.length.toLocaleString()} categories…`}
              className="flex-1 px-2 py-1.5 text-[12px] rounded-md border border-beroe-card-border focus:outline-none focus:border-beroe-blue"
            />
            <SpendPoolPicker
              value={domainFilter}
              options={domains}
              onChange={setDomainFilter}
            />
          </div>

          {/* Hint when nothing is being filtered yet */}
          {!search && !domainFilter && (
            <div className="text-[11px] text-text-muted mb-2 bg-beroe-bg border border-beroe-card-border rounded-md px-2 py-1.5">
              💡 Type to search ({all.length.toLocaleString()} categories) or pick
              a Spend Pool to narrow down. Showing first {RENDER_CAP} alphabetically.
            </div>
          )}

          {/* Result count */}
          <div className="text-[10px] text-text-muted mb-1">
            {filtered.length === 0
              ? "No matches."
              : `${filtered.length.toLocaleString()} match${filtered.length === 1 ? "" : "es"}${
                  visible.length < filtered.length ? ` · showing first ${RENDER_CAP}` : ""
                }`}
          </div>

          {/* Result chips */}
          <div className="flex flex-wrap gap-1 max-h-64 overflow-y-auto p-1">
            {visible.map((c) => (
              <button
                key={c.id}
                onClick={() => onChange([...selected, c.name])}
                className={cn(
                  "text-xs px-2 py-0.5 rounded-full border",
                  c.approved
                    ? "border-beroe-card-border text-text-secondary hover:bg-beroe-bg"
                    : "border-beroe-amber/40 text-beroe-amber bg-beroe-amber/15",
                )}
                title={
                  c.approved
                    ? (c.domain ? `${c.domain}${c.availability === "pipeline" ? " · pipeline" : ""}` : "")
                    : "Pending admin approval"
                }
              >
                {c.name}{c.approved ? "" : " (pending)"}
              </button>
            ))}
          </div>

          {filtered.length > RENDER_CAP && !showAllMatches && (
            <button
              onClick={() => setShowAllMatches(true)}
              className="mt-1 text-[11px] text-beroe-blue font-semibold hover:underline"
            >
              Show all {filtered.length.toLocaleString()} matches
            </button>
          )}

          {/* Propose-new */}
          <div className="mt-3 flex gap-1">
            <input
              type="text"
              value={proposeText}
              onChange={(e) => setProposeText(e.target.value)}
              placeholder="Don't see it? Propose a new category…"
              className="flex-1 px-2 py-1 text-xs rounded-md border border-beroe-card-border focus:outline-none focus:border-beroe-blue"
            />
            <button
              onClick={() => proposeText.trim() && proposeMutation.mutate(proposeText.trim())}
              disabled={!proposeText.trim() || proposeMutation.isPending}
              className="text-xs px-2 py-1 rounded-md border border-beroe-blue text-beroe-blue font-semibold disabled:opacity-50"
            >
              {proposeMutation.isPending ? "…" : "Propose"}
            </button>
          </div>
          {proposeError && (
            <div className="mt-1 text-xs text-beroe-red">{proposeError}</div>
          )}
          <div className="mt-1 text-[10px] text-text-muted">
            New categories appear as <i>pending</i> until an admin approves them.
          </div>
        </>
      )}
    </div>
  );
}

function GeographyPicker({
  selected,
  onChange,
  disabled,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
  disabled: boolean;
}) {
  // 1-June bug 01-04/05 — "Geographies / Target Countries" needs a
  // searchable picker, not a flat pill-grid. Backend lookup carries
  // ~5 regions + ~38 countries (migration 0053); typeahead lets users
  // pick any of them without scrolling a wall of pills.
  const { data: geos } = useQuery<Geography[]>({
    queryKey: ["geographies"],
    queryFn: () => api.get<Geography[]>("/api/v1/lookups/geographies"),
    staleTime: 60_000,
  });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const all = useMemo(() => geos ?? [], [geos]);

  // Group entries by region for the unfiltered view. Regions land
  // under their own header; country-only entries (no region) sink
  // into "Other".
  const grouped = useMemo(() => {
    const out: Record<string, Geography[]> = {};
    for (const g of all) {
      const isRegion = !g.region || g.region === g.name;
      const bucket = isRegion ? "Regions" : g.region || "Other";
      (out[bucket] ??= []).push(g);
    }
    // Sort bucket keys: Regions first, then alphabetical.
    return Object.entries(out).sort(([a], [b]) => {
      if (a === "Regions") return -1;
      if (b === "Regions") return 1;
      return a.localeCompare(b);
    });
  }, [all]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return null; // null → use grouped view
    return all.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        (g.region ?? "").toLowerCase().includes(q),
    );
  }, [q, all]);

  const isPicked = (name: string) => selected.includes(name);
  const toggle = (name: string) => {
    if (isPicked(name)) {
      onChange(selected.filter((s) => s !== name));
    } else {
      onChange([...selected, name]);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <div className="flex flex-wrap gap-1 mb-2">
        {selected.map((name) => (
          <Pill
            key={name}
            onRemove={
              disabled ? undefined : () => onChange(selected.filter((n) => n !== name))
            }
          >
            {name}
          </Pill>
        ))}
        {selected.length === 0 && (
          <span className="text-xs text-text-muted">No regions or countries selected.</span>
        )}
      </div>
      {!disabled && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={open}
          className="text-[12px] rounded-md border border-beroe-card-border bg-white px-2 py-1.5 inline-flex items-center gap-1 hover:border-beroe-blue/40 focus:outline-none focus:border-beroe-blue"
        >
          <span className="text-text-secondary">🌍</span>
          <span>Add region or country</span>
          <span
            className={cn(
              "text-[9px] text-text-muted ml-1 transition-transform",
              open && "rotate-180",
            )}
          >
            ▾
          </span>
        </button>
      )}

      {open && (
        <div
          role="listbox"
          aria-label="Select geography"
          className="absolute z-30 mt-1 left-0 w-[300px] rounded-md border border-beroe-card-border bg-white shadow-lg overflow-hidden"
        >
          <div className="p-2 border-b border-beroe-card-border">
            <input
              ref={inputRef}
              type="text"
              placeholder="🔍 Search regions and countries…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full px-2 py-1.5 text-[12px] rounded-md border border-beroe-card-border focus:outline-none focus:border-beroe-blue"
            />
          </div>
          <div className="max-h-[320px] overflow-y-auto">
            {matches !== null ? (
              matches.length === 0 ? (
                <div className="px-3 py-3 text-[11px] text-text-muted text-center">
                  No match for &quot;{query}&quot;.
                </div>
              ) : (
                matches.map((g) => (
                  <GeoRow
                    key={g.id}
                    geo={g}
                    picked={isPicked(g.name)}
                    onToggle={() => toggle(g.name)}
                  />
                ))
              )
            ) : (
              grouped.map(([bucket, list]) => (
                <div key={bucket}>
                  <div className="px-3 py-1 text-[9px] uppercase tracking-wider text-text-muted bg-beroe-bg sticky top-0">
                    {bucket}
                  </div>
                  {list
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((g) => (
                      <GeoRow
                        key={g.id}
                        geo={g}
                        picked={isPicked(g.name)}
                        onToggle={() => toggle(g.name)}
                      />
                    ))}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function GeoRow({
  geo,
  picked,
  onToggle,
}: {
  geo: Geography;
  picked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={picked}
      onClick={onToggle}
      className={cn(
        "w-full px-3 py-2 flex items-center gap-2 text-left text-[12px] hover:bg-beroe-bg",
        picked && "bg-beroe-blue/5",
      )}
    >
      <span
        className={cn(
          "w-3.5 h-3.5 inline-flex items-center justify-center rounded border flex-shrink-0",
          picked
            ? "bg-beroe-blue border-beroe-blue text-white"
            : "border-beroe-card-border bg-white",
        )}
        aria-hidden
      >
        {picked && <span className="text-[9px]">✓</span>}
      </span>
      <span className="flex-1 truncate text-text-primary">{geo.name}</span>
      {geo.region && geo.region !== geo.name && (
        <span className="text-[10px] text-text-muted">{geo.region}</span>
      )}
    </button>
  );
}

function Pill({ children, onRemove }: { children: React.ReactNode; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-beroe-blue/10 text-beroe-blue border border-beroe-blue/30 font-semibold">
      {children}
      {onRemove && (
        <button
          onClick={onRemove}
          className="text-beroe-blue/60 hover:text-beroe-blue ml-0.5"
          aria-label="Remove"
        >
          ×
        </button>
      )}
    </span>
  );
}

// ---------- Helpers ----------

function inputCls(enabled: boolean) {
  return cn(
    "w-full px-3 py-1.5 rounded-lg border border-beroe-card-border text-sm focus:outline-none focus:border-beroe-blue",
    !enabled && "bg-beroe-bg text-text-secondary cursor-not-allowed",
  );
}

function countWords(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

// Currencies pinned at the top of the picker — common procurement currencies
// across Beroe customer base. Order matters (most-likely first).
const COMMON_CURRENCY_CODES: SpendCurrency[] = [
  "USD", "EUR", "GBP", "INR", "JPY", "CNY", "AED", "SGD",
];

/** Compact currency picker — small chip trigger, click opens a search popover
 *  with a "Common" section pinned at the top and the rest scrollable. Replaces
 *  the 27-item native dropdown that was unreadable. */
function CurrencyPicker({
  value,
  onChange,
  disabled,
}: {
  value: SpendCurrency;
  onChange: (code: SpendCurrency) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Close on outside click + ESC.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    // Auto-focus the search on open for keyboard users.
    setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = SPEND_CURRENCIES.find((c) => c.code === value);
  const q = query.trim().toLowerCase();

  const matches = useMemo(() => {
    if (!q) return SPEND_CURRENCIES;
    return SPEND_CURRENCIES.filter(
      (c) =>
        c.code.toLowerCase().includes(q) ||
        c.label.toLowerCase().includes(q) ||
        c.symbol.toLowerCase().includes(q),
    );
  }, [q]);

  const common = useMemo(
    () =>
      COMMON_CURRENCY_CODES.map((code) =>
        SPEND_CURRENCIES.find((c) => c.code === code),
      ).filter((c): c is (typeof SPEND_CURRENCIES)[number] => Boolean(c)),
    [],
  );

  const showCommon = !q;

  return (
    <div ref={wrapRef} className="relative w-[88px] flex-none">
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          inputCls(!disabled),
          "w-full text-left inline-flex items-center justify-between gap-1 pr-2",
        )}
      >
        <span className="truncate">
          <span className="text-text-secondary mr-1">{active?.symbol ?? "$"}</span>
          {value}
        </span>
        <span className={cn("text-[9px] text-text-muted transition-transform", open && "rotate-180")}>
          ▾
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Select currency"
          className="absolute z-30 mt-1 left-0 w-[260px] rounded-md border border-beroe-card-border bg-white shadow-lg overflow-hidden"
        >
          <div className="p-2 border-b border-beroe-card-border">
            <input
              ref={inputRef}
              type="text"
              placeholder="🔍 Search currency…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full px-2 py-1.5 text-[12px] rounded-md border border-beroe-card-border focus:outline-none focus:border-beroe-blue"
            />
          </div>

          <div className="max-h-[260px] overflow-y-auto">
            {showCommon && (
              <>
                <div className="px-3 py-1 text-[9px] uppercase tracking-wider text-text-muted bg-beroe-bg">
                  Common
                </div>
                {common.map((c) => (
                  <CurrencyRow
                    key={`common-${c.code}`}
                    c={c}
                    active={c.code === value}
                    onPick={() => {
                      onChange(c.code);
                      setOpen(false);
                      setQuery("");
                    }}
                  />
                ))}
                <div className="px-3 py-1 text-[9px] uppercase tracking-wider text-text-muted bg-beroe-bg">
                  All currencies
                </div>
              </>
            )}
            {matches.length === 0 ? (
              <div className="px-3 py-3 text-[11px] text-text-muted text-center">
                No match for &quot;{query}&quot;.
              </div>
            ) : (
              matches.map((c) => (
                <CurrencyRow
                  key={c.code}
                  c={c}
                  active={c.code === value}
                  onPick={() => {
                    onChange(c.code);
                    setOpen(false);
                    setQuery("");
                  }}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CurrencyRow({
  c,
  active,
  onPick,
}: {
  c: (typeof SPEND_CURRENCIES)[number];
  active: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      role="option"
      aria-selected={active}
      className={cn(
        "w-full px-3 py-2 flex items-center gap-2 text-left text-[12px] hover:bg-beroe-bg",
        active && "bg-beroe-blue/5",
      )}
    >
      <span className="w-6 text-center text-text-secondary">{c.symbol}</span>
      <span className="font-semibold text-text-primary w-10">{c.code}</span>
      <span className="text-text-secondary truncate">{c.label}</span>
      {active && <span className="ml-auto text-beroe-blue text-[10px]">✓</span>}
    </button>
  );
}

/** Compact Spend-Pool picker — button trigger + click-to-open popover with
 *  search. Replaces the 22-row native dropdown next to the category search. */
function SpendPoolPicker({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (next: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () => (q ? options.filter((o) => o.toLowerCase().includes(q)) : options),
    [q, options],
  );

  const triggerLabel = value || `All Spend Pools (${options.length})`;

  return (
    <div ref={wrapRef} className="relative sm:w-[200px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="w-full text-[12px] rounded-md border border-beroe-card-border bg-white px-2 py-1.5 inline-flex items-center justify-between gap-1 hover:border-beroe-blue/40 focus:outline-none focus:border-beroe-blue"
      >
        <span className={cn("truncate text-left", !value && "text-text-secondary")}>
          {triggerLabel}
        </span>
        <span className={cn("text-[9px] text-text-muted transition-transform shrink-0", open && "rotate-180")}>
          ▾
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Select spend pool"
          className="absolute z-30 mt-1 left-0 w-full min-w-[240px] rounded-md border border-beroe-card-border bg-white shadow-lg overflow-hidden"
        >
          <div className="p-2 border-b border-beroe-card-border">
            <input
              ref={inputRef}
              type="text"
              placeholder="🔍 Search spend pools…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full px-2 py-1.5 text-[12px] rounded-md border border-beroe-card-border focus:outline-none focus:border-beroe-blue"
            />
          </div>
          <div className="max-h-[280px] overflow-y-auto">
            {/* Clear / all entry always at top */}
            <button
              type="button"
              role="option"
              aria-selected={!value}
              onClick={() => {
                onChange("");
                setOpen(false);
                setQuery("");
              }}
              className={cn(
                "w-full px-3 py-2 flex items-center gap-2 text-left text-[12px] hover:bg-beroe-bg border-b border-beroe-card-border",
                !value && "bg-beroe-blue/5 font-semibold",
              )}
            >
              <span className="text-text-secondary">⌫</span>
              <span>All Spend Pools</span>
              <span className="ml-auto text-[10px] text-text-muted">
                {options.length}
              </span>
              {!value && <span className="text-beroe-blue text-[10px]">✓</span>}
            </button>

            {matches.length === 0 ? (
              <div className="px-3 py-3 text-[11px] text-text-muted text-center">
                No match for &quot;{query}&quot;.
              </div>
            ) : (
              matches.map((d) => {
                const active = d === value;
                return (
                  <button
                    key={d}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      onChange(d);
                      setOpen(false);
                      setQuery("");
                    }}
                    className={cn(
                      "w-full px-3 py-2 flex items-center gap-2 text-left text-[12px] hover:bg-beroe-bg",
                      active && "bg-beroe-blue/5",
                    )}
                  >
                    <span className="truncate text-text-primary">{d}</span>
                    {active && (
                      <span className="ml-auto text-beroe-blue text-[10px]">✓</span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function scoreLabel(score: number): string {
  if (score >= 4) return "Strong";
  if (score === 3) return "Acceptable";
  return "Needs work";
}

/** Apply an MoM-extracted slice over the live engagement form. Existing
 *  values are kept when the extraction has nothing for that field; arrays
 *  are REPLACED (not merged) — same wholesale semantic as the multi-selects. */
function mergeEngagementDraft(base: Engagement, draft: ExtractedEngagement): Engagement {
  return {
    ...base,
    engagement_objective: draft.engagement_objective || base.engagement_objective,
    target_categories: draft.target_categories?.length ? draft.target_categories : base.target_categories,
    geographies: draft.geographies?.length ? draft.geographies : base.geographies,
    spoc_text: draft.spoc_text || base.spoc_text,
    sponsor_text: draft.sponsor_text || base.sponsor_text,
    procurement_maturity: (draft.procurement_maturity as MaturityLevel | null) || base.procurement_maturity,
    // 05-Jun — engagement timeline + Beroe-side leads. AI returns names
    // verbatim ("Nivedha", "Aditya Pherwani"); the BeroeUserPicker shows
    // the name as-is and lets the CSM upgrade it to a canonical email.
    pre_discovery_date: draft.pre_discovery_date || base.pre_discovery_date,
    discovery_lead: draft.discovery_lead || base.discovery_lead,
    sales_lead: draft.sales_lead || base.sales_lead,
    sdr_lead: draft.sdr_lead || base.sdr_lead,
    ai_quality_dismissed: false,  // a freshly populated objective should re-trigger AI scoring
  };
}

/** Compute the diff for PATCH — only fields whose value changed go on the wire. */
function diff(next: Engagement, prev: Engagement): EngagementUpdate {
  const out: Record<string, unknown> = {};
  const keys: (keyof EngagementUpdate)[] = [
    "sdr_lead", "pre_discovery_date", "discovery_lead", "sales_lead",
    "target_categories", "engagement_objective",
    "procurement_maturity", "ai_penetration",
    "procurement_spend_musd", "procurement_spend_currency", "geographies",
    "spoc_text", "sponsor_text", "power_users_text",
    "ai_quality_dismissed",
  ];
  for (const k of keys) {
    if (JSON.stringify(next[k]) !== JSON.stringify(prev[k])) {
      out[k] = next[k];
    }
  }
  return out;
}

/** Strip volatile fields before comparing for dirtiness. */
function serialise(e: Engagement): unknown {
  const { updated_at, updated_by, is_editable, ai_quality_score, ...rest } = e;
  return rest;
}

/** ISO yyyy-mm-dd for today — used as the `max` on pre_discovery_date. */
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------- BeroeUserPicker (SDR / Discovery / Sales lead) ----------
//
// Names alone aren't unique over years (many "Gauravs"), so we store the
// canonical Beroe email address. The picker shows "Full Name (email)" so
// the human still recognises the row; saving stores just the email.

interface BeroeUserOpt {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
}

function BeroeUserPicker({
  value,
  onChange,
  disabled,
  placeholder,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  disabled: boolean;
  placeholder?: string;
}) {
  const { data, isLoading, isError } = useQuery<BeroeUserOpt[]>({
    queryKey: ["users-lookup"],
    queryFn: () => api.get<BeroeUserOpt[]>("/api/v1/users/lookup"),
    staleTime: 5 * 60_000,
  });

  // If the saved value isn't in the active-user list (e.g. a teammate left),
  // surface the raw email so it's still visible — picker can't lose data.
  const knownEmails = new Set((data ?? []).map((u) => u.email.toLowerCase()));
  const valueIsStale = !!value && !knownEmails.has(value.toLowerCase());

  return (
    <div>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        disabled={disabled || isLoading}
        className={inputCls(!disabled)}
      >
        <option value="">{isLoading ? "Loading…" : (placeholder ?? "— Select —")}</option>
        {valueIsStale && value && (
          <option value={value}>
            {value} (former teammate)
          </option>
        )}
        {(data ?? []).map((u) => (
          <option key={u.id} value={u.email}>
            {u.full_name ? `${u.full_name} · ${u.email}` : u.email}
          </option>
        ))}
      </select>
      {isError && (
        <div className="text-[10px] text-beroe-red mt-0.5">
          Could not load Beroe users — paste an @beroe-inc.com email manually if needed.
        </div>
      )}
    </div>
  );
}

// 27-May Row 75 — Pre-Meeting Brief inline wrapper. Just renders the
// shared MeetingBriefEditor inside the collapsible disclosure. Kept as
// a thin wrapper (rather than calling MeetingBriefEditor directly in
// the <details>) so future styling tweaks specific to the inline
// presentation have a clean attach point.
// ─────────────────────────────────────────────────────────────
// 05-Jun — Pre-Meeting Brief INLINE above the MoM upload card.
// Replaces the old BriefOverlayButton popup. Stakeholders explicitly
// asked for the entire brief experience (presentation + edit) to live
// in-page above the MoM uploader instead of behind a button. Same
// MeetingBriefEditor underneath — just sits in a collapsible card.
// The brief auto-populates from any uploaded MoM via the existing
// extraction draft pipeline (consumeBriefSlice).
// ─────────────────────────────────────────────────────────────
function PreMeetingBriefInline({ accountId }: { accountId: string }) {
  // Default to expanded so the user lands on the populated brief without
  // an extra click. localStorage keeps the per-account preference.
  const storageKey = `awb:pre-brief-expanded:${accountId}`;
  const [expanded, setExpanded] = useState<boolean>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw === null ? true : raw === "1";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, expanded ? "1" : "0");
    } catch {
      /* swallow */
    }
  }, [storageKey, expanded]);

  return (
    <div className="rounded-card border border-beroe-card-border bg-white overflow-hidden">
      {/* Indigo header strip with the brand pill + chevron */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left"
        style={{ background: "#001137" }}
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="px-2.5 py-0.5 rounded-md text-[11px] font-bold text-white"
            style={{ background: "#4A00F8" }}
          >
            Brief
          </span>
          <span className="text-[13px] text-white font-semibold">
            📝 Pre-Meeting Brief
          </span>
          <span className="text-[10.5px] text-white/55">
            Auto-populated from the most recent MoM upload · edit any section inline
          </span>
        </div>
        <span
          className="text-white/80 text-[14px] transition-transform"
          style={{ transform: expanded ? "rotate(180deg)" : undefined }}
          aria-hidden
        >
          ▼
        </span>
      </button>
      {expanded && (
        <div className="px-4 py-3 bg-white border-t border-beroe-card-border">
          {/* MeetingBriefEditor renders each brief section as a collapsible
              <details>, so within this inline panel sections can still be
              collapsed/expanded independently. */}
          <MeetingBriefEditor accountId={accountId} />
        </div>
      )}
    </div>
  );
}

// 27-May Row 77 — Client Contacts inline section.
//
// Replaces the old stakeholders-jsonb + "Manage Contacts" link with a
// real listing pulled from /api/v1/accounts/:id/contacts, grouped by:
//   1. SPOC                (is_spoc=true)
//   2. Executive Sponsor   (is_sponsor=true, OR decision_power='executive_sponsor')
//   3. Power Users         (everything else with a defined role)
// Each row shows Name · Title · Function · Influence/Decision Power.
// Edit / add still happens on the dedicated /contacts page; that link
// is preserved at the bottom.

type ContactRow = {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  function: string | null;
  seniority: string | null;
  decision_power: string | null;
  is_spoc: boolean;
  is_sponsor: boolean;
};

const DECISION_LABELS: Record<string, string> = {
  executive_sponsor: "Executive Sponsor",
  influencer: "Influencer",
  champion: "Champion",
  detractor: "Detractor",
  unknown: "Unknown",
};
// 29-May bug 29-08 — FUNCTION_LABELS deleted; the new tabular roster
// doesn't surface contact.function. Labels still live in
// types/contact.ts if needed elsewhere.

function ClientContactsInline({ accountId }: { accountId: string }) {
  const qc = useQueryClient();
  const confirmDlg = useConfirm();
  const { data, isLoading, isError } = useQuery<{
    items: ContactRow[];
    total: number;
    is_editable: boolean;
  }>({
    queryKey: ["contacts", accountId],
    queryFn: () =>
      api.get(`/api/v1/accounts/${accountId}/contacts`),
    staleTime: 30_000,
  });
  const navigate = useNavigate();
  const removeMutation = useMutation({
    mutationFn: (contactId: string) =>
      api.delete(`/api/v1/contacts/${contactId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["contacts", accountId] });
      qc.invalidateQueries({ queryKey: ["activity", accountId] });
    },
  });

  if (isLoading) {
    return (
      <div className="bg-white rounded-card border border-beroe-card-border px-5 py-4 text-[12px] text-text-muted">
        Loading client contacts…
      </div>
    );
  }
  if (isError) {
    return (
      <div className="bg-beroe-red/10 rounded-card border border-beroe-red/30 px-5 py-3 text-[12px] text-beroe-red">
        Failed to load contacts. Try refreshing the page.
      </div>
    );
  }

  const items = data?.items ?? [];
  const spoc = items.filter((c) => c.is_spoc);
  const sponsor = items.filter(
    (c) => !c.is_spoc && (c.is_sponsor || c.decision_power === "executive_sponsor"),
  );
  const power = items.filter(
    (c) => !c.is_spoc && !c.is_sponsor && c.decision_power !== "executive_sponsor",
  );

  // 29-May bug 29-08 — renderContact + sectionStyle helpers removed.
  // The 3-card layout is replaced by a top role-summary row + flat
  // tabular roster (see below).

  // 29-May bug 29-08 — derived summary strings for the top "named roles"
  // row. Comma-joined name lists fit the prototype's text-input look.
  const fmtNames = (xs: typeof spoc) =>
    xs.map((c) => c.name).filter(Boolean).join(", ") || "—";
  const spocSummary = fmtNames(spoc);
  const sponsorSummary = fmtNames(sponsor);
  const powerSummary = fmtNames(power);
  const allContacts = [...spoc, ...sponsor, ...power];

  return (
    <div className="bg-white rounded-card border border-beroe-card-border p-4">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="text-[12px] font-bold uppercase tracking-wider text-text-muted">
          Client Contacts
        </div>
        <button
          type="button"
          onClick={() => navigate(`/accounts/${accountId}/contacts`)}
          className="text-[11px] px-3 py-1 rounded-md border border-beroe-blue/30 bg-beroe-blue/5 text-beroe-blue font-semibold hover:bg-beroe-blue/10"
        >
          + Add Contact
        </button>
      </div>

      {/* 29-May bug 29-08 — top role-summary row (3 columns):
          SPOC · Executive Sponsor · Power Users — names as read-only
          text inputs sourced from the contacts list. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        {[
          { label: "SPOC", value: spocSummary, count: spoc.length },
          { label: "Executive Sponsor", value: sponsorSummary, count: sponsor.length },
          { label: "Power Users", value: powerSummary, count: power.length },
        ].map(({ label, value, count }) => (
          <div key={label}>
            <div className="text-[10px] uppercase tracking-wider font-semibold text-text-muted mb-1">
              {label}
            </div>
            <div
              className={cn(
                "text-[12px] rounded-md border px-2.5 py-1.5",
                count > 0
                  ? "bg-white border-beroe-card-border text-text-primary"
                  : "bg-beroe-bg/40 border-beroe-card-border/60 text-text-muted italic",
              )}
            >
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* 29-May bug 29-08 — tabular contact roster (Name | Title |
          Role | Influence). Read-only here; full edit lives on the
          Contacts page (+ Add Contact link above). */}
      {allContacts.length === 0 ? (
        <div className="text-[11px] text-text-muted italic px-1 py-2">
          No contacts captured yet — click "+ Add Contact" to add one.
        </div>
      ) : (
        <div>
          <div className="hidden md:grid grid-cols-[2fr_2fr_1.2fr_1fr_28px] gap-2 px-2 pb-1 text-[10px] uppercase tracking-wider font-semibold text-text-muted">
            <div>Name</div>
            <div>Title</div>
            <div>Role</div>
            <div>Influence</div>
            <div />
          </div>
          <ul className="space-y-1.5">
            {allContacts.map((c) => (
              <li
                key={c.id}
                className="grid grid-cols-1 md:grid-cols-[2fr_2fr_1.2fr_1fr_28px] gap-2 items-center rounded-md border border-beroe-card-border bg-white px-2.5 py-1.5"
              >
                <div className="text-[12px] font-semibold text-text-primary">
                  {c.name}
                </div>
                <div className="text-[11px] text-text-secondary">
                  {c.title ?? "—"}
                </div>
                <div className="text-[11px] text-text-secondary">
                  {c.decision_power
                    ? (DECISION_LABELS[c.decision_power] ?? c.decision_power)
                    : "—"}
                </div>
                <div>
                  <span
                    className={cn(
                      "text-[10px] font-semibold px-1.5 py-0.5 rounded-full",
                      c.seniority === "cxo" || c.seniority === "vp"
                        ? "bg-beroe-green/15 text-beroe-green"
                        : c.seniority === "director"
                          ? "bg-beroe-blue/10 text-beroe-blue"
                          : "bg-beroe-amber/15 text-beroe-amber",
                    )}
                  >
                    {(c.seniority === "cxo" || c.seniority === "vp")
                      ? "High"
                      : c.seniority === "director"
                        ? "Medium"
                        : "Low"}
                  </span>
                </div>
                <div className="flex justify-end">
                  {data?.is_editable && (
                    <button
                      type="button"
                      aria-label={`Remove ${c.name}`}
                      title="Remove from this account"
                      disabled={
                        removeMutation.isPending &&
                        removeMutation.variables === c.id
                      }
                      onClick={async () => {
                        const ok = await confirmDlg({
                          title: `Remove "${c.name}"?`,
                          body: "The contact is soft-deleted and can be restored by an admin within 30 days.",
                          confirmLabel: "Remove",
                          danger: true,
                        });
                        if (ok) removeMutation.mutate(c.id);
                      }}
                      className="w-5 h-5 rounded-full inline-flex items-center justify-center text-text-muted hover:text-beroe-red hover:bg-beroe-red/10 disabled:opacity-40 disabled:cursor-wait"
                    >
                      ×
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
