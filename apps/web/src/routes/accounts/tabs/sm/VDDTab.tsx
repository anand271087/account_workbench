// M22 — Value Delivery Document.
//
// Four section cards in one tab:
//   1. Client strategic priorities  — string list
//   2. Agreed success metrics       — usually mirrors M20 success_metrics
//   3. Beroe's approach per initiative + 3-lever savings
//   4. Value delivered rollup ($identified / $committed / $implemented)
//
// Lock model mirrors M19 Success Contract: locked state is read-only,
// admin-only unlock. PATCH on locked returns 409 from the API.
// Auto-draft (auto_drafted:true) wears an orange "Pre-filled from Goals
// + Metrics" badge.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/components/AuthProvider";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAccountFromLayout } from "../../AccountProfileLayout";
import {
  attributionTotals,
  fmtMusd,
  LEVERS,
  LEVER_LABELS,
  LEVER_TONES,
  STAGES,
  type ApproachItem,
  type MetricSnapshot,
  type SavingsLever,
  type ValueDeliveredItem,
  type Vdd,
  type VddUpdate,
} from "@/types/vdd";

export default function VDDTab() {
  const account = useAccountFromLayout();
  const { me } = useAuth();
  const isAdmin = !!me?.permissions?.is_global_admin;
  const qc = useQueryClient();
  const queryKey = ["vdd", account.id];

  const { data, isLoading } = useQuery<Vdd>({
    queryKey,
    queryFn: () =>
      api.get<Vdd>(`/api/v1/accounts/${account.id}/value-delivery-document`),
  });

  const [form, setForm] = useState<Vdd | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (data && !form) setForm(data);
  }, [data, form]);

  const dirty = useMemo(() => {
    if (!form || !data) return false;
    return JSON.stringify(serializeForm(form)) !== JSON.stringify(serializeForm(data));
  }, [form, data]);

  const saveMutation = useMutation({
    mutationFn: (body: VddUpdate) =>
      api.patch<Vdd>(
        `/api/v1/accounts/${account.id}/value-delivery-document`,
        body,
      ),
    onSuccess: (saved) => {
      qc.setQueryData(queryKey, saved);
      setForm(saved);
      setErr(null);
    },
    onError: (e: ApiError) => setErr(e.message),
  });

  const lockMutation = useMutation({
    mutationFn: () =>
      api.post<Vdd>(
        `/api/v1/accounts/${account.id}/value-delivery-document/lock`,
      ),
    onSuccess: (saved) => {
      qc.setQueryData(queryKey, saved);
      setForm(saved);
      setErr(null);
    },
    onError: (e: ApiError) => setErr(e.message),
  });

  const unlockMutation = useMutation({
    mutationFn: () =>
      api.post<Vdd>(
        `/api/v1/accounts/${account.id}/value-delivery-document/unlock`,
      ),
    onSuccess: (saved) => {
      qc.setQueryData(queryKey, saved);
      setForm(saved);
      setErr(null);
    },
    onError: (e: ApiError) => setErr(e.message),
  });

  if (isLoading || !form) {
    return (
      <Card>
        <div className="text-sm text-text-muted">Loading Value Delivery Document…</div>
      </Card>
    );
  }

  const locked = form.locked_at !== null;
  const editable = form.is_editable && !locked;
  const totals = attributionTotals(form.value_delivered);

  const onSave = () => saveMutation.mutate(serializeForm(form));
  const onLock = () => {
    if (dirty) saveMutation.mutate(serializeForm(form), { onSuccess: () => lockMutation.mutate() });
    else lockMutation.mutate();
  };

  const allFour =
    form.client_strategic_priorities.length > 0 &&
    form.agreed_success_metrics.length > 0 &&
    form.beroes_approach.length > 0 &&
    form.value_delivered.length > 0;

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
              Success Management · M22
            </div>
            <h2 className="text-lg font-semibold text-text-primary">
              Value Delivery Document
            </h2>
            <p className="text-[12px] text-text-secondary mt-0.5">
              Single source of truth for what Beroe committed to and what was
              delivered. Reviewed at every checkpoint.
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            {locked ? (
              <span className="text-[11px] px-2 py-1 rounded-md bg-green-50 text-green-700 border border-green-200 font-semibold">
                🔒 Locked
              </span>
            ) : form.auto_drafted ? (
              <span className="text-[11px] px-2 py-1 rounded-md bg-amber-50 text-amber-700 border border-amber-200">
                Pre-filled from Goals + Metrics
              </span>
            ) : (
              <span className="text-[11px] px-2 py-1 rounded-md bg-slate-50 text-slate-700 border border-slate-200">
                Draft
              </span>
            )}
          </div>
        </div>
      </Card>

      {/* Attribution rollup */}
      <Card>
        <div className="text-[11px] font-bold uppercase tracking-wider text-text-muted mb-2">
          CSM-attributed value rollup
        </div>
        <div className="grid grid-cols-3 gap-3">
          <RollupTile label="Identified" value={totals.identified} tone="slate" />
          <RollupTile label="Committed" value={totals.committed} tone="amber" />
          <RollupTile label="Implemented" value={totals.implemented} tone="green" />
        </div>
      </Card>

      {/* Section 1 — Client strategic priorities */}
      <Card>
        <SectionHeader title="Client strategic priorities" hint="Pillars / themes the client invested in" />
        <PriorityList
          items={form.client_strategic_priorities}
          editable={editable}
          onChange={(v) => setForm({ ...form, client_strategic_priorities: v })}
        />
      </Card>

      {/* Section 2 — Agreed success metrics */}
      <Card>
        <SectionHeader
          title="Agreed success metrics"
          hint="Usually mirrored from Value Tracking (M20). Free to override."
        />
        <MetricsList
          items={form.agreed_success_metrics}
          editable={editable}
          onChange={(v) => setForm({ ...form, agreed_success_metrics: v })}
        />
      </Card>

      {/* Section 3 — Beroe's approach */}
      <Card>
        <SectionHeader
          title="Beroe's approach per initiative"
          hint="3-lever savings model: cost · risk · adoption"
        />
        <ApproachList
          items={form.beroes_approach}
          editable={editable}
          onChange={(v) => setForm({ ...form, beroes_approach: v })}
        />
      </Card>

      {/* Section 4 — Value delivered */}
      <Card>
        <SectionHeader
          title="Value delivered"
          hint="$Identified / $Committed / $Implemented per initiative"
        />
        <ValueDeliveredList
          items={form.value_delivered}
          editable={editable}
          onChange={(v) => setForm({ ...form, value_delivered: v })}
        />
      </Card>

      {/* Exec summary */}
      <Card>
        <SectionHeader title="Exec summary" hint="One-paragraph wrap-up for the renewal conversation" />
        <textarea
          disabled={!editable}
          value={form.exec_summary ?? ""}
          onChange={(e) => setForm({ ...form, exec_summary: e.target.value })}
          rows={4}
          maxLength={4000}
          placeholder="On track / at risk. Where we are vs the target, and what's next…"
          className="w-full text-[13px] border border-beroe-card-border rounded-md px-3 py-2 disabled:bg-beroe-bg/40 disabled:text-text-muted"
        />
      </Card>

      {/* Sticky action bar */}
      {form.is_editable && (
        <div
          className={cn(
            "sticky bottom-3 z-10 flex items-center justify-between gap-3 px-3 py-2 rounded-lg border shadow-sm",
            dirty
              ? "bg-amber-50 border-amber-200"
              : "bg-white border-beroe-card-border",
          )}
        >
          <div className="text-[12px] text-text-secondary">
            {err ? (
              <span className="text-red-700">{err}</span>
            ) : locked ? (
              <span>Document is locked. Unlock to edit.</span>
            ) : dirty ? (
              <span className="font-medium text-amber-800">Unsaved changes</span>
            ) : (
              <span>All sections saved.</span>
            )}
          </div>
          <div className="flex gap-2">
            {locked ? (
              isAdmin && (
                <button
                  onClick={() => unlockMutation.mutate()}
                  disabled={unlockMutation.isPending}
                  className="text-[12px] px-3 py-1.5 rounded-md border border-beroe-card-border text-text-secondary hover:bg-beroe-bg/60"
                >
                  Unlock
                </button>
              )
            ) : (
              <>
                <button
                  onClick={onSave}
                  disabled={!dirty || saveMutation.isPending}
                  className="text-[12px] px-3 py-1.5 rounded-md border border-beroe-card-border text-text-secondary hover:bg-beroe-bg/60 disabled:opacity-50"
                >
                  Save changes
                </button>
                <button
                  onClick={onLock}
                  disabled={!allFour || lockMutation.isPending}
                  title={!allFour ? "All 4 sections must have ≥1 item to lock" : ""}
                  className="text-[12px] px-3 py-1.5 rounded-md bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-50"
                >
                  🔒 Lock VDD
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Helpers + primitive controls
// ============================================================

function serializeForm(v: Vdd): VddUpdate {
  return {
    client_strategic_priorities: v.client_strategic_priorities,
    agreed_success_metrics: v.agreed_success_metrics,
    beroes_approach: v.beroes_approach,
    value_delivered: v.value_delivered,
    exec_summary: v.exec_summary,
  };
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white border border-beroe-card-border rounded-card p-4">
      {children}
    </div>
  );
}

function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-3">
      <div className="text-[13px] font-semibold text-text-primary">{title}</div>
      {hint && <div className="text-[11px] text-text-muted mt-0.5">{hint}</div>}
    </div>
  );
}

function RollupTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "slate" | "amber" | "green";
}) {
  const toneClass = {
    slate: "bg-slate-50 border-slate-200 text-slate-800",
    amber: "bg-amber-50 border-amber-200 text-amber-800",
    green: "bg-green-50 border-green-200 text-green-800",
  }[tone];
  return (
    <div className={cn("rounded-md border p-3", toneClass)}>
      <div className="text-[10px] uppercase tracking-wider font-semibold opacity-80">
        {label}
      </div>
      <div className="text-xl font-bold mt-1">{fmtMusd(value)}</div>
    </div>
  );
}

