// M18 — Success Management sub-layout.
//
// 28-May — literal port of prototype `bMetricsTab` (beroe_awb_v20.html
// line 2858-2937). Brings 4 things from the prototype:
//
//   1. Activation banner at top — green ✅ when contract is locked,
//      red ⚠️ otherwise (prototype line 2901-2911).
//   2. Stakeholder-map completeness warning — amber 👥 when any of
//      Budget Owner / Day-to-day Champion / Category Manager is
//      missing (prototype line 2913-2919).
//   3. 5 pill sub-tabs with prototype's exact icons + colours + per-tab
//      status badge (pg=✓ green / pa=• amber / pr=! red / pgr=• grey).
//      Active pill: bg #fff0f2 + border #CF454840 + text #CF4548.
//      Locked pill: greyed at opacity 0.4 with 🔒 badge (matches
//      prototype line 2926 — Checkpoints locks until contract locks;
//      Renewal locks until at least one checkpoint is signed off).
//   4. Tab order: VDD → Contract & Goals → Value Tracking →
//      Checkpoints → Delivery & Renewal (same as before).
//
// The layout fetches 5 lightweight queries to drive the activation
// banner + per-tab badges + stakeholder warning. Query keys match
// the leaf tabs so the cache is shared (no duplicate fetches).

import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAccountFromLayout } from "./AccountProfileLayout";
import type { CSOnboarding, Stakeholder } from "@/types/cs_onboarding";
import type { SuccessContract } from "@/types/success_contract";
import type { MetricListResponse } from "@/types/metric";
import type { Checkpoint } from "@/types/checkpoint";
import type { DeliveryRenewal } from "@/types/delivery_renewal";
import type { Vdd } from "@/types/vdd";

type BadgeKind = "pg" | "pa" | "pr" | "pgr";

interface SMSubTab {
  to: string;
  label: string;
  icon: string;
  badge: BadgeKind;
  locked: boolean;
  lockReason: string;
}

const PINK = "#CF4548";
const PINK_BG = "#fff0f2";
const PINK_BORDER = `${PINK}40`;

