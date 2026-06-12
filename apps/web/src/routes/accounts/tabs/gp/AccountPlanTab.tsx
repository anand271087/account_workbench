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
import { useConfirm, useNotify } from "@/components/DialogProvider";
import { MoneyInput } from "@/components/MoneyInput";
import { useNavigate } from "react-router-dom";
import { useProductRoster } from "@/components/ProductRoster";
import type { CSGoal, Initiative } from "@/types/cs_goal";
import { useAccountFromLayout } from "../../AccountProfileLayout";
import {
  fmtK,
  MODE_CONF,
  SALES_STAGES,
  stageColor,
  stageName,
  type Appetite,
  type AiPlaySuggestion,
  type GrowthContext,
  type PeerBenchmark,
  type PeerPlaySuggestion,
  type Play,
  type PlayCreate,
  type PlayListResponse,
  type PlayMode,
  type TopPeerModule,
} from "@/types/play";

// 12-Jun · MODE_TITLES kept for the (mode-aware) AI / Peer tab heuristics.
// Active tab no longer reads it after the initiative refactor.
// @ts-expect-error — temporarily unused
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

  // 10-Jun · Growth & Pipeline prototype v3 — peer benchmark + AI / peer
  // play suggestions. Single endpoint; degrades to nulls on empty cohort.
  const { data: growthCtx } = useQuery<GrowthContext>({
    queryKey: ["growth-context", account.id],
    queryFn: () =>
      api.get<GrowthContext>(`/api/v1/accounts/${account.id}/growth-context`),
  });

  // 12-Jun · `showAddModal` removed — Add play moved into the Active
  // tab inside PlayTabsSection (it now opens AddInitiativeFromPlaysModal).
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
      {/* Mode banner — full-width top per prototype screenshot
          (29-May bug 29-46). */}
      <ModeBanner
        appetite={appetite}
        editable={editable}
        onChangeMode={() => setShowModeModal(true)}
      />

      {/* How is this calculated? — full-width directly under mode
          banner so the explanation is immediately accessible. */}
      <ScoreBreakdownDetails appetite={appetite} />

      {/* 29-May bugs 29-44/29-46/29-48 — Two-column body. LEFT carries
          the main Account Plan content (ACV / ARR / Expansion Plays /
          Saturation / Recommended Plays). RIGHT carries the sidebar
          (Plan inputs · Mode description · Mode-aware Checklist) —
          sticky so it stays visible while the main column scrolls. */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-3 items-start">
        {/* LEFT — main content */}
        <div className="space-y-3 min-w-0">
          {/* Header — Add play moved to bottom-right of Active tab list
              (12-Jun stakeholder ask). Plays are now initiatives under
              the success-metric goals; the button lives next to the
              list it adds to. */}
          <div className="flex items-center">
            <div className="text-[16px] font-bold text-text-primary">
              Account Plan
            </div>
          </div>

          {/* ACV Growth Path — 4-tile Current / Target / Gap / Pipeline.
              Mode-adaptive: rescue mode swaps to a Renewal-Risk shape.
              All values pulled from account.current_acv / target_acv +
              appetite.breakdown.projected_acv_usd. */}
          <AcvTile appetite={appetite} account={account} mode={mode} />

          {/* 12-Jun · Earlier separate <ProductRoster> card retired —
              <ProductSaturation> below now reads the same account_products
              roster AND renders it in the prototype's amber-gradient
              Saturation layout, so a separate card was duplicate. */}

          {/* 09-Jun bug (Bug Tracker · Jun-8 #6 part 1) — Product &
              Services Saturation moved ABOVE Expansion Plays (per spec
              feedback: "Product & Services Saturation should come before
              Expansion Plays and after ARR Growth Tracker"). */}
          {/* 10-Jun · Growth & Pipeline v3 prototype — Saturation now
              includes the peer-benchmark sub-panel (you / industry
              median / revenue bucket / top-quartile) + top-peer-modules
              grid. Driven by /growth-context. */}
          <ProductSaturation
            accountId={account.id}
            peerBenchmark={growthCtx?.peer_benchmark}
            topPeerModules={growthCtx?.top_peer_modules ?? []}
          />

          {/* 10-Jun · Growth & Pipeline v3 — Expansion Plays now lives in
              a 3-tab strip (Active · AI recommended · From peer CSMs)
              matching the prototype layout. */}
          <PlayTabsSection
            mode={mode}
            editable={editable}
            accountId={account.id}
            plays={visiblePlays}
            allPlays={allPlays}
            showAllPlays={showAllPlays}
            onToggleShowAll={(v) => setShowAllPlays(v)}
            aiPlays={growthCtx?.ai_plays ?? []}
            peerPlays={growthCtx?.peer_plays ?? []}
          />
        </div>

        {/* RIGHT — sticky sidebar */}
        <aside className="space-y-3 lg:sticky lg:top-2">
          {/* 26-May Row 60 — Plan inputs at the top of the sidebar
              (29-May bug 29-44). */}
          <PlanInputs
            accountId={account.id}
            accountHealth={account.health_score}
            appetite={appetite}
            mode={mode}
          />

          {/* 10-Jun · Prototype-faithful checklist. One shared
              ModeChecklist with filter tabs (All/Pending/Done), AI
              accept/dismiss, CSM custom items + add-input + legend.
              State persists in localStorage per-account-per-mode. */}
          <ModeChecklist
            mode={mode}
            plays={allPlays}
            appetite={appetite}
            accountId={account.id}
          />
        </aside>
      </div>

      {/* 12-Jun · AddPlayModal removed at this layer — Active tab now
          opens its own AddInitiativeFromPlaysModal (goal picker → init
          form). AI / Peer tabs still use the play creation flow inside
          their list components. */}

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
  // 28-May bug 28-33 — reason required (≥10 chars) when picking non-Auto.
  const [reason, setReason] = useState<string>(
    current.override_reason ?? "",
  );
  const [err, setErr] = useState<string | null>(null);
  const reasonTooShort =
    picked !== null && reason.trim().length < 10;

  const mutation = useMutation({
    mutationFn: ({
      mode,
      reason: r,
    }: {
      mode: PlayMode | null;
      reason: string | null;
    }) => api.post(`/api/v1/accounts/${accountId}/plan-mode`, { mode, reason: r }),
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
      {/* 28-May bug 28-33 — reason required when overriding to a
          non-Auto mode. Skipped/cleared when picking Auto. */}
      {picked !== null && (
        <div className="mb-3">
          <label className="block text-[10px] uppercase tracking-wider font-semibold text-text-secondary mb-1">
            Reason for override <span className="text-beroe-red">*</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={600}
            placeholder="Why is the system recommendation wrong for this account right now? (min 10 chars)"
            className="w-full text-[12px] border border-beroe-card-border rounded-md px-2.5 py-1.5 focus:outline-none focus:border-beroe-blue"
          />
          <div
            className={cn(
              "text-[10px] mt-0.5",
              reasonTooShort ? "text-beroe-red" : "text-text-muted",
            )}
          >
            {reason.trim().length}/600 · min 10 chars
          </div>
        </div>
      )}

      {/* 28-May bug 28-33 — Mode History: last 20 entries (newest first). */}
      {current.history && current.history.length > 0 && (
        <details className="mb-3 border border-beroe-card-border rounded-md">
          <summary className="px-2.5 py-1.5 text-[11px] font-semibold text-text-secondary cursor-pointer list-none flex items-center gap-1.5">
            <span>📜</span>
            Mode History ({current.history.length})
          </summary>
          <ul className="px-2.5 pb-2 max-h-40 overflow-y-auto space-y-1">
            {current.history.map((h, i) => (
              <li
                key={i}
                className="text-[11px] text-text-secondary flex flex-wrap items-baseline gap-1.5 border-b border-beroe-card-border/60 pb-1 last:border-b-0"
              >
                <span className="font-semibold text-text-primary">
                  {h.from ? MODE_CONF[h.from].label : "Auto"} →{" "}
                  {h.to ? MODE_CONF[h.to].label : "Auto"}
                </span>
                <span className="text-text-muted">
                  · {h.by_name ?? "—"}
                </span>
                <span className="text-text-muted">
                  · {new Date(h.at).toLocaleString()}
                </span>
                {h.reason && (
                  <div className="basis-full text-[10px] text-text-muted italic mt-0.5">
                    "{h.reason}"
                  </div>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {err && <div className="text-[11px] text-beroe-red mb-2">{err}</div>}
      <div className="flex justify-end gap-2">
        <button
          onClick={onClose}
          className="text-[11px] px-3 py-1.5 rounded-md border border-beroe-card-border hover:bg-beroe-bg/60"
        >
          Cancel
        </button>
        <button
          onClick={() =>
            mutation.mutate({
              mode: picked,
              reason: picked === null ? null : reason.trim(),
            })
          }
          disabled={mutation.isPending || reasonTooShort}
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
    ["Renewal Proximity", "15%", `${bd.renew_pts}/15`, "#F0BC41", "Time to renewal + risk pressure"],
    [
      "ARR Growth",
      "20%",
      `${bd.arr_pts}/20`,
      "#6EC457",
      `Pipeline vs ${bd.arr_target_pct}% target`,
    ],
  ];
  // 29-May bug 29-43 — "How is this mode determined" panel repainted
  // from neutral grey to a brand-Indigo tint so the breakdown reads as
  // a primary explanation, not a secondary note.
  return (
    <details className="bg-beroe-blue/5 border border-beroe-blue/30 rounded-md">
      <summary className="px-3.5 py-2.5 text-[11px] font-semibold text-beroe-blue cursor-pointer flex items-center gap-1.5 list-none">
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

// ============================================================
// ACV Growth Path tile
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
          ["ACV at Risk", fmtK(current), "#CF4548"],
          ["Days to Renewal", "—", "#F0BC41"],
          ["Risk Level", "Elevated", "#CF4548"],
        ] as Array<[string, string, string]>)
      : ([
          ["Current", fmtK(current), "#0d1b2e"],
          ["Target", target > 0 ? fmtK(target) : fmtK(current), "#6EC457"],
          [
            "Gap",
            gap > 0 ? fmtK(gap) : "Done",
            gap > 0 ? "#CF4548" : "#6EC457",
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
// Plays list
// ============================================================

// 12-Jun · PlayList is dead code after the Active tab moved to initiatives.
// Retained here for the AI / Peer tabs (PlayCard layout still reusable) but
// no current call site exists.
// @ts-expect-error — temporarily unused
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
  const confirm = useConfirm();
  const notify = useNotify();
  const conf = MODE_CONF[mode];
  // 29-May bug 29-45 — Edit modal target + per-row "expanded" view.
  const [editingPlay, setEditingPlay] = useState<Play | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
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
        const weighted = valNum * (p.prob / 100);
        const isExpanded = expandedId === p.id;
        return (
          <div
            key={p.id}
            className="flex items-start gap-3 px-3 py-2.5 border rounded-md"
            style={{ background: conf.bg, borderColor: conf.col + "30" }}
          >
            {/* 29-May bug 29-45 — teal/aqua numbered badge per
                prototype (regardless of mode tint). */}
            <div
              className="w-7 h-7 rounded-md text-white text-[12px] font-bold flex items-center justify-center flex-shrink-0 bg-beroe-teal"
            >
              {i + 1}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[13px] font-bold underline decoration-1 underline-offset-2">
                  {p.title}
                </span>
                {(showAllPlays ? p.modes : p.modes).map((pm) => (
                  <span
                    key={pm}
                    className="text-[9px] px-1.5 py-0.5 rounded-full border font-semibold"
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
              </div>
              {p.trigger_text && (
                <div
                  className={cn(
                    "text-[11px] text-text-secondary mt-1 leading-snug",
                    !isExpanded && "line-clamp-2",
                  )}
                >
                  {p.trigger_text}
                </div>
              )}
              {/* 29-May bug 29-45 — 3-button action row (View / Email
                  Pitch / Tag Metric). View toggles the description
                  clamp; Email Pitch opens a mailto with the play
                  context; Tag Metric is a v1.1 placeholder (would
                  link the play to a Success Metric server-side). */}
              <div className="flex items-center gap-1.5 mt-2">
                <button
                  type="button"
                  onClick={() =>
                    setExpandedId(isExpanded ? null : p.id)
                  }
                  className="text-[10px] px-2 py-0.5 rounded-md border border-beroe-card-border bg-white hover:bg-beroe-bg/60 font-semibold"
                >
                  {isExpanded ? "Hide" : "View"}
                </button>
                <a
                  href={`mailto:?subject=${encodeURIComponent(
                    `Play: ${p.title}`,
                  )}&body=${encodeURIComponent(
                    [
                      `Play: ${p.title}`,
                      `When: ${p.when_text ?? "—"}`,
                      `Stage: ${stageName(p.prob)} (${p.prob}%)`,
                      `Value: ${fmtK(valNum)} · Weighted ${fmtK(weighted)}`,
                      p.trigger_text ? `\nTrigger: ${p.trigger_text}` : "",
                    ].join("\n"),
                  )}`}
                  className="text-[10px] px-2 py-0.5 rounded-md border border-beroe-blue/30 bg-beroe-blue/5 text-beroe-blue hover:bg-beroe-blue/10 font-semibold"
                >
                  ✉ Email Pitch
                </a>
                <button
                  type="button"
                  onClick={() =>
                    notify({
                      title: "Tag Metric — ships in v1.1",
                      body: "Links this play to a Success Metric for ARR-attribution.",
                      tone: "info",
                    })
                  }
                  className="text-[10px] px-2 py-0.5 rounded-md border border-beroe-red/30 bg-beroe-red/5 text-beroe-red hover:bg-beroe-red/10 font-semibold"
                >
                  🎯 Tag Metric
                </button>
              </div>
            </div>
            {/* 29-May bug 29-45 — right column: large value + weighted
                line + per-row action icons (Edit ✎ / Delete ✕). */}
            <div className="flex items-stretch gap-2 flex-shrink-0 self-start">
              <div className="text-right">
                <div
                  className="text-[14px] font-extrabold"
                  style={{ color: "#1d6b35" }}
                >
                  {fmtK(valNum)}
                </div>
                <div className="text-[10px] text-text-muted">
                  {fmtK(weighted)} wtd
                </div>
              </div>
              {editable && (
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => setEditingPlay(p)}
                    className="text-[11px] w-6 h-6 rounded-md border border-beroe-purple/30 text-beroe-purple bg-beroe-purple/5 hover:bg-beroe-purple/15 flex items-center justify-center"
                    title="Edit play"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Delete play "${p.title}"?`,
                        body: "This removes the play from the account plan permanently.",
                        confirmLabel: "Delete",
                        danger: true,
                      });
                      if (ok) deleteMutation.mutate(p.id);
                    }}
                    className="text-[11px] w-6 h-6 rounded-md border border-beroe-red/30 text-beroe-red bg-beroe-red/5 hover:bg-beroe-red/15 flex items-center justify-center"
                    title="Delete play"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* 29-May bug 29-45 — Edit modal. Reuses AddPlayModal shape but
          PATCHes /plays/:id with the existing values pre-filled. */}
      {editingPlay && (
        <EditPlayModal
          play={editingPlay}
          onClose={() => setEditingPlay(null)}
          onSaved={() => {
            setEditingPlay(null);
            qc.invalidateQueries({ queryKey: ["plays", accountId] });
            qc.invalidateQueries({ queryKey: ["appetite", accountId] });
          }}
        />
      )}
    </div>
  );
}

// 29-May bug 29-45 — small label/input wrapper used inside EditPlayModal.
function ModalField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider font-semibold text-text-muted">
        {label}
      </label>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

// 29-May bug 29-45 — EditPlayModal mirrors AddPlayModal but PATCHes.
function EditPlayModal({
  play,
  onClose,
  onSaved,
}: {
  play: Play;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<PlayCreate>({
    title: play.title,
    value_usd: play.value_usd,
    prob: play.prob,
    when_text: play.when_text ?? "",
    trigger_text: play.trigger_text ?? "",
    modes: play.modes,
    role: play.role ?? "",
  });
  const [err, setErr] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: (body: PlayCreate) => api.patch(`/api/v1/plays/${play.id}`, body),
    onSuccess: () => onSaved(),
    onError: (e: ApiError) => setErr(e.message),
  });
  const toggleMode = (mode: PlayMode) => {
    const has = (form.modes ?? []).includes(mode);
    setForm({
      ...form,
      modes: has
        ? (form.modes ?? []).filter((x) => x !== mode)
        : [...(form.modes ?? []), mode],
    });
  };
  return (
    <ModalShell onClose={onClose} title="Edit play">
      <div className="space-y-2.5">
        <ModalField label="Title">
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="w-full text-[12px] border border-beroe-card-border rounded-md px-2 py-1.5"
          />
        </ModalField>
        <div className="grid grid-cols-2 gap-2">
          <ModalField label="When">
            <input
              value={form.when_text ?? ""}
              onChange={(e) => setForm({ ...form, when_text: e.target.value })}
              className="w-full text-[12px] border border-beroe-card-border rounded-md px-2 py-1.5"
            />
          </ModalField>
          <ModalField label="Stage / probability">
            <select
              value={form.prob}
              onChange={(e) => setForm({ ...form, prob: parseInt(e.target.value, 10) })}
              className="w-full text-[12px] border border-beroe-card-border rounded-md px-2 py-1.5"
            >
              {SALES_STAGES.map((s) => (
                <option key={s.prob} value={s.prob}>
                  {s.label} ({s.prob}%)
                </option>
              ))}
            </select>
          </ModalField>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <ModalField label="Value (USD)">
            {/* 10-Jun · Live US-comma formatting; raw value flows to backend. */}
            <MoneyInput
              value={form.value_usd as string | number | null}
              onChange={(v) => setForm({ ...form, value_usd: v ?? "" })}
              className="w-full text-[12px] border border-beroe-card-border rounded-md px-2 py-1.5"
              placeholder="$ 0"
            />
          </ModalField>
          <ModalField label="Owner / role">
            <input
              value={form.role ?? ""}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              className="w-full text-[12px] border border-beroe-card-border rounded-md px-2 py-1.5"
            />
          </ModalField>
        </div>
        <ModalField label="Modes (≥1)">
          <div className="flex gap-1.5 flex-wrap">
            {(["rescue", "retain", "expand"] as PlayMode[]).map((mm) => {
              const c = MODE_CONF[mm];
              const on = (form.modes ?? []).includes(mm);
              return (
                <button
                  key={mm}
                  type="button"
                  onClick={() => toggleMode(mm)}
                  className="text-[11px] px-2 py-1 rounded-md border-[1.5px]"
                  style={
                    on
                      ? { background: c.bg, color: c.col, borderColor: c.col + "60" }
                      : { background: "#fff", borderColor: "#e4eaf6", color: "#94a3b8" }
                  }
                >
                  {c.icon} {c.label}
                </button>
              );
            })}
          </div>
        </ModalField>
        <ModalField label="Trigger / context">
          <textarea
            rows={3}
            value={form.trigger_text ?? ""}
            onChange={(e) => setForm({ ...form, trigger_text: e.target.value })}
            className="w-full text-[12px] border border-beroe-card-border rounded-md px-2 py-1.5"
          />
        </ModalField>
        {err && <div className="text-[11px] text-beroe-red">{err}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            className="text-[11px] px-3 py-1.5 rounded-md border border-beroe-card-border hover:bg-beroe-bg/60"
          >
            Cancel
          </button>
          <button
            onClick={() => m.mutate(form)}
            disabled={m.isPending || !form.title.trim() || (form.modes ?? []).length === 0}
            className="text-[11px] px-3 py-1.5 rounded-md bg-beroe-navy text-white font-semibold disabled:opacity-50"
          >
            {m.isPending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

// ============================================================
// Add play modal
// ============================================================

// 12-Jun · AddPlayModal kept for AI / Peer accept flows. No active caller
// at the moment (Active tab uses AddInitiativeFromPlaysModal); leave for
// when those tabs are reconciled.
// @ts-expect-error — temporarily unused
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
            {/* 10-Jun · Live US-comma formatting via MoneyInput. */}
            <MoneyInput
              value={form.value_usd as string | number | null}
              onChange={(v) => setForm({ ...form, value_usd: v ?? "" })}
              className="w-full text-[12px] border border-beroe-card-border rounded-md px-2 py-1.5 mt-0.5"
              placeholder="$ 0"
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
// Mode Checklist — 10-Jun · Prototype-faithful rewrite
// ============================================================
//
// One shared component (replaces ExpandChecklist / RetainChecklist /
// RescueChecklist) that matches `beroe_growth_pipeline_proto_revised.html`:
//   * Filter tabs: All / Pending / Done (with counts)
//   * SYS items (engine-derived from appetite + plays + mode)
//   * AI items with ✓ accept / ✕ dismiss actions
//   * CSM custom items with delete + add-input at the bottom
//   * Source legend (SYS · AI · CSM)
//
// All state — checked SYS items + accepted/dismissed AI ids + CSM custom
// items — persists in `localStorage` per-account-per-mode. No backend.
//
// Beroe palette: SYS = Indigo tint · AI = Fuscia tint · CSM = Aqua tint
// (verbatim from the prototype CSS root vars).

type ChkSource = "sys" | "ai" | "csm";
type ChkStatus = "pending" | "warn" | "done";

interface SysSpec {
  id: string;
  label: string;
  status: ChkStatus;
  hint?: string;
}

interface AiSpec {
  id: string;
  label: string;
  hint?: string;
}

interface CsmEntry {
  id: string;
  text: string;
  createdAt: string;
  status: "pending" | "done";
}

interface ChkRow {
  id: string;
  source: ChkSource;
  label: string;
  hint?: string;
  status: ChkStatus;
  acceptedFromAi?: boolean;
}

const MODE_CHK_CONF: Record<
  PlayMode,
  { title: string; tail: string; ai: AiSpec[] }
> = {
  expand: {
    title: "🚀 Expand Checklist",
    tail: "ready",
    ai: [
      {
        id: "ai-touchpoint-week",
        label: "Log first touchpoint this week",
        hint: "No touchpoints in last 30d — even a status email lifts the score",
      },
      {
        id: "ai-peer-shareback",
        label: "Schedule peer-benchmark share-back with sponsor",
        hint: "Top peer CSMs open with the saturation gap — drives Sustainability play close in 65d avg",
      },
    ],
  },
  retain: {
    title: "🛡️ Retain Checklist",
    tail: "healthy",
    ai: [
      {
        id: "ai-qbr-renewal",
        label: "Run a QBR before the renewal window",
        hint: "Pre-renewal trust check — peers see ~30% churn drop after QBR",
      },
      {
        id: "ai-value-recap",
        label: "Document value delivered for renewal narrative",
        hint: "Pull from Success Management → Value Delivery Document",
      },
    ],
  },
  rescue: {
    title: "🚑 Rescue Checklist",
    tail: "stable",
    ai: [
      {
        id: "ai-exec-escalation",
        label: "Schedule executive escalation with sponsor",
        hint: "Re-sets relationship before churn signal hardens",
      },
      {
        id: "ai-root-cause",
        label: "Document root-cause + 2-week recovery plan",
        hint: "Surface in next leadership review",
      },
    ],
  },
};

const CHK_TAG_TONE: Record<ChkSource, string> = {
  // 10-Jun · Beroe palette — Indigo / Fuscia / Aqua tints matching the
  // prototype CSS root vars (#3800CC / #8a1a90 / #0f7770).
  sys: "bg-beroe-blue/10 text-beroe-blue",
  ai: "bg-beroe-purple/10 text-beroe-purple",
  csm: "bg-beroe-aqua/10 text-beroe-teal",
};

function _sysItems(mode: PlayMode, plays: Play[], appetite: Appetite): SysSpec[] {
  const livePlays = plays.filter((p) => !p.hidden);
  if (mode === "expand") {
    const xp = livePlays.filter((p) => p.modes.includes("expand"));
    return [
      {
        id: "sys-x-1",
        label: "≥1 expand play in motion",
        status: xp.length > 0 ? "done" : "warn",
        hint: xp.length === 0 ? "Add at least one expand-tagged play" : undefined,
      },
      {
        id: "sys-x-2",
        label: "≥1 high-probability expand play (≥60%)",
        status: xp.some((p) => p.prob >= 60) ? "done" : "warn",
        hint: "Bring an expand play above 60% confidence",
      },
      {
        id: "sys-x-3",
        label: "Pipeline meets ARR-growth target",
        status: appetite.breakdown.arr_status === "on_track" ? "done" : "warn",
        hint: "Pipeline below target — add value to expand plays",
      },
      {
        id: "sys-x-4",
        label: "Health ≥70 (expand-ready band)",
        status: appetite.breakdown.health_pts >= 28 ? "done" : "warn",
        hint: "Stabilise health before pushing expand",
      },
      {
        id: "sys-x-5",
        label: "Signal mix tilted positive / neutral",
        status: appetite.breakdown.sig_pts >= 15 ? "done" : "warn",
        hint: "Resolve open risks before pushing expand",
      },
      { id: "sys-x-6", label: "Mode confirmed (auto or manual)", status: "done" },
    ];
  }
  if (mode === "rescue") {
    const rp = livePlays.filter((p) => p.modes.includes("rescue"));
    return [
      {
        id: "sys-r-1",
        label: "≥1 rescue play in motion",
        status: rp.length > 0 ? "done" : "warn",
        hint: rp.length === 0 ? "Add at least one rescue-tagged play" : undefined,
      },
      {
        id: "sys-r-2",
        label: "Executive sponsor engaged",
        status: rp.some(
          (p) =>
            (p.title || "").toLowerCase().includes("exec") ||
            (p.trigger_text || "").toLowerCase().includes("sponsor"),
        )
          ? "done"
          : "warn",
        hint: "Schedule an exec-sponsor touchpoint",
      },
      {
        id: "sys-r-3",
        label: "Open critical / risk signals being worked",
        status:
          appetite.breakdown.sig_pts > 0 && appetite.breakdown.sig_pts < 15
            ? "done"
            : "warn",
        hint: "Resolve open risks (signal mix is risk-heavy)",
      },
      {
        id: "sys-r-4",
        label: "Health-recovery plan documented",
        status:
          appetite.breakdown.health_pts < 16 && rp.length > 0 ? "done" : "warn",
        hint: "Document the health-recovery plan as a play below",
      },
      {
        id: "sys-r-5",
        label: "Stabilise ARR — pause expansion asks",
        status: appetite.breakdown.arr_status !== "declining" ? "done" : "warn",
        hint: "ARR is declining — pull back any expand commitments",
      },
      { id: "sys-r-6", label: "Mode confirmed (auto or manual)", status: "done" },
    ];
  }
  // retain (default)
  return [
    {
      id: "sys-t-1",
      label: "Active plays in motion (≥1)",
      status: livePlays.length > 0 ? "done" : "warn",
      hint: livePlays.length === 0 ? "Add at least one play below" : undefined,
    },
    {
      id: "sys-t-2",
      label: "Renewal play within 90 days",
      status: livePlays.some(
        (p) =>
          (p.when_text || "").toLowerCase().includes("q") ||
          (p.when_text || "").toLowerCase().includes("renewal"),
      )
        ? "done"
        : "warn",
      hint: "Schedule the renewal-anchor play",
    },
    {
      id: "sys-t-3",
      label: "Health ≥40 (out of risk band)",
      status: appetite.breakdown.health_pts >= 16 ? "done" : "warn",
    },
    {
      id: "sys-t-4",
      label: "Pipeline weighted ≥30% of target gap",
      status: appetite.breakdown.arr_status !== "behind" ? "done" : "warn",
      hint: "Build pipeline to close the ARR gap",
    },
    {
      id: "sys-t-5",
      label: "Signal mix not risk-dominant",
      status: appetite.breakdown.sig_pts >= 15 ? "done" : "warn",
      hint: "Resolve open risks / surface positive signals",
    },
    { id: "sys-t-6", label: "Mode confirmed (auto or manual)", status: "done" },
  ];
}

function _lsKey(accountId: string, mode: PlayMode, slot: string): string {
  return `awb:checklist:${accountId}:${mode}:${slot}`;
}

function _readLs<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function _writeLs(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* localStorage quota / private mode — silently skip */
  }
}

function ModeChecklist({
  mode,
  plays,
  appetite,
  accountId,
}: {
  mode: PlayMode;
  plays: Play[];
  appetite: Appetite;
  accountId: string;
}) {
  const cfg = MODE_CHK_CONF[mode];
  const [filter, setFilter] = useState<"all" | "pending" | "done">("all");
  const [draft, setDraft] = useState("");

  // ── Persistent state ───────────────────────────────────────────
  // sysOverrides: SYS items the user manually checked (overrides
  //   engine `warn` → `done`); shape Record<sys-id, boolean>
  // dismissedAi: AI ids the user dismissed (✕)
  // acceptedAi:  AI ids the user accepted (moved to CSM list)
  // csm:         CsmEntry[] — custom items the user typed
  const sysKey = _lsKey(accountId, mode, "sys-checked");
  const dismissedKey = _lsKey(accountId, mode, "ai-dismissed");
  const acceptedKey = _lsKey(accountId, mode, "ai-accepted");
  const csmKey = _lsKey(accountId, mode, "csm");

  const [sysChecked, setSysChecked] = useState<Record<string, boolean>>(() =>
    _readLs<Record<string, boolean>>(sysKey, {}),
  );
  const [dismissedAi, setDismissedAi] = useState<string[]>(() =>
    _readLs<string[]>(dismissedKey, []),
  );
  const [acceptedAi, setAcceptedAi] = useState<string[]>(() =>
    _readLs<string[]>(acceptedKey, []),
  );
  const [csmItems, setCsmItems] = useState<CsmEntry[]>(() =>
    _readLs<CsmEntry[]>(csmKey, []),
  );

  // ── Compose final rows ────────────────────────────────────────
  const sysRows: ChkRow[] = _sysItems(mode, plays, appetite).map((s) => ({
    id: s.id,
    source: "sys",
    label: s.label,
    hint: s.hint,
    status: sysChecked[s.id] ? "done" : s.status,
  }));

  const aiRows: ChkRow[] = cfg.ai
    .filter((a) => !dismissedAi.includes(a.id) && !acceptedAi.includes(a.id))
    .map((a) => ({
      id: a.id,
      source: "ai",
      label: a.label,
      hint: a.hint,
      status: "pending",
    }));

  const csmRows: ChkRow[] = csmItems.map((c) => ({
    id: c.id,
    source: "csm",
    label: c.text,
    hint: `Added ${c.createdAt}`,
    status: c.status === "done" ? "done" : "pending",
    acceptedFromAi: c.id.startsWith("ai-"),
  }));

  const rows: ChkRow[] = [...sysRows, ...aiRows, ...csmRows];
  const all = rows.length;
  const done = rows.filter((r) => r.status === "done").length;
  const pending = all - done;
  const visible = rows.filter((r) =>
    filter === "all"
      ? true
      : filter === "done"
        ? r.status === "done"
        : r.status !== "done",
  );

  // ── Actions ───────────────────────────────────────────────────
  const toggleRow = (row: ChkRow) => {
    if (row.source === "sys") {
      const next = { ...sysChecked, [row.id]: row.status !== "done" };
      setSysChecked(next);
      _writeLs(sysKey, next);
    } else if (row.source === "csm") {
      const next = csmItems.map((c) =>
        c.id === row.id
          ? { ...c, status: c.status === "done" ? ("pending" as const) : ("done" as const) }
          : c,
      );
      setCsmItems(next);
      _writeLs(csmKey, next);
    }
    // AI items aren't toggleable — accept (→ CSM) or dismiss.
  };

  const acceptAi = (row: ChkRow) => {
    const acc = [...acceptedAi, row.id];
    setAcceptedAi(acc);
    _writeLs(acceptedKey, acc);
    const csm = [
      ...csmItems,
      {
        id: row.id,
        text: row.label,
        createdAt: new Date().toISOString().slice(0, 10),
        status: "pending" as const,
      },
    ];
    setCsmItems(csm);
    _writeLs(csmKey, csm);
  };

  const dismissAi = (row: ChkRow) => {
    const next = [...dismissedAi, row.id];
    setDismissedAi(next);
    _writeLs(dismissedKey, next);
  };

  const deleteCsm = (row: ChkRow) => {
    const next = csmItems.filter((c) => c.id !== row.id);
    setCsmItems(next);
    _writeLs(csmKey, next);
  };

  const addCustom = () => {
    const text = draft.trim();
    if (!text) return;
    const entry: CsmEntry = {
      id: `csm-${Date.now()}`,
      text,
      createdAt: new Date().toISOString().slice(0, 10),
      status: "pending",
    };
    const next = [...csmItems, entry];
    setCsmItems(next);
    _writeLs(csmKey, next);
    setDraft("");
  };

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="bg-white border border-beroe-card-border rounded-card p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="text-[13px] font-bold">{cfg.title}</div>
        <span className="text-[10px] font-bold text-text-muted bg-beroe-bg px-2 py-0.5 rounded">
          {done} / {all} {cfg.tail}
        </span>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-2.5 bg-beroe-bg rounded-md p-0.5">
        {([
          ["all", "All", all],
          ["pending", "Pending", pending],
          ["done", "Done", done],
        ] as const).map(([id, label, count]) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={cn(
              "flex-1 px-2 py-1.5 rounded text-[10.5px] font-bold transition-colors",
              filter === id
                ? "bg-white text-beroe-blue shadow-sm"
                : "text-text-muted hover:text-text-primary",
            )}
          >
            {label}
            <span
              className={cn(
                "ml-1 px-1.5 py-px rounded-full text-[9px] font-extrabold",
                filter === id
                  ? "bg-beroe-blue/10 text-beroe-blue"
                  : "bg-beroe-bg text-text-muted",
              )}
            >
              {count}
            </span>
          </button>
        ))}
      </div>

      {/* Item list */}
      <div className="space-y-1.5">
        {visible.length === 0 ? (
          <div className="text-[11px] text-text-muted italic py-4 text-center">
            Nothing here.
          </div>
        ) : (
          visible.map((row) => (
            <ChecklistRow
              key={row.id}
              row={row}
              onToggle={() => toggleRow(row)}
              onAccept={() => acceptAi(row)}
              onDismiss={() => dismissAi(row)}
              onDelete={() => deleteCsm(row)}
            />
          ))
        )}
      </div>

      {/* AI banner */}
      {aiRows.length > 0 && (
        <div
          className="mt-2 rounded-md p-2 flex gap-2 items-start text-[10.5px] leading-snug"
          style={{
            background: "linear-gradient(135deg, #fdf5ff, #fafbff)",
            border: "1px dashed #c9b5ff",
          }}
        >
          <span style={{ color: "#C344C7" }}>✨</span>
          <span>
            <b style={{ color: "#8a1a90" }}>AI suggested items</b> above are
            based on the gap pattern in your account state. Accept to add to
            your list, dismiss to ignore.
          </span>
        </div>
      )}

      {/* Add-your-own input */}
      <div className="flex gap-1.5 mt-2.5 items-stretch">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addCustom();
          }}
          placeholder="+ Add your own checklist item…"
          className="flex-1 min-w-0 px-2 py-1.5 text-[11px] rounded-md border border-dashed border-beroe-card-border bg-white focus:border-beroe-blue focus:border-solid outline-none"
        />
        <button
          type="button"
          onClick={addCustom}
          className="shrink-0 text-[11px] font-bold rounded-md px-3 py-1.5 bg-beroe-blue text-white hover:opacity-90"
        >
          Add
        </button>
      </div>

      {/* Legend */}
      <div className="text-[9.5px] text-text-muted mt-2.5 leading-relaxed">
        <b>Legend:</b>{" "}
        <span className={cn("font-bold px-1.5 py-px rounded uppercase tracking-wide", CHK_TAG_TONE.sys)}>
          SYS
        </span>{" "}
        engine ·{" "}
        <span className={cn("font-bold px-1.5 py-px rounded uppercase tracking-wide", CHK_TAG_TONE.ai)}>
          AI
        </span>{" "}
        ·{" "}
        <span className={cn("font-bold px-1.5 py-px rounded uppercase tracking-wide", CHK_TAG_TONE.csm)}>
          CSM
        </span>{" "}
        custom
      </div>
    </div>
  );
}

function ChecklistRow({
  row,
  onToggle,
  onAccept,
  onDismiss,
  onDelete,
}: {
  row: ChkRow;
  onToggle: () => void;
  onAccept: () => void;
  onDismiss: () => void;
  onDelete: () => void;
}) {
  const tag =
    row.source === "sys" ? "SYS" : row.source === "ai" ? "✨ AI" : "CSM";

  // Background tint + left-border by status / source
  const rowStyle: React.CSSProperties = {};
  let leftBorder: string | undefined;
  if (row.status === "done") {
    rowStyle.background = "#f0fdf4";
    rowStyle.borderColor = "#a8e5c4";
  } else if (row.status === "warn") {
    rowStyle.background = "#fff8eb";
    rowStyle.borderColor = "#fde2a0";
  } else if (row.source === "ai") {
    rowStyle.background = "linear-gradient(180deg, #fdf5ff, #fff)";
    rowStyle.borderColor = "#e9c0ec";
    leftBorder = "#C344C7";
  } else if (row.source === "csm") {
    leftBorder = "#4A00F8";
  }

  return (
    <div
      className="group flex gap-2 px-2.5 py-2 rounded-md border bg-white relative transition-colors"
      style={{
        ...rowStyle,
        ...(leftBorder ? { borderLeftWidth: "3px", borderLeftColor: leftBorder } : {}),
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "w-[18px] h-[18px] rounded border-2 shrink-0 mt-0.5 flex items-center justify-center text-[11px] font-bold transition-colors",
          row.status === "done"
            ? "bg-beroe-green border-beroe-green text-white"
            : row.status === "warn"
              ? "border-beroe-amber text-beroe-amber bg-white"
              : "border-beroe-card-border text-transparent bg-white hover:border-beroe-blue",
        )}
        title="Toggle"
      >
        {row.status === "done" ? "✓" : row.status === "warn" ? "!" : ""}
      </button>

      <div className="flex-1 min-w-0">
        <div
          className={cn(
            "text-[11.5px] font-semibold leading-snug",
            row.status === "done" ? "line-through text-text-muted" : "text-text-primary",
          )}
        >
          {row.label}
        </div>
        {row.hint && (
          <div
            className={cn(
              "text-[10px] mt-0.5 leading-snug text-text-muted",
              row.status === "done" ? "opacity-60" : "",
            )}
          >
            {row.hint}
          </div>
        )}
        <div className="flex gap-1 mt-1 flex-wrap">
          <span
            className={cn(
              "text-[8.5px] font-extrabold uppercase tracking-wide px-1.5 py-px rounded",
              CHK_TAG_TONE[row.source],
            )}
          >
            {tag}
          </span>
          {row.acceptedFromAi && (
            <span
              className={cn(
                "text-[8.5px] font-extrabold uppercase tracking-wide px-1.5 py-px rounded",
                CHK_TAG_TONE.ai,
              )}
            >
              from AI
            </span>
          )}
        </div>
      </div>

      {/* Action menu */}
      <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {row.source === "ai" && row.status !== "done" && (
          <>
            <button
              type="button"
              onClick={onAccept}
              className="w-[22px] h-[22px] rounded text-beroe-green border border-beroe-green/40 bg-white hover:bg-beroe-green hover:text-white text-[11px] flex items-center justify-center"
              title="Accept"
            >
              ✓
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="w-[22px] h-[22px] rounded text-text-muted border border-beroe-card-border bg-white hover:text-beroe-red hover:border-beroe-red text-[11px] flex items-center justify-center"
              title="Dismiss"
            >
              ✕
            </button>
          </>
        )}
        {row.source === "csm" && (
          <button
            type="button"
            onClick={onDelete}
            className="w-[22px] h-[22px] rounded text-text-muted border border-beroe-card-border bg-white hover:text-beroe-red hover:border-beroe-red text-[11px] flex items-center justify-center"
            title="Delete"
          >
            🗑
          </button>
        )}
      </div>
    </div>
  );
}

// 2. Product & Services Saturation — count of OWNED Beroe products out
//    of the canonical 28-product roster (account_products table). Visual
//    layout faithfully ports beroe_growth_pipeline_proto_revised.html
//    § "Product & Services Saturation". The legacy BEROE_MODULES list
//    (8 module names tied to gate_contract_modules) was retired 12-Jun.

function ProductSaturation({
  accountId,
  peerBenchmark,
  topPeerModules,
}: {
  accountId: string;
  peerBenchmark?: PeerBenchmark;
  topPeerModules: TopPeerModule[];
}) {
  // 12-Jun · Data source switched from the legacy gate_contract_modules
  // (which only carried a handful of contract-line names) to the canonical
  // account_products roster (28 Beroe products, populated by the bulk
  // import or manual edit). Visual layout faithfully ports
  // beroe_growth_pipeline_proto_revised.html § "Product & Services
  // Saturation" — amber→red progress gradient, green Owned rows,
  // dashed-grey Gap rows.
  const gateQ = useQuery<{
    gate_platform_tier: string | null;
    gate_account_segment: string | null;
  }>({
    queryKey: ["signing-gate", accountId],
    queryFn: () => api.get(`/api/v1/accounts/${accountId}/sign`),
  });
  const { data: roster, isLoading } = useProductRoster(accountId);

  const items = roster?.items ?? [];
  const ownedCount = items.filter((r) => r.purchased === true).length;
  const total = items.length || 28;
  const pct = total > 0 ? Math.round((ownedCount / total) * 100) : 0;

  // Sort owned first so the green block reads top-down.
  const sorted = [...items].sort((a, b) => {
    const av = a.purchased === true ? 0 : 1;
    const bv = b.purchased === true ? 0 : 1;
    return av - bv;
  });

  return (
    <div className="bg-white border border-beroe-card-border rounded-card p-4">
      {/* section-h */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-baseline gap-2">
          <div className="text-[14px] font-extrabold text-[#0d1b2e]">
            🎯 Product &amp; Services Saturation
          </div>
        </div>
        <div className="text-[10.5px] text-[#5a7896]">
          Tier:{" "}
          <b className="text-[#0d1b2e]">
            {gateQ.data?.gate_platform_tier ?? "—"}
          </b>{" "}
          · Segment:{" "}
          <b className="text-[#0d1b2e]">
            {gateQ.data?.gate_account_segment ?? "—"}
          </b>
        </div>
      </div>

      {/* progress bar row — prototype § Saturation */}
      <div className="flex items-center gap-3 mb-2.5">
        <div className="flex-1">
          <div
            style={{
              height: 10,
              background: "#e8eef8",
              borderRadius: 5,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${pct}%`,
                background:
                  "linear-gradient(90deg, #EF9637 0%, #FD576B 100%)",
                transition: "width 0.4s ease",
              }}
            />
          </div>
        </div>
        <div
          style={{
            fontSize: 18,
            fontWeight: 800,
            color: "#EF9637",
          }}
        >
          {pct}%
        </div>
        <div style={{ fontSize: 10.5, color: "#8496b0" }}>
          {ownedCount} of {total} products
        </div>
      </div>

      {/* 2-col sat-row grid */}
      {isLoading ? (
        <div className="text-[11px] text-text-muted italic">Loading roster…</div>
      ) : items.length === 0 ? (
        <div
          className="text-[11px] italic px-3 py-3 rounded-md"
          style={{ background: "#fafbfd", color: "#8496b0" }}
        >
          No product roster yet for this account. Use the{" "}
          <b>📥 Import accounts</b> button on the list page to upload, or
          PATCH each row admin-side.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {sorted.map((p) => {
            const owned = p.purchased === true;
            const styles = owned
              ? {
                  background: "#f0fdf4",
                  border: "1px solid #a8e5c4",
                  color: "#146a45",
                }
              : {
                  background: "#fafbfd",
                  border: "1px dashed #e4eaf6",
                  color: "#5a7896",
                };
            return (
              <div
                key={p.product_key}
                style={{
                  ...styles,
                  display: "grid",
                  gridTemplateColumns: "20px 1fr 60px",
                  alignItems: "center",
                  padding: "7px 10px",
                  borderRadius: 7,
                  fontSize: 11.5,
                  gap: 10,
                  transition: "border-color 0.12s, background 0.12s",
                }}
                title={
                  p.purchased === true
                    ? "Purchased"
                    : p.purchased === false
                      ? "Not purchased — pitch via Growth & Pipeline Plays"
                      : "Status unknown — populate via account_products"
                }
              >
                <span style={{ fontSize: 14 }}>{owned ? "✓" : "○"}</span>
                <span style={{ fontWeight: 600 }}>{p.label}</span>
                <span
                  style={{
                    fontSize: 9.5,
                    fontWeight: 800,
                    textAlign: "right",
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    color: owned ? "#146a45" : "#8496b0",
                  }}
                >
                  {owned ? "Owned" : "Gap"}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* 10-Jun · Growth & Pipeline v3 prototype — Peer benchmark
          sub-panel. Renders empty-state copy when the cohort has no
          peers; the API contract is stable so the panel always paints. */}
      {peerBenchmark && (
        <PeerBenchmarkPanel
          benchmark={peerBenchmark}
          topPeerModules={topPeerModules}
        />
      )}
    </div>
  );
}

// 10-Jun · Peer-benchmark sub-panel inside ProductSaturation. Fuscia-
// themed (#C344C7) per the prototype to differentiate from the green
// "owned" / amber "gap" colors used in the saturation grid above.
function PeerBenchmarkPanel({
  benchmark,
  topPeerModules,
}: {
  benchmark: PeerBenchmark;
  topPeerModules: TopPeerModule[];
}) {
  const empty = benchmark.cohort_size === 0;
  return (
    <div
      className="mt-3 rounded-card p-3.5 border"
      style={{
        background: "linear-gradient(180deg, #fdf5ff, #ffffff)",
        borderColor: "#e9c0ec",
      }}
    >
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-[15px]" style={{ color: "#C344C7" }}>👥</span>
        <span className="text-[11.5px] font-extrabold flex-1" style={{ color: "#8a1a90" }}>
          Peer benchmark
        </span>
        <span className="text-[10px] text-text-muted">{benchmark.cohort_label}</span>
      </div>

      {empty ? (
        <div className="text-[11px] text-text-muted italic py-2">
          {benchmark.insight}
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            <PeerBar
              label="You"
              pct={benchmark.you_pct}
              fill="linear-gradient(90deg, #4A00F8, #C344C7)"
              labelClass="text-beroe-blue font-extrabold"
              valueClass="text-beroe-blue"
            />
            <PeerBar
              label="Peer median (industry)"
              pct={benchmark.peer_industry_pct ?? 0}
              fill="#e9c0ec"
            />
            <PeerBar
              label="Peer median (tier bucket)"
              pct={benchmark.peer_revenue_pct ?? 0}
              fill="#e9c0ec"
            />
            <PeerBar
              label="Top quartile"
              pct={benchmark.top_quartile_pct ?? 0}
              fill="#40CC8F"
              valueClass="text-beroe-green font-bold"
            />
          </div>

          <div
            className="mt-2.5 rounded-md p-2 flex gap-2 items-start text-[11.5px] leading-snug"
            style={{ background: "#fff", border: "1px solid #e9c0ec" }}
          >
            <span style={{ color: "#C344C7" }}>💡</span>
            <span className="text-text-primary">{benchmark.insight}</span>
          </div>

          {topPeerModules.length > 0 && (
            <>
              <div
                className="mt-3 text-[10px] font-bold uppercase tracking-wider"
                style={{ color: "#8a1a90" }}
              >
                Top modules adopted by peers
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5 mt-1.5">
                {topPeerModules.map((m) => (
                  <div
                    key={m.name}
                    className={cn(
                      "rounded-md p-2 text-[10.5px] border",
                      m.you_own
                        ? "border-beroe-green/40 bg-beroe-green/15/30"
                        : "bg-white",
                    )}
                    style={!m.you_own ? { borderColor: "#e9c0ec" } : undefined}
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-[11px] font-bold flex-1 truncate text-text-primary">
                        {m.name}
                      </span>
                      {m.you_own && (
                        <span
                          className="text-[8px] font-extrabold uppercase tracking-wider px-1 py-px rounded"
                          style={{ background: "#40CC8F", color: "#fff" }}
                        >
                          you own
                        </span>
                      )}
                    </div>
                    <div className="flex justify-between text-[9.5px] text-text-muted">
                      <span>Owned by</span>
                      <span
                        className="font-bold"
                        style={{ color: m.you_own ? "#146a45" : "#8a1a90" }}
                      >
                        {m.adoption_pct}% of peers
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function PeerBar({
  label,
  pct,
  fill,
  labelClass,
  valueClass,
}: {
  label: string;
  pct: number;
  fill: string;
  labelClass?: string;
  valueClass?: string;
}) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div className="grid grid-cols-[140px_1fr_44px] gap-2 items-center text-[11px]">
      <span className={cn("text-text-muted", labelClass)}>{label}</span>
      <div className="h-2 rounded-full bg-beroe-bg overflow-hidden relative">
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${w}%`, background: fill }} />
      </div>
      <span className={cn("text-right text-[10.5px] font-mono font-bold", valueClass)}>
        {pct.toFixed(1)}%
      </span>
    </div>
  );
}

// 10-Jun · Growth & Pipeline v3 prototype — 3-tab Plays section.
// ⚡ Active (existing PlayList) · ✨ AI recommended (from /growth-context
// ai_plays) · 👥 From peer CSMs (from /growth-context peer_plays).
type PlayTab = "active" | "ai" | "peer";

function PlayTabsSection({
  // 12-Jun · `mode`, `plays`, `showAllPlays`, `onToggleShowAll` retained
  // in the signature for caller compatibility but no longer consumed by
  // the Active tab (which now reads goals/initiatives). Removing them
  // would force every parent site to re-thread their state; cheaper
  // to underscore-prefix.
  mode: _mode,
  editable,
  accountId,
  plays: _plays,
  allPlays,
  showAllPlays: _showAllPlays,
  onToggleShowAll: _onToggleShowAll,
  aiPlays,
  peerPlays,
}: {
  mode: PlayMode;
  editable: boolean;
  accountId: string;
  plays: Play[];
  allPlays: Play[];
  showAllPlays: boolean;
  onToggleShowAll: (v: boolean) => void;
  aiPlays: AiPlaySuggestion[];
  peerPlays: PeerPlaySuggestion[];
}) {
  const [tab, setTab] = useState<PlayTab>("active");

  // 12-Jun · Active tab now pulls initiatives from cs_goals instead of
  // the legacy account_plays endpoint. Each initiative is rendered with
  // its parent goal as context. PATCHes go back to the parent goal.
  const goalsQ = useQuery<{ items: CSGoal[] }>({
    queryKey: ["cs-goals", accountId, false],
    queryFn: () =>
      api.get<{ items: CSGoal[] }>(
        `/api/v1/accounts/${accountId}/cs-goals?include_deleted=false`,
      ),
    enabled: tab === "active",
  });
  const goals = goalsQ.data?.items ?? [];
  const activeInitiativeCount = goals.reduce(
    (n, g) => n + (g.initiatives?.length ?? 0),
    0,
  );

  const counts: Record<PlayTab, number> = {
    active: activeInitiativeCount,
    ai: aiPlays.length,
    peer: peerPlays.length,
  };
  const tabs: Array<{ id: PlayTab; label: string; icon: string }> = [
    { id: "active", label: "Active", icon: "⚡" },
    { id: "ai", label: "AI recommended", icon: "✨" },
    { id: "peer", label: "From peer CSMs", icon: "👥" },
  ];

  return (
    <div className="bg-white border border-beroe-card-border rounded-card p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="text-[13px] font-bold">Expansion Plays</div>
        {/* "Show all plays" toggle retired 12-Jun — Active tab now shows
            every initiative across goals; AI / Peer tabs still respect
            mode-context via their own filters. */}
      </div>

      <div className="flex gap-1.5 mb-3 flex-wrap">
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "px-3 py-1.5 rounded-md text-[11.5px] font-bold border inline-flex items-center gap-1.5 transition-colors",
                active
                  ? "bg-beroe-blue/10 border-beroe-blue text-beroe-blue"
                  : "bg-white border-beroe-card-border text-text-muted hover:border-beroe-blue hover:text-beroe-blue",
              )}
            >
              <span>{t.icon}</span>
              <span>{t.label}</span>
              <span
                className={cn(
                  "ml-1 px-1.5 py-px rounded-full text-[10px] font-extrabold",
                  active ? "bg-white text-beroe-blue" : "bg-beroe-bg text-text-muted",
                )}
              >
                {counts[t.id]}
              </span>
            </button>
          );
        })}
      </div>

      {tab === "active" ? (
        <ActiveInitiativesList
          accountId={accountId}
          editable={editable}
          goals={goals}
          loading={goalsQ.isLoading}
        />
      ) : tab === "ai" ? (
        <AiPlaysList plays={aiPlays} accountId={accountId} editable={editable} />
      ) : (
        <PeerPlaysList plays={peerPlays} accountId={accountId} editable={editable} allPlays={allPlays} />
      )}
    </div>
  );
}

function probPill(tier: "high" | "med" | "low"): { cls: string; label: string } {
  if (tier === "high") return { cls: "bg-beroe-green/20 text-beroe-green", label: "High prob" };
  if (tier === "med") return { cls: "bg-beroe-amber/20 text-beroe-amber", label: "Med prob" };
  return { cls: "bg-beroe-bg text-text-muted", label: "Low prob" };
}

function AiPlaysList({
  plays,
  accountId,
  editable,
}: {
  plays: AiPlaySuggestion[];
  accountId: string;
  editable: boolean;
}) {
  const qc = useQueryClient();
  const notify = useNotify();
  const addMutation = useMutation({
    mutationFn: (s: AiPlaySuggestion) =>
      api.post(`/api/v1/accounts/${accountId}/plays`, {
        title: s.name,
        value_usd: s.est_acv_k * 1000,
        prob: s.prob_tier === "high" ? 80 : 50,
        modes: ["expand"],
        trigger_text: s.rationale,
      } satisfies PlayCreate),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["plays", accountId] });
      qc.invalidateQueries({ queryKey: ["appetite", accountId] });
      notify({ title: "Added to your active plays", tone: "success" });
    },
    onError: (e) =>
      notify({
        title: "Could not add play",
        body: e instanceof ApiError ? e.message : "Unknown error",
        tone: "error",
      }),
  });

  if (plays.length === 0) {
    return (
      <div className="text-[11px] text-text-muted italic py-4 text-center">
        No AI suggestions yet — peers in this cohort have fully overlapping module ownership.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {plays.map((p, i) => {
        const pp = probPill(p.prob_tier);
        return (
          <div
            key={p.id}
            className="rounded-card border bg-white p-3 grid grid-cols-[28px_1fr_84px_70px_60px] gap-2 items-center"
            style={{ borderLeftWidth: "4px", borderLeftColor: "#C344C7", borderColor: "var(--card-border, #e4eaf6)" }}
          >
            <div
              className="w-6 h-6 rounded-md flex items-center justify-center text-white text-[10px] font-extrabold"
              style={{ background: "#C344C7" }}
            >
              A{i + 1}
            </div>
            <div className="min-w-0">
              <div className="text-[12.5px] font-bold flex items-center gap-1.5 flex-wrap">
                {p.name}
                <span
                  className="text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-px rounded"
                  style={{
                    background: "linear-gradient(135deg, #C344C7, #8a1a90)",
                    color: "#fff",
                  }}
                >
                  ✨ AI · {p.match_pct}% match
                </span>
              </div>
              <div className="text-[10.5px] text-text-muted mt-0.5">{p.rationale}</div>
            </div>
            <div className="text-right font-mono text-[12.5px] font-extrabold">
              ${p.est_acv_k}K
              <div className="text-[9px] font-normal text-text-muted font-sans">est. ACV</div>
            </div>
            <span
              className={cn(
                "text-[9.5px] font-bold uppercase rounded-full px-2 py-1 text-center",
                pp.cls,
              )}
            >
              {pp.label}
            </span>
            <button
              type="button"
              disabled={!editable || addMutation.isPending}
              onClick={() => addMutation.mutate(p)}
              className="text-[10.5px] font-bold rounded-md px-2 py-1 bg-beroe-blue/10 text-beroe-blue border border-beroe-blue/30 hover:bg-beroe-blue/15 disabled:opacity-50"
            >
              + Add
            </button>
          </div>
        );
      })}
    </div>
  );
}

// 12-Jun · Informational list of initiatives from peer accounts in the
// SAME INDUSTRY. No "Add" button per stakeholder ("just list out").
// Rows show: initiative name + status pill + peer account · peer CSM ·
// parent goal + optional target + notes.
function PeerPlaysList({
  plays,
  accountId: _accountId,
  editable: _editable,
  allPlays: _allPlays,
}: {
  plays: PeerPlaySuggestion[];
  accountId: string;
  editable: boolean;
  allPlays: Play[];
}) {
  if (plays.length === 0) {
    return (
      <div className="text-[11px] text-text-muted italic py-4 text-center">
        No peer plays yet — no other accounts in your industry have logged
        initiatives, or the industry on this account isn't set.
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {plays.map((p) => {
        // 13-Jun · Status badge hidden — stakeholder asked not to display
        // anything in that slot for now. _STATUS_LABEL / _STATUS_TONE still
        // live in this file because the Status select inside Goal Alignment
        // depends on them; only the badge in the play row is gone.
        return (
          <div
            key={p.id}
            className="rounded-card border bg-white p-3"
            style={{
              borderLeftWidth: "4px",
              borderLeftColor: "#4A00F8",
              borderColor: "#e4eaf6",
            }}
          >
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] font-bold text-text-primary">
                  {p.name}
                </div>
                <div className="text-[10.5px] text-text-muted mt-1 flex flex-wrap gap-1.5 items-center">
                  <span>👤</span>
                  <b className="text-text-secondary">{p.peer_account_name}</b>
                  <span>· CSM:</span>
                  <b className="text-text-secondary">{p.peer_csm_name}</b>
                  <span>· Under goal:</span>
                  <i>{p.parent_goal_title}</i>
                  {p.value_target && (
                    <>
                      <span>·</span>
                      <b className="text-text-primary">{p.value_target}</b>
                    </>
                  )}
                </div>
                {p.notes && (
                  <div className="text-[10.5px] text-text-muted mt-1.5 italic leading-snug">
                    {p.notes}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// 3. Recommended Plays — superseded by the AI / Peer tabs of
//    PlayTabsSection (10-Jun). The data path is now cohort-aware
//    via GET /accounts/:id/growth-context — see PlayTabsSection above.

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
    { label: "Product", value: `${productScore}/100`, col: "#6EC457" },
    { label: "Signals", value: `${signalsScore}/100`, col: "#C344C7" },
    {
      label: "Active Signals",
      value: `${activeSignals} logged`,
      col: "#CF4548",
    },
    { label: "Activity", value: `${activityCount} entries`, col: "#F0BC41" },
    { label: "Hot Cats", value: `${hotCats}`, col: "#CF4548" },
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


// ============================================================
// 12-Jun · Active Expansion Plays = initiatives across goals
// ============================================================

type InitiativeRow = {
  goal: CSGoal;
  init: Initiative;
  index: number; // position inside the goal's initiatives array
};

function flattenInitiatives(goals: CSGoal[]): InitiativeRow[] {
  const rows: InitiativeRow[] = [];
  for (const g of goals) {
    (g.initiatives ?? []).forEach((init, i) => rows.push({ goal: g, init, index: i }));
  }
  return rows;
}

function ActiveInitiativesList({
  accountId,
  editable,
  goals,
  loading,
}: {
  accountId: string;
  editable: boolean;
  goals: CSGoal[];
  loading: boolean;
}) {
  const qc = useQueryClient();
  const notify = useNotify();
  const confirmDlg = useConfirm();
  const [addOpen, setAddOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<InitiativeRow | null>(null);

  const rows = flattenInitiatives(goals);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["cs-goals", accountId, false] });
  };

  async function onDelete(row: InitiativeRow) {
    const ok = await confirmDlg({
      title: "Remove this play?",
      body: `"${row.init.name}" — under goal "${row.goal.title}". This deletes the initiative from the goal.`,
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    const next = (row.goal.initiatives ?? []).filter((_, i) => i !== row.index);
    try {
      await api.patch(`/api/v1/cs-goals/${row.goal.id}`, {
        initiatives: next,
      });
      refresh();
      notify({ title: "Play removed", tone: "success" });
    } catch (e) {
      const err = e as ApiError;
      notify({ title: "Remove failed", body: err.message, tone: "error" });
    }
  }

  if (loading) {
    return <div className="text-[11px] text-text-muted italic">Loading plays…</div>;
  }

  return (
    <div>
      {rows.length === 0 ? (
        <div
          className="text-[11.5px] italic px-3 py-4 rounded-md mb-3"
          style={{ background: "#fafbfd", color: "#8496b0" }}
        >
          No plays yet — every play lives under a goal. Click{" "}
          <b>+ Add play</b> below to pick a goal and add the first one.
        </div>
      ) : (
        <div className="space-y-2 mb-3">
          {rows.map((row) => {
            // 13-Jun · Status badge column removed — stakeholder asked not
            // to display the "Identification / Pipeline / …" pill on play
            // rows for now. Grid collapses from `1fr 120px 80px` (content /
            // status / actions) to `1fr 80px` (content / actions).
            return (
              <div
                key={`${row.goal.id}:${row.index}`}
                className="bg-white border border-beroe-card-border rounded-card p-3 grid items-center"
                style={{
                  gridTemplateColumns: "1fr 80px",
                  gap: 12,
                }}
              >
                <div className="min-w-0">
                  <div className="text-[12.5px] font-bold text-text-primary truncate">
                    {row.init.name}
                  </div>
                  <div className="text-[10.5px] text-text-muted mt-0.5 flex items-center gap-1.5 flex-wrap">
                    <span>📎 Under goal:</span>
                    <b className="text-text-secondary">{row.goal.title}</b>
                    {row.init.value_target && (
                      <>
                        <span>·</span>
                        <b className="text-text-primary">{row.init.value_target}</b>
                      </>
                    )}
                    {row.init.notes && (
                      <>
                        <span>·</span>
                        <span
                          className="truncate"
                          title={row.init.notes ?? undefined}
                          style={{ maxWidth: 380 }}
                        >
                          {row.init.notes}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                {editable ? (
                  <div className="flex gap-1 justify-end">
                    <button
                      onClick={() => setEditingRow(row)}
                      className="text-[11px] px-2 py-1 rounded border border-beroe-card-border bg-white hover:bg-beroe-bg/60"
                      title="Edit"
                    >
                      ✎
                    </button>
                    <button
                      onClick={() => onDelete(row)}
                      className="text-[11px] px-2 py-1 rounded border border-beroe-red/30 bg-white text-beroe-red hover:bg-beroe-red/5"
                      title="Remove"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <div />
                )}
              </div>
            );
          })}
        </div>
      )}

      {editable && (
        <div className="flex justify-end">
          <button
            onClick={() => setAddOpen(true)}
            className="text-[12px] px-3 py-1.5 rounded-md border border-beroe-card-border bg-white hover:bg-beroe-bg/60 font-semibold"
          >
            + Add play
          </button>
        </div>
      )}

      {addOpen && (
        <AddInitiativeFromPlaysModal
          accountId={accountId}
          goals={goals}
          onClose={() => setAddOpen(false)}
          onSaved={() => {
            refresh();
            setAddOpen(false);
          }}
        />
      )}

      {editingRow && (
        <EditInitiativeModal
          row={editingRow}
          onClose={() => setEditingRow(null)}
          onSaved={() => {
            refresh();
            setEditingRow(null);
          }}
        />
      )}
    </div>
  );
}


// ============================================================
// Two-step: goal picker → initiative form
// ============================================================

function _newInitiative(name: string): Initiative {
  return {
    name,
    sub_initiatives: null,
    status: "identification",
    value_stage: null,
    value_target: null,
    value_delivered: null,
    notes: null,
    completion_pct: null,
    client_acknowledged: "pending",
    evidence: null,
    implementation_status: null,
    implementation_note: null,
    value_fields: {},
    client_data: [],
    value_history: [],
  };
}

function _initialDraft(row: InitiativeRow | null): Initiative {
  return row ? { ...row.init } : _newInitiative("");
}

function AddInitiativeFromPlaysModal({
  accountId,
  goals,
  onClose,
  onSaved,
}: {
  accountId: string;
  goals: CSGoal[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const navigate = useNavigate();
  const notify = useNotify();
  const [step, setStep] = useState<1 | 2>(1);
  const [pickedGoalId, setPickedGoalId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Initiative>(_newInitiative(""));
  const [saving, setSaving] = useState(false);

  const pickedGoal = goals.find((g) => g.id === pickedGoalId) ?? null;

  async function onSave() {
    if (!pickedGoal) return;
    if (!draft.name.trim()) {
      notify({ title: "Title is required", tone: "warning" });
      return;
    }
    setSaving(true);
    try {
      const next = [...(pickedGoal.initiatives ?? []), draft];
      await api.patch(`/api/v1/cs-goals/${pickedGoal.id}`, {
        initiatives: next,
      });
      notify({
        title: "Play added",
        body: `Under goal "${pickedGoal.title}"`,
        tone: "success",
      });
      onSaved();
    } catch (e) {
      const err = e as ApiError;
      notify({ title: "Save failed", body: err.message, tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell onClose={onClose} title={step === 1 ? "Pick a goal" : "Add play"}>
      {step === 1 ? (
        <div>
          <div className="text-[11.5px] text-text-muted mb-3">
            Which success metric does this play live under? Every play is an
            initiative on a goal.
          </div>
          {goals.length === 0 ? (
            <div
              className="px-3 py-4 rounded-md text-[11.5px] italic"
              style={{ background: "#fef3c7", color: "#854F0B" }}
            >
              This account has no goals yet. Create one in{" "}
              <b>Goal Alignment</b> first, then come back here.
              <div className="mt-2">
                <button
                  onClick={() => {
                    onClose();
                    navigate(`/accounts/${accountId}/success-management/goal-alignment`);
                  }}
                  className="text-[12px] px-3 py-1.5 rounded-md border border-beroe-blue bg-beroe-blue text-white font-semibold"
                >
                  Go to Goal Alignment →
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2 max-h-[340px] overflow-y-auto">
              {goals.map((g) => {
                const selected = g.id === pickedGoalId;
                return (
                  <label
                    key={g.id}
                    className="block cursor-pointer rounded-md border p-3 transition-colors"
                    style={{
                      borderColor: selected ? "#4A00F8" : "#e4eaf6",
                      background: selected ? "#f5f3ff" : "#fff",
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        checked={selected}
                        onChange={() => setPickedGoalId(g.id)}
                        className="flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] font-bold text-text-primary">
                          {g.title}
                        </div>
                        <div className="text-[10.5px] text-text-muted mt-0.5">
                          Category: <b>{g.category}</b>
                          {g.target_value && <> · Target: <b>{g.target_value}</b></>}
                          {g.target_date && <> · Due: <b>{g.target_date}</b></>}
                          <> · {g.initiatives?.length ?? 0} existing initiative{(g.initiatives?.length ?? 0) === 1 ? "" : "s"}</>
                        </div>
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
          <div className="flex justify-end gap-2 mt-4">
            <button
              onClick={onClose}
              className="text-[12px] px-3 py-1.5 rounded-md border border-beroe-card-border bg-white font-semibold"
            >
              Cancel
            </button>
            <button
              onClick={() => setStep(2)}
              disabled={!pickedGoalId || goals.length === 0}
              className="text-[12px] px-4 py-1.5 rounded-md bg-beroe-blue text-white font-semibold disabled:opacity-50"
            >
              Next →
            </button>
          </div>
        </div>
      ) : (
        <div>
          <div className="text-[10.5px] text-text-muted mb-3">
            Adding to: <b className="text-text-primary">{pickedGoal?.title}</b>
          </div>
          <InitiativeFormFields draft={draft} setDraft={setDraft} />
          <div className="flex justify-between gap-2 mt-4">
            <button
              onClick={() => setStep(1)}
              className="text-[12px] px-3 py-1.5 rounded-md border border-beroe-card-border bg-white font-semibold"
            >
              ← Back
            </button>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="text-[12px] px-3 py-1.5 rounded-md border border-beroe-card-border bg-white font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={onSave}
                disabled={saving || !draft.name.trim()}
                className="text-[12px] px-4 py-1.5 rounded-md bg-beroe-blue text-white font-semibold disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save play"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ModalShell>
  );
}

function EditInitiativeModal({
  row,
  onClose,
  onSaved,
}: {
  row: InitiativeRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const notify = useNotify();
  const [draft, setDraft] = useState<Initiative>(() => _initialDraft(row));
  const [saving, setSaving] = useState(false);

  async function onSave() {
    if (!draft.name.trim()) {
      notify({ title: "Title is required", tone: "warning" });
      return;
    }
    setSaving(true);
    try {
      const next = (row.goal.initiatives ?? []).map((it, i) =>
        i === row.index ? draft : it,
      );
      await api.patch(`/api/v1/cs-goals/${row.goal.id}`, {
        initiatives: next,
      });
      notify({ title: "Play updated", tone: "success" });
      onSaved();
    } catch (e) {
      const err = e as ApiError;
      notify({ title: "Update failed", body: err.message, tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell onClose={onClose} title="Edit play">
      <div className="text-[10.5px] text-text-muted mb-3">
        Under goal: <b className="text-text-primary">{row.goal.title}</b>
      </div>
      <InitiativeFormFields draft={draft} setDraft={setDraft} />
      <div className="flex justify-end gap-2 mt-4">
        <button
          onClick={onClose}
          className="text-[12px] px-3 py-1.5 rounded-md border border-beroe-card-border bg-white font-semibold"
        >
          Cancel
        </button>
        <button
          onClick={onSave}
          disabled={saving || !draft.name.trim()}
          className="text-[12px] px-4 py-1.5 rounded-md bg-beroe-blue text-white font-semibold disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </ModalShell>
  );
}

// 13-Jun · Realigned to the v20 prototype "Add Play" modal (lines 7600-7619).
// Field set + order + labels match exactly: Title → [Opportunity Value | Stage |
// Timeline] → Trigger → Relevant Modes. Storage shape is preserved — the new
// prototype-only fields (sales_stage_prob, timeline, modes) ride along in the
// existing `value_fields` jsonb, so no migration is needed. "Status" / "Owner" /
// "Delivered" are dropped from the modal (status still defaults to
// "identification" via _newInitiative so the cascade-unlock logic on Goals
// keeps working downstream).

function InitiativeFormFields({
  draft,
  setDraft,
}: {
  draft: Initiative;
  setDraft: (next: Initiative) => void;
}) {
  const vf = (draft.value_fields ?? {}) as Record<string, unknown>;
  const stageProb = typeof vf.sales_stage_prob === "number" ? vf.sales_stage_prob : null;
  const timeline = typeof vf.timeline === "string" ? vf.timeline : "";
  const modes: PlayMode[] = Array.isArray(vf.modes)
    ? (vf.modes as string[]).filter((m): m is PlayMode =>
        m === "rescue" || m === "retain" || m === "expand"
      )
    : [];

  const patchValueFields = (patch: Record<string, unknown>) =>
    setDraft({ ...draft, value_fields: { ...vf, ...patch } });

  const toggleMode = (m: PlayMode) => {
    const next = modes.includes(m) ? modes.filter((x) => x !== m) : [...modes, m];
    patchValueFields({ modes: next });
  };

  return (
    <div className="space-y-3">
      <ModalField label="Title *">
        <input
          type="text"
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="What's this play about?"
          className="w-full px-3 py-1.5 rounded-md border border-beroe-card-border text-[12.5px]"
        />
      </ModalField>
      <div className="grid grid-cols-3 gap-3">
        <ModalField label="Opportunity Value">
          <MoneyInput
            value={draft.value_target ?? ""}
            onChange={(v) => setDraft({ ...draft, value_target: v ?? null })}
            className="w-full px-3 py-1.5 rounded-md border border-beroe-card-border text-[12.5px]"
            placeholder="$ 0"
          />
        </ModalField>
        <ModalField label="Stage">
          <select
            value={stageProb ?? ""}
            onChange={(e) =>
              patchValueFields({
                sales_stage_prob: e.target.value === "" ? null : parseInt(e.target.value, 10),
              })
            }
            className="w-full px-3 py-1.5 rounded-md border border-beroe-card-border text-[12.5px] bg-white"
          >
            <option value="">— Select Stage —</option>
            {SALES_STAGES.map((s) => (
              <option key={s.prob} value={s.prob}>
                {s.prob}% — {s.label}
              </option>
            ))}
          </select>
        </ModalField>
        <ModalField label="Timeline">
          <input
            type="text"
            value={timeline}
            onChange={(e) => patchValueFields({ timeline: e.target.value })}
            placeholder="Q3 FY25 · 30 days · …"
            className="w-full px-3 py-1.5 rounded-md border border-beroe-card-border text-[12.5px]"
          />
        </ModalField>
      </div>
      <ModalField label="Trigger">
        <textarea
          value={draft.notes ?? ""}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value || null })}
          placeholder="What signal / event triggered this play?"
          rows={3}
          className="w-full px-3 py-1.5 rounded-md border border-beroe-card-border text-[12.5px] resize-y"
        />
      </ModalField>
      <ModalField label="Relevant Modes">
        <div className="flex flex-wrap gap-3 pt-0.5">
          {(["rescue", "retain", "expand"] as PlayMode[]).map((m) => {
            const c = MODE_CONF[m];
            const checked = modes.includes(m);
            return (
              <label
                key={m}
                className="flex items-center gap-1.5 text-[12px] cursor-pointer select-none"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleMode(m)}
                  className="cursor-pointer"
                />
                <span style={{ color: c.col }}>{c.icon}</span>
                <span>{c.label}</span>
              </label>
            );
          })}
        </div>
      </ModalField>
    </div>
  );
}
