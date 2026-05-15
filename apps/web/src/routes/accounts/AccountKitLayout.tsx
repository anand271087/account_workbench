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
  { to: "sales-handoff", label: "Sales Handoff", show: (a) => a.can_view_sales_handoff },
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
