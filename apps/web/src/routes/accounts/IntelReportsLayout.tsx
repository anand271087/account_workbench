// M29 — Intelligence & Reports sub-layout.
//
// Three top-section pill tabs in flow order:
//   * Intelligence            (M29 — live, 6 sub-tabs)
//   * Analytics               (M30 — stub)
//   * Documents & Reports     (M31 — stub)
//
// Cyan theme matches the prototype (#35E1D4).

import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { cn } from "@/lib/utils";
import { useAccountFromLayout } from "./AccountProfileLayout";

interface IRSub {
  to: string;
  label: string;
}

const IR_SUB_NAV: IRSub[] = [
  { to: "intelligence", label: "Intelligence" },
  { to: "analytics", label: "Analytics" },
  { to: "documents", label: "Documents & Reports" },
];

export default function IntelReportsLayout() {
  const account = useAccountFromLayout();
  const nav = useNavigate();
  const loc = useLocation();

  const segs = loc.pathname.split("/").filter(Boolean);
  const last = segs[segs.length - 1];
  if (last === "intel-reports") {
    nav("./intelligence", { replace: true });
  }

  return (
    <div>
      <div className="flex gap-1.5 mb-4 flex-wrap">
        {IR_SUB_NAV.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              cn(
                "flex-1 min-w-[160px] px-3 py-2 rounded-lg border-[1.5px] text-[12px] text-center transition-colors duration-100",
                isActive
                  ? "border-beroe-teal/40 bg-beroe-teal/5 text-beroe-teal font-bold"
                  : "border-beroe-card-border bg-white text-text-secondary font-medium hover:border-beroe-teal/30 hover:text-beroe-teal",
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
