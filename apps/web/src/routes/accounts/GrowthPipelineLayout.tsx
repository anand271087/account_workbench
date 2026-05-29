// M26 — Growth & Pipeline sub-layout.
//
// Three sub-tabs in prototype order:
//   Account Plan (M26 — live)
//   Signals & Activity (M27 — stub)
//   External Intelligence (M28 — stub)
//
// Green theme to match the prototype's strategy palette (#6EC457).

import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";

import { cn } from "@/lib/utils";
import { useAccountFromLayout } from "./AccountProfileLayout";

interface GPSubTab {
  to: string;
  label: string;
}

const GP_SUB_NAV: GPSubTab[] = [
  { to: "plan",      label: "Account Plan" },
  { to: "signals",   label: "Signals & Activity" },
  { to: "ext-intel", label: "External Intelligence" },
];

export default function GrowthPipelineLayout() {
  const account = useAccountFromLayout();
  const navigate = useNavigate();
  const loc = useLocation();

  const segs = loc.pathname.split("/").filter(Boolean);
  const lastSeg = segs[segs.length - 1];
  if (lastSeg === "growth-pipeline") {
    navigate(`./plan`, { replace: true });
  }

  return (
    <div>
      <div className="flex gap-1.5 mb-4 flex-wrap">
        {GP_SUB_NAV.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              cn(
                "flex-1 min-w-[140px] px-3 py-2 rounded-lg border-[1.5px] text-[12px] text-center transition-colors duration-100",
                isActive
                  ? "border-beroe-green/40 bg-beroe-green/5 text-beroe-green font-bold"
                  : "border-beroe-card-border bg-white text-text-secondary font-medium hover:border-beroe-green/30 hover:text-beroe-green",
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
