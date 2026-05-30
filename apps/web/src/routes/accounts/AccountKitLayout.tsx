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
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAccountFromLayout } from "./AccountProfileLayout";
import type { AccountDetail } from "@/types/account";

interface KitSubTab {
  to: string;
  label: string;
  show: (a: AccountDetail) => boolean;
}

// 27-May Row 73 — Pre-Sales + Solutioning merged into one tab; new
// order: Pre-Sales & Solutioning → Sales Hand-off & Signing → CS
// Onboarding → Brief (Brief moves to the end).
const KIT_SUB_NAV: KitSubTab[] = [
  {
    to: "pre-sales-solutioning",
    label: "Pre-Sales & Solutioning",
    show: (a) => a.can_view_pre_sales || a.can_view_solutioning,
  },
  { to: "sales-handoff", label: "Sales Hand-off & Signing", show: (a) => a.can_view_sales_handoff },
  { to: "cs-onboarding", label: "CS Onboarding", show: (a) => a.can_view_cs_onboarding },
  { to: "brief",         label: "Brief",         show: (a) => a.can_view_pre_sales },
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
  // 29-May bug 29-05 — Kit Completion now mirrors the prototype's 6
  // stages (was 4): Pre-Sales · Solutioning · Sales Hand-off · Signed ·
  // Metrics · VDD. Metrics + VDD completion derives from server data
  // fetched here as light side queries (count metrics / vdd locked).
  // The colour palette is the prototype's 6-color set (line 5822).
  type MetricListResponse = { items: unknown[] };
  type VddSnapshot = { locked_at: string | null };
  const { data: metricsData } = useQuery<MetricListResponse>({
    queryKey: ["metrics", account.id],
    queryFn: () =>
      api.get<MetricListResponse>(`/api/v1/accounts/${account.id}/metrics`),
  });
  const { data: vddData } = useQuery<VddSnapshot>({
    queryKey: ["vdd", account.id],
    queryFn: () =>
      api.get<VddSnapshot>(
        `/api/v1/accounts/${account.id}/value-delivery-document`,
      ),
  });
  const metricCount = metricsData?.items?.length ?? 0;
  const vddLocked = !!vddData?.locked_at;
  const steps: { label: string; done: boolean; col: string }[] = [
    { label: "Pre-Sales", done: account.handed_off_to_solutioning, col: "#4A00F8" },
    { label: "Solutioning", done: account.handed_off_to_solutioning, col: "#F0BC41" },
    { label: "Sales Hand-off", done: account.gate_signed, col: "#C344C7" },
    {
      label: "Signed",
      done: account.gate_signed && !account.gate_unlocked,
      col: "#35E1D4",
    },
    { label: "Metrics", done: metricCount > 0, col: "#6EC457" },
    { label: "VDD", done: vddLocked, col: "#CF4548" },
  ];
  const completed = steps.filter((s) => s.done).length;
  const overallPct = Math.round((completed / steps.length) * 100);
  const overallCol =
    overallPct >= 75 ? "#6EC457" : overallPct >= 40 ? "#F0BC41" : "#CF4548";

  return (
    <div className="mb-3 bg-white border border-beroe-card-border rounded-card px-4 py-2.5">
      <div className="flex items-center gap-3.5 flex-wrap">
        <div className="text-[11px] font-bold whitespace-nowrap text-text-primary">
          Kit Completion
        </div>

        {/* Multi-segment bar — verbatim from prototype line 5818-5823 */}
        <div className="flex-1 flex items-center gap-1.5 min-w-[200px]">
          <div
            className="flex-1 h-2 rounded-full overflow-hidden flex gap-px"
            style={{ background: "#e8eef8" }}
          >
            {steps.map((s) => {
              const pct = s.done ? 100 : 0;
              return (
                <div
                  key={s.label}
                  className="flex-1 h-full"
                  style={{
                    background: s.col,
                    opacity: pct / 100,
                  }}
                />
              );
            })}
          </div>
          <span
            className="text-[12px] font-bold"
            style={{ color: overallCol }}
          >
            {overallPct}%
          </span>
        </div>

        {/* Per-step % labels (prototype line 5826) */}
        <div className="flex items-center gap-2 flex-wrap">
          {steps.map((s) => {
            const pct = s.done ? 100 : 0;
            return (
              <span
                key={s.label}
                className="text-[9px] font-semibold whitespace-nowrap"
                style={{ color: s.col }}
              >
                {s.label} {pct}%
              </span>
            );
          })}
        </div>

        {/* 27-May Row 74 — Download Kit button. */}
        <button
          type="button"
          onClick={() => downloadAccountKit(account)}
          className="text-[10px] px-2.5 py-1 rounded border border-beroe-blue/40 bg-beroe-blue/5 text-beroe-blue font-semibold hover:bg-beroe-blue/10 whitespace-nowrap"
          title="Open a printable summary in a new window"
        >
          ⬇ Download Kit
        </button>
      </div>
    </div>
  );
}

