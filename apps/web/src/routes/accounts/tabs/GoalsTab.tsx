// M14b — CS Goal Validation & Alignment.
//
// One tab, one list of goals. Click a goal to expand inline → header
// fields + Phase A/B/C wizard + initiatives + history. Add-goal modal
// + soft-delete-with-reason confirm + admin restore for deleted goals.
//
// Component split:
//   GoalsTab           Top-level: queries, list, add modal, deleted-toggle
//   GoalCard           One collapsed row + expanded body
//   GoalEditor         The expanded body — header + 3 phases + initiatives + history
//   PhaseAEditor       Per-category Phase A fields
//   PhaseBEditor       Groundwork dropdowns + research-requested
//   PhaseCEditor       Agreed-target text fields + timeline date
//   InitiativeList     Add / edit / remove initiatives
//   HistoryFeed        Chronological audit list

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAccountFromLayout } from "../AccountProfileLayout";
import {
  ALIGNMENT_LABELS,
  CATEGORY_LABELS,
  GROUNDWORK_LABELS,
  PHASE_A_GOAL_TYPE_OPTIONS,
  VALUE_STAGES,
  type CSGoal,
  type CSGoalAlignment,
  type CSGoalCategory,
  type CSGoalCreate,
  type CSGoalUpdate,
  type GroundworkStatus,
  type HistoryAction,
  type Initiative,
  type PhaseA,
  type PhaseB,
  type PhaseC,
} from "@/types/cs_goal";

const CATEGORY_OPTIONS: CSGoalCategory[] = [
  "cost_savings",
  "base_rationalization",
  "risk_mitigation",
  "adoption",
  "other",
];

/** Per-category icon + colour. Verbatim port of prototype line
 *  3084-3090 (`GOAL_CATS`), with the two off-brand hex values mapped
 *  to the Beroe brand palette:
 *    cost_savings        prototype #6EC457 → Risk Green  #6EC457
 *    base_rationalization prototype #4A00F8 → Indigo      #4A00F8 (on brand)
 *    risk_mitigation     prototype #F0BC41 → Risk Amber  #F0BC41
 *    adoption            prototype #C344C7 → Fuscia      #C344C7 (on brand)
 *    other               prototype #64748b → Midnight 60% #00113799
 *  Saves repeating the icon emoji + colour map in three render sites
 *  (row chip, card border, alignment dot palette anchor). */
export const CATEGORY_META: Record<
  CSGoalCategory,
  { icon: string; color: string }
> = {
  cost_savings: { icon: "💰", color: "#6EC457" },
  base_rationalization: { icon: "🔗", color: "#4A00F8" },
  risk_mitigation: { icon: "🛡", color: "#F0BC41" },
  adoption: { icon: "📊", color: "#C344C7" },
  other: { icon: "🎯", color: "#001137" },
};

export default function GoalsTab() {
  const account = useAccountFromLayout();
  const qc = useQueryClient();
  const [showDeleted, setShowDeleted] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading } = useQuery<{ items: CSGoal[] }>({
    queryKey: ["cs-goals", account.id, showDeleted],
    queryFn: () =>
      api.get<{ items: CSGoal[] }>(
        `/api/v1/accounts/${account.id}/cs-goals?include_deleted=${showDeleted}`,
      ),
  });

  const create = useMutation({
    mutationFn: (body: CSGoalCreate) =>
      api.post<CSGoal>(`/api/v1/accounts/${account.id}/cs-goals`, body),
    onSuccess: (g) => {
      qc.invalidateQueries({ queryKey: ["cs-goals", account.id] });
      qc.invalidateQueries({ queryKey: ["activity", account.id] });
      setShowAdd(false);
      setExpandedId(g.id);
    },
  });

  if (isLoading) {
    return <div className="text-sm text-text-muted">Loading goals…</div>;
  }

  const goals = data?.items ?? [];
  const activeCount = goals.filter((g) => !g.deleted_at).length;
  const deletedCount = goals.length - activeCount;

  return (
    <div className="space-y-4">
      {/* Header strip */}
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-base font-bold text-text-primary">
          CS Goals · {activeCount}
          {showDeleted && deletedCount > 0 && (
            <span className="text-text-muted font-normal">
              {" "}
              · {deletedCount} deleted
            </span>
          )}
        </h2>
        <label className="text-xs text-text-muted inline-flex items-center gap-1.5 ml-auto cursor-pointer">
          <input
            type="checkbox"
            checked={showDeleted}
            onChange={(e) => setShowDeleted(e.target.checked)}
          />
          Show deleted
        </label>
        <button
          onClick={() => setShowAdd(true)}
          className="px-3 py-1.5 rounded-lg bg-beroe-blue text-white text-xs font-semibold"
        >
          + Add goal
        </button>
      </div>

      {/* Goal list */}
      {goals.length === 0 && (
        <div className="bg-white rounded-card border border-beroe-card-border p-8 text-center text-sm text-text-muted">
          No goals yet. Click "Add goal" to start. The Phase A/B/C wizard
          opens once a goal is created.
        </div>
      )}

      {goals.map((g) => (
        <GoalCard
          key={g.id}
          goal={g}
          expanded={expandedId === g.id}
          onToggle={() =>
            setExpandedId((cur) => (cur === g.id ? null : g.id))
          }
          accountId={account.id}
        />
      ))}

      {showAdd && (
        <AddGoalModal
          onClose={() => setShowAdd(false)}
          onCreate={(body) => create.mutate(body)}
          saving={create.isPending}
          error={
            create.isError ? (create.error as ApiError).message : null
          }
        />
      )}
    </div>
  );
}

