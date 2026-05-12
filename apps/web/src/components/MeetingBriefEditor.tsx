// M12 — Pre-Meeting Brief editor.
//
// Single component embedded inside PreSalesTab. Holds the whole brief in
// local state, PATCHes the entire document on save. Each block (call info,
// attendees, minefields, ...) is a collapsible <details> so the page stays
// scannable; only the call-info summary and win condition are open by default.
//
// Style choice: we deliberately keep the field set unfussy — no rich text,
// no drag-and-drop reordering, no avatar-color picker. The brief is a
// working artifact, not a published doc. If a sales lead needs prettier
// output, they can export it later.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useUnsavedChangesGuard } from "@/lib/use-unsaved-changes";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import {
  EXTRACTION_APPLIED_EVENT,
  consumeBriefSlice,
} from "@/lib/extractionDraft";
import type { ExtractedBrief } from "@/types/mom_extraction";
import {
  BRIEF_CALL_TYPE_LABELS,
  emptyBrief,
  SCENARIO_LABELS,
  SEVERITY_LABELS,
  type AnnualReportItem,
  type Attendee,
  type AttendeeCompany,
  type BriefCallType,
  type CallTimerSlot,
  type ClosingScenario,
  type DiscoveryQuestion,
  type EmailInsight,
  type MeetingBrief,
  type MeetingBriefUpdate,
  type Minefield,
  type NewsItem,
  type Objective,
  type PublicSignal,
  type ScenarioType,
  type Severity,
  type SnapshotStat,
  type ValueAnchor,
} from "@/types/meeting_brief";

const CALL_TYPE_OPTIONS: BriefCallType[] = [
  "first_discovery",
  "qbr",
  "renewal",
  "expansion",
  "other",
];

const SEVERITY_OPTIONS: Severity[] = ["high", "caution"];
const SCENARIO_OPTIONS: ScenarioType[] = ["good", "neutral", "poor"];
const ATTENDEE_COMPANY_OPTIONS: AttendeeCompany[] = ["client", "beroe"];