// Row 74 — open a printable Account-Kit summary in a new window.
// Pure-frontend: walks the AccountDetail props already on the layout
// context. User saves as PDF via the browser's Print → Save dialog.
function downloadAccountKit(account: AccountDetail) {
  const fmt = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : String(v));
  const fmtMoney = (v: string | null) =>
    !v ? "—" : Number.isFinite(Number(v)) ? `$${Number(v).toLocaleString()}` : v;
  const w = window.open("", "_blank");
  if (!w) {
    alert("Pop-up was blocked. Allow pop-ups for this site to download the kit.");
    return;
  }
  const html = `<!doctype html>
<html><head><meta charset="utf-8" /><title>Account Kit — ${account.name}</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; padding: 32px; max-width: 880px; margin: 0 auto; color: #1f2937; }
  h1 { color: #001137; margin-bottom: 4px; font-size: 22px; }
  .meta { color: #64748b; font-size: 12px; margin-bottom: 16px; }
  h2 { color: #4A00F8; margin-top: 24px; border-bottom: 2px solid #e4eaf6; padding-bottom: 4px; font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 6px; }
  td { padding: 4px 0; vertical-align: top; }
  td:first-child { color: #64748b; font-weight: 600; width: 200px; text-transform: uppercase; font-size: 11px; letter-spacing: 0.05em; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; margin-right: 4px; }
  .pill-emerald { background: #ecfdf5; color: #047857; }
  .pill-amber { background: #fffbeb; color: #b45309; }
  @media print { body { padding: 16px; } }
</style></head><body>
<h1>${account.name} — Account Kit</h1>
<div class="meta">Generated ${new Date().toLocaleString()} · Slug ${account.slug}</div>
<h2>Account</h2><table>
  <tr><td>Industry</td><td>${fmt(account.industry)}</td></tr>
  <tr><td>Country / Region</td><td>${fmt(account.country)} / ${fmt(account.region)}</td></tr>
  <tr><td>Tier</td><td>${fmt(account.tier)}</td></tr>
  <tr><td>Account Type</td><td>${fmt(account.account_type)}</td></tr>
  <tr><td>Segment</td><td>${fmt(account.segment)}</td></tr>
  <tr><td>Annual Revenue</td><td>${fmt(account.annual_revenue_text)}</td></tr>
</table>
<h2>Commercials</h2><table>
  <tr><td>Current ACV</td><td>${fmtMoney(account.current_acv)}</td></tr>
  <tr><td>Target ACV</td><td>${fmtMoney(account.target_acv)}</td></tr>
  <tr><td>Renewal Date</td><td>${fmt(account.renewal_date)}</td></tr>
  <tr><td>Days to Renewal</td><td>${fmt(account.days_to_renewal)}</td></tr>
  <tr><td>Health Score</td><td>${fmt(account.health_score)}</td></tr>
</table>
<h2>Workflow State</h2><table>
  <tr><td>Pre-Sales / Solutioning</td><td><span class="pill ${account.handed_off_to_solutioning ? "pill-emerald" : "pill-amber"}">${account.handed_off_to_solutioning ? "✓ Handed off" : "○ Pending"}</span></td></tr>
  <tr><td>Signed</td><td><span class="pill ${account.gate_signed ? "pill-emerald" : "pill-amber"}">${account.gate_signed ? "✓ Signed" : "○ Not signed"}</span></td></tr>
  <tr><td>CS Entry Type</td><td>${fmt(account.cs_entry_type)}</td></tr>
</table>
<h2>Assignment</h2><table>
  <tr><td>CSM</td><td>${fmt(account.csm_full_name)}</td></tr>
  <tr><td>Commercial Owner</td><td>${fmt(account.co_full_name)}</td></tr>
</table>
<div class="meta" style="margin-top:24px">Beroe Account Workbench — printable Account Kit summary. For the live workflow + editable forms, open this account in the app.</div>
</body></html>`;
  w.document.write(html);
  w.document.close();
}
