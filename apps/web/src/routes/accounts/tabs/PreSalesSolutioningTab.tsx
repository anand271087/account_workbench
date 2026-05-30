// 27-May Row 73 — Merged "Pre-Sales & Solutioning" tab.
//
// Stakeholder asked for Pre-Sales + Solutioning to live under ONE tab.
// 29-May bug 29-12 — both halves are now wrapped in their own clearly-
// labeled "main container" card so the two sections read as cohesive
// units with their subsections inside ("create one main container for
// Pre-Sales and include all related details within it, organized into
// separate subsections").

import { Link } from "react-router-dom";

import { useAccountFromLayout } from "../AccountProfileLayout";
import PreSalesTab from "./PreSalesTab";
import SolutioningTab from "./SolutioningTab";

export default function PreSalesSolutioningTab() {
  const account = useAccountFromLayout();
  return (
    <div className="space-y-4">
      {/* Section anchor for jumping to Solutioning portion */}
      <div className="bg-beroe-blue/5 border border-beroe-blue/30 rounded-md px-3 py-2 flex items-center justify-between gap-2 text-[11px]">
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

      {/* ============================================================
          29-May bug 29-12 — PRE-SALES main container.
          One clearly-labeled outer card wrapping all Pre-Sales
          sub-sections (MoM uploads, Brief, Engagement Info,
          Categories, Geographies, Profile, Client Contacts,
          Handover).
          ============================================================ */}
      <section className="bg-beroe-bg/30 rounded-card border-2 border-beroe-blue/30 p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-beroe-blue/20">
          <div>
            <div className="text-[14px] font-bold uppercase tracking-wider text-beroe-blue">
              Pre-Sales
            </div>
            <div className="text-[11px] text-text-muted">
              Discovery → engagement context → client contacts → hand off
              to Solutioning.
            </div>
          </div>
          {account.handed_off_to_solutioning && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-beroe-green/15 text-beroe-green border border-beroe-green/30">
              ✓ Handed to Solutioning
            </span>
          )}
        </div>
        <PreSalesTab />
      </section>

      {/* ============================================================
          29-May bug 29-12 — SOLUTIONING main container.
          One clearly-labeled outer card wrapping all Solutioning
          sub-sections (VPD upload, Autofill, Type / Duration /
          Proposed solution / Value Definition / Value Themes / Lock).
          ============================================================ */}
      <section
        id="sol-section"
        className="bg-beroe-bg/30 rounded-card border-2 border-beroe-purple/30 p-4 space-y-3"
      >
        <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-beroe-purple/20">
          <div>
            <div className="text-[14px] font-bold uppercase tracking-wider text-beroe-purple">
              Solutioning
            </div>
            <div className="text-[11px] text-text-muted">
              VPD → structured fields → value definition → lock & pass to
              Sales.
            </div>
          </div>
          {account.handed_off_to_solutioning && (
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-beroe-purple/15 text-beroe-purple border border-beroe-purple/30">
              ↳ Active
            </span>
          )}
        </div>
        <SolutioningTab />
      </section>

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
