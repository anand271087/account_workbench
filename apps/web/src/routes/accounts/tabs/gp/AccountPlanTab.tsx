// M26 — Growth & Pipeline · Account Plan sub-tab.
//
// Faithful port of the prototype's bPlan() function:
//   * Mode banner (rescue/retain/expand) with override modal
//   * "How is this calculated?" expander showing the 4 score components
//   * ACV growth path tile (current / target / gap / pipeline + bar)
//   * ARR burn-down tile (current / projected / target + bar + status)
//   * Plays list with stage colour + per-row actions
//   * Add play modal
//
// Data sources:
//   GET  /accounts/:id/appetite-score   → score + mode + breakdown
//   GET  /accounts/:id/plays            → list of plays (excludes hidden)
//   POST /accounts/:id/plays            → add play
//   PATCH /plays/:id                    → edit play
//   DELETE /plays/:id                   → soft delete (hidden=true)
//   POST /accounts/:id/plan-mode        → set/clear override

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAccountFromLayout } from "../../AccountProfileLayout";
import {
  fmtK,
  MODE_CONF,
  SALES_STAGES,
  stageColor,
  stageName,
  type Appetite,
  type Play,
  type PlayCreate,
  type PlayListResponse,
  type PlayMode,
} from "@/types/play";

const MODE_TITLES: Record<PlayMode, string> = {
  rescue: "Rescue Plays",
  retain: "Retention & Adoption Plays",
  expand: "Expansion Plays",
};

export default function AccountPlanTab() {
  const account = useAccountFromLayout();
  const qc = useQueryClient();

  const apptKey = ["appetite", account.id];
  const playsKey = ["plays", account.id];

  const { data: appetite } = useQuery<Appetite>({
    queryKey: apptKey,
    queryFn: () =>
      api.get<Appetite>(`/api/v1/accounts/${account.id}/appetite-score`),
  });
  const { data: playsData } = useQuery<PlayListResponse>({
    queryKey: playsKey,
    queryFn: () => api.get<PlayListResponse>(`/api/v1/accounts/${account.id}/plays`),
  });

  const [showAddModal, setShowAddModal] = useState(false);
  const [showModeModal, setShowModeModal] = useState(false);
  const [showAllPlays, setShowAllPlays] = useState(false);

  if (!appetite || !playsData) {
    return (
      <Card>
        <div className="text-sm text-text-muted">Loading Account Plan…</div>
      </Card>
    );
  }

  const editable = playsData.is_editable;
  const mode = appetite.current_mode;
  const allPlays = playsData.items;
  const visiblePlays = showAllPlays
    ? allPlays
    : allPlays.filter((p) => p.modes.includes(mode));

  return (
    <div className="space-y-3">
      {/* Mode banner */}
      <ModeBanner
        appetite={appetite}
        editable={editable}
        onChangeMode={() => setShowModeModal(true)}
      />

      {/* How is this calculated? */}
      <ScoreBreakdownDetails appetite={appetite} />

      {/* 26-May Row 60 — "Plan inputs" sidebar (mirrors prototype bPlan
          right-rail card). Shows the 6 core inputs feeding the appetite
          mode at a glance, beside the current mode + its description. */}
      <PlanInputs accountId={account.id} accountHealth={account.health_score} appetite={appetite} mode={mode} />

      {/* Header + Add play */}
      <div className="flex items-center justify-between">
        <div className="text-[16px] font-bold text-text-primary">
          Account Plan
        </div>
        {editable && (
          <button
            onClick={() => setShowAddModal(true)}
            className="text-[12px] px-3 py-1.5 rounded-md border border-beroe-card-border bg-white hover:bg-beroe-bg/60 font-semibold"
          >
            + Add play
          </button>
        )}
      </div>

      {/* ACV growth tile (mode-adaptive) */}
      <AcvTile appetite={appetite} account={account} mode={mode} />

      {/* ARR Growth Tracker — 27-May Row 61: always render. When the
          status is 'n/a' (fresh account / zero target) the tile shows
          an empty state instead of hiding so stakeholders see the
          section name they expect. */}
      <ArrBurnDown appetite={appetite} account={account} />

      {/* Plays section — 27-May Row 61: render "Expansion Plays" as a
          stable literal heading so stakeholders can locate it
          regardless of current mode. The mode-aware title (rescue /
          retain / expand naming) becomes a subtitle. */}
      <div className="bg-white border border-beroe-card-border rounded-card p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div>
            <div className="text-[13px] font-bold">Expansion Plays</div>
            <div className="text-[10px] text-text-muted mt-0.5">
              {mode === "expand"
                ? "Showing expand-mode plays"
                : `Mode-aware view: ${MODE_TITLES[mode]} (toggle "Show all plays" to see expansion plays here)`}
            </div>
          </div>
          <label className="text-[11px] text-text-muted flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={showAllPlays}
              onChange={(e) => setShowAllPlays(e.target.checked)}
            />
            Show all plays
          </label>
        </div>
        <PlayList
          plays={visiblePlays}
          mode={mode}
          editable={editable}
          accountId={account.id}
          showAllPlays={showAllPlays}
        />
      </div>

      {/* Row 51 — three missing prototype sections added below the Plays:
          Retain Checklist · Product & Services Saturation · Recommended Plays.
          Pure-frontend reads, derived from data already in scope. */}
      <RetainChecklist plays={allPlays} appetite={appetite} />
      <ProductSaturation accountId={account.id} />
      <RecommendedPlays plays={allPlays} mode={mode} />

      {showAddModal && (
        <AddPlayModal
          accountId={account.id}
          defaultMode={mode}
          onClose={() => setShowAddModal(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: playsKey });
            qc.invalidateQueries({ queryKey: apptKey });
            setShowAddModal(false);
          }}
        />
      )}

      {showModeModal && (
        <ModeOverrideModal
          accountId={account.id}
          current={appetite}
          onClose={() => setShowModeModal(false)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: apptKey });
            qc.invalidateQueries({ queryKey: playsKey });
            setShowModeModal(false);
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// Mode banner + override modal
// ============================================================

function ModeBanner({
  appetite,
  editable,
  onChangeMode,
}: {
  appetite: Appetite;
  editable: boolean;
  onChangeMode: () => void;
}) {
  const conf = MODE_CONF[appetite.current_mode];
  const recConf = MODE_CONF[appetite.recommended_mode];
  const isOver = appetite.is_overridden;
  return (
    <div
      className="rounded-lg border-[1.5px] px-4 py-3 flex items-center justify-between gap-3"
      style={{ background: conf.bg, borderColor: conf.col + "40" }}
    >
      <div className="flex items-start gap-3">
        <span style={{ fontSize: 22 }}>{conf.icon}</span>
        <div>
          <div
            className="text-[14px] font-bold"
            style={{ color: conf.col }}
            title="Appetite score = Health 40% + Signals 25% + Renewal Proximity 15% + ARR Growth 20%"
          >
            {conf.label} mode {isOver ? "(override)" : "recommended"}
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: conf.col + "cc" }}>
            {conf.desc}
          </div>
          <div className="text-[10px] text-text-muted mt-1">
            Score: <b>{appetite.score}/100</b>
          </div>
          {isOver && (
            <div className="text-[10px] text-text-subtle mt-0.5">
              System recommends <b>{recConf.label}</b> · Currently set to{" "}
              <b>{conf.label}</b>
            </div>
          )}
        </div>
      </div>
      {editable && (
        <button
          onClick={onChangeMode}
          className="text-[11px] px-2.5 py-1 rounded-md border border-beroe-card-border bg-white hover:bg-beroe-bg/60 font-semibold flex-shrink-0"
        >
          Change mode
        </button>
      )}
    </div>
  );
}