// ============================================================
// GoalCard — collapsed row + expanded body
// ============================================================

function GoalCard({
  goal,
  expanded,
  onToggle,
  accountId,
}: {
  goal: CSGoal;
  expanded: boolean;
  onToggle: () => void;
  accountId: string;
}) {
  void accountId;
  const isDeleted = !!goal.deleted_at;
  const meta = CATEGORY_META[goal.category] ?? CATEGORY_META.other;
  return (
    <div
      className={cn(
        "bg-white rounded-card overflow-hidden border",
        isDeleted ? "opacity-60" : "",
      )}
      style={{
        borderColor: "#e4eaf6",
        borderLeft: `3px solid ${isDeleted ? "#cbd5e1" : meta.color}`,
      }}
    >
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-beroe-bg text-left transition-colors"
      >
        <span className="text-[14px] flex-shrink-0">{meta.icon}</span>
        <AlignmentDot status={goal.alignment_status} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold text-text-primary truncate">
            {goal.title}
            {isDeleted && (
              <span className="ml-2 text-[11px] font-normal" style={{ color: "#CF4548" }}>
                (deleted)
              </span>
            )}
          </div>
          <div className="text-[11px] text-text-muted truncate flex items-center gap-1.5 flex-wrap">
            <span
              className="inline-block px-1.5 py-0.5 rounded-full font-bold"
              style={{
                background: `${meta.color}15`,
                color: meta.color,
              }}
            >
              {CATEGORY_LABELS[goal.category]}
            </span>
            <span>{ALIGNMENT_LABELS[goal.alignment_status]}</span>
            {goal.target_value && <span>· target: {goal.target_value}</span>}
            {goal.target_date && <span>· by {goal.target_date}</span>}
            {goal.owner && <span>· {goal.owner}</span>}
          </div>
        </div>
        <span className="text-text-muted text-xs">{expanded ? "▼" : "▸"}</span>
      </button>
      {expanded && <GoalEditor goal={goal} />}
    </div>
  );
}

/** Alignment dot — brand RAG (Risk Green #6EC457 · Risk Amber #F0BC41 ·
 *  Midnight 60% #00113799). No Tailwind utility colours. */
function AlignmentDot({ status }: { status: CSGoalAlignment }) {
  const color =
    status === "aligned"
      ? "#6EC457"
      : status === "partial"
        ? "#F0BC41"
        : "#cbd5e1";
  return (
    <span
      title={ALIGNMENT_LABELS[status]}
      className="inline-block w-3 h-3 rounded-full flex-shrink-0"
      style={{ background: color }}
    />
  );
}

// ============================================================
// GoalEditor — header + Phase A/B/C + initiatives + history
// ============================================================

