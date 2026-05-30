import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useUnsavedChangesGuard } from "@/lib/use-unsaved-changes";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import { KindUploadCard } from "@/components/KindUploadCard";
import { VpdMetricsExtractionReview } from "@/components/VpdMetricsExtractionReview";
import {
  EXTRACTION_APPLIED_EVENT,
  consumeSolutioningSlice,
} from "@/lib/extractionDraft";
import type { VpdMetricsExtractionResult } from "@/types/vpd_metrics_extraction";
import { useAccountFromLayout } from "../AccountProfileLayout";
import {
  ENGAGEMENT_TYPE_LABELS,
  type EngagementType,
  type Solutioning,
  type SolutioningLockResponse,
  type SolutioningUpdate,
} from "@/types/solutioning";
import type { ExtractedVpd } from "@/types/vpd_extraction";

const ENGAGEMENT_TYPE_OPTIONS: EngagementType[] = [
  "one_time", "retainer", "subscription", "pilot", "other",
];

export default function SolutioningTab() {
  const account = useAccountFromLayout();
  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery<Solutioning>({
    queryKey: ["solutioning", account.id],
    queryFn: () => api.get<Solutioning>(`/api/v1/accounts/${account.id}/solutioning`),
  });

  const [form, setForm] = useState<Solutioning | null>(null);
  const [savingError, setSavingError] = useState<string | null>(null);
  const [valueThemeInput, setValueThemeInput] = useState("");

  useEffect(() => {
    if (data && !form) {
      const draft = consumeSolutioningSlice(account.id);
      setForm(draft ? mergeSolutioningDraft(data, draft) : data);
    }
  }, [data, form, account.id]);

  // Live event — fires when the user uploads a VPD while this tab is
  // already mounted. Mid-page extraction lands on the form as dirty.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ accountId: string }>).detail;
      if (!detail || detail.accountId !== account.id) return;
      const draft = consumeSolutioningSlice(account.id);
      if (!draft) return;
      setForm((prev) => (prev ? mergeSolutioningDraft(prev, draft) : prev));
    };
    window.addEventListener(EXTRACTION_APPLIED_EVENT, handler);
    return () => window.removeEventListener(EXTRACTION_APPLIED_EVENT, handler);
  }, [account.id]);

  const dirty = !!form && data
    ? JSON.stringify(serialise(form)) !== JSON.stringify(serialise(data))
    : false;

  const saveMutation = useMutation({
    mutationFn: (body: SolutioningUpdate) =>
      api.patch<Solutioning>(`/api/v1/accounts/${account.id}/solutioning`, body),
    onSuccess: (saved) => {
      qc.setQueryData(["solutioning", account.id], saved);
      qc.invalidateQueries({ queryKey: ["activity", account.id] });
      setForm(saved);
      setSavingError(null);
    },
    onError: (e: ApiError) => {
      setSavingError(e.message);
      // 28-May — On a lock/forbidden failure (409 Conflict from the
      // sales-handoff lock, 403 from RBAC), the user's edits can't be
      // persisted. Revert form to the last server-known data so:
      //   1. dirty clears → nav guard stops blocking the next tab click
      //   2. Save button disables (dirty=false)
      //   3. The locked banner already communicates why edits aren't
      //      possible.
      if ((e.status === 409 || e.status === 403) && data) {
        setForm(data);
      }
    },
  });

  // 28-May — In the merged Pre-Sales & Solutioning tab, Pre-Sales is
  // often left with a dirty auto-applied MoM-extraction draft the user
  // never sees. When they click Save on Solutioning + then navigate
  // away, Pre-Sales' guard fires unexpectedly. Listen for a companion
  // save signal from the Pre-Sales side and a matching dispatch from
  // our own save so the two forms stay in lockstep.
  useEffect(() => {
    const onCompanion = (e: Event) => {
      const detail = (e as CustomEvent<{ accountId: string }>).detail;
      if (!detail || detail.accountId !== account.id) return;
      if (!form || !data || saveMutation.isPending) return;
      // 28-May — must respect lock: if Solutioning is locked (or the
      // role can't write), don't auto-fire the companion save — the
      // server would just 409 with the "locked" error. The dirty
      // draft stays in-memory until the user explicitly unlocks.
      if (!form.is_editable) return;
      const changes = diff(form, data);
      if (Object.keys(changes).length > 0) {
        saveMutation.mutate(changes);
      }
    };
    window.addEventListener("kit:save-companion", onCompanion);
    return () => window.removeEventListener("kit:save-companion", onCompanion);
    // form + data are read inside the handler at call-time; deps cover them.
  }, [form, data, account.id, saveMutation]);

  // Sales Hand-off lock — separate POST so the UI can render a clear
  // "before/after locked" state independent of the regular save flow.
  const [lockError, setLockError] = useState<string | null>(null);
  const lockMutation = useMutation({
    mutationFn: () =>
      api.post<SolutioningLockResponse>(`/api/v1/accounts/${account.id}/solutioning/lock`),
    onSuccess: () => {
      // The lock endpoint only returns lock metadata; refetch the whole row
      // so `is_editable` flips and the form re-renders read-only.
      qc.invalidateQueries({ queryKey: ["solutioning", account.id] });
      qc.invalidateQueries({ queryKey: ["activity", account.id] });
      setLockError(null);
    },
    onError: (e: ApiError) => setLockError(e.message),
  });
  const unlockMutation = useMutation({
    mutationFn: () =>
      api.post<SolutioningLockResponse>(`/api/v1/accounts/${account.id}/solutioning/unlock`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["solutioning", account.id] });
      qc.invalidateQueries({ queryKey: ["activity", account.id] });
      setLockError(null);
    },
    onError: (e: ApiError) => setLockError(e.message),
  });

  const saveDirty = () => {
    if (form && data) saveMutation.mutate(diff(form, data));
    // 28-May — also poke Pre-Sales (sibling in the merged tab) to save
    // its dirty draft. Cross-save event keeps both forms in lockstep
    // so the user never sees a stuck dirty-PreSales after clicking
    // Solutioning's Save button.
    window.dispatchEvent(
      new CustomEvent("kit:save-companion", { detail: { accountId: account.id } }),
    );
  };
  const guard = useUnsavedChangesGuard({
    dirty,
    isSaving: saveMutation.isPending,
    onSaveShortcut: saveDirty,
  });

  if (isLoading || !form) {
    return <div className="text-sm text-text-muted">Loading solutioning…</div>;
  }
  if (isError) {
    return <div className="text-sm text-beroe-red">Failed to load solutioning data.</div>;
  }

  const aiExtracted = !!form.ai_extracted_at;
  const showAiBadge = aiExtracted && form.is_editable;
  const isLocked = !!form.locked_at;
  // Whether *role* allows writes, regardless of lock — needed so the Unlock
  // button can show in the Sales Hand-off card while is_editable is false.
  const roleCanWrite = form.is_editable || isLocked;

  return (
    <div className="space-y-4">
      {/* 27-May Row 80 — "Received from Pre-Sales · DATE" card at top.
          Amber to signal a workflow milestone (mirrors the Row 79 card
          surfaced on Pre-Sales when handover happens). Renders only
          when the upstream handover has actually occurred. */}
      {account.handed_off_to_solutioning && account.handed_off_at && (
        <div className="bg-beroe-amber/15 border border-beroe-amber/40 rounded-card px-4 py-2.5 flex items-center gap-2.5">
          <span className="text-[18px]">📥</span>
          <div className="text-[12px] text-beroe-amber">
            <b>Received from Pre-Sales · </b>
            {new Date(account.handed_off_at).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </div>
        </div>
      )}

      {/* VPD uploads — first thing on Solutioning so the doc that drives
          the structured fields below is the most visible action.
          29-May bug 29-10 — the old "How this works" card was folded
          into this description so the explanation lives on the VPD
          upload itself (consolidated, no extra surface). */}
      <KindUploadCard
        accountId={account.id}
        kind="vpd"
        title="Value Proposition Deck (VPD)"
        description="Upload the latest VPD. Claude reads it and proposes values for the structured Solutioning fields below — review and edit anything that's off. Saving flips the badge to AI-assisted. Re-uploading won't overwrite fields you've already edited."
        emptyHint="No VPDs yet. Drag a .docx, .pdf or .txt onto the card above."
      />

      {/* 27-May Row 81 — Autofill Success Metrics from VPD.
          Calls POST /documents/:id/extract-metrics on demand against the
          MOST RECENT VPD upload, then opens the review modal to let the
          user pick which metrics to create on Value Tracking. */}
      <VpdMetricsAutofillButton accountId={account.id} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        {isLocked && (
          <div className="rounded-xl border border-beroe-green/30 bg-beroe-green/15 px-4 py-3 text-xs text-beroe-green flex items-center gap-2">
            <span className="text-base">🔒</span>
            <div className="flex-1">
              <div className="font-bold">Locked for Sales Hand-off</div>
              <div>
                Value definition was passed to Sales
                {form.locked_at && ` on ${new Date(form.locked_at).toLocaleString()}`}.
                Unlock from the right-hand card to edit again.
              </div>
            </div>
          </div>
        )}
        {showAiBadge && (
          <div className={cn(
            "rounded-xl border p-3 text-xs",
            form.ai_edited
              ? "bg-beroe-purple/10 border-beroe-purple/30 text-beroe-purple"
              : "bg-beroe-teal/10 border-beroe-teal/30 text-beroe-teal",
          )}>
            <span className="font-bold">
              {form.ai_edited ? "AI-assisted" : "AI-generated"}
            </span>{" "}
            · last extracted {form.ai_extracted_at && new Date(form.ai_extracted_at).toLocaleString()}
            {!form.ai_edited && " — edits will mark it AI-assisted."}
          </div>
        )}

        {/* 27-May Row 82 — section sequence rewritten to match the
            stakeholder's exact order:
              1. Engagement Shape (Type + Duration)
              2. Proposed Solution
              3. ⭐ Value Definition (starred — primary deliverable)
              4. Value Themes
            Handed-off-to-Sales date already lives at the bottom of
            the right-column Sales Hand-off card with the lock action. */}
        <Section title="Engagement shape">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Engagement type">
              <select
                value={form.engagement_type ?? ""}
                onChange={(e) => setForm({ ...form, engagement_type: (e.target.value || null) as EngagementType | null })}
                disabled={!form.is_editable}
                className={inputCls(form.is_editable)}
              >
                <option value="">— Select —</option>
                {ENGAGEMENT_TYPE_OPTIONS.map((t) => (
                  <option key={t} value={t}>{ENGAGEMENT_TYPE_LABELS[t]}</option>
                ))}
              </select>
            </Field>
            <Field label="Duration (weeks)">
              <input
                type="number"
                min={1}
                max={520}
                value={form.engagement_duration_months ?? ""}
                onChange={(e) =>
                  setForm({ ...form, engagement_duration_months: e.target.value === "" ? null : Number(e.target.value) })
                }
                disabled={!form.is_editable}
                className={inputCls(form.is_editable)}
              />
            </Field>
          </div>
        </Section>

        <Section
          title="Proposed solution"
          subtitle="What Beroe will deliver — bespoke summary auto-extracted from the latest VPD upload."
        >
          <textarea
            rows={4}
            value={form.proposed_solution ?? ""}
            onChange={(e) => setForm({ ...form, proposed_solution: e.target.value })}
            disabled={!form.is_editable}
            className={inputCls(form.is_editable)}
          />
        </Section>

        {/* 29-May bug 29-11 — Value Definition reframed as the primary
            Solutioning deliverable. AI-extracted from the latest VPD
            (existing M7.5 plumbing already populates this field on
            VPD upload). Visual treatment matches the prototype:
              ⭐ VALUE DEFINITION   [Solutioning]   [Sales]
              amber-bordered box around the narrative. */}
        <div className="bg-white border border-beroe-card-border rounded-card p-4">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <div className="text-[12px] font-bold uppercase tracking-wider text-text-primary flex items-center gap-1.5">
              <span className="text-beroe-amber">⭐</span>
              VALUE DEFINITION
            </div>
            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-beroe-blue/10 text-beroe-blue border border-beroe-blue/30">
              Solutioning
            </span>
            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-beroe-purple/10 text-beroe-purple border border-beroe-purple/30">
              Sales
            </span>
            <span className="text-[10px] text-text-muted ml-auto">
              How the value will be measured · primary Solutioning deliverable.
            </span>
          </div>
          <textarea
            rows={4}
            value={form.value_definition ?? ""}
            placeholder="Auto-extracted from the latest VPD upload — review and refine."
            onChange={(e) =>
              setForm({ ...form, value_definition: e.target.value })
            }
            disabled={!form.is_editable}
            className="w-full text-[13px] leading-relaxed rounded-md px-3 py-2 bg-beroe-amber/10 border border-beroe-amber/40 focus:outline-none focus:border-beroe-amber disabled:bg-beroe-amber/10 disabled:text-text-secondary"
          />
        </div>

        <Section title="Value themes" subtitle="Short tags — what kinds of value the engagement will deliver.">
          <div className="flex flex-wrap gap-1 mb-2">
            {form.value_themes.map((t) => (
              <Pill key={t} onRemove={form.is_editable ? () => setForm({
                ...form,
                value_themes: form.value_themes.filter((x) => x !== t),
              }) : undefined}>
                {t}
              </Pill>
            ))}
            {form.value_themes.length === 0 && (
              <span className="text-xs text-text-muted">No themes yet.</span>
            )}
          </div>
          {form.is_editable && (
            <div className="flex gap-1">
              <input
                type="text"
                value={valueThemeInput}
                onChange={(e) => setValueThemeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && valueThemeInput.trim()) {
                    e.preventDefault();
                    setForm({ ...form, value_themes: [...form.value_themes, valueThemeInput.trim()] });
                    setValueThemeInput("");
                  }
                }}
                placeholder="Add a theme + Enter (e.g. cost reduction)"
                className="flex-1 px-2 py-1 text-xs rounded-md border border-beroe-card-border focus:outline-none focus:border-beroe-blue"
              />
              <button
                onClick={() => {
                  if (!valueThemeInput.trim()) return;
                  setForm({ ...form, value_themes: [...form.value_themes, valueThemeInput.trim()] });
                  setValueThemeInput("");
                }}
                className="text-xs px-2 py-1 rounded-md border border-beroe-blue text-beroe-blue font-semibold"
              >
                Add
              </button>
            </div>
          )}
        </Section>

      </div>

      <div className="space-y-4">
        {/* 28-May bug 28-07 — "Estimated value" section removed per
            stakeholder feedback. The estimated_value_musd field stays
            on the schema for upstream AI extraction but is no longer
            surfaced in the Solutioning UI. */}

        <Section title="Sales Hand-off">
          {isLocked ? (
            <>
              <div className="rounded-lg border border-beroe-green/30 bg-beroe-green/15 px-3 py-2 text-xs text-beroe-green mb-3">
                <div className="font-bold flex items-center gap-1">🔒 Locked</div>
                {form.locked_at && (
                  <div className="text-[11px] mt-0.5">
                    Passed to Sales on {new Date(form.locked_at).toLocaleString()}.
                  </div>
                )}
              </div>
              {roleCanWrite && (
                <button
                  onClick={() => {
                    if (
                      confirm(
                        "Unlock solutioning? This re-opens the value definition for edits and the activity log will record it.",
                      )
                    ) {
                      unlockMutation.mutate();
                    }
                  }}
                  disabled={unlockMutation.isPending}
                  className="w-full px-3 py-1.5 rounded-lg border border-beroe-amber/50 bg-beroe-amber/15 text-beroe-amber text-xs font-semibold disabled:opacity-50"
                >
                  {unlockMutation.isPending ? "Unlocking…" : "Unlock to edit & re-pass"}
                </button>
              )}
            </>
          ) : (
            <>
              <div className="text-xs text-text-muted mb-3">
                Once the value definition is final, lock it and pass to Sales Hand-off.
                Requires a value definition.
              </div>
              {roleCanWrite && (
                <button
                  onClick={() => {
                    if (dirty) {
                      alert("Save your edits first — lock works against the saved value definition.");
                      return;
                    }
                    if (
                      !form.value_definition ||
                      !form.value_definition.trim()
                    ) {
                      alert("Fill in the value definition before locking.");
                      return;
                    }
                    if (
                      confirm(
                        "Lock the value definition and pass to Sales Hand-off? Unlock will be required for further edits.",
                      )
                    ) {
                      lockMutation.mutate();
                    }
                  }}
                  disabled={lockMutation.isPending || dirty}
                  className="w-full px-3 py-1.5 rounded-lg bg-beroe-blue text-white text-xs font-semibold disabled:opacity-50"
                  title={dirty ? "Save changes before locking" : ""}
                >
                  {lockMutation.isPending ? "Locking…" : "🔒 Lock & pass to Sales →"}
                </button>
              )}
            </>
          )}
          {lockError && (
            <div className="mt-2 text-[11px] text-beroe-red bg-beroe-red/10 border border-beroe-red/30 rounded-lg px-2 py-1">
              {lockError}
            </div>
          )}
        </Section>

        {/* 28-May bug 28-07 — "How this works" explainer card removed
            per stakeholder feedback. */}
      </div>

      {form.is_editable && (
        <div
          className={cn(
            "lg:col-span-3 sticky bottom-0 -mx-6 px-6 py-3 flex items-center gap-3 border-t z-30 transition-colors",
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
          {!dirty && !savingError && <span className="text-xs text-text-muted">✓ All changes saved</span>}
          <button
            onClick={() => data && setForm(data)}
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

      {guard.pendingHref && (
        <UnsavedChangesDialog
          pendingHref={guard.pendingHref}
          saving={saveMutation.isPending}
          onSaveAndGo={async () => {
            try {
              if (form && data) await saveMutation.mutateAsync(diff(form, data));
              guard.proceed();
            } catch {
              /* error already surfaced via savingError */
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

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
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

function Pill({ children, onRemove }: { children: React.ReactNode; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-beroe-blue/10 text-beroe-blue border border-beroe-blue/30 font-semibold">
      {children}
      {onRemove && (
        <button onClick={onRemove} className="text-beroe-blue/60 hover:text-beroe-blue ml-0.5">×</button>
      )}
    </span>
  );
}

function inputCls(enabled: boolean) {
  return cn(
    "w-full px-3 py-1.5 rounded-lg border border-beroe-card-border text-sm focus:outline-none focus:border-beroe-blue",
    !enabled && "bg-beroe-bg text-text-secondary cursor-not-allowed",
  );
}

function diff(next: Solutioning, prev: Solutioning): SolutioningUpdate {
  const out: Record<string, unknown> = {};
  const keys: (keyof SolutioningUpdate)[] = [
    "proposed_solution", "engagement_type", "engagement_duration_months",
    "value_themes", "value_definition", "estimated_value_musd",
  ];
  for (const k of keys) {
    if (JSON.stringify(next[k]) !== JSON.stringify(prev[k])) out[k] = next[k];
  }
  return out;
}

function serialise(s: Solutioning): unknown {
  // Strip volatile + server-owned fields. `locked_at` / `locked_by` are
  // mutated by the lock/unlock POSTs, not by the form, so they shouldn't
  // count toward dirtiness.
  const {
    updated_at, updated_by, is_editable,
    ai_extracted_at, ai_extracted_from_doc, ai_edited,
    locked_at, locked_by,
    ...rest
  } = s;
  void updated_at; void updated_by; void is_editable;
  void ai_extracted_at; void ai_extracted_from_doc; void ai_edited;
  void locked_at; void locked_by;
  return rest;
}

/** Apply a VPD-extracted slice over the live solutioning form. AI values
 *  override base when present; arrays REPLACE wholesale (same as PATCH
 *  semantic). Empty/null AI values keep the base. */
function mergeSolutioningDraft(base: Solutioning, draft: ExtractedVpd): Solutioning {
  return {
    ...base,
    proposed_solution: draft.proposed_solution || base.proposed_solution,
    engagement_type: draft.engagement_type || base.engagement_type,
    engagement_duration_months:
      draft.engagement_duration_months ?? base.engagement_duration_months,
    value_themes: draft.value_themes?.length ? draft.value_themes : base.value_themes,
    value_definition: draft.value_definition || base.value_definition,
    estimated_value_musd:
      draft.estimated_value_musd !== null ? draft.estimated_value_musd : base.estimated_value_musd,
  };
}

// ============================================================
// 27-May Row 81 — Autofill Success Metrics from VPD
// ============================================================
//
// One-button flow:
//   1. Fetch the account's most recent VPD doc.
//   2. POST /api/v1/documents/:id/extract-metrics → candidate metrics.
//   3. Open the review modal — user picks rows + edits inline.
//   4. Modal fans out POST /api/v1/accounts/:id/metrics × selected and
//      invalidates the Value Tracking cache.

function VpdMetricsAutofillButton({ accountId }: { accountId: string }) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<VpdMetricsExtractionResult | null>(null);
  const [vpdName, setVpdName] = useState<string | undefined>();

  const onClick = async () => {
    setLoading(true);
    setErr(null);
    try {
      // Find the latest VPD doc for this account.
      const docs = await api.get<{
        items: { id: string; kind: string; filename: string; uploaded_at: string }[];
      }>(`/api/v1/accounts/${accountId}/documents?kind=vpd`);
      const latest = docs.items?.[0];
      if (!latest) {
        setErr(
          "Upload a VPD first — autofill needs at least one VPD on this account.",
        );
        return;
      }
      const extracted = await api.post<VpdMetricsExtractionResult>(
        `/api/v1/documents/${latest.id}/extract-metrics`,
        {},
      );
      setVpdName(latest.filename);
      setResult(extracted);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Extraction failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-card border border-beroe-card-border px-4 py-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <div className="text-[13px] font-bold text-text-primary">
            ✨ Autofill Success Metrics from VPD
          </div>
          <div className="text-[11px] text-text-muted mt-0.5">
            Claude reads the latest VPD and proposes Success Metrics — review,
            edit, and one-click create them on Value Tracking.
          </div>
        </div>
        <button
          type="button"
          onClick={onClick}
          disabled={loading}
          className="text-[12px] px-3 py-1.5 rounded-md border border-beroe-purple/40 bg-beroe-purple/10 text-beroe-purple font-semibold hover:bg-beroe-purple/15 disabled:opacity-50"
        >
          {loading ? "Extracting…" : "Autofill Success Metrics →"}
        </button>
      </div>
      {err && (
        <div className="mt-2 text-[11px] text-beroe-red bg-beroe-red/10 border border-beroe-red/30 rounded px-2 py-1">
          {err}
        </div>
      )}
      {result && (
        <VpdMetricsExtractionReview
          accountId={accountId}
          documentName={vpdName}
          result={result}
          onClose={() => setResult(null)}
        />
      )}
    </div>
  );
}