export default function SuccessManagementLayout() {
  const account = useAccountFromLayout();
  const navigate = useNavigate();
  const loc = useLocation();

  // /success-management (no sub) → redirect to VDD (first sub-tab,
  // matches prototype's openAcct default smSubTab:"contract" but our
  // app puts VDD first as the overview surface).
  const segs = loc.pathname.split("/").filter(Boolean);
  const lastSeg = segs[segs.length - 1];
  if (lastSeg === "success-management") {
    navigate(`./vdd`, { replace: true });
  }

  // Five lightweight queries for the activation banner + badges.
  // All are cached + shared with the leaf tabs via matching keys.
  const sc = useQuery<SuccessContract>({
    queryKey: ["success-contract", account.id],
    queryFn: () =>
      api.get<SuccessContract>(
        `/api/v1/accounts/${account.id}/success-contract`,
      ),
  });
  const metrics = useQuery<MetricListResponse>({
    queryKey: ["metrics", account.id],
    queryFn: () =>
      api.get<MetricListResponse>(
        `/api/v1/accounts/${account.id}/success-metrics`,
      ),
  });
  const vdd = useQuery<Vdd>({
    queryKey: ["vdd", account.id],
    queryFn: () =>
      api.get<Vdd>(`/api/v1/accounts/${account.id}/value-delivery-document`),
  });
  const checkpoints = useQuery<{ items: Checkpoint[] }>({
    queryKey: ["checkpoints", account.id],
    queryFn: () =>
      api.get<{ items: Checkpoint[] }>(
        `/api/v1/accounts/${account.id}/checkpoints`,
      ),
  });
  const dr = useQuery<DeliveryRenewal>({
    queryKey: ["delivery-renewal", account.id],
    queryFn: () =>
      api.get<DeliveryRenewal>(
        `/api/v1/accounts/${account.id}/delivery-renewal`,
      ),
  });
  const cso = useQuery<CSOnboarding>({
    queryKey: ["cs-onboarding", account.id],
    queryFn: () =>
      api.get<CSOnboarding>(
        `/api/v1/accounts/${account.id}/cs-onboarding`,
      ),
  });

  const goals = useQuery<{ items: Array<{ id: string }> }>({
    queryKey: ["cs-goals", account.id, false],
    queryFn: () =>
      api.get<{ items: Array<{ id: string }> }>(
        `/api/v1/accounts/${account.id}/cs-goals?include_deleted=false`,
      ),
  });

  // Activation gate (prototype line 2875).
  const entryReady =
    account.gate_signed ||
    (account.cs_entry_type === "B"); // we don't have cs_entry_b_context on AccountDetail; presence of Entry B itself is enough

  // Contract-locked state drives activation + Checkpoints lock.
  const scLocked = !!sc.data?.locked_at;
  const goalCount = goals.data?.items.length ?? 0;
  const isActivated = scLocked;

  // Days-left calc for the "Account Not Activated" banner — 30-day
  // window from gate_signed_date (prototype line 2867-2869).
  let scDaysLeft: number | null = null;
  let scOverdue = false;
  if (account.gate_signed_date && !scLocked) {
    const kickoff = new Date(account.gate_signed_date);
    const deadline = new Date(kickoff.getTime() + 30 * 86400_000);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    scDaysLeft = Math.ceil((deadline.getTime() - today.getTime()) / 86400_000);
    scOverdue = scDaysLeft < 0;
  }

  // Metric / checkpoint / readiness counts drive the per-tab badges.
  const metricList = metrics.data?.items ?? [];
  const metricTrackedCount = metricList.filter((m) => m.current_value).length;
  const cpList = checkpoints.data?.items ?? [];
  const cpSignedCount = cpList.filter((c) => c.status === "signed_off").length;
  const rrDone = dr.data?.readiness
    ? [
        dr.data.readiness.delivered_metric,
        dr.data.readiness.proof_data,
        dr.data.readiness.client_acknowledged,
      ].filter((q) => q?.answer === "yes").length
    : 0;
  // VDD has content if any of the 4 sections has at least one entry,
  // or there's an exec summary. Matches prototype line 2890.
  const vddFilled = !!(
    vdd.data &&
    (vdd.data.client_strategic_priorities.length > 0 ||
      vdd.data.agreed_success_metrics.length > 0 ||
      vdd.data.beroes_approach.length > 0 ||
      vdd.data.value_delivered.length > 0 ||
      vdd.data.exec_summary?.trim())
  );

  // Stakeholder-map completeness (prototype line 2914).
  const stk = cso.data?.cs_stakeholders ?? {};
  const stkMissing: string[] = [];
  if (!asStakeholder(stk.commercial)?.name?.trim())
    stkMissing.push("Budget Owner");
  if (!asStakeholder(stk.champion)?.name?.trim())
    stkMissing.push("Day-to-day Champion");
  if (!asStakeholder(stk.category)?.name?.trim())
    stkMissing.push("Category Manager");

  // Per-tab badge + lock state — prototype line 2891-2897 + 2923.
  const tabs: SMSubTab[] = [
    {
      to: "vdd",
      label: "VDD (Value Delivery Document)",
      icon: "📄",
      badge: vddFilled ? "pg" : "pgr",
      locked: false,
      lockReason: "",
    },
    {
      to: "contract-goals",
      label: "Contract & Goals",
      icon: "🔒",
      badge:
        scLocked && goalCount > 0
          ? "pg"
          : scLocked || goalCount > 0
            ? "pa"
            : scOverdue
              ? "pr"
              : "pgr",
      locked: false,
      lockReason: "",
    },
    {
      to: "value-tracking",
      label: "Value Tracking",
      icon: "📊",
      badge: metricTrackedCount > 0 ? "pg" : metricList.length > 0 ? "pa" : "pgr",
      locked: false,
      lockReason: "",
    },
    {
      to: "checkpoints",
      label: "Checkpoints",
      icon: "📅",
      badge: cpSignedCount > 0 ? "pg" : cpList.length > 0 ? "pa" : "pgr",
      locked: !scLocked,
      lockReason: "Complete the success contract first",
    },
    {
      to: "delivery-renewal",
      label: "Delivery & Renewal",
      icon: "🛡",
      badge: rrDone === 3 ? "pg" : rrDone > 0 ? "pa" : "pgr",
      locked: cpSignedCount === 0,
      lockReason: "Complete at least one checkpoint first",
    },
  ];

  // Activation gate — pre-Sales handoff state (prototype line 2876-2888).
  if (!entryReady) {
    return (
      <div className="text-center px-5 py-16">
        <div className="text-[40px] mb-3">🛠️</div>
        <div className="text-[18px] font-bold text-text-primary mb-2">
          CS Workflow Not Started
        </div>
        <div className="text-[13px] text-text-muted max-w-[440px] mx-auto leading-relaxed mb-5">
          This account needs either a <b>signed contract</b> (Entry A — clean
          handover from Sales) or a <b>mid-flight baseline</b> (Entry B — CSM
          uploads prior context) before Success Management can begin.
        </div>
        <div className="flex gap-2.5 justify-center flex-wrap">
          <button
            type="button"
            onClick={() =>
              navigate(`/accounts/${account.id}/account-kit/sales-handoff`)
            }
            className="text-[12px] px-5 py-2.5 rounded-lg bg-beroe-blue text-white font-semibold hover:bg-beroe-blue/90"
          >
            📝 Go to Sales Handoff
          </button>
          <button
            type="button"
            onClick={() =>
              navigate(`/accounts/${account.id}/account-kit/cs-onboarding`)
            }
            className="text-[12px] px-5 py-2.5 rounded-lg border border-beroe-card-border bg-white text-text-secondary font-semibold hover:bg-slate-50"
          >
            🔄 Start Entry B (Mid-Contract)
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Activation banner — prototype line 2901-2911 verbatim. */}
      {isActivated ? (
        <div
          className="rounded-card px-4 py-2.5 mb-3 flex items-center gap-2.5"
          style={{ background: "#f0fdf4", border: "1.5px solid #6EC45740" }}
        >
          <span className="text-[14px]">✅</span>
          <div
            className="text-[12px] font-semibold"
            style={{ color: "#6EC457" }}
          >
            Account Activated · Success contract locked{" "}
            {sc.data?.locked_at
              ? new Date(sc.data.locked_at).toLocaleDateString()
              : "—"}{" "}
            · {goalCount} goals · {metricTrackedCount}/{metricList.length}{" "}
            metrics tracked
          </div>
        </div>
      ) : (
        <div
          className="rounded-card px-4 py-3 mb-3 flex items-center gap-2.5"
          style={{ background: PINK_BG, border: `1.5px solid ${PINK_BORDER}` }}
        >
          <span className="text-[18px]">⚠️</span>
          <div className="flex-1">
            <div
              className="text-[13px] font-bold"
              style={{ color: "#CF4548" }}
            >
              Account Not Activated
            </div>
            <div
              className="text-[11px]"
              style={{ color: "#CF4548" }}
            >
              Lock the success contract and define at least one goal to
              activate.
              {scDaysLeft !== null && (
                <>
                  {" "}
                  {scOverdue ? (
                    <b>{Math.abs(scDaysLeft)}d overdue — Undefined Value.</b>
                  ) : (
                    <>{scDaysLeft}d remaining.</>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Stakeholder-map completeness warning — prototype line 2913-2919. */}
      {stkMissing.length > 0 && (
        <div
          className="rounded-card px-4 py-2.5 mb-2.5 flex items-center gap-2.5"
          style={{ background: "#fff8eb", border: "1.5px solid #F0BC4140" }}
        >
          <span className="text-[14px]">👥</span>
          <div
            className="flex-1 text-[12px]"
            style={{ color: "#F0BC41" }}
          >
            <b>Stakeholder map incomplete</b> — missing:{" "}
            {stkMissing.join(", ")}. All 3 roles required.
          </div>
          <button
            type="button"
            onClick={() =>
              navigate(`/accounts/${account.id}/account-kit/cs-onboarding`)
            }
            className="text-[10px] px-2.5 py-1 rounded border border-beroe-card-border bg-white text-text-secondary font-semibold hover:bg-slate-50 whitespace-nowrap"
          >
            Update in Account Kit →
          </button>
        </div>
      )}

      {/* Pill sub-tab strip — prototype line 2921-2929 verbatim. */}
      <div className="flex gap-1.5 mb-3.5 flex-wrap">
        {tabs.map((t) => (
          <SMSubTabPill key={t.to} t={t} />
        ))}
      </div>

      <Outlet context={{ account }} />
    </div>
  );
}

function SMSubTabPill({ t }: { t: SMSubTab }) {
  // Locked pills still render as buttons (not links) so they don't
  // navigate — matches the prototype's pointer-events:none. Clicking
  // a locked pill is a no-op + tooltip explains why.
  if (t.locked) {
    return (
      <button
        type="button"
        title={t.lockReason}
        className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg cursor-not-allowed text-[12px] font-medium"
        style={{
          border: "1.5px solid #e4eaf6",
          background: "#f8f9fc",
          color: "#c0c8d8",
          opacity: 0.45,
        }}
      >
        <span>{t.icon}</span>
        <span>{t.label}</span>
        <BadgePip kind="pgr" lockedBadge />
      </button>
    );
  }
  return (
    <NavLink
      to={t.to}
      end
      className={cn(
        "flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[12px] transition-colors",
      )}
      style={({ isActive }) => ({
        border: `1.5px solid ${isActive ? PINK_BORDER : "#e4eaf6"}`,
        background: isActive ? PINK_BG : "#fff",
        color: isActive ? PINK : "#4b5563",
        fontWeight: isActive ? 700 : 500,
      })}
    >
      <span>{t.icon}</span>
      <span>{t.label}</span>
      <BadgePip kind={t.badge} />
    </NavLink>
  );
}

/** Pip variants — prototype's `pill pg / pa / pr / pgr` classes,
 *  rendered as a tiny dot pill at the end of each tab label. */
function BadgePip({
  kind,
  lockedBadge,
}: {
  kind: BadgeKind;
  lockedBadge?: boolean;
}) {
  if (lockedBadge) {
    return (
      <span
        className="text-[8px] font-bold px-1.5 py-px rounded-full"
        style={{ background: "#e4eaf6", color: "#94a3b8" }}
      >
        🔒
      </span>
    );
  }
  const map: Record<BadgeKind, { bg: string; fg: string; ch: string }> = {
    pg: { bg: "#dcfce7", fg: "#166534", ch: "✓" },
    pa: { bg: "#fef3c7", fg: "#92400e", ch: "•" },
    pr: { bg: "#fee2e2", fg: "#991b1b", ch: "!" },
    pgr: { bg: "#e4eaf6", fg: "#94a3b8", ch: "•" },
  };
  const c = map[kind];
  return (
    <span
      className="text-[8px] font-bold px-1.5 py-px rounded-full"
      style={{ background: c.bg, color: c.fg }}
    >
      {c.ch}
    </span>
  );
}

/** Type-narrowing helper — cs_stakeholders is Record<string, Stakeholder>
 *  but we read it via dotted access on a partial dict. */
function asStakeholder(s: unknown): Stakeholder | null {
  return s && typeof s === "object" ? (s as Stakeholder) : null;
}
