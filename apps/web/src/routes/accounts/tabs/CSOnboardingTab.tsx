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

import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useConfirm, useNotify } from "@/components/DialogProvider";
import { useAccountFromLayout } from "../AccountProfileLayout";
import type {
  CSEntryType,
  CSHandoffState,
  CSOnboarding,
  CSOnboardingUpdate,
} from "@/types/cs_onboarding";
import type {
  CSGoal,
  CSGoalCategory,
  CSGoalUpdate,
} from "@/types/cs_goal";

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

// ─────────────────────────────────────────────────────────────
// Per-category Phase A question + options (prototype lines 305-322).
// ─────────────────────────────────────────────────────────────
function phaseAQuestion(category: CSGoalCategory): string {
  switch (category) {
    case "cost_savings":
      return "What baseline spend are we measuring savings against? Has the client confirmed the start point?";
    case "risk_mitigation":
      return "What type of risk is in scope?";
    case "base_rationalization":
      return "Does the client know their current supplier count per category?";
    case "adoption":
      return "What does 'active usage' mean — logins, depth, or both?";
    default:
      return "What does success look like for this goal?";
  }
}
function phaseAOptions(category: CSGoalCategory): string[] {
  switch (category) {
    case "cost_savings":
      return ["Confirmed with baseline", "Partial — baseline pending", "Not confirmed"];
    case "risk_mitigation":
      return ["Regulatory (EUDR / CSDDD)", "Supply disruption", "Geopolitical", "Financial", "All of the above"];
    case "base_rationalization":
      return ["Known per category", "Known at total", "Partial", "Not known"];
    case "adoption":
      return ["Active users / month", "Module-depth score", "Both"];
    default:
      return ["Confirmed", "Partial", "Unclear"];
  }
}
const PHASE_B_OPTIONS: Array<[string, string]> = [
  ["done_current", "✅ Done & current"],
  ["done_outdated", "⚠️ Done but outdated"],
  ["not_done", "❌ Not done"],
  ["unknown", "❓ Don't know"],
];

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
      <SectionHead n="1" color={C.BLUE} title="CS Onboarding Entry" teamLabel="CS" teamColor={C.BLUE} />
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

// ─────────────────────────────────────────────────────────────
// Block 5 — Goal Alignment & Validation
// ─────────────────────────────────────────────────────────────
function BlockGoals({
  accountId,
  locked,
}: {
  accountId: string;
  locked: boolean;
}) {
  const qc = useQueryClient();
  const { data } = useQuery<{ items: CSGoal[] }>({
    queryKey: ["cs-goals", accountId, false],
    queryFn: () =>
      api.get(`/api/v1/accounts/${accountId}/cs-goals?include_deleted=false`),
    staleTime: 30_000,
  });
  const goals = useMemo(() => data?.items ?? [], [data]);
  const counts = useMemo(() => {
    const c = { aligned: 0, in_progress: 0, not_started: 0, accepted: 0, flagged: 0, removed: 0 };
    for (const g of goals) {
      const al = goalAlignment(g);
      c[al.status]++;
      if (g.validation_status === "accepted") c.accepted++;
      if (g.validation_status === "flagged") c.flagged++;
      if (g.validation_status === "removed") c.removed++;
    }
    return c;
  }, [goals]);
  const allAligned = goals.every(
    (g) => goalAlignment(g).status === "aligned" || g.validation_status === "removed",
  );
  const validated = allAligned && counts.accepted > 0 && counts.flagged === 0;

  if (goals.length === 0) {
    return (
      <Card leftBorderColor={C.BLUE}>
        <SectionHead n="5" color={C.BLUE} title="Goal Alignment & Validation" teamLabel="CS" teamColor={C.BLUE} />
        <EmptyHint>
          No goals captured yet. <Link to={`/accounts/${accountId}/success-management/contract-goals`} className="text-beroe-blue font-semibold hover:underline">Manage Goals →</Link>
        </EmptyHint>
      </Card>
    );
  }

  return (
    <Card leftBorderColor={validated ? C.GREEN : C.BLUE}>
      <SectionHead
        n="5"
        color={validated ? C.GREEN : C.BLUE}
        title="Goal Alignment & Validation"
        teamLabel="CS"
        teamColor={C.BLUE}
        trailing={
          <div className="ml-auto flex gap-1.5 flex-wrap text-[10px]">
            <Pill bg="#d4f5e5" color="#146a45">{counts.aligned} aligned</Pill>
            {counts.in_progress > 0 && <Pill bg="#ede6ff" color="#3800CC">{counts.in_progress} in-progress</Pill>}
            {counts.not_started > 0 && <Pill bg="#f1f5f9" color="#64748b">{counts.not_started} not started</Pill>}
            {counts.flagged > 0 && <Pill bg="#fef0c0" color="#8a4510">{counts.flagged} flagged</Pill>}
            {counts.removed > 0 && <Pill bg="#f1f5f9" color="#64748b">{counts.removed} removed</Pill>}
          </div>
        }
      />
      <div
        className="rounded-[9px] border px-3.5 py-2.5 mb-3 text-[11px] leading-[1.65]"
        style={{
          background: validated ? "#f0fdf4" : "#f3f0ff",
          borderColor: validated ? `${C.GREEN}40` : "#d0c5f5",
          color: validated ? "#146a45" : "#2d1870",
        }}
      >
        {validated ? (
          <>
            <b>✓ All goals aligned and accepted.</b> {counts.aligned} goals will be tracked.
            Phase A/B/C answers will seed each goal's measurement plan in VDD.
          </>
        ) : (
          <>
            <b>Each goal needs 3-phase alignment before acceptance.</b>{" "}
            <span style={{ color: C.BLUE }}><b>Phase A · Intent</b></span> — clarify what the goal means concretely.{" "}
            <span style={{ color: C.BLUE }}><b>Phase B · Groundwork</b></span> — check baseline data, access, cadence.{" "}
            <span style={{ color: C.BLUE }}><b>Phase C · Agreement</b></span> — pin down the number, measurement method, timeline. Only then can the goal be Accepted.
          </>
        )}
      </div>
      <div>
        {goals.map((g, i) => (
          <GoalCard
            key={g.id}
            g={g}
            index={i}
            locked={locked}
            onMutate={() =>
              qc.invalidateQueries({ queryKey: ["cs-goals", accountId, false] })
            }
          />
        ))}
      </div>
    </Card>
  );
}

