import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useUnsavedChangesGuard } from "@/lib/use-unsaved-changes";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import { useAccountFromLayout } from "../AccountProfileLayout";
import type {
  Engagement,
  EngagementUpdate,
  MaturityLevel,
  QualityCheckResponse,
} from "@/types/engagement";
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
    if (data && !form) setForm(data);
  }, [data, form]);

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
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
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

        {/* Categories — multi-select with propose-new */}
        <Section title="Target categories" subtitle="What's in scope for this engagement.">
          <CategoryPicker
            selected={form.target_categories}
            onChange={(cats) => setForm({ ...form, target_categories: cats })}
            disabled={!form.is_editable}
          />
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
                value={form.procurement_spend_musd ?? ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    procurement_spend_musd: e.target.value === "" ? null : e.target.value,
                  })
                }
                disabled={!form.is_editable}
                className={inputCls(form.is_editable)}
              />
            </Field>
          </div>
        </Section>
      </div>

      {/* Right column — origin + people */}
      <div className="space-y-4">
        <Section title="Origin">
          <Field label="SDR / lead source">
            <input
              type="text"
              value={form.sdr_lead ?? ""}
              onChange={(e) => setForm({ ...form, sdr_lead: e.target.value })}
              disabled={!form.is_editable}
              className={inputCls(form.is_editable)}
            />
          </Field>
          <Field label="Pre-discovery date">
            <input
              type="date"
              value={form.pre_discovery_date ?? ""}
              onChange={(e) =>
                setForm({ ...form, pre_discovery_date: e.target.value || null })
              }
              disabled={!form.is_editable}
              className={inputCls(form.is_editable)}
            />
          </Field>
          <Field label="Discovery lead">
            <input
              type="text"
              value={form.discovery_lead ?? ""}
              onChange={(e) => setForm({ ...form, discovery_lead: e.target.value })}
              disabled={!form.is_editable}
              className={inputCls(form.is_editable)}
            />
          </Field>
          <Field label="Sales lead">
            <input
              type="text"
              value={form.sales_lead ?? ""}
              onChange={(e) => setForm({ ...form, sales_lead: e.target.value })}
              disabled={!form.is_editable}
              className={inputCls(form.is_editable)}
            />
          </Field>
        </Section>

        <Section title="Stakeholders">
          <Field label="SPOC">
            <input
              type="text"
              value={form.spoc_text ?? ""}
              onChange={(e) => setForm({ ...form, spoc_text: e.target.value })}
              disabled={!form.is_editable}
              className={inputCls(form.is_editable)}
            />
          </Field>
          <Field label="Sponsor">
            <input
              type="text"
              value={form.sponsor_text ?? ""}
              onChange={(e) => setForm({ ...form, sponsor_text: e.target.value })}
              disabled={!form.is_editable}
              className={inputCls(form.is_editable)}
            />
          </Field>
          <Field label="Power users">
            <input
              type="text"
              value={form.power_users_text ?? ""}
              onChange={(e) => setForm({ ...form, power_users_text: e.target.value })}
              disabled={!form.is_editable}
              className={inputCls(form.is_editable)}
              placeholder="Comma-separated"
            />
          </Field>
        </Section>
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
