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

  // R24 — Draft with AI button: re-runs the auto-draft from M19/M20/M15
  // (Success Contract + Success Metrics + CS Goals) ignoring existing content.
  const redraftMutation = useMutation({
    mutationFn: () =>
      api.post<Vdd>(
        `/api/v1/accounts/${account.id}/value-delivery-document/redraft`,
      ),
    onSuccess: (drafted) => {
      qc.setQueryData(queryKey, drafted);
      setForm(drafted);
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
              <span className="text-[11px] px-2 py-1 rounded-md bg-beroe-green/15 text-beroe-green border border-beroe-green/30 font-semibold">
                🔒 Locked
              </span>
            ) : form.auto_drafted ? (
              <span className="text-[11px] px-2 py-1 rounded-md bg-beroe-amber/15 text-beroe-amber border border-beroe-amber/40">
                Pre-filled from Goals + Metrics
              </span>
            ) : (
              <span className="text-[11px] px-2 py-1 rounded-md bg-beroe-bg text-text-secondary border border-beroe-card-border">
                Draft
              </span>
            )}
            {/* R24 — Draft-with-AI + Download-PPT shortcuts. */}
            {form.is_editable && !locked && (
              <button
                onClick={() => {
                  if (
                    confirm(
                      "Re-draft this VDD from Success Contract + Metrics + Goals?\n\nUnsaved changes will be lost.",
                    )
                  ) {
                    redraftMutation.mutate();
                  }
                }}
                disabled={redraftMutation.isPending}
                className="text-[11px] px-2 py-1 rounded-md border border-beroe-blue text-beroe-blue font-semibold hover:bg-beroe-blue/5 disabled:opacity-50"
              >
                {redraftMutation.isPending ? "Drafting…" : "✨ Draft with AI"}
              </button>
            )}
            <button
              type="button"
              onClick={async () => {
                try {
                  const r = await api.get<{
                    html: string;
                    filename: string;
                    type: string;
                  }>(`/api/v1/accounts/${account.id}/reports/vdd`);
                  const blob = new Blob([r.html], { type: "text/html" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = r.filename;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                } catch (e) {
                  setErr(
                    e instanceof ApiError ? e.message : "VDD download failed",
                  );
                }
              }}
              className="text-[11px] px-2 py-1 rounded-md border border-beroe-card-border text-text-secondary hover:bg-beroe-bg"
              title="Download VDD as standalone HTML — PPT export lands in v1.1"
            >
              ⬇ Download VDD
            </button>
          </div>
        </div>
      </Card>

      {/* 28-May — standalone rollup card removed. Per prototype line
          3382-3392 the CSM-attribution rollup is injected INSIDE
          Section 4 ("Value delivered") above the per-initiative list,
          and only when at least one of the 3 totals is > 0. */}

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

      {/* R25 — Savings Lever Framework explanation. Shown above the per-initiative
          approach list so readers know what each lever means + the typical
          savings range before they pick lever pills. */}
      <Card>
        <SectionHeader
          title="Savings Lever Framework"
          hint="The 3 levers Beroe pulls to deliver value. Pick the applicable lever(s) per initiative below."
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <LeverFramework
            num={1}
            name="Cost"
            color="#6EC457"
            range="Typical 3–12% of category spend"
            description="Negotiation leverage, demand consolidation, e-auctions, supplier rationalisation, contract terms."
          />
          <LeverFramework
            num={2}
            name="Risk"
            color="#F0BC41"
            range="Avoided-cost basis · 1–5% of spend at risk"
            description="Supplier health monitoring, alternate-source qualification, geo-risk hedging, compliance exposure."
          />
          <LeverFramework
            num={3}
            name="Adoption"
            color="#4A00F8"
            range="Indirect · 5–15% productivity uplift on covered spend"
            description="Platform adoption, super-user enablement, intake compliance, self-serve insights."
          />
        </div>
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

      {/* Section 4 — Value delivered — CSM Attributed.
          Verbatim port of prototype line 3366-3400: the CSM Attribution
          rollup is injected ABOVE the per-initiative list, only when at
          least one of the 3 totals is > 0. */}
      <Card>
        <SectionHeader
          title="Value delivered — CSM attributed"
          hint="$Identified / $Committed / $Implemented per initiative"
        />
        <CsmAttributionRollup totals={totals} />
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

      {/* R26 — VDD audit trail. Reads from the account-wide activity feed
          and filters to value_delivery_document changes (the SQLAlchemy
          before_flush listener auto-captures every PATCH as one audit row). */}
      <VDDAuditTrail accountId={account.id} />

      {/* Sticky action bar */}
      {form.is_editable && (
        <div
          className={cn(
            "sticky bottom-3 z-10 flex items-center justify-between gap-3 px-3 py-2 rounded-lg border shadow-sm",
            dirty
              ? "bg-beroe-amber/15 border-beroe-amber/40"
              : "bg-white border-beroe-card-border",
          )}
        >
          <div className="text-[12px] text-text-secondary">
            {err ? (
              <span className="text-beroe-red">{err}</span>
            ) : locked ? (
              <span>Document is locked. Unlock to edit.</span>
            ) : dirty ? (
              <span className="font-medium text-beroe-amber">Unsaved changes</span>
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
                  className="text-[12px] px-3 py-1.5 rounded-md bg-beroe-green text-white font-semibold hover:bg-beroe-green disabled:opacity-50"
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
// R26 — VDD audit trail
// ============================================================

function VDDAuditTrail({ accountId }: { accountId: string }) {
  type ActivityItem = {
    id: string;
    field_name: string | null;
    action: string;
    changed_at: string;
    changed_by_full_name: string | null;
  };
  const { data } = useQuery<{ items: ActivityItem[] }>({
    queryKey: ["vdd-audit", accountId],
    queryFn: () =>
      api.get<{ items: ActivityItem[] }>(
        `/api/v1/accounts/${accountId}/activity?page=1&page_size=50`,
      ),
  });
  const vddItems = (data?.items ?? []).filter(
    (it) =>
      it.field_name === "value_delivery_document" ||
      it.field_name === "vdd_locked_at" ||
      it.field_name === "vdd_locked_by",
  );
  return (
    <Card>
      <SectionHeader
        title="Change history"
        hint="Every save, lock, and unlock recorded with who + when."
      />
      {vddItems.length === 0 ? (
        <div className="text-[12px] text-text-muted italic">
          No changes recorded yet.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {vddItems.slice(0, 20).map((it) => (
            <li
              key={it.id}
              className="text-[12px] text-text-secondary flex items-center gap-2 border-b border-beroe-card-border/60 pb-1.5 last:border-b-0 last:pb-0"
            >
              <span className="text-[10px] uppercase tracking-wider font-bold text-text-muted">
                {it.action}
              </span>
              <span className="font-semibold text-text-primary">
                {labelForVddField(it.field_name)}
              </span>
              <span className="ml-auto text-text-muted">
                {it.changed_by_full_name ?? "—"} ·{" "}
                {new Date(it.changed_at).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function labelForVddField(field: string | null): string {
  if (field === "value_delivery_document") return "VDD content saved";
  if (field === "vdd_locked_at") return "VDD locked";
  if (field === "vdd_locked_by") return "VDD locked-by changed";
  return field ?? "change";
}

/** Lever-framework tile — Lever 1 (Cost) / 2 (Risk) / 3 (Adoption).
 *  Brand palette only:
 *    Lever 1 → Risk Green #6EC457
 *    Lever 2 → Risk Amber #F0BC41
 *    Lever 3 → Indigo     #4A00F8
 *  Inline styles so we never drift back to Tailwind off-palette
 *  utilities (green-50 / blue-50 etc.) — see feedback memory. */
function LeverFramework({
  num,
  name,
  color,
  range,
  description,
}: {
  num: number;
  name: string;
  color: string;
  range: string;
  description: string;
}) {
  return (
    <div
      className="rounded-lg px-3 py-2.5"
      style={{
        background: `${color}10`,
        border: `1px solid ${color}40`,
      }}
    >
      <div
        className="text-[10px] uppercase font-bold"
        style={{ color, letterSpacing: "0.05em" }}
      >
        Lever {num}
      </div>
      <div className="text-[14px] font-bold mt-0.5" style={{ color }}>
        {name}
      </div>
      <div className="text-[11px] font-semibold mt-1" style={{ color }}>
        {range}
      </div>
      <div
        className="text-[11px] mt-1 leading-snug"
        style={{ color: "#001137" }}
      >
        {description}
      </div>
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

/** Section heading — Aqua `#35E1D4`, UPPERCASE, 0.05em letter-spacing.
 *  Verbatim port of prototype line 3397. Aqua is already on the Beroe
 *  brand palette (page 35) so no substitution needed. */
function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-3">
      <div
        className="text-[11px] font-bold uppercase"
        style={{ color: "#35E1D4", letterSpacing: "0.05em" }}
      >
        {title}
      </div>
      {hint && (
        <div className="text-[11px] text-text-muted mt-0.5">{hint}</div>
      )}
    </div>
  );
}

/** CSM Attribution Summary rollup — verbatim port of prototype line
 *  3382-3392. Green-tinted box with "CSM Attribution Summary" title in
 *  Risk Green, 3-column grid with per-value colours from the brand
 *  palette:
 *    Identified  → Risk Amber #F0BC41  (was prototype #EF9637)
 *    Committed   → Indigo     #4A00F8  (on brand)
 *    Implemented → Risk Green #6EC457  (was prototype #40CC8F)
 *  Only renders when at least one total is > 0 (prototype's
 *  `if(idSum>0)` gate). */
function CsmAttributionRollup({
  totals,
}: {
  totals: { identified: number; committed: number; implemented: number };
}) {
  const hasAny =
    totals.identified > 0 || totals.committed > 0 || totals.implemented > 0;
  if (!hasAny) return null;
  return (
    <div
      className="rounded-lg px-3.5 py-3 mb-3"
      style={{
        background: "#f0fdf4",
        border: "1.5px solid #6EC45740",
      }}
    >
      <div
        className="text-[10px] font-bold uppercase mb-2"
        style={{ color: "#6EC457", letterSpacing: "0.05em" }}
      >
        CSM Attribution Summary — from initiative stage tracking
      </div>
      <div className="grid grid-cols-3 gap-4">
        <RollupValue label="Identified" value={totals.identified} color="#F0BC41" />
        <RollupValue label="Committed" value={totals.committed} color="#4A00F8" />
        <RollupValue label="Implemented" value={totals.implemented} color="#6EC457" />
      </div>
    </div>
  );
}

function RollupValue({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="text-center">
      <div className="text-[18px] font-extrabold" style={{ color }}>
        {fmtMusd(value)}
      </div>
      <div className="text-[10px] text-text-muted mt-0.5">{label}</div>
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
              className="text-[11px] text-text-muted hover:text-beroe-red px-1.5"
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
              className="col-span-1 text-text-muted hover:text-beroe-red"
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
                className="text-text-muted hover:text-beroe-red px-1"
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
              className="col-span-1 text-text-muted hover:text-beroe-red"
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
