// 03-Jun — CS Handoff page (full prototype port).
//
// Single-page mirror of beroe_cs_handoff_proto.html with the prototype's
// exact block order, colour palette (mapped to brand-locked tokens),
// labels, and behaviour. Pulls live data from existing endpoints; no
// new backend routes beyond cs_handoff state + cs_goals validation
// fields landed in migration 0058.
//
// Block order (matches prototype line render() bottom-up):
//   stage indicator → success banner → realign banner →
//   1) CS Onboarding Entry  →  2) Commercial (gate_*) →
//   3) Client (contacts SPOC/sponsor/power) → 4) Commitment (sh_* + metric) →
//   5) Goal Alignment & Validation (cs_goals × Phase A/B/C × Accept/Flag/Remove) →
//   Final actions (Ready check + Start Success Journey + Re-align modal)

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useConfirm, useNotify, usePrompt } from "@/components/DialogProvider";
import { useAuth } from "@/components/AuthProvider";
import { useAccountFromLayout } from "../AccountProfileLayout";
import type {
  CSEntryType,
  CSHandoffState,
  CSOnboarding,
  CSOnboardingUpdate,
} from "@/types/cs_onboarding";
import { CS_HANDOVER_GROUPS } from "@/types/cs_onboarding";
import type { CSGoal } from "@/types/cs_goal";
// 04-Jun bug 11 — CATEGORY_LABELS import removed; only consumer was
// the legacy BlockGoals function that moved to Success Management.

// ─────────────────────────────────────────────────────────────
// Brand-locked palette (maps prototype off-brand colours to the
// Beroe brand book — Indigo / Fuscia / Aqua / Bumblebee + Risk RAG).
// ─────────────────────────────────────────────────────────────
const C = {
  BLUE: "#4A00F8",   // Indigo (prototype --blue)
  PURPLE: "#C344C7", // Fuscia (prototype --pur)
  AMBER: "#F0BC41",  // Bumblebee/Risk Amber (prototype --amb)
  GREEN: "#6EC457",  // Risk Green (prototype --grn)
  RED: "#CF4548",    // Risk Red (prototype --red)
  TEAL: "#35E1D4",   // Aqua (prototype --teal)
  NAVY: "#001137",   // Midnight (--t1 anchor)
  T2: "#475569",
  T3: "#94a3b8",
  CB: "#e4eaf6",
  BG: "#EAF1F5",
};

// ─────────────────────────────────────────────────────────────
// Adjacent-domain types (only the fields this page reads).
// ─────────────────────────────────────────────────────────────
interface ContactRow {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  is_spoc: boolean;
  is_sponsor: boolean;
  decision_power: string | null;
  seniority: string | null;
}
interface SolutioningRow {
  sh_value_themes_from_solutioning: string | null;
  // 09-Jun · G2 — beroe_value_flow_map.html · Stage 4 gap-pill:
  // "Today: chips + first metric + kickoff date shown. NARRATIVE
  // missing. CSM must infer from chips." Surfacing the prose
  // statement (sh_value_from_solutioning) on the Commitment card.
  sh_value_from_solutioning: string | null;
  sh_go_live_date: string | null;
  sh_stakeholder_signoff: string | null;
}
interface MetricRow {
  id: string;
  name: string;
  target_value: string | null;
  current_value: string | null;
  status: "green" | "amber" | "red" | "grey";
}

// (phaseAOptions helper removed 11-Jun — only consumer was the
// deleted DemoStateToggle's fast-fwd flow.)

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function fd(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
function initials(name: string | null | undefined): string {
  if (!name) return "??";
  return name.replace(/[^A-Za-z ]/g, "").split(" ").filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? "").join("");
}
function fmtUsd(v: string | number | null | undefined): string {
  if (v == null || v === "") return "—";
  const n = typeof v === "string" ? parseFloat(v) : v;
  if (!Number.isFinite(n)) return "—";
  return "$" + n.toLocaleString("en-US");
}

// Per-phase completion derives from completed_at presence.
function goalAlignment(g: CSGoal) {
  const a = !!g.phase_a_completed_at;
  const b = !!g.phase_b_completed_at;
  const c = !!g.phase_c_completed_at;
  const doneCount = [a, b, c].filter(Boolean).length;
  let status: "aligned" | "in_progress" | "not_started" = "not_started";
  if (a && b && c) status = "aligned";
  else if (a || b || c) status = "in_progress";
  return { status, phases: { A: a, B: b, C: c } as const, doneCount };
}

