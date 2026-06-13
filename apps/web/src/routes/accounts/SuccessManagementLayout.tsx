// 05-Jun — Success Management sub-layout REBUILT to the new 4-tab
// shape per beroe_sm_strategy_proto.html:
//
//   1. 🎯 Goal Validation and Alignment   (was: VDD + Contract & Goals)
//   2. 📊 Value Tracking                    (was: Value Tracking)
//   3. 📥 Business Review                   (was: Checkpoints)
//   4. 🛡 Renewal Readiness                 (was: Delivery & Renewal)
//
// The activation banner (locked / not-yet-locked Success Contract +
// stakeholder coverage warning) is kept verbatim from the previous
// implementation — only the sub-tab nav is reshaped.
//
// Legacy URLs (/vdd, /contract-goals, /checkpoints, /delivery-renewal)
// stay as redirects in App.tsx so old bookmarks land in the new tabs.

import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAccountFromLayout } from "./AccountProfileLayout";
import type { CSOnboarding, Stakeholder } from "@/types/cs_onboarding";
import type { SuccessContract } from "@/types/success_contract";
import type { MetricListResponse } from "@/types/metric";

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

  // /success-management (no sub) → redirect to Goal Alignment (first tab).
  const segs = loc.pathname.split("/").filter(Boolean);
  const idx = segs.indexOf("success-management");
  const cur = idx >= 0 && segs[idx + 1] ? segs[idx + 1] : "";

  // Activation gate — Sales handoff state (signed account OR Entry B).
  const cs = useQuery<CSOnboarding>({
    queryKey: ["cs-onboarding", account.id],
    queryFn: () =>
      api.get<CSOnboarding>(`/api/v1/accounts/${account.id}/cs-onboarding`),
  });
  const entryReady = !!cs.data?.activated;

  // Success Contract — drives the "Account Activated" banner.
  const sc = useQuery<SuccessContract>({
    queryKey: ["success-contract", account.id],
    queryFn: () =>
      api.get<SuccessContract>(
        `/api/v1/accounts/${account.id}/success-contract`,
      ),
  });
  const scLocked = !!sc.data?.locked_at;

  // Goals count — for the activation banner.
  const goals = useQuery<{ items: { id: string }[] }>({
    queryKey: ["cs-goals", account.id, false],
    queryFn: () =>
      api.get(`/api/v1/accounts/${account.id}/cs-goals?include_deleted=false`),
  });
  const goalCount = goals.data?.items.length ?? 0;

  // Metrics — for the "N/M metrics tracked" line in the activation banner.
  const metrics = useQuery<MetricListResponse>({
    queryKey: ["metrics", account.id],
    queryFn: () =>
      api.get<MetricListResponse>(`/api/v1/accounts/${account.id}/metrics`),
  });
  const metricList = metrics.data?.items ?? [];
  const metricTrackedCount = metricList.filter(
    (m) => m.current_value != null && m.current_value !== "",
  ).length;

  const isActivated = entryReady && scLocked;
  const scDaysLeft = sc.data?.locked_at ? null : 7;

  // Stakeholder coverage warning.
  const stk: Record<string, Stakeholder | undefined> = cs.data?.cs_stakeholders ?? {};
  const stkMissing = (
    ["commercial", "champion", "category"] as const
  ).filter((k) => !stk[k]?.name);

  // -----------------------------------------------------------
  // 05-Jun — new 4-tab structure per beroe_sm_strategy_proto.html
  // -----------------------------------------------------------
  const subTabs: SMSubTab[] = [
    {
      // 12-Jun bug 248 — Renamed per stakeholder ask: "Section to be
      // renamed as 'Success Metrics Validation and Alignment'". URL
      // path stays `/goal-alignment` for back-compat with bookmarks +
      // existing deep-links from Value Tracking.
      to: "goal-alignment",
      label: "Success Metrics Validation and Alignment",
      icon: "🎯",
      badge: entryReady ? (goalCount > 0 ? "pg" : "pa") : "pgr",
      locked: !entryReady,
      lockReason: "Account not yet activated — open Sales Hand-off or Entry B first.",
    },
    {
      to: "value-tracking",
      label: "Value Tracking",
      icon: "📊",
      badge: metricTrackedCount > 0 ? "pg" : metricList.length > 0 ? "pa" : "pgr",
      locked: !entryReady,
      lockReason: "Activate the account first.",
    },
    {
      to: "business-review",
      label: "Business Review",
      icon: "📥",
      badge: "pgr",
      locked: !entryReady,
      lockReason: "Activate the account first.",
    },
    {
      to: "renewal-readiness",
      label: "Renewal Readiness",
      icon: "🛡",
      badge: "pgr",
      locked: !entryReady,
      lockReason: "Activate the account first.",
    },
  ];

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
      {/* Activation banner — same logic as before, just under the new
          4-tab nav. */}
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
              style={{ color: PINK }}
            >
              Account Not Activated
            </div>
            <div className="text-[11px]" style={{ color: PINK }}>
              Lock the success contract and define at least one goal to
              activate.
              {scDaysLeft !== null && (
                <span className="ml-1 opacity-80">
                  ({scDaysLeft} days since signing — capture the contract now)
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Stakeholder coverage warning — only when something's missing. */}
      {stkMissing.length > 0 && (
        <div
          className="rounded-card px-4 py-2.5 mb-3 flex items-center gap-2.5"
          style={{ background: "#fff8eb", border: "1.5px solid #F0BC4140" }}
        >
          <span className="text-[14px]">👥</span>
          <div
            className="text-[12px] font-semibold"
            style={{ color: "#F0BC41" }}
          >
            Stakeholder map incomplete —{" "}
            {stkMissing
              .map((k) =>
                k === "commercial"
                  ? "Budget Owner"
                  : k === "champion"
                    ? "Day-to-day Champion"
                    : "Category Manager",
              )
              .join(" · ")}{" "}
            missing
          </div>
        </div>
      )}

      {/* 4 pill sub-tabs */}
      <div className="flex gap-1.5 mb-4 overflow-x-auto pb-1">
        {subTabs.map((t) => {
          const active = cur === t.to;
          return (
            <NavLink
              key={t.to}
              to={t.to}
              className={cn(
                "px-3.5 py-2 rounded-card text-[12px] font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition border",
                active
                  ? ""
                  : "border-beroe-card-border bg-white text-text-secondary hover:bg-beroe-bg",
                t.locked && "opacity-40 pointer-events-none",
              )}
              style={
                active
                  ? { background: PINK_BG, borderColor: PINK_BORDER, color: PINK }
                  : undefined
              }
              title={t.locked ? t.lockReason : undefined}
            >
              <span>{t.icon}</span>
              <span>{t.label}</span>
              {t.locked && <span className="ml-1">🔒</span>}
            </NavLink>
          );
        })}
      </div>

      <Outlet context={{ account }} />
    </div>
  );
}
