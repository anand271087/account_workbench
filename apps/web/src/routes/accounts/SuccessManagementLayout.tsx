// M18 — Success Management sub-layout.
//
// The CS team's home for the post-signing lifecycle. Five sub-tabs in
// flow order:
//
//   VDD → Contract + Goals → Value Tracking → Checkpoints → Delivery + Renewal
//
// Each sub-tab is built in its own milestone:
//   M19 Contract + Goals  — Success Contract (3-lock) + extends M15 Goals
//   M20 Value Tracking    — dedicated metrics table + status engine
//   M21 Checkpoints       — Kickoff/MBR/QBR/Renewal + sign-off modal
//   M22 VDD               — 4-section doc + PPT export
//   M23 Delivery + Renewal— dual-track + 3-question readiness
//
// The layout itself just provides the sub-tab strip and re-exposes the
// account via outlet context (same pattern as AccountKitLayout).

import { NavLink, Outlet, useNavigate, useLocation } from "react-router-dom";

import { cn } from "@/lib/utils";
import { useAccountFromLayout } from "./AccountProfileLayout";

interface SMSubTab {
  to: string;
  label: string;
}

// Order matches the prototype: VDD first (informational/overview), then
// Contract+Goals (definition), Value Tracking (ongoing), Checkpoints
// (review cycles), Delivery+Renewal (outcomes).
const SM_SUB_NAV: SMSubTab[] = [
  { to: "vdd",               label: "VDD" },
  { to: "contract-goals",    label: "Contract & Goals" },
  { to: "value-tracking",    label: "Value Tracking" },
  { to: "checkpoints",       label: "Checkpoints" },
  { to: "delivery-renewal",  label: "Delivery & Renewal" },
];

export default function SuccessManagementLayout() {
  const account = useAccountFromLayout();
  const navigate = useNavigate();
  const loc = useLocation();

  // /success-management (no sub) → redirect to VDD (first sub-tab).
  const segs = loc.pathname.split("/").filter(Boolean);
  const lastSeg = segs[segs.length - 1];
  if (lastSeg === "success-management") {
    navigate(`./vdd`, { replace: true });
  }

  return (
    <div>
      <div className="flex gap-1.5 mb-4 flex-wrap">
        {SM_SUB_NAV.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              cn(
                "flex-1 min-w-[120px] px-3 py-2 rounded-lg border-[1.5px] text-[12px] text-center transition-colors duration-100",
                isActive
                  ? "border-pink-500/40 bg-pink-500/5 text-pink-700 font-bold"
                  : "border-beroe-card-border bg-white text-text-secondary font-medium hover:border-pink-500/30 hover:text-pink-700",
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