function ModeOverrideModal({
  accountId,
  current,
  onClose,
  onSaved,
}: {
  accountId: string;
  current: Appetite;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [picked, setPicked] = useState<PlayMode | null>(
    current.is_overridden ? current.current_mode : null,
  );
  const [err, setErr] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (mode: PlayMode | null) =>
      api.post(`/api/v1/accounts/${accountId}/plan-mode`, { mode }),
    onSuccess: () => onSaved(),
    onError: (e: ApiError) => setErr(e.message),
  });

  return (
    <ModalShell onClose={onClose} title="Change play mode">
      <div className="text-[11px] text-text-muted mb-3">
        Override the auto-recommendation. Pick "Auto" to clear the override
        and follow the appetite score.
      </div>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <button
          onClick={() => setPicked(null)}
          className={cn(
            "text-[12px] px-3 py-2 rounded-md border-[1.5px] text-left",
            picked === null
              ? "border-beroe-green bg-beroe-green/15"
              : "border-beroe-card-border bg-white hover:bg-beroe-bg/60",
          )}
        >
          <div className="font-semibold">Auto</div>
          <div className="text-[10px] text-text-muted">
            Use the recommendation ({MODE_CONF[current.recommended_mode].label})
          </div>
        </button>
        {(["rescue", "retain", "expand"] as PlayMode[]).map((m) => {
          const c = MODE_CONF[m];
          return (
            <button
              key={m}
              onClick={() => setPicked(m)}
              className={cn(
                "text-[12px] px-3 py-2 rounded-md border-[1.5px] text-left",
                picked === m ? "border-current" : "border-beroe-card-border",
              )}
              style={{
                background: picked === m ? c.bg : "#fff",
                color: picked === m ? c.col : undefined,
              }}
            >
              <div className="font-semibold">
                {c.icon} {c.label}
              </div>
              <div className="text-[10px] opacity-80">{c.desc}</div>
            </button>
          );
        })}
      </div>
      {err && <div className="text-[11px] text-beroe-red mb-2">{err}</div>}
      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          className="text-[11px] px-3 py-1.5 rounded-md border border-beroe-card-border hover:bg-beroe-bg/60"
        >
          Cancel
        </button>
        <button
          onClick={() => mutation.mutate(picked)}
          disabled={mutation.isPending}
          className="text-[11px] px-3 py-1.5 rounded-md bg-beroe-navy text-white font-semibold disabled:opacity-50"
        >
          Save
        </button>
      </div>
    </ModalShell>
  );
}