function GoalEditor({ goal }: { goal: CSGoal }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<CSGoal>(goal);
  const [savingError, setSavingError] = useState<string | null>(null);
  useEffect(() => {
    setForm(goal);
  }, [goal]);

  const dirty = useMemo(
    () => JSON.stringify(serialise(form)) !== JSON.stringify(serialise(goal)),
    [form, goal],
  );

  const save = useMutation({
    mutationFn: (body: CSGoalUpdate) =>
      api.patch<CSGoal>(`/api/v1/cs-goals/${goal.id}`, body),
    onSuccess: (saved) => {
      qc.invalidateQueries({ queryKey: ["cs-goals", goal.account_id] });
      qc.invalidateQueries({ queryKey: ["activity", goal.account_id] });
      setForm(saved);
      setSavingError(null);
    },
    onError: (e: ApiError) => setSavingError(e.message),
  });

  const del = useMutation({
    mutationFn: (reason: string) =>
      api.delete<CSGoal>(`/api/v1/cs-goals/${goal.id}`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cs-goals", goal.account_id] });
      qc.invalidateQueries({ queryKey: ["activity", goal.account_id] });
      setSavingError(null);
    },
    onError: (e: ApiError) => setSavingError(e.message),
  });

  const restore = useMutation({
    mutationFn: () =>
      api.post<CSGoal>(`/api/v1/cs-goals/${goal.id}/restore`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cs-goals", goal.account_id] });
      qc.invalidateQueries({ queryKey: ["activity", goal.account_id] });
      setSavingError(null);
    },
    onError: (e: ApiError) => setSavingError(e.message),
  });

  const editable = goal.is_editable && !goal.deleted_at;
  const isDeleted = !!goal.deleted_at;

  return (
    <div className="border-t border-beroe-card-border bg-beroe-bg/30 px-4 py-4 space-y-4">
      {isDeleted && (
        <div className="rounded-lg border border-beroe-red/30 bg-beroe-red/10 px-3 py-2 text-xs text-beroe-red">
          Deleted{" "}
          {goal.deleted_at &&
            `on ${new Date(goal.deleted_at).toLocaleDateString()}`}
          {goal.deleted_reason && <> — reason: {goal.deleted_reason}</>}
          <button
            onClick={() => restore.mutate()}
            disabled={restore.isPending}
            className="ml-3 text-[11px] font-semibold underline disabled:opacity-50"
            title="Admin only"
          >
            {restore.isPending ? "Restoring…" : "Restore"}
          </button>
        </div>
      )}

      {/* Header — title / category / target / date / owner */}
      <Section title="Goal header">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Title">
            <input
              type="text"
              maxLength={200}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              disabled={!editable}
              className={inputCls(editable)}
            />
          </Field>
          <Field label="Category">
            <select
              value={form.category}
              onChange={(e) =>
                setForm({ ...form, category: e.target.value as CSGoalCategory })
              }
              disabled={!editable}
              className={inputCls(editable)}
            >
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Target value">
            <input
              type="text"
              maxLength={200}
              value={form.target_value ?? ""}
              placeholder='e.g. $1M · "40 suppliers → 25" · "80% MAU"'
              onChange={(e) =>
                setForm({ ...form, target_value: e.target.value || null })
              }
              disabled={!editable}
              className={inputCls(editable)}
            />
          </Field>
          <Field label="Target date">
            <input
              type="date"
              value={form.target_date ?? ""}
              onChange={(e) =>
                setForm({ ...form, target_date: e.target.value || null })
              }
              disabled={!editable}
              className={inputCls(editable)}
            />
          </Field>
          <Field label="Owner">
            <input
              type="text"
              maxLength={200}
              value={form.owner ?? ""}
              placeholder="Who's accountable"
              onChange={(e) =>
                setForm({ ...form, owner: e.target.value || null })
              }
              disabled={!editable}
              className={inputCls(editable)}
            />
          </Field>
          <Field label="Alignment status (derived)">
            <input
              type="text"
              value={ALIGNMENT_LABELS[form.alignment_status]}
              disabled
              className={inputCls(false)}
            />
          </Field>
        </div>
      </Section>

      {/* Phase A — discovery */}
      <PhaseEditor
        label="Phase A — What does this goal actually mean?"
        category={form.category}
        phase={form.phase_a}
        onChange={(p) => setForm({ ...form, phase_a: p })}
        editable={editable}
        completeKey="phase_a_complete"
      >
        <PhaseAEditor
          category={form.category}
          value={form.phase_a}
          onChange={(p) => setForm({ ...form, phase_a: p })}
          editable={editable}
        />
      </PhaseEditor>

      {/* Phase B — groundwork */}
      <PhaseEditor
        label="Phase B — What groundwork exists?"
        category={form.category}
        phase={form.phase_b}
        onChange={(p) => setForm({ ...form, phase_b: p })}
        editable={editable}
        completeKey="phase_b_complete"
      >
        <PhaseBEditor
          category={form.category}
          value={form.phase_b}
          onChange={(p) => setForm({ ...form, phase_b: p })}
          editable={editable}
        />
      </PhaseEditor>

      {/* Phase C — agreed target */}
      <PhaseEditor
        label="Phase C — Agree the target"
        category={form.category}
        phase={form.phase_c}
        onChange={(p) => setForm({ ...form, phase_c: p })}
        editable={editable}
        completeKey="phase_c_complete"
      >
        <PhaseCEditor
          value={form.phase_c}
          onChange={(p) => setForm({ ...form, phase_c: p })}
          editable={editable}
        />
      </PhaseEditor>

      {/* Initiatives — 29-May bug 29-31: counter renamed to
          "N INITIATIVES · M DELIVERED" per the prototype screenshot.
          Delivered = initiatives at the final success stage for the
          goal's category (implemented / achieved / disruption_avoided
          / embedded). */}
      <Section
        title={(() => {
          // "Delivered" = initiative.status === "delivered" OR
          // initiative.value_stage matches the category's success
          // milestone (implemented / achieved / disruption_avoided /
          // embedded — the third entry of VALUE_STAGES[category]).
          const stages = VALUE_STAGES[form.category];
          const deliveredStage = stages[2] ?? null;
          const delivered = form.initiatives.filter(
            (it) =>
              it.status === "delivered" ||
              (deliveredStage && it.value_stage === deliveredStage),
          ).length;
          return `${form.initiatives.length} INITIATIVES · ${delivered} DELIVERED`;
        })()}
        subtitle="What you'll actually do to hit the target."
      >
        <InitiativeList
          category={form.category}
          items={form.initiatives}
          editable={editable}
          onChange={(items) => setForm({ ...form, initiatives: items })}
        />
      </Section>

      {/* History */}
      <HistoryFeed entries={form.history} />

      {/* Sticky save bar — Risk Amber tint when dirty (brand palette). */}
      {editable && (
        <div
          className="sticky bottom-0 -mx-4 px-4 py-3 flex items-center gap-3 border-t z-30 transition-colors"
          style={
            dirty
              ? {
                  background: "#F0BC4115",
                  borderColor: "#F0BC4140",
                  boxShadow: "0 -4px 12px rgba(0,0,0,0.05)",
                }
              : { background: "#fff", borderColor: "#e4eaf6" }
          }
        >
          {savingError && (
            <span
              className="text-xs rounded-lg px-3 py-1"
              style={{
                color: "#CF4548",
                background: "#CF454810",
                border: "1px solid #CF454830",
              }}
            >
              {savingError}
            </span>
          )}
          {!savingError && dirty && (
            <span
              className="text-xs font-bold"
              style={{ color: "#854F0B" }}
            >
              Unsaved changes
            </span>
          )}
          {!dirty && !savingError && (
            <span className="text-xs text-text-muted">✓ All changes saved</span>
          )}
          <button
            onClick={() => {
              const reason = prompt(
                "Reason for deleting this goal (5–600 chars, captured in the audit trail):",
              );
              if (!reason || reason.trim().length < 5) return;
              del.mutate(reason.trim());
            }}
            disabled={del.isPending}
            className="px-3 py-1.5 rounded-lg text-xs bg-white disabled:opacity-50"
            style={{ color: "#CF4548", border: "1px solid #CF454840" }}
          >
            {del.isPending ? "Deleting…" : "Delete goal"}
          </button>
          <button
            onClick={() => setForm(goal)}
            disabled={!dirty || save.isPending}
            className="ml-auto px-3 py-1.5 rounded-lg text-sm border border-beroe-card-border text-text-secondary disabled:opacity-50 bg-white"
          >
            Discard
          </button>
          <button
            onClick={() => save.mutate(diff(form, goal))}
            disabled={!dirty || save.isPending}
            className="px-4 py-1.5 rounded-lg text-white text-sm font-semibold disabled:opacity-50"
            style={{ background: "#4A00F8" }}
          >
            {save.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      )}
    </div>
  );
}

// ============================================================
// PhaseEditor wrapper — completion toggle + section frame
// ============================================================

function PhaseEditor({
  label,
  category,
  phase,
  onChange,
  editable,
  completeKey,
  children,
}: {
  label: string;
  category: CSGoalCategory;
  phase: PhaseA | PhaseB | PhaseC;
  onChange: (p: PhaseA | PhaseB | PhaseC) => void;
  editable: boolean;
  completeKey: "phase_a_complete" | "phase_b_complete" | "phase_c_complete";
  children: React.ReactNode;
}) {
  const complete = !!(phase as unknown as Record<string, boolean>)[completeKey];
  // R27 — validate before allowing the "mark complete" flip. Each phase
  // has its own minimum-content rule; if unmet, the checkbox is disabled
  // and a tooltip explains what's missing.
  const missing = !complete ? validatePhaseForCompletion(completeKey, category, phase) : null;
  return (
    <details className="bg-white rounded-card border border-beroe-card-border" open>
      <summary className="px-4 py-3 cursor-pointer text-sm font-bold text-text-primary hover:bg-beroe-bg flex items-center gap-2">
        <span className={cn(complete && "line-through text-text-muted")}>
          {label}
        </span>
        {complete && (
          <span
            className="text-[11px] px-2 py-0.5 rounded-full font-bold"
            style={{ background: "#6EC45720", color: "#1d6b35" }}
          >
            ✓ Complete
          </span>
        )}
        <label
          className={cn(
            "ml-auto text-[11px] text-text-secondary inline-flex items-center gap-1 cursor-pointer",
            !!missing && "cursor-not-allowed opacity-70",
          )}
          onClick={(e) => e.stopPropagation()}
          title={missing ?? ""}
        >
          <input
            type="checkbox"
            checked={complete}
            disabled={!editable || !!missing}
            onChange={(e) =>
              onChange({ ...phase, [completeKey]: e.target.checked })
            }
          />
          mark complete
        </label>
      </summary>
      <div className="px-4 pb-4 pt-2">
        {!!missing && (
          <div
            className="mb-2 text-[11px] rounded-md px-2.5 py-1.5"
            style={{
              color: "#854F0B",
              background: "#F0BC4115",
              border: "1px solid #F0BC4140",
            }}
          >
            ⚠ Cannot mark complete yet — {missing}
          </div>
        )}
        {children}
      </div>
    </details>
  );
}

// R27 — returns null when the phase is ready to mark complete, or a
// human-readable string naming the missing piece.
function validatePhaseForCompletion(
  completeKey: "phase_a_complete" | "phase_b_complete" | "phase_c_complete",
  category: CSGoalCategory,
  phase: PhaseA | PhaseB | PhaseC,
): string | null {
  const p = phase as unknown as Record<string, unknown>;
  if (completeKey === "phase_a_complete") {
    const a = phase as PhaseA;
    if (!a.goal_type) return "pick a goal type";
    if (!a.category_clarity) return "set category clarity";
    return null;
  }
  if (completeKey === "phase_b_complete") {
    const items =
      GROUNDWORK_BY_CATEGORY[category] ?? GROUNDWORK_BY_CATEGORY.other;
    const anySet = items.some((it) => !!p[it.key]);
    if (!anySet) return "answer at least one groundwork item";
    return null;
  }
  if (completeKey === "phase_c_complete") {
    const c = phase as PhaseC;
    if (!c.agreed_target?.trim()) return "agree the target";
    if (!c.measure_method?.trim()) return "define the measurement method";
    return null;
  }
  return null;
}

// ============================================================
// PhaseAEditor — category-aware
// ============================================================

function PhaseAEditor({
  category,
  value,
  onChange,
  editable,
}: {
  category: CSGoalCategory;
  value: PhaseA;
  onChange: (p: PhaseA) => void;
  editable: boolean;
}) {
  const opts = PHASE_A_GOAL_TYPE_OPTIONS[category];
  return (
    <div className="space-y-2">
      {opts.length > 0 && (
        <Field
          label={
            category === "cost_savings"
              ? "Goal type"
              : category === "base_rationalization"
                ? "Confirmed scope?"
                : "Goal type"
          }
        >
          <select
            value={value.goal_type ?? ""}
            onChange={(e) =>
              onChange({ ...value, goal_type: e.target.value || null })
            }
            disabled={!editable}
            className={inputCls(editable)}
          >
            <option value="">— Select —</option>
            {opts.map((o) => (
              <option key={o} value={o}>
                {o.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="Category clarity">
        <select
          value={value.category_clarity ?? ""}
          onChange={(e) =>
            onChange({
              ...value,
              category_clarity:
                (e.target.value as PhaseA["category_clarity"]) || null,
            })
          }
          disabled={!editable}
          className={inputCls(editable)}
        >
          <option value="">— Select —</option>
          <option value="confirmed">Confirmed with client</option>
          <option value="partial">Partial — some questions open</option>
          <option value="not_discussed">Not yet discussed</option>
        </select>
      </Field>
      <Field label="Target origin">
        <select
          value={value.target_origin ?? ""}
          onChange={(e) =>
            onChange({
              ...value,
              target_origin:
                (e.target.value as PhaseA["target_origin"]) || null,
            })
          }
          disabled={!editable}
          className={inputCls(editable)}
        >
          <option value="">— Select —</option>
          <option value="analysis_backed">Analysis-backed</option>
          <option value="finance_set">Set by Finance / leadership</option>
          <option value="joint_estimate">Joint estimate with client</option>
          <option value="unknown">Unknown</option>
        </select>
      </Field>
      <Field label="Validation note">
        <textarea
          rows={3}
          maxLength={4000}
          value={value.validation_note ?? ""}
          placeholder="What does success look like in plain language for this account?"
          onChange={(e) =>
            onChange({ ...value, validation_note: e.target.value || null })
          }
          disabled={!editable}
          className={textareaCls(editable)}
        />
      </Field>
    </div>
  );
}

// ============================================================
// PhaseBEditor — groundwork
// ============================================================

// R28 — Groundwork items shown in Phase B depend on the goal category. Each
// row maps to a jsonb key on `cs_goals.phase_b` (PhaseB schema is `extra="allow"`
// on the backend so new keys flow through without DDL).
const GROUNDWORK_BY_CATEGORY: Record<
  string,
  ReadonlyArray<{ key: string; label: string }>
> = {
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

function PhaseBEditor({
  category,
  value,
  onChange,
  editable,
}: {
  category: string;
  value: PhaseB;
  onChange: (p: PhaseB) => void;
  editable: boolean;
}) {
  const items =
    GROUNDWORK_BY_CATEGORY[category] ?? GROUNDWORK_BY_CATEGORY.other;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {items.map((it) => (
          <Field key={it.key} label={it.label}>
            <GroundworkSelect
              value={
                ((value as unknown as Record<string, GroundworkStatus | null>)[
                  it.key
                ] ?? null) as GroundworkStatus | null
              }
              onChange={(v) =>
                onChange({ ...(value as PhaseB), [it.key]: v } as PhaseB)
              }
              editable={editable}
            />
          </Field>
        ))}
      </div>
      <label className="text-xs text-text-secondary inline-flex items-center gap-2">
        <input
          type="checkbox"
          checked={!!value.research_requested}
          disabled={!editable}
          onChange={(e) =>
            onChange({
              ...value,
              research_requested: e.target.checked,
              research_request_date: e.target.checked
                ? value.research_request_date ?? new Date().toISOString().slice(0, 10)
                : null,
            })
          }
        />
        Research requested to fill groundwork gaps
      </label>
      {value.research_requested && (
        <Field label="Research request date">
          <input
            type="date"
            value={value.research_request_date ?? ""}
            onChange={(e) =>
              onChange({
                ...value,
                research_request_date: e.target.value || null,
              })
            }
            disabled={!editable}
            className={inputCls(editable)}
          />
        </Field>
      )}
    </div>
  );
}

function GroundworkSelect({
  value,
  onChange,
  editable,
}: {
  value: GroundworkStatus | null;
  onChange: (v: GroundworkStatus | null) => void;
  editable: boolean;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange((e.target.value as GroundworkStatus) || null)}
      disabled={!editable}
      className={inputCls(editable)}
    >
      <option value="">— Select —</option>
      {(["done_current", "done_outdated", "not_done", "unknown"] as const).map(
        (k) => (
          <option key={k} value={k}>
            {GROUNDWORK_LABELS[k]}
          </option>
        ),
      )}
    </select>
  );
}

// ============================================================
// PhaseCEditor — agreed target
// ============================================================

function PhaseCEditor({
  value,
  onChange,
  editable,
}: {
  value: PhaseC;
  onChange: (p: PhaseC) => void;
  editable: boolean;
}) {
  return (
    <div className="space-y-2">
      <Field label="Category focus">
        <textarea
          rows={2}
          maxLength={2000}
          value={value.category_focus ?? ""}
          placeholder="Which categories / spend pools is this goal scoped to?"
          onChange={(e) =>
            onChange({ ...value, category_focus: e.target.value || null })
          }
          disabled={!editable}
          className={textareaCls(editable)}
        />
      </Field>
      <Field label="Baseline">
        <textarea
          rows={2}
          maxLength={2000}
          value={value.baseline ?? ""}
          placeholder="What's the starting point we're measuring against?"
          onChange={(e) =>
            onChange({ ...value, baseline: e.target.value || null })
          }
          disabled={!editable}
          className={textareaCls(editable)}
        />
      </Field>
      <Field label="Agreed target">
        <textarea
          rows={2}
          maxLength={2000}
          value={value.agreed_target ?? ""}
          placeholder="What we / client jointly committed to."
          onChange={(e) =>
            onChange({ ...value, agreed_target: e.target.value || null })
          }
          disabled={!editable}
          className={textareaCls(editable)}
        />
      </Field>
      <Field label="Measure method">
        <textarea
          rows={2}
          maxLength={2000}
          value={value.measure_method ?? ""}
          placeholder="How we'll know we hit it (data source, cadence)."
          onChange={(e) =>
            onChange({ ...value, measure_method: e.target.value || null })
          }
          disabled={!editable}
          className={textareaCls(editable)}
        />
      </Field>
      <Field label="Timeline">
        <input
          type="date"
          value={value.timeline ?? ""}
          onChange={(e) =>
            onChange({ ...value, timeline: e.target.value || null })
          }
          disabled={!editable}
          className={inputCls(editable)}
        />
      </Field>
    </div>
  );
}

// ============================================================
// InitiativeList — category-aware stages
// ============================================================

function InitiativeList({
  category,
  items,
  editable,
  onChange,
}: {
  category: CSGoalCategory;
  items: Initiative[];
  editable: boolean;
  onChange: (next: Initiative[]) => void;
}) {
  const stages = VALUE_STAGES[category];
  // 29-May bug 29-31 — top-3 stages shown as the dot indicator. For
  // cost_savings these are Identified → Committed → Implemented; for
  // other categories the first three entries of VALUE_STAGES.
  const dotStages = stages.slice(0, 3);
  return (
    <div className="space-y-2">
      {items.map((it, i) => (
        <div
          key={i}
          className="rounded-lg border border-beroe-card-border bg-white p-3 relative"
        >
          {editable && (
            <button
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="absolute top-2 right-2 text-text-muted hover:text-beroe-red text-xs"
              aria-label="Remove initiative"
            >
              ✕
            </button>
          )}
          {/* 29-May bug 29-31 — Name + " — " + description (sub_initiatives)
              on one line, matching the prototype. */}
          <div className="grid grid-cols-1 sm:grid-cols-[1.4fr_2fr] gap-2 mb-2 pr-6">
            <input
              type="text"
              maxLength={200}
              value={it.name}
              placeholder="Initiative name"
              onChange={(e) =>
                onChange(
                  items.map((x, j) =>
                    j === i ? { ...x, name: e.target.value } : x,
                  ),
                )
              }
              disabled={!editable}
              className={cn(inputCls(editable), "font-semibold")}
            />
            <input
              type="text"
              maxLength={400}
              value={it.sub_initiatives ?? ""}
              placeholder="One-line description"
              onChange={(e) =>
                onChange(
                  items.map((x, j) =>
                    j === i ? { ...x, sub_initiatives: e.target.value } : x,
                  ),
                )
              }
              disabled={!editable}
              className={inputCls(editable)}
            />
          </div>

          {/* 29-May bug 29-31 — 3-stage dot indicator (Identified /
              Committed / Implemented for cost_savings) above the inputs.
              Active stage = current value_stage, past stages = green
              (delivered), future stages = grey. */}
          {dotStages.length > 0 && (
            <StageDotRow
              stages={dotStages}
              activeStage={it.value_stage ?? null}
              status={it.status}
            />
          )}

          {/* Status select on the same row as the stage badge for
              compactness. */}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr] gap-2 mb-2">
            <select
              value={it.status}
              onChange={(e) =>
                onChange(
                  items.map((x, j) =>
                    j === i
                      ? {
                          ...x,
                          status: e.target.value as Initiative["status"],
                        }
                      : x,
                  ),
                )
              }
              disabled={!editable}
              className={inputCls(editable)}
            >
              <option value="not_started">Not started</option>
              <option value="in_progress">In progress</option>
              <option value="delivered">Delivered</option>
            </select>
            {/* Pending / yes / not_yet client ack on the right. */}
            <select
              value={it.client_acknowledged ?? "pending"}
              onChange={(e) =>
                onChange(
                  items.map((x, j) =>
                    j === i
                      ? {
                          ...x,
                          client_acknowledged: e.target.value as Initiative["client_acknowledged"],
                        }
                      : x,
                  ),
                )
              }
              disabled={!editable}
              className={inputCls(editable)}
            >
              <option value="pending">Pending</option>
              <option value="yes">Client confirmed</option>
              <option value="not_yet">Not yet</option>
            </select>
          </div>
          {stages.length > 0 && (
            <Field label="Value stage">
              <select
                value={it.value_stage ?? ""}
                onChange={(e) =>
                  onChange(
                    items.map((x, j) =>
                      j === i
                        ? { ...x, value_stage: e.target.value || null }
                        : x,
                    ),
                  )
                }
                disabled={!editable}
                className={inputCls(editable)}
              >
                <option value="">— Select —</option>
                {stages.map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Field label="Value target">
              <input
                type="text"
                maxLength={200}
                value={it.value_target ?? ""}
                onChange={(e) =>
                  onChange(
                    items.map((x, j) =>
                      j === i
                        ? { ...x, value_target: e.target.value || null }
                        : x,
                    ),
                  )
                }
                disabled={!editable}
                className={inputCls(editable)}
              />
            </Field>
            <Field label="Value delivered">
              <input
                type="text"
                maxLength={200}
                value={it.value_delivered ?? ""}
                onChange={(e) =>
                  onChange(
                    items.map((x, j) =>
                      j === i
                        ? { ...x, value_delivered: e.target.value || null }
                        : x,
                    ),
                  )
                }
                disabled={!editable}
                className={inputCls(editable)}
              />
            </Field>
          </div>
          <Field label="Client acknowledgement">
            <select
              value={it.client_acknowledged}
              onChange={(e) =>
                onChange(
                  items.map((x, j) =>
                    j === i
                      ? {
                          ...x,
                          client_acknowledged: e.target.value as Initiative["client_acknowledged"],
                        }
                      : x,
                  ),
                )
              }
              disabled={!editable}
              className={inputCls(editable)}
            >
              <option value="pending">Pending</option>
              <option value="yes">Yes</option>
              <option value="not_yet">Not yet</option>
            </select>
          </Field>
          <Field label="Evidence">
            <textarea
              rows={2}
              maxLength={4000}
              value={it.evidence ?? ""}
              onChange={(e) =>
                onChange(
                  items.map((x, j) =>
                    j === i ? { ...x, evidence: e.target.value || null } : x,
                  ),
                )
              }
              disabled={!editable}
              className={textareaCls(editable)}
            />
          </Field>
        </div>
      ))}
      {editable && (
        <button
          onClick={() =>
            onChange([
              ...items,
              {
                name: "",
                sub_initiatives: null,
                status: "not_started",
                value_stage: null,
                value_target: null,
                value_delivered: null,
                client_acknowledged: "pending",
                evidence: null,
                implementation_status: null,
                implementation_note: null,
                value_fields: {},
                client_data: [],
                value_history: [],
              },
            ])
          }
          className="text-xs px-2 py-1 rounded-md border border-beroe-blue text-beroe-blue font-semibold"
        >
          + Initiative
        </button>
      )}
    </div>
  );
}

// ============================================================
// 29-May bug 29-31 — Stage dot row (3 stages per category).
// Active stage = filled brand-amber. Past stages = filled brand-green.
// Future stages = grey outline. Status === "delivered" colours all
// dots brand-green to signal completion.
// ============================================================

function StageDotRow({
  stages,
  activeStage,
  status,
}: {
  stages: string[];
  activeStage: string | null;
  status: Initiative["status"];
}) {
  const activeIdx = activeStage ? stages.indexOf(activeStage) : -1;
  const fullyDone = status === "delivered";
  return (
    <div className="flex items-start gap-0 mb-2 mt-1">
      {stages.map((s, idx) => {
        const isPast = fullyDone || (activeIdx >= 0 && idx < activeIdx);
        const isActive = !fullyDone && idx === activeIdx;
        const dotColor = isPast
          ? "#6EC457" // Risk Green
          : isActive
            ? "#F0BC41" // Risk Amber
            : "#cbd5e1"; // grey outline
        const labelColor = isPast || isActive ? "#001137" : "#94a3b8";
        return (
          <div
            key={s}
            className="flex-1 flex flex-col items-center text-center"
          >
            <div className="w-full flex items-center">
              {/* Connector left (skip on first) */}
              <div
                className="flex-1 h-[2px]"
                style={{ background: idx === 0 ? "transparent" : dotColor }}
              />
              <div
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{
                  background: isPast || isActive ? dotColor : "#fff",
                  border: `1.5px solid ${dotColor}`,
                }}
              />
              {/* Connector right (skip on last) */}
              <div
                className="flex-1 h-[2px]"
                style={{
                  background: idx === stages.length - 1 ? "transparent" : "#cbd5e1",
                }}
              />
            </div>
            <div
              className="text-[9px] mt-1 font-semibold uppercase tracking-wider"
              style={{ color: labelColor }}
            >
              {s.replace(/_/g, " ")}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// HistoryFeed
// ============================================================

function HistoryFeed({ entries }: { entries: HistoryAction[] }) {
  if (entries.length === 0) return null;
  return (
    <details className="bg-white rounded-card border border-beroe-card-border">
      <summary className="px-4 py-3 cursor-pointer text-sm font-bold text-text-primary hover:bg-beroe-bg">
        History ({entries.length})
      </summary>
      <ul className="px-4 pb-4 space-y-1.5">
        {[...entries].reverse().map((h, i) => (
          <li
            key={i}
            className="text-xs text-text-secondary border-l-2 border-beroe-card-border pl-2.5"
          >
            <span className="text-text-muted">
              {new Date(h.at).toLocaleString()}
            </span>{" "}
            · <span className="font-semibold text-text-primary">{h.action}</span>
            {h.reason && <> · {h.reason}</>}
            {h.new_value !== undefined && h.new_value !== null && (
              <span className="text-text-muted ml-1">
                {typeof h.new_value === "object"
                  ? JSON.stringify(h.new_value)
                  : String(h.new_value)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

// ============================================================
// AddGoalModal
// ============================================================

function AddGoalModal({
  onClose,
  onCreate,
  saving,
  error,
}: {
  onClose: () => void;
  onCreate: (body: CSGoalCreate) => void;
  saving: boolean;
  error: string | null;
}) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<CSGoalCategory>("other");
  return (
    <div
      className="fixed inset-0 bg-black/40 z-40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-card border border-beroe-card-border p-5 w-full max-w-md space-y-3"
      >
        <h2 className="text-sm font-bold text-text-primary">Add CS goal</h2>
        <Field label="Title">
          <input
            type="text"
            maxLength={200}
            value={title}
            placeholder="Short, outcome-oriented"
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            className={inputCls(true)}
          />
        </Field>
        <Field label="Category">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as CSGoalCategory)}
            className={inputCls(true)}
          >
            {CATEGORY_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </Field>
        {error && (
          <div className="text-xs text-beroe-red bg-beroe-red/10 border border-beroe-red/30 rounded-lg px-3 py-2">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-sm border border-beroe-card-border text-text-secondary bg-white"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (!title.trim()) {
                alert("Title is required.");
                return;
              }
              onCreate({ title: title.trim(), category });
            }}
            disabled={saving}
            className="px-4 py-1.5 rounded-lg bg-beroe-blue text-white text-sm font-semibold disabled:opacity-50"
          >
            {saving ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Helpers
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
    <div className="bg-white rounded-card border border-beroe-card-border p-4">
      <h3 className="text-sm font-bold text-text-primary">{title}</h3>
      {subtitle && (
        <p className="text-xs text-text-muted mt-0.5 mb-2">{subtitle}</p>
      )}
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
    <div className="mb-2 last:mb-0">
      <label className="block text-[11px] uppercase tracking-wider text-text-muted font-bold mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}

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

function serialise(g: CSGoal): unknown {
  const {
    created_at, created_by, updated_at, updated_by,
    is_editable, deleted_at, deleted_reason, deleted_by, history,
    ...rest
  } = g;
  void created_at; void created_by; void updated_at; void updated_by;
  void is_editable; void deleted_at; void deleted_reason; void deleted_by;
  void history;
  return rest;
}

function diff(next: CSGoal, prev: CSGoal): CSGoalUpdate {
  const out: Record<string, unknown> = {};
  const keys: (keyof CSGoalUpdate)[] = [
    "title", "category", "target_value", "target_date", "owner",
    "alignment_status", "phase_a", "phase_b", "phase_c", "initiatives",
  ];
  for (const k of keys) {
    if (JSON.stringify(next[k]) !== JSON.stringify(prev[k])) {
      out[k] = next[k];
    }
  }
  return out as CSGoalUpdate;
}
