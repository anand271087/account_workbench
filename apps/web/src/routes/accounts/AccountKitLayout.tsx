// M17 — Account Kit sub-layout.
//
// Groups the five tabs that together form the "Account Kit" workflow:
//   Pre-Sales → Brief → Solutioning → Sales Handoff → CS Onboarding
//
// Sits between AccountProfileLayout (top-level nav + header) and the leaf
// tab components. Re-exposes the account via outlet context so the leaf
// tabs keep using `useAccountFromLayout()` without changes.
//
// Default route (no sub-tab in URL) redirects to the first sub-tab the
// user can view.

import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";

import { cn } from "@/lib/utils";
import { useAccountFromLayout } from "./AccountProfileLayout";
import type { AccountDetail } from "@/types/account";

interface KitSubTab {
  to: string;
  label: string;
  show: (a: AccountDetail) => boolean;
}

const KIT_SUB_NAV: KitSubTab[] = [
  { to: "pre-sales",     label: "Pre-Sales",     show: (a) => a.can_view_pre_sales },
  { to: "brief",         label: "Brief",         show: (a) => a.can_view_pre_sales },
  { to: "solutioning",   label: "Solutioning",   show: (a) => a.can_view_solutioning },
  { to: "sales-handoff", label: "Sales Handoff & Signing", show: (a) => a.can_view_sales_handoff },
  { to: "cs-onboarding", label: "CS Onboarding", show: (a) => a.can_view_cs_onboarding },
];

export default function AccountKitLayout() {
  const account = useAccountFromLayout();
  const navigate = useNavigate();
  const loc = useLocation();

  const visible = KIT_SUB_NAV.filter((t) => t.show(account));

  // /account-kit (no sub) → redirect to first visible sub-tab.
  const segs = loc.pathname.split("/").filter(Boolean);
  const lastSeg = segs[segs.length - 1];
  if (lastSeg === "account-kit") {
    const first = visible[0];
    if (first) {
      navigate(`./${first.to}`, { replace: true });
    }
  }

  if (visible.length === 0) {
    return (
      <div className="text-sm text-text-muted">
        You don&apos;t have access to any Account Kit section for this account.
      </div>
    );
  }

  return (
    <div>
      {/* R10 — Kit Completion strip: progress through the 5 Account Kit steps. */}
      <KitCompletion account={account} />

      {/* Pill-style sub-tab strip — matches the v20 prototype */}
      <div className="flex gap-1.5 mb-4 flex-wrap">
        {visible.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              cn(
                "flex-1 min-w-[120px] px-3 py-2 rounded-lg border-[1.5px] text-[12px] text-center transition-colors duration-100",
                isActive
                  ? "border-beroe-blue/40 bg-beroe-blue/5 text-beroe-blue font-bold"
                  : "border-beroe-card-border bg-white text-text-secondary font-medium hover:border-beroe-blue/30 hover:text-beroe-blue",
              )
            }
            end
          >
            {t.label}
          </NavLink>
        ))}
      </div>

      <Outlet context={{ account }} />
    </div>
  );
}

function KitCompletion({ account }: { account: AccountDetail }) {
  // Heuristic: each step is "done" when the strongest signal of completion
  // on its tab is set. We avoid fan-out queries by leaning on AccountDetail
  // fields surfaced by the layout (engagement.objective live in /engagement;
  // we don't fetch it here — Pre-Sales is treated as "complete" once the
  // user has handed off to Solutioning, which is the gate to leave that step).
  const steps: { label: string; done: boolean }[] = [
    { label: "Pre-Sales", done: account.handed_off_to_solutioning },
    { label: "Brief", done: account.handed_off_to_solutioning },
    {
      label: "Solutioning",
      done: account.handed_off_to_solutioning && account.gate_signed,
    },
    { label: "Sales Handoff", done: account.gate_signed },
    { label: "CS Onboarding", done: account.cs_entry_type !== null },
  ];
  const completed = steps.filter((s) => s.done).length;
  const pct = Math.round((completed / steps.length) * 100);
  return (
    <div className="mb-3 bg-white border border-beroe-card-border rounded-card px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted">
          Kit Completion
        </div>
        <div className="text-[11px] font-bold text-text-primary">
          {completed} / {steps.length} steps · {pct}%
        </div>
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mb-2">
        <div
          className={cn(
            "h-full transition-all",
            pct === 100 ? "bg-emerald-500" : "bg-beroe-blue",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {steps.map((s) => (
          <span
            key={s.label}
            className={cn(
              "text-[10px] px-1.5 py-0.5 rounded-full border font-semibold",
              s.done
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-slate-50 text-text-muted border-beroe-card-border",
            )}
          >
            {s.done ? "✓" : "○"} {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