// ----- Priorities -----

function PriorityList({
  items,
  editable,
  onChange,
}: {
  items: string[];
  editable: boolean;
  onChange: (v: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="space-y-1.5">
      {items.length === 0 && (
        <div className="text-[12px] text-text-muted italic">No priorities yet.</div>
      )}
      {items.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          {editable ? (
            <input
              value={p}
              onChange={(e) => {
                const next = [...items];
                next[i] = e.target.value;
                onChange(next);
              }}
              className="flex-1 text-[12px] border border-beroe-card-border rounded-md px-2 py-1"
            />
          ) : (
            <div className="flex-1 text-[12px] text-text-primary">• {p}</div>
          )}
          {editable && (
            <button
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="text-[11px] text-text-muted hover:text-red-700 px-1.5"
            >
              ✕
            </button>
          )}
        </div>
      ))}
      {editable && (
        <div className="flex gap-2 pt-1">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a strategic priority"
            onKeyDown={(e) => {
              if (e.key === "Enter" && draft.trim()) {
                onChange([...items, draft.trim()]);
                setDraft("");
              }
            }}
            className="flex-1 text-[12px] border border-beroe-card-border rounded-md px-2 py-1"
          />
          <button
            onClick={() => {
              if (draft.trim()) {
                onChange([...items, draft.trim()]);
                setDraft("");
              }
            }}
            className="text-[11px] px-2.5 py-1 rounded-md border border-beroe-card-border hover:bg-beroe-bg/60"
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}

// ----- Metrics -----

function MetricsList({
  items,
  editable,
  onChange,
}: {
  items: MetricSnapshot[];
  editable: boolean;
  onChange: (v: MetricSnapshot[]) => void;
}) {
  const update = (i: number, patch: Partial<MetricSnapshot>) => {
    const next = [...items];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  return (
    <div className="space-y-2">
      {items.length === 0 && (
        <div className="text-[12px] text-text-muted italic">No agreed metrics yet.</div>
      )}
      {items.map((m, i) => (
        <div
          key={i}
          className="grid grid-cols-12 gap-2 text-[12px] items-center"
        >
          <input
            disabled={!editable}
            value={m.name ?? ""}
            onChange={(e) => update(i, { name: e.target.value })}
            placeholder="Metric"
            className="col-span-5 border border-beroe-card-border rounded-md px-2 py-1 disabled:bg-beroe-bg/40"
          />
          <input
            disabled={!editable}
            value={m.target ?? ""}
            onChange={(e) => update(i, { target: e.target.value })}
            placeholder="Target"
            className="col-span-3 border border-beroe-card-border rounded-md px-2 py-1 disabled:bg-beroe-bg/40"
          />
          <input
            disabled={!editable}
            value={m.current ?? ""}
            onChange={(e) => update(i, { current: e.target.value })}
            placeholder="Current"
            className="col-span-3 border border-beroe-card-border rounded-md px-2 py-1 disabled:bg-beroe-bg/40"
          />
          {editable && (
            <button
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="col-span-1 text-text-muted hover:text-red-700"
            >
              ✕
            </button>
          )}
        </div>
      ))}
      {editable && (
        <button
          onClick={() =>
            onChange([
              ...items,
              { name: "", target: "", current: "" } as MetricSnapshot,
            ])
          }
          className="text-[11px] px-2.5 py-1 rounded-md border border-beroe-card-border hover:bg-beroe-bg/60"
        >
          + Add metric
        </button>
      )}
    </div>
  );
}

// ----- Approach -----

function ApproachList({
  items,
  editable,
  onChange,
}: {
  items: ApproachItem[];
  editable: boolean;
  onChange: (v: ApproachItem[]) => void;
}) {
  const update = (i: number, patch: Partial<ApproachItem>) => {
    const next = [...items];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const toggleLever = (i: number, lever: SavingsLever) => {
    const current = items[i].levers ?? [];
    const has = current.includes(lever);
    update(i, { levers: has ? current.filter((l) => l !== lever) : [...current, lever] });
  };

  return (
    <div className="space-y-3">
      {items.length === 0 && (
        <div className="text-[12px] text-text-muted italic">
          No approach entries yet. Add one per initiative.
        </div>
      )}
      {items.map((a, i) => (
        <div
          key={i}
          className="border border-beroe-card-border rounded-md p-3 space-y-2"
        >
          <div className="flex items-start gap-2">
            <input
              disabled={!editable}
              value={a.initiative_name ?? ""}
              onChange={(e) => update(i, { initiative_name: e.target.value })}
              placeholder="Initiative name"
              className="flex-1 text-[12px] font-semibold border border-beroe-card-border rounded-md px-2 py-1 disabled:bg-beroe-bg/40"
            />
            <select
              disabled={!editable}
              value={a.stage ?? ""}
              onChange={(e) =>
                update(i, { stage: (e.target.value || null) as ApproachItem["stage"] })
              }
              className="text-[11px] border border-beroe-card-border rounded-md px-2 py-1 disabled:bg-beroe-bg/40"
            >
              <option value="">stage…</option>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {s.replace("_", " ")}
                </option>
              ))}
            </select>
            {editable && (
              <button
                onClick={() => onChange(items.filter((_, j) => j !== i))}
                className="text-text-muted hover:text-red-700 px-1"
              >
                ✕
              </button>
            )}
          </div>
          <textarea
            disabled={!editable}
            value={a.approach ?? ""}
            onChange={(e) => update(i, { approach: e.target.value })}
            rows={2}
            placeholder="Approach summary"
            className="w-full text-[12px] border border-beroe-card-border rounded-md px-2 py-1 disabled:bg-beroe-bg/40"
          />
          <div className="flex gap-1.5 flex-wrap">
            {LEVERS.map((l) => {
              const on = (a.levers ?? []).includes(l);
              return (
                <button
                  key={l}
                  disabled={!editable}
                  onClick={() => toggleLever(i, l)}
                  className={cn(
                    "text-[10px] px-2 py-0.5 rounded-md border",
                    on ? LEVER_TONES[l] : "bg-white text-text-muted border-beroe-card-border",
                    !editable && "cursor-default",
                  )}
                >
                  {LEVER_LABELS[l]}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {editable && (
        <button
          onClick={() =>
            onChange([
              ...items,
              { initiative_name: "", levers: [] } as ApproachItem,
            ])
          }
          className="text-[11px] px-2.5 py-1 rounded-md border border-beroe-card-border hover:bg-beroe-bg/60"
        >
          + Add initiative
        </button>
      )}
    </div>
  );
}

// ----- Value delivered -----

function ValueDeliveredList({
  items,
  editable,
  onChange,
}: {
  items: ValueDeliveredItem[];
  editable: boolean;
  onChange: (v: ValueDeliveredItem[]) => void;
}) {
  const update = (i: number, patch: Partial<ValueDeliveredItem>) => {
    const next = [...items];
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const numField = (v: string): number | null => {
    if (!v.trim()) return null;
    const n = parseFloat(v);
    return Number.isNaN(n) ? null : n;
  };
  return (
    <div className="space-y-2">
      {items.length === 0 && (
        <div className="text-[12px] text-text-muted italic">
          No value-delivered rows yet.
        </div>
      )}
      {items.length > 0 && (
        <div className="grid grid-cols-12 gap-2 text-[10px] uppercase tracking-wider text-text-muted px-1">
          <div className="col-span-5">Initiative</div>
          <div className="col-span-2 text-right">$Ident</div>
          <div className="col-span-2 text-right">$Comm</div>
          <div className="col-span-2 text-right">$Impl</div>
          <div className="col-span-1" />
        </div>
      )}
      {items.map((v, i) => (
        <div key={i} className="grid grid-cols-12 gap-2 text-[12px] items-center">
          <input
            disabled={!editable}
            value={v.initiative_name ?? ""}
            onChange={(e) => update(i, { initiative_name: e.target.value })}
            placeholder="Initiative"
            className="col-span-5 border border-beroe-card-border rounded-md px-2 py-1 disabled:bg-beroe-bg/40"
          />
          <input
            disabled={!editable}
            value={v.identified_musd ?? ""}
            onChange={(e) => update(i, { identified_musd: numField(e.target.value) })}
            placeholder="0.0"
            className="col-span-2 border border-beroe-card-border rounded-md px-2 py-1 text-right disabled:bg-beroe-bg/40"
          />
          <input
            disabled={!editable}
            value={v.committed_musd ?? ""}
            onChange={(e) => update(i, { committed_musd: numField(e.target.value) })}
            placeholder="0.0"
            className="col-span-2 border border-beroe-card-border rounded-md px-2 py-1 text-right disabled:bg-beroe-bg/40"
          />
          <input
            disabled={!editable}
            value={v.implemented_musd ?? ""}
            onChange={(e) => update(i, { implemented_musd: numField(e.target.value) })}
            placeholder="0.0"
            className="col-span-2 border border-beroe-card-border rounded-md px-2 py-1 text-right disabled:bg-beroe-bg/40"
          />
          {editable && (
            <button
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="col-span-1 text-text-muted hover:text-red-700"
            >
              ✕
            </button>
          )}
        </div>
      ))}
      {editable && (
        <button
          onClick={() =>
            onChange([
              ...items,
              {
                initiative_name: "",
                identified_musd: null,
                committed_musd: null,
                implemented_musd: null,
              } as ValueDeliveredItem,
            ])
          }
          className="text-[11px] px-2.5 py-1 rounded-md border border-beroe-card-border hover:bg-beroe-bg/60"
        >
          + Add row
        </button>
      )}
    </div>
  );
}
