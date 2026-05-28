import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useUnsavedChangesGuard } from "@/lib/use-unsaved-changes";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import { KindUploadCard } from "@/components/KindUploadCard";
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
} from "@/types/engagement";
import type { ExtractedEngagement } from "@/types/mom_extraction";
import type { Category, Geography } from "@/types/lookup";

const MIN_OBJECTIVE_WORDS = 120;

export default function PreSalesTab() {
  const account = useAccountFromLayout();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const handoverMutation = useMutation({
    mutationFn: () =>
      api.post<{
        account_id: string;
        handed_off_to_solutioning: boolean;
        handed_off_at: string | null;
      }>(`/api/v1/accounts/${account.id}/handover-to-solutioning`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["account", account.id] });
      qc.invalidateQueries({ queryKey: ["activity", account.id] });
      navigate(`/accounts/${account.id}/solutioning`);
    },
  });

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
    onError: (e: ApiError) => setSavingError(e.message),
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
  };
  const guard = useUnsavedChangesGuard({
    dirty,
    isSaving: saveMutation.isPending,
    onSaveShortcut: saveDirty,
  });

  if (isLoading || !form) {
    return <div className="text-sm text-text-muted">Loading engagement info…</div>;
  }
  if (isError) {
    return <div className="text-sm text-red-700">Failed to load engagement info.</div>;
  }

  const wordCount = countWords(form.engagement_objective ?? "");
  const showWarning =
    !form.ai_quality_dismissed &&
    aiResult !== null &&
    aiResult.score < 3;

  return (
    <div className="space-y-4">
      {/* R13 — Signing-state banner. Surfaces here so Pre-Sales editors know
          when the gate has been re-opened (Sales is mid-correction) or
          locked-in, without having to bounce to the Sales Handoff tab. */}
      {account.gate_signed && (
        <div
          className={cn(
            "rounded-card border px-4 py-3 flex items-center gap-3",
            account.gate_unlocked
              ? "bg-amber-50 border-amber-200"
              : "bg-emerald-50 border-emerald-200",
          )}
        >
          <span className="text-[18px]">
            {account.gate_unlocked ? "🔓" : "🔒"}
          </span>
          <div className="flex-1 text-[12px]">
            {account.gate_unlocked ? (
              <>
                <b className="text-amber-900">Signing unlocked</b> — Sales is
                re-confirming contract details. Engagement edits made here may
                be revisited after re-confirmation.
              </>
            ) : (
              // 27-May Row 78 — verbiage change to make the locked
              // state explicit ("section is locked", not just "signed").
              <>
                <b className="text-emerald-800">This section is locked</b>
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

      {/* MoM uploads — first thing on Pre-Sales so the discovery story
          lives next to the engagement objective + categories. */}
      <KindUploadCard
        accountId={account.id}
        kind="mom"
        title="Meeting Minutes (MoM)"
        description="Upload discovery / kick-off / cadence MoMs. Claude will summarise each and auto-extract structured fields into Engagement, Brief, and Contacts."
        emptyHint="No MoMs uploaded yet. Drag a .docx, .pdf, .txt, .vtt or .eml onto the card above."
      />

      {/* 27-May Row 75 — Pre-Meeting Brief now opens INLINE on Pre-Sales
          via a collapsible <details> disclosure. Stakeholder didn't
          want users redirected away to a separate tab; the standalone
          /brief route is kept for deep-links but the primary entry
          point is here next to the MoM upload area. */}
      <details className="group bg-white rounded-card border border-beroe-card-border overflow-hidden">
        <summary className="px-5 py-3 cursor-pointer list-none flex items-center gap-2 hover:bg-slate-50 transition-colors">
          <span className="text-sm font-bold text-text-primary">
            🗓 Pre-Meeting Brief
          </span>
          <span className="text-[11px] text-text-muted">
            · Call info, attendees, objectives, minefields, cheat sheet
          </span>
          <span className="ml-auto text-xs text-beroe-blue font-semibold flex items-center gap-1">
            <span className="group-open:hidden">▾ Open inline</span>
            <span className="hidden group-open:inline">▴ Collapse</span>
          </span>
        </summary>
        <div className="border-t border-beroe-card-border p-4 bg-slate-50/50">
          <PreMeetingBriefInline accountId={account.id} />
        </div>
      </details>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        {/* R14 — Engagement Info. 27-May Row 76 — field order is now
            Discovery Date → Discovery Lead → Sales Lead, with SDR
            (existing field, kept for data continuity) moved to the
            end of the section. Categories + Engagement Objective +
            Procurement Maturity follow per the stakeholder sequence. */}
        <Section title="Engagement Info">
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
        <Section title="Target categories" subtitle="What's in scope for this engagement.">
          <CategoryPicker
            selected={form.target_categories}
            onChange={(cats) => setForm({ ...form, target_categories: cats })}
            disabled={!form.is_editable}
          />
        </Section>

        {/* Engagement objective + AI quality check */}
        <Section
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
              "w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-beroe-blue",
              !form.is_editable && "bg-slate-50 text-text-secondary cursor-not-allowed",
            )}
          />
          <div className="flex items-center gap-2 mt-2 text-xs">
            <span
              className={cn(
                "font-semibold",
                wordCount < MIN_OBJECTIVE_WORDS ? "text-amber-700" : "text-green-700",
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
            <div className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {aiError}
            </div>
          )}

          {aiResult && (
            <div
              className={cn(
                "mt-2 rounded-lg px-3 py-2 text-xs border",
                aiResult.score >= 4
                  ? "bg-green-50 border-green-200 text-green-800"
                  : aiResult.score === 3
                    ? "bg-blue-50 border-blue-200 text-blue-800"
                    : "bg-amber-50 border-amber-200 text-amber-800",
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
        <Section title="Geographies">
          <GeographyPicker
            selected={form.geographies}
            onChange={(g) => setForm({ ...form, geographies: g })}
            disabled={!form.is_editable}
          />
        </Section>

        {/* Procurement maturity + AI penetration + spend */}
        <Section title="Profile">
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
            <Field label="Procurement spend ($M)">
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
                  });
                }}
                disabled={!form.is_editable}
                className={inputCls(form.is_editable)}
              />
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

      {/* Handover gate */}
      {form.is_editable && (
        <div className="lg:col-span-3 bg-slate-50 rounded-card border border-beroe-card-border p-4 flex items-center gap-3 flex-wrap">
          <div className="text-sm">
            <div className="font-bold text-text-primary">Pre-Sales → Solutioning handover</div>
            <div className="text-xs text-text-muted">
              {account.handed_off_to_solutioning
                ? `Already handed off${account.handed_off_at ? ` on ${new Date(account.handed_off_at).toLocaleDateString()}` : ""}.`
                : "Once you've captured the engagement objective, target categories, and key stakeholders, hand the account to Solutioning to start VPD work."}
            </div>
          </div>
          <button
            onClick={() => {
              if (account.handed_off_to_solutioning) {
                navigate(`/accounts/${account.id}/solutioning`);
              } else if (confirm("Hand this account over to Solutioning? This is recorded in the activity log.")) {
                handoverMutation.mutate();
              }
            }}
            disabled={handoverMutation.isPending || dirty}
            className="ml-auto px-3 py-1.5 rounded-lg bg-beroe-blue text-white text-xs font-semibold disabled:opacity-50"
            title={dirty ? "Save engagement changes before handing off" : ""}
          >
            {account.handed_off_to_solutioning
              ? "Open Solutioning →"
              : handoverMutation.isPending
                ? "Handing off…"
                : "Hand over to Solutioning →"}
          </button>
        </div>
      )}

      {/* 27-May Row 79 — Handed-to-Solutioning date at end of Pre-Sales.
          Always visible (not gated on form.is_editable) so locked
          accounts still surface the milestone. Renders only when the
          handover has actually happened. */}
      {account.handed_off_to_solutioning && account.handed_off_at && (
        <div className="lg:col-span-3 bg-amber-50 border border-amber-200 rounded-card px-4 py-2.5 flex items-center gap-2.5">
          <span className="text-[16px]">📤</span>
          <div className="text-[12px] text-amber-900">
            <b>Handed off to Solutioning · </b>
            {new Date(account.handed_off_at).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </div>
        </div>
      )}

      {/* Sticky save bar — pulses when dirty */}
      {form.is_editable && (
        <div
          className={cn(
            "lg:col-span-3 sticky bottom-0 -mx-6 px-6 py-3 flex items-center gap-3 border-t z-30 transition-colors",
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
            onClick={() => setForm(data!)}
            disabled={!dirty || saveMutation.isPending}
            className="ml-auto px-3 py-1.5 rounded-lg text-sm border border-slate-200 text-text-secondary disabled:opacity-50 bg-white"
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
    </div>
  );
}

// ---------- Sub-components ----------

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
  const qc = useQueryClient();
  const { data: categories } = useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: () => api.get<Category[]>("/api/v1/lookups/categories"),
    staleTime: 30_000,
  });
  const [proposeText, setProposeText] = useState("");
  const [proposeError, setProposeError] = useState<string | null>(null);
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

  const all = (categories ?? []).map((c) => c);
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
          <div className="flex flex-wrap gap-1">
            {all
              .filter((c) => !selected.includes(c.name))
              .map((c) => (
                <button
                  key={c.id}
                  onClick={() => onChange([...selected, c.name])}
                  className={cn(
                    "text-xs px-2 py-0.5 rounded-full border",
                    c.approved
                      ? "border-slate-200 text-text-secondary hover:bg-slate-50"
                      : "border-amber-200 text-amber-800 bg-amber-50",
                  )}
                  title={c.approved ? "" : "Pending admin approval"}
                >
                  {c.name}{c.approved ? "" : " (pending)"}
                </button>
              ))}
          </div>

          <div className="mt-3 flex gap-1">
            <input
              type="text"
              value={proposeText}
              onChange={(e) => setProposeText(e.target.value)}
              placeholder="Propose a new category…"
              className="flex-1 px-2 py-1 text-xs rounded-md border border-slate-200 focus:outline-none focus:border-beroe-blue"
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
            <div className="mt-1 text-xs text-red-700">{proposeError}</div>
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
  const { data: geos } = useQuery<Geography[]>({
    queryKey: ["geographies"],
    queryFn: () => api.get<Geography[]>("/api/v1/lookups/geographies"),
  });
  return (
    <div>
      <div className="flex flex-wrap gap-1 mb-2">
        {selected.map((name) => (
          <Pill key={name} onRemove={disabled ? undefined : () => onChange(selected.filter((n) => n !== name))}>
            {name}
          </Pill>
        ))}
        {selected.length === 0 && (
          <span className="text-xs text-text-muted">No geographies selected.</span>
        )}
      </div>
      {!disabled && (
        <div className="flex flex-wrap gap-1">
          {(geos ?? [])
            .filter((g) => !selected.includes(g.name))
            .map((g) => (
              <button
                key={g.id}
                onClick={() => onChange([...selected, g.name])}
                className="text-xs px-2 py-0.5 rounded-full border border-slate-200 text-text-secondary hover:bg-slate-50"
              >
                {g.name}
              </button>
            ))}
        </div>
      )}
    </div>
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
    "w-full px-3 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-beroe-blue",
    !enabled && "bg-slate-50 text-text-secondary cursor-not-allowed",
  );
}

function countWords(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
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
    "procurement_spend_musd", "geographies",
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
        <div className="text-[10px] text-red-700 mt-0.5">
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
function PreMeetingBriefInline({ accountId }: { accountId: string }) {
  return <MeetingBriefEditor accountId={accountId} />;
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
const FUNCTION_LABELS: Record<string, string> = {
  procurement: "Procurement",
  supply_chain: "Supply Chain",
  finance: "Finance",
  operations: "Operations",
  it: "IT",
  other: "Other",
};

function ClientContactsInline({ accountId }: { accountId: string }) {
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

  if (isLoading) {
    return (
      <div className="bg-white rounded-card border border-beroe-card-border px-5 py-4 text-[12px] text-text-muted">
        Loading client contacts…
      </div>
    );
  }
  if (isError) {
    return (
      <div className="bg-red-50 rounded-card border border-red-200 px-5 py-3 text-[12px] text-red-700">
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

  const renderContact = (c: ContactRow) => (
    <div
      key={c.id}
      className="flex items-start gap-2 py-1.5 border-b border-beroe-card-border/40 last:border-b-0 text-[12px]"
    >
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-text-primary truncate">
          {c.name}
          {c.title && (
            <span className="font-normal text-text-secondary">
              {" · "}{c.title}
            </span>
          )}
        </div>
        <div className="text-[11px] text-text-muted flex items-center gap-1.5 flex-wrap">
          {c.function && (
            <span>{FUNCTION_LABELS[c.function] ?? c.function}</span>
          )}
          {c.decision_power && (
            <span className="px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200 font-semibold">
              {DECISION_LABELS[c.decision_power] ?? c.decision_power}
            </span>
          )}
          {c.email && (
            <a
              href={`mailto:${c.email}`}
              className="text-beroe-blue hover:underline"
            >
              {c.email}
            </a>
          )}
        </div>
      </div>
    </div>
  );

  const sectionStyle = (count: number) =>
    cn(
      "rounded-md border px-3 py-2",
      count > 0
        ? "bg-white border-beroe-card-border"
        : "bg-slate-50 border-beroe-card-border/60",
    );

  return (
    <div className="bg-white rounded-card border border-beroe-card-border p-4">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div>
          <div className="text-[14px] font-bold text-text-primary">
            Client Contacts
          </div>
          <div className="text-[11px] text-text-muted">
            SPOC · Executive Sponsor · Power Users · contact details
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate(`/accounts/${accountId}/contacts`)}
          className="text-[11px] text-beroe-blue font-semibold hover:underline"
        >
          + Add / Edit Contacts →
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className={sectionStyle(spoc.length)}>
          <div className="text-[10px] uppercase tracking-wider font-bold text-emerald-700 mb-1.5">
            ⭐ SPOC ({spoc.length})
          </div>
          {spoc.length === 0 ? (
            <div className="text-[11px] text-text-muted italic">
              No SPOC marked — mark a contact as SPOC from the Contacts page.
            </div>
          ) : (
            spoc.map(renderContact)
          )}
        </div>

        <div className={sectionStyle(sponsor.length)}>
          <div className="text-[10px] uppercase tracking-wider font-bold text-violet-700 mb-1.5">
            👤 Executive Sponsor ({sponsor.length})
          </div>
          {sponsor.length === 0 ? (
            <div className="text-[11px] text-text-muted italic">
              No exec sponsor marked yet.
            </div>
          ) : (
            sponsor.map(renderContact)
          )}
        </div>

        <div className={sectionStyle(power.length)}>
          <div className="text-[10px] uppercase tracking-wider font-bold text-amber-700 mb-1.5">
            ⚡ Power Users ({power.length})
          </div>
          {power.length === 0 ? (
            <div className="text-[11px] text-text-muted italic">
              No other contacts captured.
            </div>
          ) : (
            <div>{power.slice(0, 6).map(renderContact)}</div>
          )}
          {power.length > 6 && (
            <div className="text-[10px] italic text-text-muted mt-1">
              + {power.length - 6} more on the Contacts page
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