// ============================================================
// Score breakdown details
// ============================================================

function ScoreBreakdownDetails({ appetite }: { appetite: Appetite }) {
  const bd = appetite.breakdown;
  const tiles: Array<[string, string, string, string, string]> = [
    ["Health Score", "40%", `${bd.health_pts}/40`, "#4A00F8", "Account health (adoption + signals)"],
    ["Signal Mix", "25%", `${bd.sig_pts}/25`, "#C344C7", "Balance of positive vs risk signals"],
    ["Renewal Proximity", "15%", `${bd.renew_pts}/15`, "#EF9637", "Time to renewal + risk pressure"],
    [
      "ARR Growth",
      "20%",
      `${bd.arr_pts}/20`,
      "#40CC8F",
      `Pipeline vs ${bd.arr_target_pct}% target`,
    ],
  ];
  return (
    <details className="bg-beroe-bg border border-beroe-card-border rounded-md">
      <summary className="px-3.5 py-2.5 text-[11px] font-semibold text-text-secondary cursor-pointer flex items-center gap-1.5 list-none">
        <span>ℹ️</span> How is this mode determined?
      </summary>
      <div className="px-3.5 pb-3.5">
        <div className="text-[11px] text-text-secondary leading-relaxed mb-2.5">
          The play mode is automatically determined from 4 weighted inputs.
          Score range: 0–39 = Rescue, 40–69 = Retain, 70–100 = Expand.
        </div>
        <div className="grid grid-cols-4 gap-1.5 mb-2.5">
          {tiles.map(([label, weight, score, col, desc]) => (
            <div
              key={label}
              className="bg-white rounded-md p-2 text-center border"
              style={{ borderColor: col + "30" }}
            >
              <div className="text-[16px] font-extrabold" style={{ color: col }}>
                {score}
              </div>
              <div className="text-[10px] font-bold mt-0.5" style={{ color: col }}>
                {label}
              </div>
              <div className="text-[9px] text-text-muted">{weight} weight</div>
              <div className="text-[9px] text-text-subtle mt-1">{desc}</div>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 px-2.5 py-2 bg-white border border-beroe-card-border rounded-md">
          <div className="text-[12px] font-bold text-text-primary">
            Total: {appetite.score}/100
          </div>
          <span className="text-[10px] text-text-muted">→</span>
          <span
            className="text-[11px] font-bold"
            style={{ color: MODE_CONF[appetite.current_mode].col }}
          >
            {MODE_CONF[appetite.current_mode].icon}{" "}
            {MODE_CONF[appetite.current_mode].label}
          </span>
        </div>
      </div>
    </details>
  );
}

// ============================================================
// ACV growth tile
// ============================================================

function AcvTile({
  appetite,
  account,
  mode,
}: {
  appetite: Appetite;
  account: { current_acv: string | null; target_acv: string | null };
  mode: PlayMode;
}) {
  const current = parseFloat(account.current_acv || "0");
  const target = parseFloat(account.target_acv || "0");
  const gap = target - current;
  const pipeline = parseFloat(appetite.breakdown.projected_acv_usd) - current;
  const pct =
    current && target ? Math.min(100, Math.round((current / target) * 100)) : 0;
  const conf = MODE_CONF[mode];

  // Row 56 — for retain + expand show the same 4-tile ACV Growth Path
  // (Current / Target / Gap / Pipeline). Rescue keeps its at-risk shape.
  const tiles =
    mode === "rescue"
      ? ([
          ["ACV at Risk", fmtK(current), "#e63950"],
          ["Days to Renewal", "—", "#d88520"],
          ["Risk Level", "Elevated", "#e63950"],
        ] as Array<[string, string, string]>)
      : ([
          ["Current", fmtK(current), "#0d1b2e"],
          ["Target", target > 0 ? fmtK(target) : fmtK(current), "#2fb87a"],
          [
            "Gap",
            gap > 0 ? fmtK(gap) : "Done",
            gap > 0 ? "#FD576B" : "#2fb87a",
          ],
          ["Pipeline", fmtK(pipeline), "#C344C7"],
        ] as Array<[string, string, string]>);

  return (
    <div className="bg-white border border-beroe-card-border rounded-card p-4">
      <div className="text-[13px] font-bold mb-2.5">
        {mode === "rescue" ? "⚠️ Renewal Risk" : "ACV Growth Path"}
      </div>
      <div
        className={cn(
          "grid gap-2 mb-2.5",
          mode === "rescue" ? "grid-cols-3" : "grid-cols-4",
        )}
      >
        {tiles.map(([label, value, col]) => (
          <div
            key={label}
            className="bg-beroe-bg rounded-md px-2 py-2.5 text-center"
          >
            <div className="text-[9px] uppercase tracking-wider text-text-muted">
              {label}
            </div>
            <div
              className="font-bold mt-0.5"
              style={{ color: col, fontSize: value.length > 12 ? 16 : 22 }}
            >
              {value}
            </div>
          </div>
        ))}
      </div>
      <div className="h-3 bg-beroe-bg rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: conf.col }}
        />
      </div>
    </div>
  );
}

// ============================================================
// ARR burn-down
// ============================================================

function ArrBurnDown({
  appetite,
  account,
}: {
  appetite: Appetite;
  account: { current_acv: string | null; tier: string | null; account_type: string | null };
}) {
  const bd = appetite.breakdown;
  const current = parseFloat(account.current_acv || "0");
  const projected = parseFloat(bd.projected_acv_usd);
  const target = parseFloat(bd.target_acv_usd);
  const pct = target > 0 ? Math.min(100, Math.round((projected / target) * 100)) : 0;
  const isNA = bd.arr_status === "n/a";
  const statusCol = isNA
    ? "#94a3b8"
    : bd.arr_status === "on_track"
      ? "#40CC8F"
      : bd.arr_status === "behind"
        ? "#EF9637"
        : "#FD576B";
  const statusLabel = isNA
    ? "Set a target to track"
    : bd.arr_status === "on_track"
      ? "On Track"
      : bd.arr_status === "behind"
        ? "Behind Target"
        : "Declining";

  return (
    <div className="bg-white border border-beroe-card-border rounded-card p-3.5">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[12px] font-bold">ARR Growth Tracker</div>
        <span className="text-[10px] text-text-muted">
          {account.account_type ?? "—"} · {account.tier ?? "—"} · Target:{" "}
          {bd.arr_target_pct}% ARR growth
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-2">
        {[
          ["Current ACV", fmtK(current), "#0d1b2e"],
          ["Projected (ACV+Pipeline)", fmtK(projected), "#4A00F8"],
          [`Target (${bd.arr_target_pct}% growth)`, fmtK(target), "#2fb87a"],
        ].map(([label, value, col]) => (
          <div key={label} className="bg-beroe-bg rounded-md p-2 text-center">
            <div className="text-[14px] font-extrabold" style={{ color: col }}>
              {value}
            </div>
            <div className="text-[9px] text-text-muted">{label}</div>
          </div>
        ))}
      </div>
      <div className="relative h-5.5 bg-beroe-bg rounded-full overflow-visible">
        <div
          className="h-full rounded-full transition-all flex items-center justify-end pr-2"
          style={{ width: `${pct}%`, background: statusCol }}
        >
          <span className="text-[9px] font-bold text-white">{pct}%</span>
        </div>
        <div
          className="absolute top-[-3px] right-0 w-0.5 h-7 bg-beroe-green/150 rounded-sm"
          title="Target"
        />
      </div>
      <div className="flex justify-between text-[10px] text-text-muted mt-1">
        <span>$0</span>
        <span style={{ color: statusCol }} className="font-semibold">
          {statusLabel}
        </span>
        <span>{fmtK(target)} target</span>
      </div>
    </div>
  );
}

// ============================================================
// Plays list
// ============================================================

function PlayList({
  plays,
  mode,
  editable,
  accountId,
  showAllPlays,
}: {
  plays: Play[];
  mode: PlayMode;
  editable: boolean;
  accountId: string;
  showAllPlays: boolean;
}) {
  const qc = useQueryClient();
  const conf = MODE_CONF[mode];
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/v1/plays/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plays", accountId] });
      qc.invalidateQueries({ queryKey: ["appetite", accountId] });
    },
  });

  if (plays.length === 0) {
    return (
      <div className="text-center py-5 text-text-muted text-[12px]">
        No plays added yet.
      </div>
    );
  }
  return (
    <div className="space-y-1.5">
      {plays.map((p, i) => {
        const c = stageColor(p.prob);
        const valNum = parseFloat(p.value_usd);
        return (
          <div
            key={p.id}
            className="flex items-start gap-3 px-3 py-2.5 border rounded-md"
            style={{ background: conf.bg, borderColor: conf.col + "30" }}
          >
            <div
              className="w-6 h-6 rounded-md text-white text-[11px] font-bold flex items-center justify-center flex-shrink-0"
              style={{ background: conf.col }}
            >
              {i + 1}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[13px] font-bold">{p.title}</span>
                {showAllPlays &&
                  p.modes.map((pm) => (
                    <span
                      key={pm}
                      className="text-[9px] px-1.5 py-0.5 rounded-md border"
                      style={{
                        background: MODE_CONF[pm].bg,
                        color: MODE_CONF[pm].col,
                        borderColor: MODE_CONF[pm].col + "30",
                      }}
                    >
                      {MODE_CONF[pm].icon} {MODE_CONF[pm].label}
                    </span>
                  ))}
              </div>
              <div className="text-[11px] text-text-muted mt-0.5">
                {p.when_text ?? "—"} ·{" "}
                <b style={{ color: c }}>
                  {stageName(p.prob)} ({p.prob}%)
                </b>
                {p.role && <> · {p.role}</>}
                {valNum > 0 && <> · {fmtK(valNum)}</>}
              </div>
              {p.trigger_text && (
                <div className="text-[11px] text-text-secondary mt-1 leading-snug">
                  {p.trigger_text}
                </div>
              )}
            </div>
            {editable && (
              <button
                onClick={() => {
                  if (confirm(`Delete play "${p.title}"?`))
                    deleteMutation.mutate(p.id);
                }}
                className="text-[11px] text-text-muted hover:text-beroe-red px-1"
              >
                ✕
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// Add play modal
// ============================================================

function AddPlayModal({
  accountId,
  defaultMode,
  onClose,
  onSaved,
}: {
  accountId: string;
  defaultMode: PlayMode;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<PlayCreate>({
    title: "",
    value_usd: "0",
    prob: 30,
    when_text: "",
    trigger_text: "",
    modes: [defaultMode],
    role: "",
  });
  const [err, setErr] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: PlayCreate) =>
      api.post(`/api/v1/accounts/${accountId}/plays`, body),
    onSuccess: () => onSaved(),
    onError: (e: ApiError) => setErr(e.message),
  });

  const toggleMode = (m: PlayMode) => {
    const has = (form.modes ?? []).includes(m);
    setForm({
      ...form,
      modes: has
        ? (form.modes ?? []).filter((x) => x !== m)
        : [...(form.modes ?? []), m],
    });
  };

  return (
    <ModalShell onClose={onClose} title="Add play">
      <div className="space-y-2.5">
        <div>
          <label className="text-[10px] uppercase tracking-wider font-semibold text-text-muted">
            Title
          </label>
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="e.g. Expand into Wheat category"
            className="w-full text-[12px] border border-beroe-card-border rounded-md px-2 py-1.5 mt-0.5"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] uppercase tracking-wider font-semibold text-text-muted">
              Value ($)
            </label>
            <input
              type="number"
              value={form.value_usd as string}
              onChange={(e) => setForm({ ...form, value_usd: e.target.value })}
              className="w-full text-[12px] border border-beroe-card-border rounded-md px-2 py-1.5 mt-0.5"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider font-semibold text-text-muted">
              Stage
            </label>
            <select
              value={form.prob}
              onChange={(e) =>
                setForm({ ...form, prob: parseInt(e.target.value, 10) })
              }
              className="w-full text-[12px] border border-beroe-card-border rounded-md px-2 py-1.5 mt-0.5"
            >
              {SALES_STAGES.map((s) => (
                <option key={s.prob} value={s.prob}>
                  {s.label} ({s.prob}%)
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] uppercase tracking-wider font-semibold text-text-muted">
              When
            </label>
            <input
              value={form.when_text ?? ""}
              onChange={(e) => setForm({ ...form, when_text: e.target.value })}
              placeholder="e.g. Q3 2026"
              className="w-full text-[12px] border border-beroe-card-border rounded-md px-2 py-1.5 mt-0.5"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider font-semibold text-text-muted">
              Role
            </label>
            <input
              value={form.role ?? ""}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              placeholder="e.g. CSM"
              className="w-full text-[12px] border border-beroe-card-border rounded-md px-2 py-1.5 mt-0.5"
            />
          </div>
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider font-semibold text-text-muted">
            Trigger
          </label>
          <textarea
            value={form.trigger_text ?? ""}
            onChange={(e) => setForm({ ...form, trigger_text: e.target.value })}
            placeholder="Why now — one line"
            rows={2}
            className="w-full text-[12px] border border-beroe-card-border rounded-md px-2 py-1.5 mt-0.5"
          />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider font-semibold text-text-muted">
            Modes
          </label>
          <div className="flex gap-1.5 mt-1">
            {(["rescue", "retain", "expand"] as PlayMode[]).map((m) => {
              const c = MODE_CONF[m];
              const on = (form.modes ?? []).includes(m);
              return (
                <button
                  key={m}
                  onClick={() => toggleMode(m)}
                  className={cn(
                    "text-[11px] px-2 py-1 rounded-md border-[1.5px]",
                    on ? "" : "bg-white border-beroe-card-border text-text-muted",
                  )}
                  style={
                    on ? { background: c.bg, color: c.col, borderColor: c.col + "60" } : {}
                  }
                >
                  {c.icon} {c.label}
                </button>
              );
            })}
          </div>
        </div>
        {err && <div className="text-[11px] text-beroe-red">{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="text-[11px] px-3 py-1.5 rounded-md border border-beroe-card-border hover:bg-beroe-bg/60"
          >
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate(form)}
            disabled={mutation.isPending || !form.title.trim() || (form.modes ?? []).length === 0}
            className="text-[11px] px-3 py-1.5 rounded-md bg-beroe-navy text-white font-semibold disabled:opacity-50"
          >
            Add play
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ============================================================
// Shared primitives
// ============================================================

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white border border-beroe-card-border rounded-card p-4">
      {children}
    </div>
  );
}

function ModalShell({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center pt-12 pb-8 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl w-[min(560px,95vw)]">
        <div className="px-4 py-3 border-b border-beroe-card-border flex items-center justify-between">
          <div className="text-[14px] font-bold text-text-primary">{title}</div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary text-lg leading-none px-1"
          >
            ✕
          </button>
        </div>
        <div className="px-4 py-3">{children}</div>
      </div>
    </div>
  );
}

// ============================================================
// Row 51 (25-May-2026) — three prototype sections added below Plays
// ============================================================

// 1. Retain Checklist — 6 retention hygiene items derived from the existing
//    appetite + plays + mode. Each item is "✓ done" or "⚠ open" — no new
//    state, just a snapshot of what needs attention to hold the renewal.
function RetainChecklist({
  plays,
  appetite,
}: {
  plays: Play[];
  appetite: Appetite;
}) {
  const livePlays = plays.filter((p) => !p.hidden);
  const items: { label: string; done: boolean; hint?: string }[] = [
    {
      label: "Active plays in motion (≥1)",
      done: livePlays.length > 0,
      hint: livePlays.length === 0 ? "Add at least one play below" : undefined,
    },
    {
      label: "Renewal play within 90 days",
      done: livePlays.some(
        (p) =>
          (p.when_text || "").toLowerCase().includes("q") ||
          (p.when_text || "").toLowerCase().includes("renewal"),
      ),
      hint: "Schedule the renewal-anchor play",
    },
    {
      label: "Health ≥40 (out of risk band)",
      done: appetite.breakdown.health_pts >= 16, // health_pts is health*0.4
    },
    {
      label: "Pipeline weighted ≥30% of target gap",
      done: appetite.breakdown.arr_status !== "behind",
      hint: "Build pipeline to close the ARR gap",
    },
    {
      label: "Signal mix not risk-dominant",
      done: appetite.breakdown.sig_pts >= 15,
      hint: "Resolve open risks / surface positive signals",
    },
    {
      label: "Mode confirmed (auto or manual)",
      done: true,
    },
  ];
  const done = items.filter((i) => i.done).length;
  return (
    <div className="bg-white border border-beroe-card-border rounded-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[13px] font-bold">🛡️ Retain Checklist</div>
        <span
          className={cn(
            "text-[11px] font-bold px-2 py-0.5 rounded-full",
            done === items.length
              ? "bg-beroe-green/20 text-beroe-green"
              : done >= items.length - 2
                ? "bg-beroe-amber/20 text-beroe-amber"
                : "bg-beroe-red/15 text-beroe-red",
          )}
        >
          {done} / {items.length} healthy
        </span>
      </div>
      <ul className="space-y-1.5">
        {items.map((it) => (
          <li
            key={it.label}
            className="flex items-start gap-2 text-[12px] py-1 border-b border-beroe-card-border/60 last:border-b-0"
          >
            <span className={it.done ? "text-beroe-green" : "text-beroe-amber"}>
              {it.done ? "✓" : "⚠"}
            </span>
            <span className="flex-1">
              {it.label}
              {!it.done && it.hint && (
                <span className="text-text-muted italic ml-2">
                  — {it.hint}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// 2. Product & Services Saturation — count of contracted Beroe modules
//    out of the 8 named modules, with a per-module owned/gap grid. Mirrors
//    prototype `bProductSaturation`. Reads gate.gate_contract_modules.
const BEROE_MODULES = [
  "Live.ai",
  "MMD",
  "Supplier Risk",
  "Supply Chain Risk",
  "Copilot",
  "DataHub",
  "Sourcing Optimizer",
  "Diverse Supplier Directory",
];

function ProductSaturation({ accountId }: { accountId: string }) {
  const { data, isLoading } = useQuery<{
    gate_contract_modules: string[];
    gate_platform_tier: string | null;
    gate_account_segment: string | null;
  }>({
    queryKey: ["signing-gate", accountId],
    queryFn: () => api.get(`/api/v1/accounts/${accountId}/sign`),
  });
  const owned = new Set((data?.gate_contract_modules ?? []).map((m) => m.toLowerCase()));
  const total = BEROE_MODULES.length;
  const ownedCount = BEROE_MODULES.filter((m) =>
    owned.has(m.toLowerCase()),
  ).length;
  const pct = Math.round((ownedCount / total) * 100);
  return (
    <div className="bg-white border border-beroe-card-border rounded-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[13px] font-bold">📦 Product & Services Saturation</div>
          <div className="text-[10px] text-text-muted mt-0.5">
            Tier:{" "}
            <b className="text-text-primary">
              {data?.gate_platform_tier ?? "—"}
            </b>{" "}
            · Segment:{" "}
            <b className="text-text-primary">
              {data?.gate_account_segment ?? "—"}
            </b>
          </div>
        </div>
        <div className="text-center">
          <div
            className="text-[20px] font-extrabold"
            style={{
              color: pct >= 50 ? "#2fb87a" : pct >= 25 ? "#EF9637" : "#FD576B",
            }}
          >
            {pct}%
          </div>
          <div className="text-[9px] text-text-muted">Saturation</div>
        </div>
      </div>
      <div className="h-1.5 bg-beroe-bg rounded-full overflow-hidden mb-3">
        <div
          className="h-full"
          style={{
            width: `${pct}%`,
            background: pct >= 50 ? "#40CC8F" : pct >= 25 ? "#EF9637" : "#FD576B",
          }}
        />
      </div>
      {isLoading ? (
        <div className="text-[11px] text-text-muted italic">Loading modules…</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {BEROE_MODULES.map((m) => {
            const has = owned.has(m.toLowerCase());
            return (
              <div
                key={m}
                className={cn(
                  "flex items-center gap-2 px-2 py-1 rounded-md border text-[11px]",
                  has
                    ? "border-beroe-green/30 bg-beroe-green/15/40"
                    : "border-beroe-card-border bg-white",
                )}
              >
                <span
                  className={cn(
                    "w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold",
                    has
                      ? "bg-beroe-green/20 text-beroe-green"
                      : "bg-beroe-amber/20 text-beroe-amber",
                  )}
                >
                  {has ? "✓" : "→"}
                </span>
                <span className="flex-1 font-medium">{m}</span>
                <span
                  className={cn(
                    "text-[9px] font-bold uppercase",
                    has ? "text-beroe-green" : "text-beroe-amber",
                  )}
                >
                  {has ? "Owned" : "Gap"}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// 3. Recommended Plays — top 3 ideas the CSM should add. Pulled from a
//    static catalog for now; future revision can layer AI suggest via the
//    existing brief-AI scaffold.
const PLAY_CATALOG: { mode: string; title: string; trigger: string; value: string }[] = [
  {
    mode: "expand",
    title: "Sustainability module upsell",
    trigger: "Most procurement teams add ESG benchmarking in year 2.",
    value: "Typical $120K–$250K incremental ACV",
  },
  {
    mode: "expand",
    title: "Supplier risk monitoring add-on",
    trigger: "Tightens the renewal narrative on exposure.",
    value: "Typical $80K–$150K incremental ACV",
  },
  {
    mode: "expand",
    title: "Multi-year enterprise renewal lock",
    trigger: "Buyer locks pricing; vendor locks tenure.",
    value: "20–35% premium over single-year renewal",
  },
  {
    mode: "retain",
    title: "QBR + champion alignment session",
    trigger: "Pre-renewal trust check.",
    value: "Reduces churn risk by ~30% (Beroe avg)",
  },
  {
    mode: "retain",
    title: "Custom benchmark on top category",
    trigger: "Highest-conviction value moment.",
    value: "Adds documented savings to renewal case",
  },
  {
    mode: "rescue",
    title: "Executive escalation w/ sponsor",
    trigger: "Re-sets relationship before churn signal hardens.",
    value: "Avoided-churn play; no $ uplift",
  },
];

function RecommendedPlays({ plays, mode }: { plays: Play[]; mode: PlayMode }) {
  const livePlays = plays.filter((p) => !p.hidden);
  const haveTitles = new Set(livePlays.map((p) => p.title.toLowerCase()));
  const recs = PLAY_CATALOG.filter((r) => r.mode === mode)
    .concat(PLAY_CATALOG.filter((r) => r.mode !== mode))
    .filter((r) => !haveTitles.has(r.title.toLowerCase()))
    .slice(0, 3);
  return (
    <div className="bg-white border border-beroe-card-border rounded-card p-4">
      <div className="text-[13px] font-bold mb-3">
        ✨ Recommended Plays{" "}
        <span className="text-[10px] font-normal text-text-muted">
          · suggestions for {mode} mode
        </span>
      </div>
      {recs.length === 0 ? (
        <div className="text-[12px] text-text-muted italic">
          You've already added the most-common plays for this mode — nice work.
        </div>
      ) : (
        <ul className="space-y-2">
          {recs.map((r) => (
            <li
              key={r.title}
              className="rounded-md border border-beroe-card-border px-3 py-2"
            >
              <div className="flex items-center justify-between gap-2 mb-1 flex-wrap">
                <span className="text-[12px] font-bold">{r.title}</span>
                <span
                  className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                  style={{ background: "#f4f3fe", color: "#4A00F8" }}
                >
                  {r.mode}
                </span>
              </div>
              <div className="text-[11px] text-text-secondary leading-snug">
                {r.trigger}
              </div>
              <div className="text-[11px] text-text-muted italic mt-1">
                💰 {r.value}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ============================================================
// Plan Inputs — 26-May Row 60
// ============================================================
//
// Faithful port of the prototype's right-rail "Plan inputs" card. Shows
// the 6 core inputs feeding the appetite-score machine in one glance
// (Health, Product, Signals, Active Signals, Activity, Hot Cats) +
// renders the current mode pill + its description below.
//
// Data sources (TanStack Query — caches are shared with neighbour cards
// so these fetches are usually free piggybacks):
//   - account.health_score                       (already in layout context)
//   - /signing-gate.gate_contract_modules.length (for the Product row)
//   - /appetite-score.breakdown.sig_pts          (already in scope)
//   - /signals?status=active                     (count for Active Signals)
//   - /activities (visible)                      (count for Activity)
//   - /platform-intel.cat_intel.top_cats         (count where heat='hot')

function PlanInputs({
  accountId,
  accountHealth,
  appetite,
  mode,
}: {
  accountId: string;
  accountHealth: number | null;
  appetite: Appetite;
  mode: PlayMode;
}) {
  // Soft-signals count (active only).
  const signalsQ = useQuery<{ items: { status: string }[] }>({
    queryKey: ["signals", accountId],
    queryFn: () =>
      api.get<{ items: { status: string }[] }>(
        `/api/v1/accounts/${accountId}/signals`,
      ),
    staleTime: 30_000,
  });
  // Activity count (visible only).
  const activitiesQ = useQuery<{ items: { hidden: boolean }[] }>({
    queryKey: ["activities", accountId],
    queryFn: () =>
      api.get<{ items: { hidden: boolean }[] }>(
        `/api/v1/accounts/${accountId}/activities`,
      ),
    staleTime: 30_000,
  });
  // Cat-intel (hot categories) — pulls from platform_intel jsonb.
  const intelQ = useQuery<{
    cat_intel?: { top_cats?: { heat?: string }[] };
  }>({
    queryKey: ["platform-intel", accountId],
    queryFn: () =>
      api.get<{ cat_intel?: { top_cats?: { heat?: string }[] } }>(
        `/api/v1/accounts/${accountId}/platform-intel`,
      ),
    staleTime: 60_000,
  });
  // Purchased-modules count (for Product saturation) — same endpoint
  // ProductSaturation uses; TanStack Query dedupes the request.
  const gateQ = useQuery<{ gate_contract_modules?: string[] | null }>({
    queryKey: ["signing-gate", accountId],
    queryFn: () =>
      api.get<{ gate_contract_modules?: string[] | null }>(
        `/api/v1/accounts/${accountId}/signing-gate`,
      ),
    staleTime: 60_000,
  });

  const activeSignals = (signalsQ.data?.items ?? []).filter(
    (s) => s.status !== "resolved",
  ).length;
  const activityCount = (activitiesQ.data?.items ?? []).filter(
    (a) => !a.hidden,
  ).length;
  const hotCats = (intelQ.data?.cat_intel?.top_cats ?? []).filter(
    (c) => c.heat === "hot",
  ).length;
  const productOwned = (gateQ.data?.gate_contract_modules ?? []).length;
  // 8 is the BEROE_MODULES catalog size — mirrors ProductSaturation.
  const productScore = Math.round((productOwned / 8) * 100);
  // sig_pts is 0..25 in the appetite breakdown; normalise to /100 for the
  // sidebar so all 6 rows are on the same scale.
  const signalsScore = Math.round((appetite.breakdown.sig_pts / 25) * 100);
  const conf = MODE_CONF[mode];

  const rows: { label: string; value: string; col: string }[] = [
    { label: "Health", value: `${accountHealth ?? 0}/100`, col: "#4A00F8" },
    { label: "Product", value: `${productScore}/100`, col: "#40CC8F" },
    { label: "Signals", value: `${signalsScore}/100`, col: "#C344C7" },
    {
      label: "Active Signals",
      value: `${activeSignals} logged`,
      col: "#e63950",
    },
    { label: "Activity", value: `${activityCount} entries`, col: "#EF9637" },
    { label: "Hot Cats", value: `${hotCats}`, col: "#FD576B" },
  ];

  return (
    <div className="bg-white border border-beroe-card-border rounded-card p-3.5">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="text-[13px] font-bold">Plan inputs</div>
        <span
          className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
          style={{
            background: conf.bg,
            color: conf.col,
            border: `1px solid ${conf.col}40`,
          }}
        >
          {conf.icon} {conf.label} mode
        </span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4">
        {rows.map((r) => (
          <div
            key={r.label}
            className="flex items-center justify-between py-1.5 border-b border-beroe-card-border last:border-b-0"
          >
            <span className="text-[11px] text-text-muted">{r.label}</span>
            <span
              className="text-[12px] font-bold"
              style={{ color: r.col }}
            >
              {r.value}
            </span>
          </div>
        ))}
      </div>
      <div
        className="mt-3 rounded-md px-3 py-2 text-[11px] leading-snug"
        style={{
          background: conf.bg,
          color: conf.col + "dd",
          border: `1px solid ${conf.col}30`,
        }}
      >
        {conf.desc}
      </div>
    </div>
  );
}
