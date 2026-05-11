import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useUnsavedChangesGuard } from "@/lib/use-unsaved-changes";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import { KindUploadCard } from "@/components/KindUploadCard";
import { useAccountFromLayout } from "../AccountProfileLayout";
import {
  ENGAGEMENT_TYPE_LABELS,
  type EngagementType,
  type Solutioning,
  type SolutioningUpdate,
} from "@/types/solutioning";

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
    if (data && !form) setForm(data);
  }, [data, form]);

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
    onError: (e: ApiError) => setSavingError(e.message),
  });

  const saveDirty = () => {
    if (form && data) saveMutation.mutate(diff(form, data));
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
    return <div className="text-sm text-red-700">Failed to load solutioning data.</div>;
  }

  const aiExtracted = !!form.ai_extracted_at;
  const showAiBadge = aiExtracted && form.is_editable;

  return (
    <div className="space-y-4">
      {/* VPD uploads — first thing on Solutioning so the doc that drives
          the structured fields below is the most visible action. */}
      <KindUploadCard
        accountId={account.id}
        kind="vpd"
        title="Value Proposition Deck (VPD)"
        description="Upload the latest VPD. Claude reads it and proposes values for the structured Solutioning fields below — review and save to keep them."
        emptyHint="No VPDs yet. Drag a .docx, .pdf or .txt onto the card above."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        {showAiBadge && (
          <div className={cn(
            "rounded-xl border p-3 text-xs",
            form.ai_edited
              ? "bg-violet-50 border-violet-200 text-violet-800"
              : "bg-cyan-50 border-cyan-200 text-cyan-800",
          )}>
            <span className="font-bold">
              {form.ai_edited ? "AI-assisted" : "AI-generated"}
            </span>{" "}
            · last extracted {form.ai_extracted_at && new Date(form.ai_extracted_at).toLocaleString()}
            {!form.ai_edited && " — edits will mark it AI-assisted."}
          </div>
        )}

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
            <Field label="Duration (months)">
              <input
                type="number"
                min={1}
                max={120}
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
                className="flex-1 px-2 py-1 text-xs rounded-md border border-slate-200 focus:outline-none focus:border-beroe-blue"
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

        <Section title="Value definition" subtitle="How the value will be measured.">
          <textarea
            rows={3}
            value={form.value_definition ?? ""}
            onChange={(e) => setForm({ ...form, value_definition: e.target.value })}
            disabled={!form.is_editable}
            className={inputCls(form.is_editable)}
          />
        </Section>
      </div>

      <div className="space-y-4">
        <Section title="Estimated value">
          <Field label="Million USD">
            <input
              type="number"
              step="0.1"
              min={0}
              value={form.estimated_value_musd ?? ""}
              onChange={(e) =>
                setForm({ ...form, estimated_value_musd: e.target.value === "" ? null : e.target.value })
              }
              disabled={!form.is_editable}
              className={inputCls(form.is_editable)}
            />
          </Field>
        </Section>

        <div className="bg-slate-50 rounded-card border border-beroe-card-border p-4 text-xs text-text-muted">
          <div className="font-bold text-text-secondary mb-1">How this works</div>
          When you upload a VPD on the Documents tab, Claude reads it and proposes
          values for the fields above. Review and edit anything that's off — saving
          flips the badge to "AI-assisted." Re-uploading a VPD won't overwrite
          fields you've edited.
        </div>
      </div>

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
          {!dirty && !savingError && <span className="text-xs text-text-muted">✓ All changes saved</span>}
          <button
            onClick={() => data && setForm(data)}
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
    "w-full px-3 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-beroe-blue",
    !enabled && "bg-slate-50 text-text-secondary cursor-not-allowed",
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
  const { updated_at, updated_by, is_editable, ai_extracted_at, ai_extracted_from_doc, ai_edited, ...rest } = s;
  return rest;
}