// ─────────────────────────────────────────────────────────────
// Block 1 — Entry picker (prototype buildEntryBlock)
// ─────────────────────────────────────────────────────────────
function BlockEntry({
  form,
  locked,
  onChange,
}: {
  form: CSOnboarding;
  locked: boolean;
  onChange: (t: CSEntryType) => void;
}) {
  return (
    <Card>
      <SectionHead n="1" color={C.BLUE} title="CS Handoff Entry" teamLabel="CS" teamColor={C.BLUE} />
      <div className="grid sm:grid-cols-2 gap-2.5">
        {(["A", "B"] as const).map((t) => {
          const selected = form.cs_entry_type === t;
          const cfg = t === "A"
            ? { title: "Entry A · Clean Sales handoff", desc: "Sales has passed a complete handover package and Contract Audit is signed off." }
            : { title: "Entry B · Mid-contract pickup", desc: "Picking up an existing account with no clean handover — CSM uploads prior context." };
          return (
            <button
              key={t}
              type="button"
              disabled={locked || !form.is_editable}
              onClick={() => onChange(t)}
              className={cn(
                "p-3.5 rounded-[10px] border-[2px] bg-white text-left transition disabled:opacity-60 disabled:cursor-not-allowed",
                selected ? "border-beroe-blue bg-[#f3f0ff]" : "border-beroe-card-border hover:border-beroe-blue/40",
              )}
            >
              <div className="text-[12px] font-bold text-beroe-blue mb-1">✅ {cfg.title}</div>
              <div className="text-[10px] text-text-muted leading-[1.5]">{cfg.desc}</div>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────
// Block 2 — Commercial (prototype buildCommercialBlock)
// Pulls gate_* + contract-doc fields from accounts.
// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// 03-Jun bug — Handover Quality Check restructured into 3 main
// pointers (Contract / Client / Engagement), each with sub-checks.
// Only renders under Entry A. Toggles save instantly via the
// existing cs_handover_checklist jsonb merge.
// ─────────────────────────────────────────────────────────────
function HandoverQualityCheckBlock({
  checklist,
  locked,
  editable,
  onToggle,
}: {
  checklist: Record<string, boolean>;
  locked: boolean;
  editable: boolean;
  onToggle: (key: string, val: boolean) => void;
}) {
  const groupCount = (g: (typeof CS_HANDOVER_GROUPS)[number]) => {
    const total = g.items.length;
    const done = g.items.filter((it) => !!checklist[it.key]).length;
    return { total, done };
  };
  const allDone = CS_HANDOVER_GROUPS.every((g) =>
    g.items.every((it) => !!checklist[it.key]),
  );

  return (
    <Card leftBorderColor={allDone ? C.GREEN : C.BLUE}>
      <SectionHead
        n="✓"
        color={allDone ? C.GREEN : C.BLUE}
        title="Handover Quality Check"
        teamLabel="CS"
        teamColor={C.BLUE}
        trailing={
          <span
            className="ml-auto text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={
              allDone
                ? { background: "#d4f5e5", color: "#146a45" }
                : { background: "#fff3e0", color: "#b85b00" }
            }
          >
            {allDone ? "✓ All checks complete" : "In progress"}
          </span>
        }
      />
      <p className="text-[11px] text-text-muted mb-3">
        Three groups, each with sub-checks. Tick every item before starting
        the Success Journey so nothing slips between Sales / Contract Ops
        / CS.
      </p>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-2.5">
        {CS_HANDOVER_GROUPS.map((g) => {
          const { total, done } = groupCount(g);
          const complete = done === total;
          return (
            <div
              key={g.key}
              className="rounded-[10px] border p-3"
              style={{
                background: complete ? "#f0fdf4" : "#fff",
                borderColor: complete ? `${C.GREEN}40` : C.CB,
                borderWidth: 1.5,
              }}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <div className="text-[12px] font-bold text-text-primary flex-1">
                  {g.label}
                </div>
                <span
                  className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                  style={
                    complete
                      ? { background: "#d4f5e5", color: "#146a45" }
                      : { background: "#f1f5f9", color: "#64748b" }
                  }
                >
                  {done}/{total}
                </span>
              </div>
              {g.desc && (
                <p className="text-[10.5px] text-text-muted mb-2 leading-[1.45]">
                  {g.desc}
                </p>
              )}
              <ul className="space-y-1.5">
                {g.items.map((it) => {
                  const checked = !!checklist[it.key];
                  return (
                    <li key={it.key}>
                      <label
                        className={cn(
                          "flex items-start gap-2 text-[11.5px] leading-[1.4] cursor-pointer rounded-md px-1.5 py-1",
                          (!editable || locked) && "cursor-not-allowed opacity-60",
                          checked && "text-text-secondary",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!editable || locked}
                          onChange={(e) => onToggle(it.key, e.target.checked)}
                          className="mt-0.5 w-3.5 h-3.5 flex-shrink-0 accent-beroe-green"
                        />
                        <span className={cn(checked && "line-through")}>
                          {it.label}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function BlockCommercial({
  account,
}: {
  account: ReturnType<typeof useAccountFromLayout>;
}) {
  const modules = account.gate_contract_modules ?? [];
  const acvUsd = account.gate_contract_acv ? Number(account.gate_contract_acv) : null;
  const termYears = (() => {
    const t = (account.gate_contract_term ?? "").toLowerCase();
    const m = /(\d+)/.exec(t);
    return m ? parseInt(m[1], 10) : null;
  })();
  const tcv = acvUsd != null && termYears != null ? acvUsd * termYears : null;
  return (
    <Card leftBorderColor={C.AMBER}>
      <SectionHead
        n="2"
        color={C.AMBER}
        title="Commercial"
        teamLabel="Contract Ops"
        teamColor={C.AMBER}
        trailing={
          <span className="text-[10px] text-text-muted">
            From Contract Audit{account.gate_confirmed_at ? ` · ${fd(account.gate_confirmed_at)}` : ""}
          </span>
        }
      />
      <GroupHead>Contract</GroupHead>
      <RoGrid cols={3}>
        <RoTile label="Signed" value={fd(account.gate_signed_date)} />
        <RoTile label="Term" value={account.gate_contract_term ?? "—"} />
        <RoTile label="Renewal" value={fd(account.gate_renewal_date)} valueColor={C.BLUE} />
      </RoGrid>
      <GroupHead>Commercial Terms</GroupHead>
      <RoGrid cols={4}>
        <RoTile label="ACV" value={fmtUsd(acvUsd)} />
        <RoTile label="TCV" value={fmtUsd(tcv)} />
        <RoTile label="Billing" value="Annual" />
        <RoTile label="Payment" value="Net 45" />
      </RoGrid>
      <GroupHead>
        What Was Sold{" "}
        <span className="font-medium text-text-muted normal-case tracking-normal">
          — {modules.length} module{modules.length === 1 ? "" : "s"}
          {account.gate_platform_tier ? ` · Platform Tier: ${account.gate_platform_tier}` : ""}
          {account.gate_account_segment ? ` · Segment ${account.gate_account_segment}` : ""}
        </span>
      </GroupHead>
      {modules.length === 0 ? (
        <EmptyHint>No modules captured in the Contract Audit yet — check Sales Hand-off.</EmptyHint>
      ) : (
        <div>{modules.map((m) => <ModuleSummary key={m} name={m} />)}</div>
      )}
      {account.gate_subscribers && (
        <div className="text-[11px] text-text-muted mt-2">
          <b className="text-text-primary">Subscribers:</b> {account.gate_subscribers}
        </div>
      )}
    </Card>
  );
}

const MODULE_ICONS: Record<string, string> = {
  "LiVE.Ai": "🤖", "Supplier Watch": "🛡", "MMD": "📊", "Custom Credits": "⚡",
  "Commodity Forecasting": "📈", "Datahub": "🗄", "GSA": "📋", "Cirtuo": "🎯",
  "Sourcing Optimizer": "⚙", "Alerts and Updates": "🔔", "Inflation Watch": "📊",
  "Spend Analytics": "📉", "nnamu": "🌐", "Prism": "🔮", "Supply Chain Risk": "🌍",
  "Opp Assessment": "🧭", "Diverse Supplier Discovery": "🌟", "Hackett": "🏛",
  "Copilot": "🤝", "Connector Fee": "🔌", "Abi Intelligence": "🤖",
  "Benchmarks": "📊", "Category Watch": "👁",
};
function ModuleSummary({ name }: { name: string }) {
  const icon = MODULE_ICONS[name] ?? "📦";
  return (
    <div
      className="flex gap-3 items-start bg-white border border-beroe-card-border rounded-[9px] px-3.5 py-2.5 mb-1.5"
      style={{ borderLeft: `3px solid ${C.BLUE}` }}
    >
      <div
        className="w-7 h-7 rounded-[7px] flex items-center justify-center text-[15px] flex-shrink-0"
        style={{ background: "#f3f0ff" }}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] font-bold text-text-primary">{name}</div>
        <div className="text-[10px] text-text-muted mt-0.5">Configuration not yet captured in this audit pass.</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Block 3 — Client (SPOC + Budget Owner + Power Users)
// Derived from client_contacts: is_spoc → SPOC; is_sponsor or
// decision_power='executive_sponsor' → Budget Owner; rest → Power Users.
// ─────────────────────────────────────────────────────────────
function BlockClient({ accountId }: { accountId: string }) {
  const { data } = useQuery<{ items: ContactRow[]; total: number }>({
    queryKey: ["contacts", accountId],
    queryFn: () => api.get(`/api/v1/accounts/${accountId}/contacts`),
    staleTime: 30_000,
  });
  const items = data?.items ?? [];
  const spoc = items.find((c) => c.is_spoc) ?? null;
  const sponsor =
    items.find((c) => !c.is_spoc && (c.is_sponsor || c.decision_power === "executive_sponsor")) ?? null;
  const power = items.filter(
    (c) => !c.is_spoc && !c.is_sponsor && c.decision_power !== "executive_sponsor",
  ).slice(0, 5);

  return (
    <Card leftBorderColor={C.PURPLE}>
      <SectionHead
        n="3"
        color={C.PURPLE}
        title="Client"
        teamLabel="Sales"
        teamColor={C.PURPLE}
        trailing={<span className="text-[10px] text-text-muted">From Sales Handoff</span>}
      />
      <GroupHead>Primary Contact (SPOC / Gatekeeper)</GroupHead>
      <RoleCard contact={spoc} roleLabel="SPOC" emptyText="SPOC not assigned — Re-align with Sales" />
      <GroupHead>Budget Owner</GroupHead>
      <RoleCard contact={sponsor} roleLabel="BUDGET OWNER" emptyText="Budget Owner not assigned — Re-align with Sales" />
      <GroupHead>
        Power Users to Track{" "}
        <span className="font-medium text-text-muted normal-case tracking-normal">
          (adoption metrics cohort · max 5)
        </span>
      </GroupHead>
      {power.length === 0 ? (
        <div
          className="flex items-center gap-2.5 rounded-[9px] px-3 py-2.5 border"
          style={{ background: "#fff8eb", borderColor: C.AMBER, color: "#854F0B" }}
        >
          <div
            className="w-8 h-8 rounded-full text-white text-[11px] font-extrabold inline-flex items-center justify-center"
            style={{ background: C.AMBER }}
          >
            !
          </div>
          <div className="flex-1 text-[12px] font-semibold">No power users listed — adoption tracking will be incomplete</div>
        </div>
      ) : (
        <>
          {power.map((c) => (
            <div key={c.id} className="flex items-center gap-2 px-2.5 py-1.5 bg-white border border-beroe-card-border rounded-[7px] mb-1 text-[12px]">
              <div
                className="w-6 h-6 rounded-full inline-flex items-center justify-center text-[10px] font-extrabold"
                style={{ background: `${C.PURPLE}25`, color: C.PURPLE, border: `1.5px solid ${C.PURPLE}` }}
              >
                {initials(c.name)}
              </div>
              <div className="flex-1 min-w-0">
                <b>{c.name}</b>
                <span className="text-text-muted"> · {c.title ?? "—"}</span>
              </div>
            </div>
          ))}
          <div className="text-[10px] text-text-muted mt-1">{power.length}/5 power users</div>
        </>
      )}
      <div className="mt-2 text-[10px]">
        <Link to={`/accounts/${accountId}/contacts`} className="text-beroe-blue font-semibold hover:underline">
          Manage Client Contacts →
        </Link>
      </div>
    </Card>
  );
}

function RoleCard({
  contact,
  roleLabel,
  emptyText,
}: {
  contact: ContactRow | null;
  roleLabel: string;
  emptyText: string;
}) {
  if (!contact) {
    return (
      <div
        className="flex items-center gap-2.5 rounded-[9px] px-3 py-2.5 border"
        style={{ background: "#fff0f2", borderColor: `${C.RED}40`, color: "#c42040" }}
      >
        <div
          className="w-8 h-8 rounded-full text-white text-[11px] font-extrabold inline-flex items-center justify-center"
          style={{ background: C.RED }}
        >
          !
        </div>
        <div className="flex-1 text-[12px] font-semibold">{emptyText}</div>
      </div>
    );
  }
  return (
    <div
      className="flex items-center gap-2.5 rounded-[9px] px-3 py-2.5 border mb-1.5"
      style={{ background: "#f3f0ff", borderColor: "#d0c5f5" }}
    >
      <div
        className="w-8 h-8 rounded-full text-white text-[11px] font-extrabold inline-flex items-center justify-center"
        style={{ background: C.PURPLE }}
      >
        {initials(contact.name)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-bold text-text-primary truncate">{contact.name}</div>
        <div className="text-[11px] text-text-muted truncate">{contact.title ?? "—"}</div>
      </div>
      <span
        className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-white border"
        style={{ borderColor: "#d0c5f5", color: C.PURPLE }}
      >
        {roleLabel}
      </span>
      {contact.email && (
        <div className="text-[10px] text-text-muted font-mono truncate max-w-[160px]">{contact.email}</div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Block 4 — Commitment (themes + success metric + kickoff)
// ─────────────────────────────────────────────────────────────
function BlockCommitment({
  account,
  accountId,
  goalsCount,
}: {
  account: ReturnType<typeof useAccountFromLayout>;
  accountId: string;
  goalsCount: number;
}) {
  const sol = useQuery<SolutioningRow>({
    queryKey: ["solutioning", accountId],
    queryFn: () => api.get(`/api/v1/accounts/${accountId}/solutioning`),
    staleTime: 60_000,
  });
  const metrics = useQuery<{ items: MetricRow[]; total: number }>({
    queryKey: ["metrics", accountId],
    queryFn: () => api.get(`/api/v1/accounts/${accountId}/metrics`),
    staleTime: 60_000,
  });
  const themes = (sol.data?.sh_value_themes_from_solutioning ?? "")
    .split(/[,\n]/g).map((t) => t.trim()).filter(Boolean);
  const narrative = (sol.data?.sh_value_from_solutioning ?? "").trim();
  const primary = metrics.data?.items?.[0] ?? null;
  const goLive = sol.data?.sh_go_live_date ?? account.gate_signed_date ?? null;
  return (
    <Card leftBorderColor={C.PURPLE}>
      <SectionHead
        n="4"
        color={C.PURPLE}
        title="Commitment"
        teamLabel="Sales"
        teamColor={C.PURPLE}
        trailing={<span className="text-[10px] text-text-muted">From Sales Handoff</span>}
      />
      {/* 09-Jun · G2 — value_flow_map Stage 4 narrative prose. Was
          missing per spec gap-pill; the CSM previously had to infer
          the commitment story from chips + metric alone. */}
      {narrative && (
        <div
          className="mb-3 rounded-[8px] border px-3 py-2 text-[12px] leading-[1.55] italic"
          style={{
            background: "#fdf0fd",
            borderColor: `${C.PURPLE}30`,
            color: "#5a3a72",
          }}
        >
          “{narrative}”
        </div>
      )}
      <GroupHead>Client Priorities</GroupHead>
      {themes.length === 0 ? (
        <EmptyHint>No value themes captured yet — set them on Solutioning.</EmptyHint>
      ) : (
        <div className="flex flex-wrap gap-1 mb-2">
          {themes.map((t) => (
            <span
              key={t}
              className="inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold"
              style={{ background: "#f5e0f6", color: "#8a1a90" }}
            >
              {t}
            </span>
          ))}
        </div>
      )}
      <GroupHead>Success Metric (Primary)</GroupHead>
      <div
        className="rounded-[8px] border px-3 py-2.5"
        style={{ background: "#fdf0fd", borderColor: `${C.PURPLE}30` }}
      >
        <div className="flex items-center gap-2.5">
          <div className="flex-1 min-w-0">
            <div
              className="text-[9.5px] uppercase tracking-wider font-bold mb-0.5"
              style={{ color: C.PURPLE }}
            >
              {primary?.name ?? "Primary metric not yet defined"}
            </div>
            <div className="text-[18px] font-bold" style={{ color: C.PURPLE }}>
              {primary?.target_value ?? "—"}
            </div>
            {primary?.current_value && (
              <div className="text-[11px] text-text-muted mt-0.5">
                Currently: <b className="text-text-primary">{primary.current_value}</b>
              </div>
            )}
          </div>
          <div className="text-[10px] text-text-muted text-right">
            Anchored by<br />
            <span className="font-semibold" style={{ color: C.PURPLE }}>{goalsCount} sub-goals</span>
          </div>
        </div>
      </div>
      <GroupHead>Kickoff Date</GroupHead>
      <RoGrid cols={2}>
        <RoTile label="Go-Live" value={fd(goLive)} valueColor={C.BLUE} sub="From Sales Handoff" />
        <RoTile label="CS Kickoff" value="Within 7 days" sub="CSM schedules after Success Journey starts" />
      </RoGrid>
    </Card>
  );
}
// 05-Jun bug 212 — BlockGoalsShortcut removed. Goal Validation & Alignment
// is now exclusively in Success Management → Contract & Goals. CS Hand-off
// no longer surfaces a goals shortcut card per stakeholder direction.

// ─────────────────────────────────────────────────────────────
// Banners (success-journey-started · realignment-pending) + stage bar
// ─────────────────────────────────────────────────────────────
function StageIndicator({
  account,
  csmName,
  journeyStarted,
}: {
  account: ReturnType<typeof useAccountFromLayout>;
  csmName: string;
  journeyStarted: boolean;
}) {
  const handed = account.handed_off_to_solutioning;
  const signed = account.gate_signed;
  // CS Handoff is the current step until journeyStarted flips.
  const sales = handed; // Sales Handoff completion proxy
  const audit = signed; // Contract Audit completion proxy (= signed)
  const cs = journeyStarted; // CS Handoff complete = journey kicked off

  return (
    <div className="flex items-center gap-1.5 mb-4 bg-white rounded-[12px] border border-beroe-card-border px-3.5 py-2.5">
      <StageStep label="Sales Handoff" sub="Sales" done={sales} />
      <StageConn done={sales} />
      <StageStep label="Contract Audit" sub="Contract Ops" done={audit} />
      <StageConn done={audit} />
      <StageStep label="CS Handoff" sub={csmName} done={cs} current={!cs && audit} />
      <StageConn done={cs} />
      <StageStep label="Success Journey" sub={csmName} done={cs} />
    </div>
  );
}
function StageStep({
  label, sub, done, current,
}: { label: string; sub: string; done: boolean; current?: boolean }) {
  return (
    <div className="flex items-center gap-2 flex-1 min-w-0">
      <div
        className="w-6 h-6 rounded-full text-[11px] font-extrabold text-white flex items-center justify-center flex-shrink-0"
        style={{
          background: done ? C.GREEN : current ? C.BLUE : "#cbd5e1",
          boxShadow: current ? `0 0 0 4px ${C.BLUE}20` : undefined,
        }}
      >
        {done ? "✓" : "·"}
      </div>
      <div className="min-w-0">
        <div className="text-[11px] font-semibold text-text-primary truncate">{label}</div>
        <div className="text-[9px] text-text-muted truncate">{sub}</div>
      </div>
    </div>
  );
}
function StageConn({ done }: { done: boolean }) {
  return (
    <div
      className="flex-1 h-[2px] max-w-[60px]"
      style={{ background: done ? C.GREEN : C.CB }}
    />
  );
}

function SuccessBanner({
  startedAt, csmName, alignedCount, accountId, onGoToSM, onUnlock,
}: {
  startedAt: string;
  csmName: string;
  alignedCount: number;
  accountId: string;
  onGoToSM: () => void;
  onUnlock?: () => void;
}) {
  return (
    <>
      <div
        className="rounded-[12px] border-[1.5px] p-4 mb-3 flex items-center gap-3.5"
        style={{
          background: "linear-gradient(135deg,#f0fdf4,#dcfce7)",
          borderColor: C.GREEN,
        }}
      >
        <span className="text-[30px]">🚀</span>
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-bold" style={{ color: "#146a45" }}>
            Success Journey started · {fd(startedAt)}
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: "#2fb87a" }}>
            Account active in Success Management. {alignedCount} goals fully aligned · CSM: <b>{csmName}</b>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {onUnlock && (
            <button
              type="button"
              onClick={onUnlock}
              title="Admin-only — revert CS Handoff back to Stage 1"
              className="px-2.5 py-1.5 rounded-[8px] text-[12px] font-semibold border bg-white text-text-secondary"
              style={{ borderColor: C.CB }}
            >
              🔓 Unlock
            </button>
          )}
          <button
            type="button"
            onClick={onGoToSM}
            className="px-3 py-1.5 rounded-[8px] text-[12px] font-semibold border bg-white"
            style={{ borderColor: C.GREEN, color: "#146a45" }}
          >
            Go to Success Management →
          </button>
        </div>
      </div>
      <NextStepsPanel alignedCount={alignedCount} accountId={accountId} />
    </>
  );
}

function NextStepsPanel({ alignedCount, accountId }: { alignedCount: number; accountId: string }) {
  void accountId;
  return (
    <div
      className="rounded-[12px] border-[1.5px] p-4 mb-3"
      style={{
        background: "linear-gradient(135deg,#f3f0ff,#ede6ff)",
        borderColor: `${C.BLUE}30`,
      }}
    >
      <div className="text-[13px] font-bold mb-2.5 inline-flex items-center gap-2" style={{ color: C.BLUE }}>
        <span>🎯</span> What happens next in Success Management
      </div>
      {[
        { n: 1, body: (<><b>{alignedCount} aligned goals</b> become the tracked list in the VDD sub-tab. Phase A/B/C answers seed each goal's measurement plan.</>) },
        { n: 2, body: (<><b>Kickoff call</b> scheduled by CSM within 7 days. Power users notified for onboarding.</>) },
        { n: 3, body: (<><b>First Checkpoint</b> at 45 days. Phase B groundwork + Phase C timeline drive the cadence.</>) },
        { n: 4, body: (<><b>Value Tracking</b> opens — Phase C measurement method becomes the rubric. ROI rollup feeds the parent Success Metric.</>) },
        { n: 5, body: (<><b>VDD generated</b> at 6-month mark for executive review with SPOC + Budget Owner.</>) },
      ].map(({ n, body }, i, arr) => (
        <div
          key={n}
          className={cn(
            "flex gap-2.5 items-start py-2",
            i < arr.length - 1 && "border-b border-dashed",
          )}
          style={{ borderColor: "#d0c5f5" }}
        >
          <div
            className="w-[22px] h-[22px] rounded-full text-white text-[10px] font-extrabold flex items-center justify-center flex-shrink-0"
            style={{ background: C.BLUE }}
          >
            {n}
          </div>
          <div className="flex-1 text-[12px] text-text-primary leading-[1.5]">{body}</div>
        </div>
      ))}
    </div>
  );
}

function RealignBanner({
  realignment,
  onEdit,
  onResolve,
  onCancel,
}: {
  realignment: NonNullable<CSHandoffState["realignment"]>;
  onEdit: () => void;
  onResolve: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="rounded-[12px] border-[1.5px] p-3.5 mb-3 flex items-start gap-3.5"
      style={{ background: "linear-gradient(135deg,#fff8eb,#fef0c0)", borderColor: C.AMBER }}
    >
      <span className="text-[24px] flex-shrink-0">📤</span>
      <div className="flex-1 min-w-0">
        <div
          className="text-[13px] font-bold flex items-center gap-1.5 flex-wrap"
          style={{ color: "#854F0B" }}
        >
          Re-alignment pending · <b>{realignment.block}</b> block sent back to <b>{realignment.sent_to}</b>
          <button
            type="button"
            onClick={onEdit}
            className="text-[9px] px-1.5 py-0.5 rounded-[6px] border bg-white text-text-secondary"
            style={{ borderColor: C.CB }}
          >
            ✎ Edit
          </button>
        </div>
        <div className="text-[11px] mt-1 leading-[1.5]" style={{ color: "#854F0B" }}>
          "{realignment.note}"
        </div>
        <div className="text-[10px] text-text-muted mt-1.5">
          Sent {fd(realignment.sent_at)} · CS Handoff paused. Will resume when {realignment.sent_to} re-locks upstream.
        </div>
      </div>
      <div className="flex flex-col gap-1.5 flex-shrink-0">
        <button
          type="button"
          onClick={onResolve}
          className="px-2.5 py-1 rounded-[6px] text-[11px] font-semibold"
          style={{ background: "#ede6ff", color: C.BLUE, border: "1px solid #c9b5ff" }}
        >
          Mark resolved ✓
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-2.5 py-1 rounded-[6px] text-[11px] font-semibold border bg-white text-text-secondary"
          style={{ borderColor: C.CB }}
        >
          Cancel re-align
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Final actions — Ready check + Start Success Journey + Re-align CTA
// ─────────────────────────────────────────────────────────────
function FinalActions({
  account,
  form,
  contactsItems,
  realigning,
  onStart,
  onOpenRealign,
}: {
  account: ReturnType<typeof useAccountFromLayout>;
  form: CSOnboarding;
  contactsItems: ContactRow[];
  realigning: boolean;
  onStart: () => void;
  onOpenRealign: () => void;
}) {
  const spoc = contactsItems.find((c) => c.is_spoc);
  const budgetOwner = contactsItems.find(
    (c) => !c.is_spoc && (c.is_sponsor || c.decision_power === "executive_sponsor"),
  );
  const powerUsers = contactsItems.filter(
    (c) => !c.is_spoc && !c.is_sponsor && c.decision_power !== "executive_sponsor",
  );
  // 05-Jun bug 212 — Goal-related checks ("All goals aligned" + "≥1
  // goal accepted, none flagged") removed from the Ready-to-Start
  // checklist. Goal Validation lives in Success Management; CS
  // Hand-off no longer gates the journey start on goal alignment.
  // `goals` + `realigning` are kept in scope because realigning is
  // still used as a blocker, and BlockCommitment + other downstream
  // sections reference goals.length.
  const checks: Array<[string, boolean]> = [
    ["Entry type selected", !!form.cs_entry_type],
    ["Commercial audited", account.gate_signed],
    ["SPOC assigned", !!spoc],
    ["Budget Owner assigned", !!budgetOwner],
    ["Power users listed", powerUsers.length > 0],
    ["Kickoff date set", !!account.gate_signed_date],
  ];
  const allOk = checks.every(([, ok]) => ok);
  const blockedReason = realigning
    ? "Re-alignment in flight"
    : !allOk
      ? "Complete the checks below"
      : "";

  return (
    <Card>
      <div className="text-[13px] font-bold mb-2.5 inline-flex items-center gap-2">
        🎯 Ready to start Success Journey?
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mb-3.5">
        {checks.map(([label, ok]) => (
          <div
            key={label}
            className="flex items-center gap-1.5 px-2 py-1 rounded-[6px] text-[11px]"
            style={{
              background: ok ? "#f0fdf4" : "#fff0f2",
              color: ok ? "#2fb87a" : "#e63950",
            }}
          >
            <span>{ok ? "✓" : "✗"}</span>
            {label}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_220px] gap-2.5">
        <button
          type="button"
          disabled={!allOk || realigning}
          onClick={onStart}
          className="px-4 py-3.5 rounded-[12px] text-white text-left flex items-center gap-3.5 disabled:opacity-40 disabled:cursor-not-allowed transition"
          style={{
            background: !allOk || realigning
              ? "linear-gradient(135deg,#94a3b8,#64748b)"
              : `linear-gradient(135deg,${C.GREEN},#2fa07a)`,
          }}
        >
          <span className="text-[22px]">🚀</span>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-bold">Start Success Journey</div>
            <div className="text-[11px] opacity-90 leading-[1.4]">
              {allOk && !realigning
                ? "Lock CS Handoff and activate Success Management."
                : blockedReason}
            </div>
          </div>
          <span className="text-[18px]">→</span>
        </button>
        <button
          type="button"
          disabled={realigning}
          onClick={onOpenRealign}
          className="px-4 py-3.5 rounded-[12px] bg-white border-[1.5px] flex items-center gap-2.5 disabled:opacity-40 disabled:cursor-not-allowed text-left"
          style={{ borderColor: C.AMBER, color: "#d88520" }}
        >
          <span className="text-[20px]">↩</span>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-bold">Re-align</div>
            <div className="text-[10px] text-text-muted">Send a block back upstream</div>
          </div>
        </button>
      </div>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────
// Re-align modal
// ─────────────────────────────────────────────────────────────
function RealignModal({
  open,
  initialBlock,
  initialNote,
  editMode,
  onClose,
  onSubmit,
}: {
  open: boolean;
  initialBlock: "Commercial" | "Client" | "Commitment" | null;
  initialNote: string;
  editMode: boolean;
  onClose: () => void;
  onSubmit: (block: "Commercial" | "Client" | "Commitment", note: string) => void;
}) {
  const [block, setBlock] = useState<"Commercial" | "Client" | "Commitment" | null>(initialBlock);
  const [note, setNote] = useState(initialNote);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (open) {
      setBlock(initialBlock);
      setNote(initialNote);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open, initialBlock, initialNote]);

  if (!open) return null;
  const blocks: Array<{ id: "Commercial" | "Client" | "Commitment"; owner: string; col: string; desc: string }> = [
    { id: "Commercial", owner: "Contract Ops", col: C.AMBER, desc: "Contract dates, ACV/TCV, modules, per-module configs, billing, payment terms, geography." },
    { id: "Client", owner: "Sales", col: C.PURPLE, desc: "SPOC, Budget Owner/COE, Power Users list." },
    { id: "Commitment", owner: "Sales", col: C.PURPLE, desc: "Client priorities, success metric, kickoff date." },
  ];
  const canSubmit = !!block && note.trim().length > 5;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/45 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-[16px] p-5 w-full max-w-[540px] max-h-[88vh] overflow-y-auto">
        <div className="text-[16px] font-bold mb-1.5">
          {editMode ? "Edit re-alignment" : "Re-align upstream block"}
        </div>
        <div className="text-[12px] text-text-muted mb-4 leading-[1.6]">
          {editMode
            ? "Update the block or note. The upstream owner will see the latest version."
            : "Pick the block that needs attention and add a note. The upstream owner will be notified and the block unlocks for re-edit. CS Handoff pauses until they re-lock."}
        </div>
        <div className="text-[10px] font-bold uppercase text-text-muted mb-1 tracking-wider">Which block?</div>
        {blocks.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => setBlock(b.id)}
            className={cn(
              "w-full px-3.5 py-2.5 rounded-[10px] border-[1.5px] mb-1.5 flex items-start gap-2.5 text-left transition",
              block === b.id ? "border-beroe-blue bg-[#fafbff]" : "border-beroe-card-border hover:bg-beroe-bg/40",
            )}
          >
            <div
              className="w-4 h-4 rounded-full border-[2px] mt-0.5 flex-shrink-0 relative"
              style={{ borderColor: block === b.id ? C.BLUE : C.CB }}
            >
              {block === b.id && (
                <div className="absolute inset-[3px] rounded-full" style={{ background: C.BLUE }} />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-bold">{b.id}</div>
              <div className="text-[10px] text-text-muted">{b.owner}</div>
              <div className="text-[11px] text-text-secondary mt-0.5">{b.desc}</div>
            </div>
            <span
              className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border"
              style={{ background: `${b.col}15`, color: b.col, borderColor: `${b.col}40` }}
            >
              {b.owner}
            </span>
          </button>
        ))}
        <div className="mt-3.5">
          <div className="text-[10px] font-bold uppercase text-text-muted mb-1 tracking-wider">Note for the upstream owner</div>
          <textarea
            ref={inputRef}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What's missing or wrong? Be specific — this becomes a notification + audit trail entry."
            className="w-full px-2.5 py-1.5 border rounded-[7px] text-[12px] min-h-[60px] resize-y leading-[1.55]"
            style={{ borderColor: C.CB }}
          />
        </div>
        <div className="flex gap-2 justify-end mt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-[8px] text-[12px] font-semibold border bg-white text-text-secondary"
            style={{ borderColor: C.CB }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => block && onSubmit(block, note.trim())}
            className="px-4 py-1.5 rounded-[8px] text-[12px] font-semibold text-white disabled:opacity-45 disabled:cursor-not-allowed"
            style={{ background: C.BLUE }}
          >
            {editMode ? "Update" : "Send back upstream →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Shared atoms
// ─────────────────────────────────────────────────────────────
function Card({
  children,
  leftBorderColor,
}: {
  children: React.ReactNode;
  leftBorderColor?: string;
}) {
  return (
    <div
      className="bg-white rounded-[14px] border border-beroe-card-border px-5 py-4 mb-3"
      style={leftBorderColor ? { borderLeft: `4px solid ${leftBorderColor}` } : undefined}
    >
      {children}
    </div>
  );
}
function SectionHead({
  n, color, title, teamLabel, teamColor, trailing,
}: {
  n: string;
  color: string;
  title: string;
  teamLabel?: string;
  teamColor?: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="text-[14px] font-bold mb-3 flex items-center gap-2 flex-wrap">
      <span
        className="w-[22px] h-[22px] rounded-[6px] text-white text-[10px] font-extrabold flex items-center justify-center flex-shrink-0"
        style={{ background: color }}
      >
        {n}
      </span>
      <span>{title}</span>
      {teamLabel && teamColor && (
        <span
          className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border"
          style={{ background: `${teamColor}15`, color: teamColor, borderColor: `${teamColor}40` }}
        >
          {teamLabel}
        </span>
      )}
      {trailing && <div className="ml-auto flex items-center">{trailing}</div>}
    </div>
  );
}
function GroupHead({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-bold text-text-muted mt-3.5 mb-2 uppercase tracking-wider">
      {children}
    </div>
  );
}
function RoGrid({ cols, children }: { cols: 2 | 3 | 4; children: React.ReactNode }) {
  return (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${cols},minmax(0,1fr))` }}
    >
      {children}
    </div>
  );
}
function RoTile({
  label, value, sub, valueColor,
}: { label: string; value: React.ReactNode; sub?: string; valueColor?: string }) {
  return (
    <div className="bg-beroe-bg/60 border border-beroe-card-border rounded-[8px] px-3 py-2">
      <div className="text-[9.5px] uppercase tracking-wider text-text-muted font-bold mb-0.5">{label}</div>
      <div className="text-[13px] font-bold" style={{ color: valueColor ?? C.NAVY }}>{value}</div>
      {sub && <div className="text-[10px] text-text-muted mt-0.5">{sub}</div>}
    </div>
  );
}
function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-[7px] px-2.5 py-2 text-[11px] italic"
      style={{ background: "#fffbf2", color: "#854F0B", borderLeft: `3px solid ${C.AMBER}` }}
    >
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Demo State Toggle (prototype line 132-141 ".mock-toggle")
//
// Fixed top-right widget that lets stakeholders flip between the three
// canonical states of the CS Handoff page during a demo, plus a
// bulk-align "Fast-fwd" + "Reset" for clean replays. The buttons mutate
// real backend state so the page reflects the change immediately.
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// Tab default export
// ─────────────────────────────────────────────────────────────
export default function CSOnboardingTab() {
  const account = useAccountFromLayout();
  const qc = useQueryClient();
  const confirmDlg = useConfirm();
  const notify = useNotify();
  const prompt = usePrompt();
  const { me } = useAuth();
  const isAdmin = me?.user.role === "admin";

  const { data, isLoading } = useQuery<CSOnboarding>({
    queryKey: ["cs-onboarding", account.id],
    queryFn: () => api.get<CSOnboarding>(`/api/v1/accounts/${account.id}/cs-onboarding`),
  });
  const contactsQ = useQuery<{ items: ContactRow[]; total: number }>({
    queryKey: ["contacts", account.id],
    queryFn: () => api.get(`/api/v1/accounts/${account.id}/contacts`),
    staleTime: 30_000,
  });
  const goalsQ = useQuery<{ items: CSGoal[] }>({
    queryKey: ["cs-goals", account.id, false],
    queryFn: () =>
      api.get(`/api/v1/accounts/${account.id}/cs-goals?include_deleted=false`),
    staleTime: 30_000,
  });

  const csmName = (account as { csm_full_name?: string | null }).csm_full_name ?? "CS lead";

  const patch = useMutation({
    mutationFn: (body: CSOnboardingUpdate) =>
      api.patch<CSOnboarding>(`/api/v1/accounts/${account.id}/cs-onboarding`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cs-onboarding", account.id] });
      qc.invalidateQueries({ queryKey: ["account", account.id] });
    },
    onError: (e: ApiError) =>
      notify({ title: "Save failed", body: e.message, tone: "error" }),
  });

  // Auto-default entry: signed → A, else → B (one-shot)
  useEffect(() => {
    if (!data || data.cs_entry_type || !data.is_editable || patch.isPending) return;
    patch.mutate({ cs_entry_type: account.gate_signed ? "A" : "B" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, account.gate_signed]);

  const [realignModalOpen, setRealignModalOpen] = useState(false);
  const [editingRealign, setEditingRealign] = useState(false);

  if (isLoading || !data) {
    return (
      <div className="text-[12px] text-text-muted">Loading CS Handoff…</div>
    );
  }

  const handoff = (data.cs_handoff ?? {}) as CSHandoffState;
  const journeyStarted = !!handoff.started;
  const realignment = handoff.realignment ?? null;
  const goals = goalsQ.data?.items ?? [];
  const contacts = contactsQ.data?.items ?? [];
  const alignedCount = goals.filter(
    (g) => goalAlignment(g).status === "aligned" && g.validation_status !== "removed",
  ).length;

  async function startJourney() {
    const ok = await confirmDlg({
      title: "Start Success Journey?",
      body: "Lock CS Handoff and activate Success Management. The aligned goals become the tracked list.",
      confirmLabel: "Start journey",
      tone: "success",
    });
    if (!ok) return;
    patch.mutate({
      cs_handoff: {
        ...handoff,
        started: true,
        started_at: new Date().toISOString(),
      },
    });
  }

  async function unlockJourney() {
    const reason = await prompt({
      title: "Unlock CS Handoff?",
      body:
        "This reverts the account back to Stage 1 (pre-journey). " +
        "Aligned goals stay intact; Success Management remains active " +
        "but CS Handoff becomes editable again. Capture WHY — this " +
        "becomes a permanent audit entry.",
      placeholder: "Why are you walking back the journey? (≥10 chars)",
      minLength: 10,
      maxLength: 2000,
      multiline: true,
      confirmLabel: "Unlock CS Handoff",
      tone: "warning",
    });
    if (!reason) return;
    try {
      await api.post<CSOnboarding>(
        `/api/v1/accounts/${account.id}/cs-onboarding/unlock`,
        { reason },
      );
      await invalidateUpstream();
      notify({
        title: "CS Handoff unlocked",
        body: "Account reverted to Stage 1. Re-start Success Journey when ready.",
        tone: "info",
      });
    } catch (e) {
      const err = e as ApiError;
      notify({
        title: "Unlock failed",
        body: err.message,
        tone: "error",
      });
    }
  }

  async function invalidateUpstream() {
    // The cascade unlock on the backend flips sh_locked_at + gate_unlocked.
    // Invalidate every cache key that gates Sales Handoff / Signing /
    // Solutioning edit affordances so the upstream tabs pick up the new
    // editable state without a manual reload.
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["cs-onboarding", account.id] }),
      qc.invalidateQueries({ queryKey: ["account", account.id] }),
      qc.invalidateQueries({ queryKey: ["signing-gate", account.id] }),
      qc.invalidateQueries({ queryKey: ["solutioning", account.id] }),
    ]);
  }

  function submitRealign(block: "Commercial" | "Client" | "Commitment", note: string) {
    api
      .post<CSOnboarding>(
        `/api/v1/accounts/${account.id}/cs-onboarding/realign`,
        { block, note },
      )
      .then(invalidateUpstream)
      .catch((e: ApiError) =>
        notify({ title: "Re-align failed", body: e.message, tone: "error" }),
      );
    setRealignModalOpen(false);
    setEditingRealign(false);
  }

  async function clearRealign(mode: "resolved" | "cancelled") {
    try {
      await api.post<CSOnboarding>(
        `/api/v1/accounts/${account.id}/cs-onboarding/realign/clear`,
        { mode },
      );
      await invalidateUpstream();
    } catch (e) {
      const err = e as ApiError;
      notify({
        title: mode === "resolved" ? "Resolve failed" : "Cancel failed",
        body: err.message,
        tone: "error",
      });
    }
  }

  async function resolveRealign() {
    clearRealign("resolved");
  }

  async function cancelRealign() {
    const ok = await confirmDlg({
      title: "Cancel this re-alignment?",
      body: "CS Handoff will resume. Sales Handoff and Signing stay unlocked — upstream owners will re-lock through their normal flows.",
      confirmLabel: "Cancel re-align",
      danger: true,
    });
    if (ok) clearRealign("cancelled");
  }

  return (
    <div>
      {/* 11-Jun · Removed the fixed top-right DemoStateToggle widget
          per stakeholder ask — it was prototype-only mock UX. The
          underlying function is dropped below. */}
      <StageIndicator
        account={account}
        csmName={csmName}
        journeyStarted={journeyStarted}
      />
      {journeyStarted && handoff.started_at && (
        <SuccessBanner
          startedAt={handoff.started_at}
          csmName={csmName}
          alignedCount={alignedCount}
          accountId={account.id}
          onGoToSM={() =>
            notify({
              title: "Go to Success Management",
              body: "Use the top-level Success Management tab from the account header.",
              tone: "info",
            })
          }
          onUnlock={isAdmin ? unlockJourney : undefined}
        />
      )}
      {realignment && (
        <RealignBanner
          realignment={realignment}
          onEdit={() => {
            setEditingRealign(true);
            setRealignModalOpen(true);
          }}
          onResolve={resolveRealign}
          onCancel={cancelRealign}
        />
      )}

      <BlockEntry
        form={data}
        locked={journeyStarted}
        onChange={(t) => patch.mutate({ cs_entry_type: t })}
      />
      {data.cs_entry_type === "A" && (
        <HandoverQualityCheckBlock
          checklist={data.cs_handover_checklist}
          locked={journeyStarted}
          editable={data.is_editable}
          onToggle={(key, val) =>
            patch.mutate({ cs_handover_checklist: { [key]: val } })
          }
        />
      )}
      <BlockCommercial account={account} />
      <BlockClient accountId={account.id} />
      <BlockCommitment
        account={account}
        accountId={account.id}
        goalsCount={goals.length}
      />
      {/* 05-Jun bug 212 — Goal Validation & Alignment shortcut removed.
          The full block lives in Success Management → Contract & Goals
          (sm/GoalAlignmentTab + sm/ContractGoalsTab). Stakeholder ask:
          'totally removed from CS Hand-off and come directly in Success
          Management - Contract and goals'. */}

      {!journeyStarted && (
        <FinalActions
          account={account}
          form={data}
          contactsItems={contacts}
          realigning={!!realignment}
          onStart={startJourney}
          onOpenRealign={() => {
            setEditingRealign(false);
            setRealignModalOpen(true);
          }}
        />
      )}

      <RealignModal
        open={realignModalOpen}
        initialBlock={editingRealign && realignment ? realignment.block : null}
        initialNote={editingRealign && realignment ? realignment.note : ""}
        editMode={editingRealign}
        onClose={() => {
          setRealignModalOpen(false);
          setEditingRealign(false);
        }}
        onSubmit={submitRealign}
      />
    </div>
  );
}