function categoryPillFor(cat: CSGoalCategory) {
  const map: Record<CSGoalCategory, { bg: string; color: string; label: string }> = {
    cost_savings: { bg: "#ede6ff", color: "#3800CC", label: "Cost Savings" },
    risk_mitigation: { bg: "#ffe0e5", color: "#c42040", label: "Risk Mitigation" },
    base_rationalization: { bg: "#fef0c0", color: "#8a4510", label: "Base Rationalization" },
    adoption: { bg: "#d4f5e5", color: "#146a45", label: "Adoption" },
    other: { bg: "#f1f5f9", color: "#64748b", label: "Other" },
  };
  return map[cat];
}

function GoalCard({
  g,
  index,
  locked,
  onMutate,
}: {
  g: CSGoal;
  index: number;
  locked: boolean;
  onMutate: () => void;
}) {
  const al = goalAlignment(g);
  const confirmDlg = useConfirm();
  const notify = useNotify();
  const [openP, setOpenP] = useState<"A" | "B" | "C" | null>(null);
  const [flagDraft, setFlagDraft] = useState<string>(g.flag_note ?? "");

  const patch = useMutation({
    mutationFn: (body: CSGoalUpdate) =>
      api.patch<CSGoal>(`/api/v1/cs-goals/${g.id}`, body),
    onSuccess: onMutate,
    onError: (e: ApiError) =>
      notify({ title: "Save failed", body: e.message, tone: "error" }),
  });

  const cardClass = (() => {
    if (g.validation_status === "removed")
      return { bg: "#f8f9fc", border: "var(--cb)", style: "opacity-55 border-dashed" };
    if (g.validation_status === "flagged")
      return { bg: "#fff8eb", border: C.AMBER, style: "" };
    if (al.status === "aligned")
      return { bg: "#f0fdf4", border: C.GREEN, style: "" };
    if (al.status === "in_progress")
      return { bg: "#fafbff", border: C.BLUE, style: "" };
    return { bg: "#fff", border: C.CB, style: "" };
  })();

  async function acceptGoal() {
    if (al.status !== "aligned") {
      notify({ title: "Complete all 3 phases first", tone: "warning" });
      return;
    }
    patch.mutate({
      validation_status: g.validation_status === "accepted" ? "pending" : "accepted",
      flag_note: null,
    });
  }
  async function flagGoal() {
    if (g.validation_status === "flagged") {
      patch.mutate({ validation_status: "pending", flag_note: null });
      return;
    }
    // Need a flag note. Prompt via DialogProvider; min 5 chars enforced server-side.
    const note = window.prompt("Why is this flagged? (min 5 characters)");
    if (note && note.trim().length >= 5) {
      patch.mutate({ validation_status: "flagged", flag_note: note.trim() });
    }
  }
  async function removeGoal() {
    if (g.validation_status === "removed") {
      patch.mutate({ validation_status: "pending" });
      return;
    }
    const ok = await confirmDlg({
      title: `Remove "${g.title}" from the tracked list?`,
      body: "The goal stays in the system but won't be tracked in Success Management.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (ok) patch.mutate({ validation_status: "removed" });
  }

  const togglePhase = (p: "A" | "B" | "C") => setOpenP((cur) => (cur === p ? null : p));

  return (
    <div
      className={cn("rounded-[10px] border p-3.5 mb-2.5 transition", cardClass.style)}
      style={{ background: cardClass.bg, borderColor: cardClass.border, borderWidth: "1.5px" }}
    >
      <div className="flex gap-3 items-start mb-2.5">
        <div
          className="w-7 h-7 rounded-full text-[12px] font-extrabold flex items-center justify-center flex-shrink-0"
          style={{
            background: g.validation_status === "accepted" ? C.GREEN :
                        g.validation_status === "flagged"  ? C.AMBER :
                        g.validation_status === "removed"  ? "#cbd5e1" :
                        al.status === "aligned"            ? C.GREEN :
                        al.status === "in_progress"        ? C.BLUE :
                        `${C.BLUE}15`,
            color: g.validation_status === "removed" ? "#64748b" :
                   (g.validation_status === "accepted" || al.status === "aligned" || al.status === "in_progress" || g.validation_status === "flagged") ? "#fff" :
                   C.BLUE,
            border: `1.5px solid ${
              g.validation_status === "accepted" ? C.GREEN :
              g.validation_status === "flagged"  ? C.AMBER :
              g.validation_status === "removed"  ? "#cbd5e1" :
              al.status === "aligned"            ? C.GREEN :
              al.status === "in_progress"        ? C.BLUE :
              `${C.BLUE}40`
            }`,
          }}
        >
          {g.validation_status === "accepted" ? "✓" :
           g.validation_status === "flagged"  ? "🚩" :
           g.validation_status === "removed"  ? "✕" :
           (index + 1)}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex gap-2 items-center mb-1 flex-wrap">
            <span
              className={cn(
                "text-[13px] font-bold",
                g.validation_status === "removed" && "line-through",
              )}
              style={{ color: g.validation_status === "removed" ? C.T3 : C.NAVY }}
            >
              {g.title}
            </span>
            {(() => {
              const cp = categoryPillFor(g.category);
              return (
                <span
                  className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                  style={{ background: cp.bg, color: cp.color }}
                >
                  {cp.label}
                </span>
              );
            })()}
          </div>
          {g.target_value && (
            <div className="text-[11px] text-text-muted mb-0.5">
              Initial target:{" "}
              <b className="font-mono" style={{ color: C.BLUE }}>{g.target_value}</b>
            </div>
          )}
          {g.owner && (
            <div className="text-[11px] text-text-secondary leading-[1.5]">Owner: {g.owner}</div>
          )}
          {g.validation_status === "flagged" && g.flag_note && (
            <div
              className="px-2.5 py-1.5 rounded-r-[6px] text-[11px] mt-1.5"
              style={{ background: "#fff8eb", borderLeft: `3px solid ${C.AMBER}`, color: "#854F0B" }}
            >
              🚩 <b>Flag note:</b> {g.flag_note}
            </div>
          )}
          {g.validation_status === "flagged" && !g.flag_note && (
            <textarea
              className="mt-1.5 w-full text-[11px] px-2.5 py-1.5 border rounded-md min-h-[48px] resize-y"
              placeholder="Why is this flagged? (required, min 5 chars)"
              value={flagDraft}
              onChange={(e) => setFlagDraft(e.target.value)}
              onBlur={() => {
                if (flagDraft.trim().length >= 5)
                  patch.mutate({ flag_note: flagDraft.trim() });
              }}
            />
          )}
        </div>
        {!locked && g.is_editable && (
          <div className="flex flex-col gap-1 flex-shrink-0">
            <ActionBtn
              tone="accept"
              active={g.validation_status === "accepted"}
              disabled={al.status !== "aligned"}
              title={al.status !== "aligned" ? "Complete all 3 alignment phases first" : ""}
              onClick={acceptGoal}
            >
              ✓ Accept
            </ActionBtn>
            <ActionBtn
              tone="flag"
              active={g.validation_status === "flagged"}
              onClick={flagGoal}
            >
              🚩 Flag
            </ActionBtn>
            <ActionBtn
              tone="remove"
              active={g.validation_status === "removed"}
              onClick={removeGoal}
            >
              ✕ Remove
            </ActionBtn>
          </div>
        )}
      </div>

      {g.validation_status !== "removed" && (
        <div className="flex gap-1.5 mt-2 pt-2 border-t border-dashed border-beroe-card-border">
          {(["A", "B", "C"] as const).map((p) => {
            const done = al.phases[p];
            const open = openP === p;
            const prev = p === "A" ? true : p === "B" ? al.phases.A : al.phases.B;
            const dis = !prev && !done;
            const label = p === "A" ? "Intent" : p === "B" ? "Groundwork" : "Agreement";
            return (
              <button
                key={p}
                type="button"
                disabled={dis || locked}
                onClick={() => togglePhase(p)}
                className={cn(
                  "flex-1 px-2.5 py-1.5 rounded-[7px] border text-left text-[10.5px] font-semibold leading-[1.3] inline-flex items-center gap-1.5 transition",
                  open && !done && "shadow-sm",
                  dis && "opacity-55 cursor-not-allowed bg-beroe-bg",
                )}
                style={{
                  background: done ? (open ? "#dcfce7" : "#f0fdf4") :
                              open ? "#ede6ff" : "#fff",
                  borderColor: done ? C.GREEN : open ? C.BLUE : C.CB,
                  borderWidth: "1.5px",
                  color: done ? C.GREEN : open ? C.BLUE : C.T2,
                }}
              >
                <span
                  className="w-[18px] h-[18px] rounded-full inline-flex items-center justify-center text-[9px] font-extrabold flex-shrink-0"
                  style={{
                    background: done ? C.GREEN : open ? C.BLUE : "#e8eef8",
                    color: done || open ? "#fff" : C.T3,
                  }}
                >
                  {done ? "✓" : p}
                </span>
                <span><b>Phase {p}</b> · {label}{!done && dis && " (locked)"}</span>
              </button>
            );
          })}
        </div>
      )}

      {openP && g.validation_status !== "removed" && (
        <PhaseForm
          g={g}
          phase={openP}
          locked={locked || !g.is_editable}
          onClose={() => setOpenP(null)}
          onSaved={(next: "A" | "B" | "C" | null) => {
            setOpenP(next);
            onMutate();
          }}
        />
      )}
    </div>
  );
}

function ActionBtn({
  tone,
  active,
  disabled,
  onClick,
  title,
  children,
}: {
  tone: "accept" | "flag" | "remove";
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  const toneStyles = {
    accept: { hover: "hover:bg-[#f0fdf4] hover:border-[#6EC457] hover:text-beroe-green", active: { bg: C.GREEN, border: C.GREEN } },
    flag: { hover: "hover:bg-[#fff8eb] hover:border-[#F0BC41] hover:text-beroe-amber", active: { bg: C.AMBER, border: C.AMBER } },
    remove: { hover: "hover:bg-[#fff0f2] hover:border-[#CF4548] hover:text-beroe-red", active: { bg: C.RED, border: C.RED } },
  }[tone];
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        "px-2.5 py-1 rounded-[6px] text-[10px] font-semibold border bg-white text-text-secondary transition disabled:opacity-35 disabled:cursor-not-allowed whitespace-nowrap text-center",
        !disabled && !active && toneStyles.hover,
      )}
      style={active ? { background: toneStyles.active.bg, borderColor: toneStyles.active.border, color: "#fff" } : undefined}
    >
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// Phase form (A · Intent / B · Groundwork / C · Agreement)
// ─────────────────────────────────────────────────────────────
function PhaseForm({
  g,
  phase,
  locked,
  onClose,
  onSaved,
}: {
  g: CSGoal;
  phase: "A" | "B" | "C";
  locked: boolean;
  onClose: () => void;
  onSaved: (next: "A" | "B" | "C" | null) => void;
}) {
  const completedKey = (
    phase === "A" ? "phase_a_completed_at" :
    phase === "B" ? "phase_b_completed_at" :
    "phase_c_completed_at"
  ) as "phase_a_completed_at" | "phase_b_completed_at" | "phase_c_completed_at";
  const phaseKey = (
    phase === "A" ? "phase_a" :
    phase === "B" ? "phase_b" :
    "phase_c"
  ) as "phase_a" | "phase_b" | "phase_c";
  const completeFlagKey = (
    phase === "A" ? "phase_a_complete" :
    phase === "B" ? "phase_b_complete" :
    "phase_c_complete"
  ) as "phase_a_complete" | "phase_b_complete" | "phase_c_complete";
  const ph = (g[phaseKey] ?? {}) as Record<string, unknown>;
  const done = !!g[completedKey];

  const [intent, setIntent] = useState<string>((ph.intent as string) ?? "");
  const [note, setNote] = useState<string>((ph.note as string) ?? "");
  const [bsl, setBsl] = useState<string>((ph.baseline_current as string) ?? "");
  const [acc, setAcc] = useState<string>((ph.data_access as string) ?? "");
  const [cadence, setCadence] = useState<string>((ph.cadence as string) ?? "");
  const [catFocus, setCatFocus] = useState<string>((ph.category_focus as string) ?? "");
  const [baseline, setBaseline] = useState<string>((ph.baseline as string) ?? "");
  const [agreedTarget, setAgreedTarget] = useState<string>((ph.agreed_target as string) ?? "");
  const [measureMethod, setMeasureMethod] = useState<string>((ph.measure_method as string) ?? "");
  const [timeline, setTimeline] = useState<string>((ph.timeline as string) ?? "");

  const patch = useMutation({
    mutationFn: (body: CSGoalUpdate) =>
      api.patch<CSGoal>(`/api/v1/cs-goals/${g.id}`, body),
    onSuccess: () => {
      const next = phase === "A" ? "B" : phase === "B" ? "C" : null;
      onSaved(next);
    },
  });

  const reopenPatch = useMutation({
    mutationFn: () => {
      const body: CSGoalUpdate = {};
      (body as Record<string, unknown>)[completedKey] = null;
      const phaseBody: Record<string, unknown> = { ...ph };
      phaseBody[completeFlagKey] = false;
      (body as Record<string, unknown>)[phaseKey] = phaseBody;
      return api.patch<CSGoal>(`/api/v1/cs-goals/${g.id}`, body);
    },
    onSuccess: () => onSaved(phase),
  });

  const canComplete = (() => {
    if (locked) return false;
    if (phase === "A") return !!intent && note.trim().length > 10;
    if (phase === "B") return !!bsl && !!acc && cadence.trim().length > 0;
    return (
      catFocus.trim().length > 0 &&
      baseline.trim().length > 0 &&
      agreedTarget.trim().length > 0 &&
      measureMethod.trim().length > 0 &&
      timeline.trim().length > 0
    );
  })();

  function completePhase() {
    const phaseBody: Record<string, unknown> = { ...ph };
    if (phase === "A") {
      phaseBody.intent = intent;
      phaseBody.note = note.trim();
      phaseBody.phase_a_complete = true;
    } else if (phase === "B") {
      phaseBody.baseline_current = bsl;
      phaseBody.data_access = acc;
      phaseBody.cadence = cadence.trim();
      phaseBody.phase_b_complete = true;
    } else {
      phaseBody.category_focus = catFocus.trim();
      phaseBody.baseline = baseline.trim();
      phaseBody.agreed_target = agreedTarget.trim();
      phaseBody.measure_method = measureMethod.trim();
      phaseBody.timeline = timeline.trim();
      phaseBody.phase_c_complete = true;
    }
    const body: CSGoalUpdate = {};
    (body as Record<string, unknown>)[phaseKey] = phaseBody;
    (body as Record<string, unknown>)[completedKey] = new Date().toISOString();
    patch.mutate(body);
  }

  const headerColor = C.BLUE;
  const phaseLabel = phase === "A" ? "Validation of Intent" : phase === "B" ? "Groundwork Check" : "Agreement — the number, not the aspiration";

  return (
    <div
      className="mt-2.5 p-3.5 rounded-[9px] border"
      style={{ background: "#fafbfd", borderColor: C.CB }}
    >
      <div className="text-[11px] font-bold mb-2.5 uppercase tracking-wider inline-flex items-center gap-1.5" style={{ color: headerColor }}>
        <span
          className="w-[18px] h-[18px] rounded-full inline-flex items-center justify-center text-[9px] font-extrabold text-white"
          style={{ background: headerColor }}
        >
          {phase}
        </span>
        Phase {phase} · {phaseLabel}
        {done && (
          <span
            className="ml-auto text-[9px] px-1.5 py-0.5 rounded-full font-bold text-white"
            style={{ background: C.GREEN }}
          >
            ✓ Done
          </span>
        )}
      </div>

      {phase === "A" && (
        <>
          <Field label={phaseAQuestion(g.category)}>
            <select
              disabled={locked}
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              className="w-full px-2.5 py-1.5 border rounded-md text-[12px]"
              style={{ borderColor: C.CB }}
            >
              <option value="">--</option>
              {phaseAOptions(g.category).map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </Field>
          <Field label="What did you confirm with the client?">
            <textarea
              disabled={locked}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Jordan confirmed baseline = FY24 actuals across cocoa/wheat/sugar. Ana to use Beroe forecasts in upcoming renegotiations."
              className="w-full px-2.5 py-1.5 border rounded-md text-[12px] min-h-[60px] resize-y leading-[1.55]"
              style={{ borderColor: C.CB }}
            />
          </Field>
        </>
      )}

      {phase === "B" && (
        <>
          <Field label="Is the baseline / current-state data confirmed?">
            <select
              disabled={locked}
              value={bsl}
              onChange={(e) => setBsl(e.target.value)}
              className="w-full px-2.5 py-1.5 border rounded-md text-[12px]"
              style={{ borderColor: C.CB }}
            >
              <option value="">--</option>
              {PHASE_B_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Do we have access to the source-of-truth data?">
            <select
              disabled={locked}
              value={acc}
              onChange={(e) => setAcc(e.target.value)}
              className="w-full px-2.5 py-1.5 border rounded-md text-[12px]"
              style={{ borderColor: C.CB }}
            >
              <option value="">--</option>
              {PHASE_B_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field label="Is the reporting cadence agreed?">
            <input
              disabled={locked}
              value={cadence}
              onChange={(e) => setCadence(e.target.value)}
              placeholder="e.g. Monthly with Lisa, Quarterly with Procurement Council"
              className="w-full px-2.5 py-1.5 border rounded-md text-[12px]"
              style={{ borderColor: C.CB }}
            />
          </Field>
        </>
      )}

      {phase === "C" && (
        <>
          <Field label="Which specific categories?">
            <textarea
              disabled={locked}
              value={catFocus}
              onChange={(e) => setCatFocus(e.target.value)}
              placeholder="e.g. Flexible packaging — laminates, films, pouches across 8 plants"
              className="w-full px-2.5 py-1.5 border rounded-md text-[12px] min-h-[60px] resize-y"
              style={{ borderColor: C.CB }}
            />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <Field label="Current state (baseline)">
              <input
                disabled={locked}
                value={baseline}
                onChange={(e) => setBaseline(e.target.value)}
                placeholder="e.g. $13.3M annual spend, 32 suppliers"
                className="w-full px-2.5 py-1.5 border rounded-md text-[12px]"
                style={{ borderColor: C.CB }}
              />
            </Field>
            <Field label="Agreed target">
              <input
                disabled={locked}
                value={agreedTarget}
                onChange={(e) => setAgreedTarget(e.target.value)}
                placeholder="e.g. $2.4M savings (18% on $13.3M)"
                className="w-full px-2.5 py-1.5 border rounded-md text-[12px]"
                style={{ borderColor: C.CB }}
              />
            </Field>
          </div>
          <Field label="How will both parties confirm achievement?">
            <input
              disabled={locked}
              value={measureMethod}
              onChange={(e) => setMeasureMethod(e.target.value)}
              placeholder="e.g. Quarterly PO actuals vs Beroe benchmark, validated by Ana"
              className="w-full px-2.5 py-1.5 border rounded-md text-[12px]"
              style={{ borderColor: C.CB }}
            />
          </Field>
          <Field label="Timeline (target completion)">
            <input
              type="date"
              disabled={locked}
              value={timeline}
              onChange={(e) => setTimeline(e.target.value)}
              className="w-full px-2.5 py-1.5 border rounded-md text-[12px]"
              style={{ borderColor: C.CB }}
            />
          </Field>
        </>
      )}

      <div className="flex gap-1.5 mt-2">
        <button
          type="button"
          disabled={!canComplete || patch.isPending}
          onClick={completePhase}
          className="px-3.5 py-1 rounded-[6px] text-[11px] font-semibold text-white disabled:opacity-45 disabled:cursor-not-allowed"
          style={{ background: C.BLUE }}
        >
          {patch.isPending ? "Saving…" : done ? `Re-complete Phase ${phase}` : `Complete Phase ${phase} →`}
        </button>
        {done && (
          <button
            type="button"
            onClick={() => reopenPatch.mutate()}
            disabled={locked || reopenPatch.isPending}
            className="px-2.5 py-1 rounded-[6px] text-[11px] font-semibold border bg-white text-text-secondary"
            style={{ borderColor: C.CB }}
          >
            Re-open
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="px-2.5 py-1 rounded-[6px] text-[11px] font-semibold border bg-white text-text-secondary"
          style={{ borderColor: C.CB }}
        >
          Close
        </button>
      </div>
    </div>
  );
}

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
  startedAt, csmName, alignedCount, accountId, onGoToSM,
}: {
  startedAt: string;
  csmName: string;
  alignedCount: number;
  accountId: string;
  onGoToSM: () => void;
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
        <button
          type="button"
          onClick={onGoToSM}
          className="px-3 py-1.5 rounded-[8px] text-[12px] font-semibold border bg-white"
          style={{ borderColor: C.GREEN, color: "#146a45" }}
        >
          Go to Success Management →
        </button>
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
  goals,
  contactsItems,
  realigning,
  onStart,
  onOpenRealign,
}: {
  account: ReturnType<typeof useAccountFromLayout>;
  form: CSOnboarding;
  goals: CSGoal[];
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
  const allAligned = goals.every(
    (g) => goalAlignment(g).status === "aligned" || g.validation_status === "removed",
  );
  const accepted = goals.filter((g) => g.validation_status === "accepted").length;
  const flagged = goals.filter((g) => g.validation_status === "flagged").length;

  const checks: Array<[string, boolean]> = [
    ["Entry type selected", !!form.cs_entry_type],
    ["Commercial audited", account.gate_signed],
    ["SPOC assigned", !!spoc],
    ["Budget Owner assigned", !!budgetOwner],
    ["Power users listed", powerUsers.length > 0],
    ["Kickoff date set", !!account.gate_signed_date],
    ["All goals aligned (Phase A · B · C)", allAligned && goals.length > 0],
    ["≥1 goal accepted, none flagged", accepted > 0 && flagged === 0],
  ];
  const allOk = checks.every(([, ok]) => ok);
  const blockedReason = realigning
    ? "Re-alignment in flight"
    : !allOk
      ? flagged > 0
        ? `${flagged} goal${flagged > 1 ? "s" : ""} flagged — resolve or remove`
        : !allAligned
          ? "Complete Phase A · B · C on every goal"
          : accepted === 0
            ? "Accept at least one aligned goal"
            : "Complete the checks below"
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
                ? `Lock CS Handoff and activate Success Management. ${accepted} aligned goals will be tracked.`
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
function Pill({ bg, color, children }: { bg: string; color: string; children: React.ReactNode }) {
  return (
    <span
      className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold"
      style={{ background: bg, color }}
    >
      {children}
    </span>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2.5">
      <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-1">{label}</div>
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
function DemoStateToggle({
  accountId,
  goals,
  handoff,
  onMutate,
  notify,
}: {
  accountId: string;
  goals: CSGoal[];
  handoff: CSHandoffState;
  onMutate: () => void;
  notify: (o: { title: string; body?: string; tone?: "info" | "success" | "warning" | "error" }) => void;
}) {
  void accountId;
  const realigning = !!handoff.realignment;
  const started = !!handoff.started;
  const currentStage: 1 | 2 | 3 = started ? 3 : realigning ? 2 : 1;

  // Whole-document handoff replacement.
  const patchHandoff = useMutation({
    mutationFn: (next: CSHandoffState | null) =>
      api.patch<CSOnboarding>(
        `/api/v1/accounts/${accountId}/cs-onboarding`,
        { cs_handoff: next },
      ),
    onSuccess: onMutate,
    onError: (e: ApiError) =>
      notify({ title: "Demo patch failed", body: e.message, tone: "error" }),
  });

  // Bulk goal patcher (fast-fwd · align all). Runs Promise.allSettled
  // so one failure doesn't block the others.
  async function bulkAlignAllGoals(opts: { accept: boolean } = { accept: true }) {
    if (goals.length === 0) {
      notify({ title: "No goals to fast-forward", tone: "warning" });
      return;
    }
    const today = new Date().toISOString();
    const seed = (g: CSGoal) => {
      const phaseA = {
        ...(g.phase_a ?? {}),
        intent: phaseAOptions(g.category)[0],
        note:
          "Demo seed — client confirmed scope and target. Use as a starting point; replace in real run.",
        phase_a_complete: true,
      };
      const phaseB = {
        ...(g.phase_b ?? {}),
        baseline_current: "done_current",
        data_access: "done_current",
        cadence: "Monthly with the category lead",
        phase_b_complete: true,
      };
      const phaseC = {
        ...(g.phase_c ?? {}),
        category_focus: "Demo seed — replace with actual category scope",
        baseline: g.target_value || "Current baseline pending capture",
        agreed_target: g.target_value || "Target agreed at signing",
        measure_method: "Quarterly review against baseline",
        timeline:
          (g.target_date && /^\d{4}-\d{2}-\d{2}$/.test(g.target_date)
            ? g.target_date
            : new Date(Date.now() + 365 * 86400_000).toISOString().slice(0, 10)),
        phase_c_complete: true,
      };
      return {
        phase_a: phaseA,
        phase_b: phaseB,
        phase_c: phaseC,
        phase_a_completed_at: today,
        phase_b_completed_at: today,
        phase_c_completed_at: today,
        validation_status: opts.accept ? ("accepted" as const) : ("pending" as const),
        flag_note: null,
        alignment_status: "aligned" as const,
      };
    };
    const results = await Promise.allSettled(
      goals.map((g) => api.patch<CSGoal>(`/api/v1/cs-goals/${g.id}`, seed(g))),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) {
      notify({
        title: "Fast-fwd partial",
        body: `${goals.length - failed}/${goals.length} goals aligned.`,
        tone: "warning",
      });
    } else {
      notify({
        title: `Fast-fwd · ${goals.length} goal${goals.length === 1 ? "" : "s"} aligned`,
        tone: "success",
      });
    }
    onMutate();
  }

  // Reset every goal back to fresh state (no phase completions, no
  // validation status).
  async function bulkResetGoals() {
    if (goals.length === 0) return;
    await Promise.allSettled(
      goals.map((g) =>
        api.patch<CSGoal>(`/api/v1/cs-goals/${g.id}`, {
          phase_a: { ...(g.phase_a ?? {}), phase_a_complete: false },
          phase_b: { ...(g.phase_b ?? {}), phase_b_complete: false },
          phase_c: { ...(g.phase_c ?? {}), phase_c_complete: false },
          phase_a_completed_at: null,
          phase_b_completed_at: null,
          phase_c_completed_at: null,
          validation_status: "pending",
          flag_note: null,
          alignment_status: "not_started",
        }),
      ),
    );
    onMutate();
  }

  async function setStage(s: 1 | 2 | 3) {
    if (s === 1) {
      await bulkResetGoals();
      patchHandoff.mutate({});
      return;
    }
    if (s === 2) {
      // Sample realignment — picks the Client block by default.
      patchHandoff.mutate({
        realignment: {
          block: "Client",
          note:
            "SPOC is fine, but the Budget Owner slot should be confirmed — they haven't attended a QBR in 2 quarters. Need clarity on whether they're still the signer.",
          sent_at: new Date().toISOString(),
          sent_to: "Sales",
        },
        started: false,
        started_at: null,
      });
      return;
    }
    // s === 3
    await bulkAlignAllGoals({ accept: true });
    patchHandoff.mutate({
      ...handoff,
      realignment: null,
      started: true,
      started_at: new Date().toISOString(),
    });
  }

  const StageBtn = ({ n, label }: { n: 1 | 2 | 3; label: string }) => {
    const active = currentStage === n;
    return (
      <button
        type="button"
        onClick={() => setStage(n)}
        disabled={patchHandoff.isPending}
        className={cn(
          "px-2.5 py-1 rounded-[6px] text-[11px] font-semibold border transition disabled:opacity-50 disabled:cursor-wait",
          active
            ? "border-transparent text-white"
            : "border-white/15 text-white/85 hover:bg-white/10",
        )}
        style={active ? { background: C.BLUE, borderColor: C.BLUE } : { background: "rgba(255,255,255,0.10)" }}
      >
        {n}. {label}
      </button>
    );
  };

  return (
    <div
      className="fixed top-3.5 right-3.5 z-[90] rounded-[10px] px-3 py-2 flex flex-wrap gap-1.5 items-center shadow-lg max-w-[560px]"
      style={{ background: C.NAVY }}
    >
      <span
        className="text-[9px] font-bold uppercase tracking-wider mr-1"
        style={{ color: "#8496b0" }}
      >
        Demo State
      </span>
      <StageBtn n={1} label="Fresh review" />
      <StageBtn n={2} label="Re-alignment pending" />
      <StageBtn n={3} label="Success Journey started" />
      <button
        type="button"
        onClick={() => bulkAlignAllGoals({ accept: true })}
        disabled={patchHandoff.isPending}
        className="px-2.5 py-1 rounded-[6px] text-[11px] font-semibold text-white disabled:opacity-50"
        style={{ background: C.GREEN }}
      >
        Fast-fwd · align all
      </button>
      <button
        type="button"
        onClick={() => setStage(1)}
        disabled={patchHandoff.isPending}
        className="px-2.5 py-1 rounded-[6px] text-[11px] font-semibold text-white disabled:opacity-50"
        style={{ background: C.AMBER }}
      >
        Reset
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Tab default export
// ─────────────────────────────────────────────────────────────
export default function CSOnboardingTab() {
  const account = useAccountFromLayout();
  const qc = useQueryClient();
  const confirmDlg = useConfirm();
  const notify = useNotify();

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

  function submitRealign(block: "Commercial" | "Client" | "Commitment", note: string) {
    const sentTo = block === "Commercial" ? "Contract Ops" : "Sales";
    patch.mutate({
      cs_handoff: {
        ...handoff,
        realignment: {
          block,
          note,
          sent_at: realignment && editingRealign ? realignment.sent_at : new Date().toISOString(),
          sent_to: sentTo,
        },
      },
    });
    setRealignModalOpen(false);
    setEditingRealign(false);
  }

  async function resolveRealign() {
    patch.mutate({
      cs_handoff: { ...handoff, realignment: null },
    });
  }

  async function cancelRealign() {
    const ok = await confirmDlg({
      title: "Cancel this re-alignment?",
      body: "CS Handoff will resume.",
      confirmLabel: "Cancel re-align",
      danger: true,
    });
    if (ok) resolveRealign();
  }

  return (
    <div>
      <DemoStateToggle
        accountId={account.id}
        goals={goals}
        handoff={handoff}
        onMutate={() => {
          qc.invalidateQueries({ queryKey: ["cs-onboarding", account.id] });
          qc.invalidateQueries({ queryKey: ["cs-goals", account.id, false] });
          qc.invalidateQueries({ queryKey: ["account", account.id] });
        }}
        notify={notify}
      />
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
      <BlockCommercial account={account} />
      <BlockClient accountId={account.id} />
      <BlockCommitment
        account={account}
        accountId={account.id}
        goalsCount={goals.length}
      />
      <BlockGoals accountId={account.id} locked={journeyStarted} />

      {!journeyStarted && (
        <FinalActions
          account={account}
          form={data}
          goals={goals}
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
