// 27-May Row 73 — Merged "Pre-Sales & Solutioning" tab.
//
// Stakeholder asked for Pre-Sales + Solutioning to live under ONE tab.
// Both existing sub-tabs are kept as standalone routes for deep-links;
// this merged view stacks the same components with a clear section
// divider so users see the whole pre-signing workflow without tab swaps.

import { Link } from "react-router-dom";

import { useAccountFromLayout } from "../AccountProfileLayout";
import PreSalesTab from "./PreSalesTab";
import SolutioningTab from "./SolutioningTab";

export default function PreSalesSolutioningTab() {
  const account = useAccountFromLayout();
  return (
    <div className="space-y-4">
      {/* Section anchor for jumping to Solutioning portion */}
      <div className="bg-beroe-blue/10/40 border border-beroe-blue/30/50 rounded-md px-3 py-2 flex items-center justify-between gap-2 text-[11px]">
        <div className="text-text-secondary">
          Pre-Sales information + Solutioning value definition live here as a
          combined pre-signing workflow.
        </div>
        <a
          href="#sol-section"
          className="text-beroe-blue font-semibold hover:underline whitespace-nowrap"
        >
          Jump to Solutioning ↓
        </a>
      </div>

      {/* Pre-Sales section (uses the existing PreSalesTab unchanged) */}
      <PreSalesTab />

      {/* Solutioning section — visual divider + anchor */}
      <div id="sol-section" className="pt-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-px flex-1 bg-beroe-card-border" />
          <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted">
            Solutioning · Value Definition
          </div>
          <div className="h-px flex-1 bg-beroe-card-border" />
        </div>
        {/* Hand-off to Sales link shown above the form for context */}
        {account.handed_off_to_solutioning && (
          <div className="text-[11px] text-text-muted mb-2 italic">
            ↳ Handed off to Solutioning. Continue with the value definition
            below, then hand off to Sales for signing.
          </div>
        )}
        <SolutioningTab />
      </div>

      {/* Continue-to-next workflow hint */}
      <div className="border border-dashed border-beroe-card-border rounded-md px-3 py-2 flex items-center justify-between gap-2 text-[11px] mt-4">
        <div className="text-text-muted">
          Done with value definition? The next step is Sales Hand-off & Signing.
        </div>
        <Link
          to={`/accounts/${account.id}/account-kit/sales-handoff`}
          className="text-beroe-blue font-semibold hover:underline whitespace-nowrap"
        >
          → Sales Hand-off
        </Link>
      </div>
    </div>
  );
}