export function MeetingBriefEditor({ accountId }: { accountId: string }) {
  const qc = useQueryClient();

  const { data, isLoading, isError } = useQuery<MeetingBrief>({
    queryKey: ["meeting-brief", accountId],
    queryFn: () => api.get<MeetingBrief>(`/api/v1/accounts/${accountId}/meeting-brief`),
  });

  const [form, setForm] = useState<MeetingBrief | null>(null);
  const [savingError, setSavingError] = useState<string | null>(null);

  useEffect(() => {
    if (data && !form) {
      const draft = consumeBriefSlice(accountId);
      setForm(draft ? mergeBriefDraft(data, draft) : data);
    }
  }, [data, form, accountId]);

  // Live event — fires when the user clicks "Extract fields" while the
  // Brief tab is already mounted (rare but possible if they extract from
  // a MoM in Pre-Sales and then quickly hop here).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ accountId: string }>).detail;
      if (!detail || detail.accountId !== accountId) return;
      const draft = consumeBriefSlice(accountId);
      if (!draft) return;
      setForm((prev) => (prev ? mergeBriefDraft(prev, draft) : prev));
    };
    window.addEventListener(EXTRACTION_APPLIED_EVENT, handler);
    return () => window.removeEventListener(EXTRACTION_APPLIED_EVENT, handler);
  }, [accountId]);

  const dirty = useMemo(() => {
    if (!form || !data) return false;
    return JSON.stringify(serialise(form)) !== JSON.stringify(serialise(data));
  }, [form, data]);

  const saveMutation = useMutation({
    mutationFn: (body: MeetingBriefUpdate) =>
      api.patch<MeetingBrief>(`/api/v1/accounts/${accountId}/meeting-brief`, body),
    onSuccess: (saved) => {
      qc.setQueryData(["meeting-brief", accountId], saved);
      qc.invalidateQueries({ queryKey: ["activity", accountId] });
      setForm(saved);
      setSavingError(null);
    },
    onError: (e: ApiError) => setSavingError(e.message),
  });

  const resetMutation = useMutation({
    mutationFn: () => api.delete(`/api/v1/accounts/${accountId}/meeting-brief`),
    onSuccess: () => {
      const blank = emptyBrief(accountId);
      qc.setQueryData(["meeting-brief", accountId], blank);
      setForm(blank);
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
    return <div className="text-sm text-text-muted">Loading brief…</div>;
  }
  if (isError) {
    return (
      <div className="text-sm text-red-700">
        Failed to load the meeting brief.
      </div>
    );
  }

  // All update helpers close over `form`/`setForm`.
  const update = <K extends keyof MeetingBrief>(key: K, value: MeetingBrief[K]) =>
    setForm({ ...form, [key]: value });

  const editable = form.is_editable;

  return (
    <div className="space-y-3">
      {/* Call info — open by default */}
      <BriefSection title="Call info" defaultOpen>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Call type">
            <select
              value={form.call_type ?? ""}
              onChange={(e) =>
                update("call_type", (e.target.value || null) as BriefCallType | null)
              }
              disabled={!editable}
              className={inputCls(editable)}
            >
              <option value="">— Select —</option>
              {CALL_TYPE_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {BRIEF_CALL_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Date">
            <input
              type="date"
              value={form.call_date ?? ""}
              onChange={(e) => update("call_date", e.target.value || null)}
              disabled={!editable}
              className={inputCls(editable)}
            />
          </Field>
          <Field label="Duration (mins)">
            <input
              type="number"
              min={0}
              max={1440}
              value={form.call_duration_minutes ?? ""}
              onChange={(e) =>
                update(
                  "call_duration_minutes",
                  e.target.value === "" ? null : Number(e.target.value),
                )
              }
              disabled={!editable}
              className={inputCls(editable)}
            />
          </Field>
          <Field label="Time">
            <input
              type="text"
              value={form.call_time ?? ""}
              maxLength={120}
              placeholder="e.g. 10:00–11:00 AM CET"
              onChange={(e) => update("call_time", e.target.value || null)}
              disabled={!editable}
              className={inputCls(editable)}
            />
          </Field>
          <Field label="Platform">
            <input
              type="text"
              value={form.call_platform ?? ""}
              maxLength={120}
              placeholder="e.g. Microsoft Teams"
              onChange={(e) => update("call_platform", e.target.value || null)}
              disabled={!editable}
              className={inputCls(editable)}
            />
          </Field>
        </div>
      </BriefSection>

      {/* Win condition — open by default; it's the headline of the brief */}
      <BriefSection title="Win condition" defaultOpen>
        <textarea
          rows={2}
          maxLength={1200}
          value={form.win_condition ?? ""}
          onChange={(e) => update("win_condition", e.target.value || null)}
          disabled={!editable}
          placeholder="Single-sentence outcome you're targeting for this call."
          className={textareaCls(editable)}
        />
      </BriefSection>

      {/* Company snapshot — small stat cards */}
      <BriefSection
        title={`Company snapshot (${form.company_snapshot.length})`}
        subtitle="Quick stat cards — revenue, headcount, key facts."
      >
        <ItemList
          items={form.company_snapshot}
          onChange={(items) => update("company_snapshot", items)}
          renderItem={(s, set) => (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                className={inputCls(editable)}
                disabled={!editable}
                placeholder="Number (e.g. $96B)"
                maxLength={40}
                value={s.num}
                onChange={(e) => set({ ...s, num: e.target.value })}
              />
              <input
                className={inputCls(editable)}
                disabled={!editable}
                placeholder="Label"
                maxLength={120}
                value={s.label}
                onChange={(e) => set({ ...s, label: e.target.value })}
              />
              <input
                className={inputCls(editable)}
                disabled={!editable}
                placeholder="Sub-label (optional)"
                maxLength={120}
                value={s.sub ?? ""}
                onChange={(e) => set({ ...s, sub: e.target.value || null })}
              />
            </div>
          )}
          emptyStat={(): SnapshotStat => ({ num: "", label: "", sub: null })}
          editable={editable}
          addLabel="+ Stat"
        />
      </BriefSection>

      {/* Call timer */}
      <BriefSection
        title={`Call timer (${form.call_timer.length})`}
        subtitle="Agenda timing breakdown."
      >
        <ItemList
          items={form.call_timer}
          onChange={(items) => update("call_timer", items)}
          renderItem={(s, set) => (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                className={inputCls(editable)}
                disabled={!editable}
                placeholder="Time slot (e.g. 0:00–8:00)"
                maxLength={40}
                value={s.time}
                onChange={(e) => set({ ...s, time: e.target.value })}
              />
              <input
                className={cn(inputCls(editable), "sm:col-span-2")}
                disabled={!editable}
                placeholder="What happens in this slot"
                maxLength={200}
                value={s.label}
                onChange={(e) => set({ ...s, label: e.target.value })}
              />
            </div>
          )}
          emptyStat={(): CallTimerSlot => ({ time: "", label: "" })}
          editable={editable}
          addLabel="+ Slot"
        />
      </BriefSection>

      {/* Attendees */}
      <BriefSection
        title={`The room — attendees (${form.attendees.length})`}
        subtitle="Each attendee gets a name, role, side, opening ask."
      >
        <ItemList
          items={form.attendees}
          onChange={(items) => update("attendees", items)}
          renderItem={(a, set) => (
            <div className="space-y-2">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <input
                  className={inputCls(editable)}
                  disabled={!editable}
                  placeholder="Initials"
                  maxLength={4}
                  value={a.initials}
                  onChange={(e) => set({ ...a, initials: e.target.value.toUpperCase() })}
                />
                <input
                  className={cn(inputCls(editable), "sm:col-span-2")}
                  disabled={!editable}
                  placeholder="Full name"
                  maxLength={120}
                  value={a.name}
                  onChange={(e) => set({ ...a, name: e.target.value })}
                />
                <select
                  className={inputCls(editable)}
                  disabled={!editable}
                  value={a.company}
                  onChange={(e) => set({ ...a, company: e.target.value as AttendeeCompany })}
                >
                  {ATTENDEE_COMPANY_OPTIONS.map((c) => (
                    <option key={c} value={c}>{c === "client" ? "Client side" : "Beroe side"}</option>
                  ))}
                </select>
              </div>
              <input
                className={inputCls(editable)}
                disabled={!editable}
                placeholder="Role / title"
                maxLength={160}
                value={a.role ?? ""}
                onChange={(e) => set({ ...a, role: e.target.value || null })}
              />
              <StringListField
                label="Background"
                items={a.background}
                editable={editable}
                onChange={(v) => set({ ...a, background: v })}
                placeholder="Add a background bullet"
              />
              <StringListField
                label="Objectives"
                items={a.objectives}
                editable={editable}
                onChange={(v) => set({ ...a, objectives: v })}
                placeholder="Add an objective tag"
              />
              <Field label="Primary objective (optional)">
                <input
                  className={inputCls(editable)}
                  disabled={!editable}
                  placeholder="Pick from objectives above"
                  maxLength={80}
                  value={a.primary_objective ?? ""}
                  onChange={(e) =>
                    set({ ...a, primary_objective: e.target.value || null })
                  }
                />
              </Field>
              <Field label="Opening ask">
                <textarea
                  className={textareaCls(editable)}
                  rows={2}
                  disabled={!editable}
                  placeholder="Question we open with for this person"
                  maxLength={600}
                  value={a.opening_ask ?? ""}
                  onChange={(e) => set({ ...a, opening_ask: e.target.value || null })}
                />
              </Field>
              <label className="text-xs text-text-secondary inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={a.is_self}
                  disabled={!editable}
                  onChange={(e) => set({ ...a, is_self: e.target.checked })}
                />
                This is me / Beroe attendee
              </label>
            </div>
          )}
          emptyStat={(): Attendee => ({
            initials: "",
            name: "",
            role: null,
            company: "client",
            is_self: false,
            avatar_color: null,
            objectives: [],
            primary_objective: null,
            background: [],
            opening_ask: null,
          })}
          editable={editable}
          addLabel="+ Attendee"
        />
      </BriefSection>

      {/* Minefields */}
      <BriefSection
        title={`Minefields (${form.minefields.length})`}
        subtitle="Things to avoid in the call — and why."
      >
        <ItemList
          items={form.minefields}
          onChange={(items) => update("minefields", items)}
          renderItem={(m, set) => (
            <div className="space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <select
                  className={inputCls(editable)}
                  disabled={!editable}
                  value={m.severity}
                  onChange={(e) => set({ ...m, severity: e.target.value as Severity })}
                >
                  {SEVERITY_OPTIONS.map((s) => (
                    <option key={s} value={s}>{SEVERITY_LABELS[s]}</option>
                  ))}
                </select>
                <input
                  className={cn(inputCls(editable), "sm:col-span-2")}
                  disabled={!editable}
                  placeholder="Type (e.g. Competitive, Coverage)"
                  maxLength={60}
                  value={m.type ?? ""}
                  onChange={(e) => set({ ...m, type: e.target.value || null })}
                />
              </div>
              <textarea
                className={textareaCls(editable)}
                rows={2}
                disabled={!editable}
                placeholder="Don't…"
                maxLength={400}
                value={m.text}
                onChange={(e) => set({ ...m, text: e.target.value })}
              />
              <textarea
                className={textareaCls(editable)}
                rows={2}
                disabled={!editable}
                placeholder="Why"
                maxLength={400}
                value={m.why ?? ""}
                onChange={(e) => set({ ...m, why: e.target.value || null })}
              />
            </div>
          )}
          emptyStat={(): Minefield => ({
            severity: "caution",
            type: null,
            text: "",
            why: null,
          })}
          editable={editable}
          addLabel="+ Minefield"
        />
      </BriefSection>

      {/* Objectives */}
      <BriefSection
        title={`Objectives (${form.objectives.length})`}
        subtitle="Ranked priorities for the call, with Beroe's response."
      >
        <ItemList
          items={form.objectives}
          onChange={(items) => update("objectives", items)}
          renderItem={(o, set) => (
            <div className="space-y-2">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Field label="Rank">
                  <input
                    type="number"
                    min={1}
                    max={20}
                    className={inputCls(editable)}
                    disabled={!editable}
                    value={o.rank}
                    onChange={(e) =>
                      set({ ...o, rank: Number(e.target.value) || 1 })
                    }
                  />
                </Field>
                <Field label="Confidence (1–5)">
                  <input
                    type="number"
                    min={1}
                    max={5}
                    className={inputCls(editable)}
                    disabled={!editable}
                    value={o.confidence}
                    onChange={(e) =>
                      set({ ...o, confidence: Math.max(1, Math.min(5, Number(e.target.value) || 1)) })
                    }
                  />
                </Field>
                <Field label="Name">
                  <input
                    type="text"
                    maxLength={200}
                    className={cn(inputCls(editable), "sm:col-span-2")}
                    disabled={!editable}
                    placeholder="Short objective name"
                    value={o.name}
                    onChange={(e) => set({ ...o, name: e.target.value })}
                  />
                </Field>
              </div>
              <StringListField
                label="Supporting bullets"
                items={o.bullets}
                editable={editable}
                onChange={(v) => set({ ...o, bullets: v })}
                placeholder="Add a bullet"
              />
              <Field label="Beroe response">
                <textarea
                  className={textareaCls(editable)}
                  rows={3}
                  maxLength={1200}
                  disabled={!editable}
                  placeholder="How Beroe addresses this objective"
                  value={o.beroe ?? ""}
                  onChange={(e) => set({ ...o, beroe: e.target.value || null })}
                />
              </Field>
            </div>
          )}
          emptyStat={(): Objective => ({
            rank: 1,
            name: "",
            confidence: 3,
            bullets: [],
            beroe: null,
            sources: [],
          })}
          editable={editable}
          addLabel="+ Objective"
        />
      </BriefSection>

      {/* Discovery questions */}
      <BriefSection
        title={`Discovery questions (${form.discovery_questions.length})`}
        subtitle="Per objective, ranked. Mark questions sourced from prior emails."
      >
        <ItemList
          items={form.discovery_questions}
          onChange={(items) => update("discovery_questions", items)}
          renderItem={(q, set) => (
            <div className="space-y-2">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <input
                  className={inputCls(editable)}
                  disabled={!editable}
                  placeholder="Objective"
                  maxLength={200}
                  value={q.objective}
                  onChange={(e) => set({ ...q, objective: e.target.value })}
                />
                <input
                  type="number"
                  min={1}
                  max={20}
                  className={inputCls(editable)}
                  disabled={!editable}
                  placeholder="Rank"
                  value={q.rank}
                  onChange={(e) => set({ ...q, rank: Number(e.target.value) || 1 })}
                />
                <input
                  className={cn(inputCls(editable), "sm:col-span-2")}
                  disabled={!editable}
                  placeholder="For (person name)"
                  maxLength={120}
                  value={q.person}
                  onChange={(e) => set({ ...q, person: e.target.value })}
                />
              </div>
              <textarea
                className={textareaCls(editable)}
                rows={2}
                maxLength={600}
                disabled={!editable}
                placeholder="The question"
                value={q.text}
                onChange={(e) => set({ ...q, text: e.target.value })}
              />
              <label className="text-xs text-text-secondary inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={q.from_email}
                  disabled={!editable}
                  onChange={(e) => set({ ...q, from_email: e.target.checked })}
                />
                Sourced from email correspondence
              </label>
            </div>
          )}
          emptyStat={(): DiscoveryQuestion => ({
            objective: "",
            rank: 1,
            person: "",
            from_email: false,
            text: "",
          })}
          editable={editable}
          addLabel="+ Question"
        />
      </BriefSection>

      {/* Value anchors */}
      <BriefSection
        title={`Value anchors (${form.value_anchors.length})`}
        subtitle="Proof points grouped by objective."
      >
        <ItemList
          items={form.value_anchors}
          onChange={(items) => update("value_anchors", items)}
          renderItem={(v, set) => (
            <div className="space-y-2">
              <input
                className={inputCls(editable)}
                disabled={!editable}
                placeholder="Objective this anchors"
                maxLength={200}
                value={v.objective}
                onChange={(e) => set({ ...v, objective: e.target.value })}
              />
              <ItemList
                items={v.points}
                onChange={(points) => set({ ...v, points })}
                renderItem={(p, setP) => (
                  <div className="space-y-1">
                    <textarea
                      className={textareaCls(editable)}
                      rows={2}
                      maxLength={600}
                      disabled={!editable}
                      placeholder="Anchor text"
                      value={p.text}
                      onChange={(e) => setP({ ...p, text: e.target.value })}
                    />
                    <input
                      className={inputCls(editable)}
                      disabled={!editable}
                      placeholder="Note (optional)"
                      maxLength={400}
                      value={p.note ?? ""}
                      onChange={(e) => setP({ ...p, note: e.target.value || null })}
                    />
                  </div>
                )}
                emptyStat={() => ({ text: "", note: null })}
                editable={editable}
                addLabel="+ Point"
              />
            </div>
          )}
          emptyStat={(): ValueAnchor => ({ objective: "", points: [] })}
          editable={editable}
          addLabel="+ Anchor"
        />
      </BriefSection>

      {/* Email insights */}
      <BriefSection
        title={`Email insights (${form.email_insights.length})`}
        subtitle="Bullets pulled from recent email threads."
      >
        <ItemList
          items={form.email_insights}
          onChange={(items) => update("email_insights", items)}
          renderItem={(e, set) => (
            <div className="space-y-2">
              <input
                className={inputCls(editable)}
                disabled={!editable}
                placeholder="Meta (date, subject, parties)"
                maxLength={200}
                value={e.meta}
                onChange={(ev) => set({ ...e, meta: ev.target.value })}
              />
              <StringListField
                label="Bullets"
                items={e.bullets}
                editable={editable}
                onChange={(v) => set({ ...e, bullets: v })}
                placeholder="Add an insight bullet"
              />
            </div>
          )}
          emptyStat={(): EmailInsight => ({ meta: "", bullets: [] })}
          editable={editable}
          addLabel="+ Email insight"
        />
      </BriefSection>

      {/* Public signals */}
      <BriefSection
        title={`Public signals (${form.public_signals.length})`}
        subtitle="LinkedIn posts, articles, talks worth referencing."
      >
        <ItemList
          items={form.public_signals}
          onChange={(items) => update("public_signals", items)}
          renderItem={(s, set) => (
            <div className="space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  className={inputCls(editable)}
                  disabled={!editable}
                  placeholder="Person"
                  maxLength={120}
                  value={s.person ?? ""}
                  onChange={(e) => set({ ...s, person: e.target.value || null })}
                />
                <input
                  className={inputCls(editable)}
                  disabled={!editable}
                  placeholder="Tag (e.g. LinkedIn)"
                  maxLength={60}
                  value={s.tag ?? ""}
                  onChange={(e) => set({ ...s, tag: e.target.value || null })}
                />
              </div>
              <input
                className={inputCls(editable)}
                disabled={!editable}
                placeholder="Headline"
                maxLength={240}
                value={s.headline}
                onChange={(e) => set({ ...s, headline: e.target.value })}
              />
              <input
                className={inputCls(editable)}
                disabled={!editable}
                placeholder="URL (optional)"
                maxLength={600}
                value={s.url ?? ""}
                onChange={(e) => set({ ...s, url: e.target.value || null })}
              />
              <textarea
                className={textareaCls(editable)}
                rows={2}
                maxLength={1200}
                disabled={!editable}
                placeholder="What this means for the call"
                value={s.text ?? ""}
                onChange={(e) => set({ ...s, text: e.target.value || null })}
              />
            </div>
          )}
          emptyStat={(): PublicSignal => ({
            person: null, headline: "", text: null, url: null, tag: null,
          })}
          editable={editable}
          addLabel="+ Signal"
        />
      </BriefSection>

      {/* News */}
      <BriefSection
        title={`News (${form.news.length})`}
        subtitle="Recent news the prospect might bring up."
      >
        <ItemList
          items={form.news}
          onChange={(items) => update("news", items)}
          renderItem={(n, set) => (
            <div className="space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  type="number"
                  min={0}
                  className={inputCls(editable)}
                  disabled={!editable}
                  placeholder="Days ago"
                  value={n.days_ago ?? ""}
                  onChange={(e) =>
                    set({ ...n, days_ago: e.target.value === "" ? null : Number(e.target.value) })
                  }
                />
                <input
                  className={inputCls(editable)}
                  disabled={!editable}
                  placeholder="Source"
                  maxLength={120}
                  value={n.source ?? ""}
                  onChange={(e) => set({ ...n, source: e.target.value || null })}
                />
                <input
                  className={inputCls(editable)}
                  disabled={!editable}
                  placeholder="Tag"
                  maxLength={60}
                  value={n.tag ?? ""}
                  onChange={(e) => set({ ...n, tag: e.target.value || null })}
                />
              </div>
              <input
                className={inputCls(editable)}
                disabled={!editable}
                placeholder="Headline"
                maxLength={240}
                value={n.headline}
                onChange={(e) => set({ ...n, headline: e.target.value })}
              />
              <input
                className={inputCls(editable)}
                disabled={!editable}
                placeholder="URL (optional)"
                maxLength={600}
                value={n.url ?? ""}
                onChange={(e) => set({ ...n, url: e.target.value || null })}
              />
              <textarea
                className={textareaCls(editable)}
                rows={2}
                maxLength={600}
                disabled={!editable}
                placeholder="Why this matters"
                value={n.signal ?? ""}
                onChange={(e) => set({ ...n, signal: e.target.value || null })}
              />
            </div>
          )}
          emptyStat={(): NewsItem => ({
            days_ago: null, headline: "", source: null, signal: null, url: null, tag: null,
          })}
          editable={editable}
          addLabel="+ News item"
        />
      </BriefSection>

      {/* Annual reports */}
      <BriefSection
        title={`Annual reports (${form.annual_reports.length})`}
        subtitle="Pulled highlights from public filings."
      >
        <ItemList
          items={form.annual_reports}
          onChange={(items) => update("annual_reports", items)}
          renderItem={(r, set) => (
            <div className="space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input
                  className={cn(inputCls(editable), "sm:col-span-2")}
                  disabled={!editable}
                  placeholder="Title"
                  maxLength={240}
                  value={r.title}
                  onChange={(e) => set({ ...r, title: e.target.value })}
                />
                <input
                  type="number"
                  min={1900}
                  max={2100}
                  className={inputCls(editable)}
                  disabled={!editable}
                  placeholder="Year"
                  value={r.year ?? ""}
                  onChange={(e) =>
                    set({ ...r, year: e.target.value === "" ? null : Number(e.target.value) })
                  }
                />
              </div>
              <input
                className={inputCls(editable)}
                disabled={!editable}
                placeholder="URL (optional)"
                maxLength={600}
                value={r.url ?? ""}
                onChange={(e) => set({ ...r, url: e.target.value || null })}
              />
              <StringListField
                label="Bullets"
                items={r.bullets}
                editable={editable}
                onChange={(v) => set({ ...r, bullets: v })}
                placeholder="Add a bullet"
              />
            </div>
          )}
          emptyStat={(): AnnualReportItem => ({ title: "", year: null, url: null, bullets: [] })}
          editable={editable}
          addLabel="+ Report"
        />
      </BriefSection>

      {/* Closing scenarios */}
      <BriefSection
        title={`Closing scenarios (${form.closing_scenarios.length})`}
        subtitle="Playbooks for good / neutral / poor end-states."
      >
        <ItemList
          items={form.closing_scenarios}
          onChange={(items) => update("closing_scenarios", items)}
          renderItem={(c, set) => (
            <div className="space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <select
                  className={inputCls(editable)}
                  disabled={!editable}
                  value={c.type}
                  onChange={(e) => set({ ...c, type: e.target.value as ScenarioType })}
                >
                  {SCENARIO_OPTIONS.map((t) => (
                    <option key={t} value={t}>{SCENARIO_LABELS[t]}</option>
                  ))}
                </select>
                <input
                  className={inputCls(editable)}
                  disabled={!editable}
                  placeholder="Custom label (optional)"
                  maxLength={80}
                  value={c.label ?? ""}
                  onChange={(e) => set({ ...c, label: e.target.value || null })}
                />
              </div>
              <textarea
                className={textareaCls(editable)}
                rows={3}
                maxLength={1200}
                disabled={!editable}
                placeholder="What does this scenario look like?"
                value={c.text}
                onChange={(e) => set({ ...c, text: e.target.value })}
              />
            </div>
          )}
          emptyStat={(): ClosingScenario => ({ type: "neutral", label: null, text: "" })}
          editable={editable}
          addLabel="+ Scenario"
        />
      </BriefSection>

      {/* Cheat sheet */}
      <BriefSection title="Cheat sheet" subtitle="Quick prompts the meeting lead glances at.">
        <Field label="Short win condition">
          <input
            type="text"
            maxLength={400}
            value={form.cheat_sheet_win_condition_short ?? ""}
            onChange={(e) =>
              update("cheat_sheet_win_condition_short", e.target.value || null)
            }
            disabled={!editable}
            className={inputCls(editable)}
            placeholder="One short line"
          />
        </Field>
        <StringListField
          label={`Never say (${form.cheat_sheet_never_say.length})`}
          items={form.cheat_sheet_never_say}
          editable={editable}
          onChange={(v) => update("cheat_sheet_never_say", v)}
          placeholder="Add a forbidden phrase"
        />
        <StringListField
          label={`Opening asks (${form.cheat_sheet_opening_asks.length})`}
          items={form.cheat_sheet_opening_asks}
          editable={editable}
          onChange={(v) => update("cheat_sheet_opening_asks", v)}
          placeholder="Add an opening question"
        />
      </BriefSection>

      {/* Sticky save bar */}
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
            onClick={() => {
              if (
                confirm(
                  "Reset the brief? This deletes everything saved and starts over.",
                )
              ) {
                resetMutation.mutate();
              }
            }}
            disabled={resetMutation.isPending}
            className="px-3 py-1.5 rounded-lg text-xs border border-red-200 text-red-700 disabled:opacity-50 bg-white"
            title="Clear the entire brief and start over"
          >
            Reset brief
          </button>
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
            {saveMutation.isPending ? "Saving…" : "Save brief"}
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
}

// ---------- Sub-components ----------

function BriefSection({
  title,
  subtitle,
  children,
  defaultOpen,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      className="bg-white rounded-card border border-beroe-card-border overflow-hidden"
      open={defaultOpen}
    >
      <summary className="px-4 py-3 cursor-pointer text-sm font-bold text-text-primary hover:bg-slate-50 transition-colors flex items-center gap-2">
        <span>{title}</span>
        {subtitle && (
          <span className="text-[11px] font-normal text-text-muted ml-1">
            · {subtitle}
          </span>
        )}
      </summary>
      <div className="px-4 pb-4 pt-2 space-y-2">{children}</div>
    </details>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wider text-text-muted font-bold mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}

/**
 * Generic repeating-list editor. The caller renders each row with whatever
 * fields it needs; we just handle add / remove / patch-in-place.
 */
function ItemList<T>({
  items,
  onChange,
  renderItem,
  emptyStat,
  editable,
  addLabel,
}: {
  items: T[];
  onChange: (next: T[]) => void;
  renderItem: (item: T, set: (next: T) => void) => React.ReactNode;
  emptyStat: () => T;
  editable: boolean;
  addLabel: string;
}) {
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div
          key={i}
          className="rounded-lg border border-slate-200 bg-slate-50/40 p-3 relative"
        >
          {editable && (
            <button
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="absolute top-2 right-2 text-text-muted hover:text-red-700 text-xs"
              title="Remove"
              aria-label="Remove item"
            >
              ✕
            </button>
          )}
          {renderItem(item, (next) =>
            onChange(items.map((x, j) => (j === i ? next : x))),
          )}
        </div>
      ))}
      {editable && (
        <button
          onClick={() => onChange([...items, emptyStat()])}
          className="text-xs px-2 py-1 rounded-md border border-beroe-blue text-beroe-blue font-semibold hover:bg-beroe-blue/5"
        >
          {addLabel}
        </button>
      )}
      {!editable && items.length === 0 && (
        <div className="text-xs text-text-muted italic">Empty.</div>
      )}
    </div>
  );
}

/** Repeating list of plain strings — used for bullets / phrases / asks. */
function StringListField({
  label,
  items,
  editable,
  onChange,
  placeholder,
}: {
  label: string;
  items: string[];
  editable: boolean;
  onChange: (next: string[]) => void;
  placeholder: string;
}) {
  const [pending, setPending] = useState("");
  const add = () => {
    const v = pending.trim();
    if (!v) return;
    onChange([...items, v]);
    setPending("");
  };
  return (
    <div>
      <label className="block text-[11px] uppercase tracking-wider text-text-muted font-bold mb-1">
        {label}
      </label>
      {items.length > 0 && (
        <ul className="space-y-1 mb-2">
          {items.map((s, i) => (
            <li
              key={`${i}-${s}`}
              className="flex items-start gap-2 text-sm text-text-primary bg-white rounded-md border border-slate-200 px-2 py-1"
            >
              <span className="flex-1">{s}</span>
              {editable && (
                <button
                  onClick={() => onChange(items.filter((_, j) => j !== i))}
                  className="text-text-muted hover:text-red-700 text-xs"
                  aria-label="Remove"
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <div className="flex gap-1">
          <input
            type="text"
            value={pending}
            onChange={(e) => setPending(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder={placeholder}
            className="flex-1 px-2 py-1 text-xs rounded-md border border-slate-200 focus:outline-none focus:border-beroe-blue"
          />
          <button
            onClick={add}
            disabled={!pending.trim()}
            className="text-xs px-2 py-1 rounded-md border border-beroe-blue text-beroe-blue font-semibold disabled:opacity-50"
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}

// ---------- Helpers ----------

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

/** Strip server-owned fields before computing the dirty diff. */
function serialise(b: MeetingBrief): unknown {
  const { updated_at, updated_by, is_editable, ...rest } = b;
  void updated_at;
  void updated_by;
  void is_editable;
  return rest;
}

/** PATCH payload — only fields that changed. */
function diff(next: MeetingBrief, prev: MeetingBrief): MeetingBriefUpdate {
  const keys = [
    "call_type",
    "call_date",
    "call_time",
    "call_platform",
    "call_duration_minutes",
    "win_condition",
    "cheat_sheet_win_condition_short",
    "company_snapshot",
    "call_timer",
    "attendees",
    "minefields",
    "objectives",
    "discovery_questions",
    "value_anchors",
    "email_insights",
    "public_signals",
    "news",
    "annual_reports",
    "closing_scenarios",
    "cheat_sheet_never_say",
    "cheat_sheet_opening_asks",
  ] as const;
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    if (JSON.stringify(next[k]) !== JSON.stringify(prev[k])) {
      out[k] = next[k];
    }
  }
  return out;
}

/** Apply an MoM-extracted slice over the live brief form. Scalar fields fall
 *  back to the existing value when the draft is empty; collections REPLACE
 *  wholesale when the draft has any entries — same semantic as the JSONB
 *  PATCH on the server, where a non-empty array overwrites in full. */
function mergeBriefDraft(base: MeetingBrief, draft: ExtractedBrief): MeetingBrief {
  const next: MeetingBrief = { ...base };
  if (draft.call_date) next.call_date = draft.call_date;
  if (draft.call_type) next.call_type = draft.call_type;
  if (draft.call_duration_minutes != null) next.call_duration_minutes = draft.call_duration_minutes;
  if (draft.win_condition) next.win_condition = draft.win_condition;
  if (draft.company_snapshot?.length) next.company_snapshot = draft.company_snapshot as SnapshotStat[];
  if (draft.attendees?.length) next.attendees = draft.attendees as Attendee[];
  if (draft.news?.length) next.news = draft.news as NewsItem[];
  if (draft.public_signals?.length) next.public_signals = draft.public_signals as PublicSignal[];
  if (draft.value_anchors?.length) next.value_anchors = draft.value_anchors as ValueAnchor[];
  if (draft.email_insights?.length) next.email_insights = draft.email_insights as EmailInsight[];
  if (draft.cheat_sheet_never_say?.length) next.cheat_sheet_never_say = draft.cheat_sheet_never_say;
  if (draft.cheat_sheet_opening_asks?.length) next.cheat_sheet_opening_asks = draft.cheat_sheet_opening_asks;
  return next;
}
