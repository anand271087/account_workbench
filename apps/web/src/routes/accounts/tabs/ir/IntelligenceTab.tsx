// 05-Jun · Intelligence dashboard — lazy-loaded per sub-tab.
//
// Each sub-tab fetches only its bundle. /intel/all (the full rollup) is
// avoided because it's sequential server-side (17×5-25s each) and the
// user only looks at one sub-tab at a time. With per-bundle fetching:
// active tab loads 5-25s cold, then instant on revisit (TanStack Query
// + 5-min server cache).
//
// All colors locked to the Beroe brand palette (charts.tsx).

import { useState } from "react";

import { cn } from "@/lib/utils";
import { useAccountFromLayout, useAccountPeriod } from "../../AccountProfileLayout";
import { useIntelBundle, type IntelSection } from "@/hooks/useIntelAll";
import type {
  AccountSubscribers,
  Abi,
  CategoryWatch,
  CustomUsage,
  InflationWatch,
  LabelCount,
  Maybe,
  Alerts as AlertsBundle,
  SupplierDiscovery,
  SupplierMonitoring,
  SuperUsersBundle,
  ThoughtLeadership,
} from "@/types/intel";
import { isUnavailable } from "@/types/intel";
import {
  Card,
  CardTitle,
  KpiTile,
  BarChart,
  DonutChart,
  LineChart,
  NaPill,
  PALETTE,
  SERIES_COLORS,
  SimpleTable,
} from "./charts";

interface SubMeta {
  id: IntelSection;
  label: string;
}

const SUB_TABS: SubMeta[] = [
  { id: "account-subscribers", label: "Account & Subscribers" },
  { id: "category-watch", label: "Category Watch + MMD" },
  { id: "abi", label: "Abi" },
  { id: "supplier-discovery", label: "Supplier Discovery" },
  { id: "supplier-monitoring", label: "Supplier Monitoring" },
  { id: "custom-usage", label: "Custom Usage" },
  { id: "thought-leadership", label: "Thought Leadership" },
  { id: "inflation-watch", label: "Inflation Watch" },
  { id: "alerts", label: "Alerts" },
  { id: "super-users", label: "Super Users" },
];

// ---------- helpers ----------

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  return new Intl.NumberFormat("en-US").format(n);
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function maybeKpi(label: string, v: Maybe<number>, accent?: string) {
  if (isUnavailable(v)) {
    return <KpiTile label={label} value="" na={{ reason: v.reason }} accent={accent} />;
  }
  return <KpiTile label={label} value={fmtNum(v as number)} accent={accent} />;
}

function barRows(items: LabelCount[]): Array<{ label: string; value: number; color: string }> {
  return items.slice(0, 10).map((r, i) => ({
    label: r.label || "(blank)",
    value: r.count,
    color: SERIES_COLORS[i % SERIES_COLORS.length],
  }));
}

// ============================================================
// Top-level component
// ============================================================

export default function IntelligenceTab() {
  const account = useAccountFromLayout();
  const { period } = useAccountPeriod();
  const [sub, setSub] = useState<IntelSection>("account-subscribers");

  return (
    <div>
      {/* Live banner */}
      <div className="mb-3 flex items-center gap-3 px-3 py-2 rounded-md bg-beroe-teal/10 border border-beroe-teal/30">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-beroe-teal">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-beroe-teal opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-beroe-teal" />
          </span>
          LIVE
        </span>
        <div className="text-[11px] text-text-secondary flex-1">
          Pulled from Redshift —{" "}
          <span className="font-semibold">
            {account.redshift_company_name ?? account.name}
          </span>{" "}
          · window: <span className="font-semibold">{period ?? "90d"}</span> · cached 5 min
        </div>
      </div>

      {/* Sub-tab strip */}
      <div className="flex gap-1 mb-3 flex-wrap">
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setSub(t.id)}
            className={cn(
              "text-[12px] px-3 py-1.5 rounded-md border-[1.5px] transition-colors",
              sub === t.id
                ? "border-beroe-teal/40 bg-beroe-teal/10 text-beroe-teal font-bold"
                : "border-beroe-card-border bg-white text-text-secondary font-medium hover:bg-beroe-bg/60",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <SubLoader accountId={account.id} period={period} section={sub} />
    </div>
  );
}

// Lazy loader — fetches only the active section's bundle.
function SubLoader({
  accountId,
  period,
  section,
}: {
  accountId: string;
  period: ReturnType<typeof useAccountPeriod>["period"];
  section: IntelSection;
}) {
  // useIntelBundle re-keys on (accountId, section, window). React renders
  // a single SubLoader at any time; switching tabs unmounts the prior one.
  switch (section) {
    case "account-subscribers":
      return <FetchAndRender<AccountSubscribers>
        accountId={accountId} period={period} section={section}
        render={(d) => <SubscribersDash data={d} />}
      />;
    case "category-watch":
      return <FetchAndRender<CategoryWatch>
        accountId={accountId} period={period} section={section}
        render={(d) => <CategoryWatchDash data={d} />}
      />;
    case "abi":
      return <FetchAndRender<Abi>
        accountId={accountId} period={period} section={section}
        render={(d) => <AbiDash data={d} />}
      />;
    case "supplier-discovery":
      return <FetchAndRender<SupplierDiscovery>
        accountId={accountId} period={period} section={section}
        render={(d) => <SupplierDiscoveryDash data={d} />}
      />;
    case "supplier-monitoring":
      return <FetchAndRender<SupplierMonitoring>
        accountId={accountId} period={period} section={section}
        render={(d) => <SupplierMonitoringDash data={d} />}
      />;
    case "custom-usage":
      return <FetchAndRender<CustomUsage>
        accountId={accountId} period={period} section={section}
        render={(d) => <CustomUsageDash data={d} />}
      />;
    case "thought-leadership":
      return <FetchAndRender<ThoughtLeadership>
        accountId={accountId} period={period} section={section}
        render={(d) => <ThoughtLeadershipDash data={d} />}
      />;
    case "inflation-watch":
      return <FetchAndRender<InflationWatch>
        accountId={accountId} period={period} section={section}
        render={(d) => <InflationWatchDash data={d} />}
      />;
    case "alerts":
      return <FetchAndRender<AlertsBundle>
        accountId={accountId} period={period} section={section}
        render={(d) => <AlertsDash data={d} />}
      />;
    case "super-users":
      return <FetchAndRender<SuperUsersBundle>
        accountId={accountId} period={period} section={section}
        render={(d) => <SuperUsersDash data={d} />}
      />;
  }
}

function FetchAndRender<T>({
  accountId,
  period,
  section,
  render,
}: {
  accountId: string;
  period: ReturnType<typeof useAccountPeriod>["period"];
  section: IntelSection;
  render: (data: T) => React.ReactNode;
}) {
  const { data, isLoading, isError, error } = useIntelBundle<T>(
    accountId,
    period,
    section,
  );

  if (isLoading) {
    return (
      <Card>
        <div className="flex items-center gap-2 text-[12px] text-text-muted py-8 justify-center">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-beroe-teal opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-beroe-teal" />
          </span>
          Querying Redshift… (cold queries take 5–25s)
        </div>
      </Card>
    );
  }
  if (isError) {
    const status = (error as { status?: number } | null)?.status;
    return (
      <Card>
        <div className="text-[13px] font-semibold mb-1 text-risk-red">
          Couldn't load this section
        </div>
        <div className="text-[11px] text-text-secondary">
          {status === 409
            ? "This account isn't mapped to a Redshift companyname yet. Set accounts.redshift_company_name to enable live data."
            : (error as { message?: string })?.message ?? "Unknown error"}
        </div>
      </Card>
    );
  }
  if (!data) return null;
  return <>{render(data)}</>;
}

// ============================================================
// Sub-dashes — each takes ONLY its own bundle
// ============================================================

function SubscribersDash({ data: a }: { data: AccountSubscribers }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiTile label="Total Subscribers" value={fmtNum(a.total_subscribers)} accent={PALETTE.indigo} />
        <KpiTile
          label="Active (≥1 login)"
          value={fmtNum(a.active_subscribers)}
          sub={`${a.total_subscribers ? Math.round((a.active_subscribers / a.total_subscribers) * 100) : 0}% of total`}
          accent={PALETTE.aqua}
        />
        <KpiTile label="Total Logins" value={fmtNum(a.total_logins)} accent={PALETTE.fuscia} />
        <KpiTile
          label="Total Time (mins)"
          value={fmtNum(Math.round(a.total_time_spent_mins))}
          accent={PALETTE.bumblebee}
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <KpiTile label="Categories Unlocked" value={fmtNum(a.categories_unlocked)} />
        {maybeKpi("Suppliers Added", a.suppliers_added)}
        <KpiTile label="Last Login" value={fmtDate(a.company_last_login)} />
      </div>
      <Card>
        <CardTitle>Subscription window</CardTitle>
        <div className="grid grid-cols-2 gap-3 text-[12px]">
          <div>
            <div className="text-text-muted text-[10px] uppercase tracking-wider mb-1">
              Start
            </div>
            <div className="font-semibold">{fmtDate(a.subscription_start)}</div>
          </div>
          <div>
            <div className="text-text-muted text-[10px] uppercase tracking-wider mb-1">
              End
            </div>
            <div className="font-semibold">{fmtDate(a.subscription_end)}</div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function CategoryWatchDash({ data: cw }: { data: CategoryWatch }) {
  const mmd = cw.mmd;
  return (
    <div className="space-y-3">
      <div className="text-[11px] text-text-muted">
        Market Movement Dashboard (live) — Category Intelligence + Benchmarks
        sections pending DBA grants on stg_user_cat_sup_report,
        stg_categoryview_reporttype, stg_benchmark.
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <KpiTile label="MMD Subscribers" value={fmtNum(mmd.subscribers)} accent={PALETTE.indigo} />
        <KpiTile
          label="Total Time (mins)"
          value={fmtNum(Math.round(mmd.total_time_mins))}
          accent={PALETTE.aqua}
        />
        <KpiTile
          label="Avg Time / User"
          value={`${mmd.avg_time_per_user_mins} m`}
          accent={PALETTE.fuscia}
        />
        <KpiTile
          label="Unique Categories"
          value={fmtNum(mmd.unique_categories_viewed)}
          accent={PALETTE.bumblebee}
        />
        <KpiTile
          label="Avg Categories / User"
          value={mmd.avg_categories_per_user.toFixed(1)}
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardTitle>Grades viewed</CardTitle>
          <BarChart rows={barRows(mmd.grades_viewed)} />
        </Card>
        <Card>
          <CardTitle>Regions viewed</CardTitle>
          <BarChart rows={barRows(mmd.regions_viewed)} />
        </Card>
      </div>
      <Card>
        <CardTitle>MMD activity — monthly</CardTitle>
        {mmd.monthly_trend.length === 0 ? (
          <div className="text-[11px] text-text-muted py-4 text-center">No data</div>
        ) : (
          <LineChart
            labels={mmd.monthly_trend.map((m) => m.month)}
            values={mmd.monthly_trend.map((m) => m.visits)}
            color={PALETTE.indigo}
          />
        )}
      </Card>
    </div>
  );
}

function AbiDash({ data: a }: { data: Abi }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiTile label="Total Queries" value={fmtNum(a.total_queries)} accent={PALETTE.indigo} />
        <KpiTile label="Unique Users" value={fmtNum(a.unique_users)} accent={PALETTE.aqua} />
        <KpiTile
          label="Bot Resolution"
          value={`${a.bot_resolution_pct}%`}
          accent={PALETTE.fuscia}
        />
        <KpiTile
          label="Repeat Users"
          value={`${a.repeat_users_pct}%`}
          accent={PALETTE.bumblebee}
        />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-2 gap-2">
        <KpiTile
          label="Avg Feedback (1-5)"
          value={a.avg_feedback == null ? "—" : a.avg_feedback.toFixed(2)}
        />
        <KpiTile
          label="Thumbs-up %"
          value={a.thumbs_up_pct == null ? "—" : `${a.thumbs_up_pct}%`}
        />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardTitle>Queries by complexity</CardTitle>
          <DonutChart
            slices={a.by_complexity.map((c) => ({ label: c.label, value: c.count }))}
          />
        </Card>
        <Card>
          <CardTitle>Query status</CardTitle>
          <DonutChart
            slices={a.by_status.map((c) => ({ label: c.label, value: c.count }))}
          />
        </Card>
        <Card>
          <CardTitle>Top deliverable</CardTitle>
          <BarChart rows={barRows(a.top_deliverable)} />
        </Card>
        <Card>
          <CardTitle>Query channel</CardTitle>
          <BarChart rows={barRows(a.by_source)} />
        </Card>
        <Card>
          <CardTitle>Top declined deliverable</CardTitle>
          <BarChart rows={barRows(a.top_declined_deliverable)} />
        </Card>
        <Card>
          <CardTitle>Research referral reasons</CardTitle>
          <BarChart rows={barRows(a.research_referral_reasons)} />
        </Card>
        <Card>
          <CardTitle>Top geographies</CardTitle>
          <BarChart rows={barRows(a.top_geographies)} />
        </Card>
        <Card>
          <CardTitle>Inside vs Outside Live.ai</CardTitle>
          <DonutChart
            slices={a.inside_vs_outside_split.map((c) => ({
              label: c.label,
              value: c.count,
            }))}
          />
        </Card>
      </div>
      <Card>
        <CardTitle>Time on Abi per user (top 50)</CardTitle>
        <SimpleTable
          cols={[
            { key: "email", label: "User" },
            { key: "hours", label: "Hours", numeric: true },
          ]}
          rows={a.time_per_user_top50.map((u) => ({
            email: u.email,
            hours: u.hours.toFixed(1),
          }))}
        />
      </Card>
    </div>
  );
}

function SupplierDiscoveryDash({ data: s }: { data: SupplierDiscovery }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiTile label="Users" value={fmtNum(s.users)} accent={PALETTE.indigo} />
        <KpiTile label="Total Searches" value={fmtNum(s.total_searches)} accent={PALETTE.aqua} />
        <KpiTile label="Total Visits" value={fmtNum(s.total_visits)} accent={PALETTE.fuscia} />
        <KpiTile
          label="Total Time (mins)"
          value={fmtNum(Math.round(s.total_time_mins))}
          accent={PALETTE.bumblebee}
        />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <KpiTile label="Avg Searches / User" value={s.avg_searches_per_user.toFixed(1)} />
        <KpiTile label="Repeat Users %" value={`${s.repeat_users_pct}%`} />
        {maybeKpi("SD Downloads", s.sd_downloads as Maybe<number>)}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardTitle>Top categories searched</CardTitle>
          <BarChart rows={barRows(s.top_categories_searched)} />
        </Card>
        <Card>
          <CardTitle>Top Regions Scoped</CardTitle>
          {isUnavailable(s.top_regions_scoped) ? (
            <NaPill reason={s.top_regions_scoped.reason} />
          ) : (
            <div className="text-[11px] text-text-muted">No data</div>
          )}
        </Card>
      </div>
    </div>
  );
}

function SupplierMonitoringDash({ data: s }: { data: SupplierMonitoring }) {
  return (
    <div className="space-y-3">
      <div className="text-[11px] text-text-muted">
        Most KPIs need access to <code>stg_user_cat_sup_report</code> — pending
        DBA grant. The time-spent KPI works via session_log + module filter.
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiTile
          label="SM Time (mins)"
          value={fmtNum(Math.round(s.total_time_mins))}
          accent={PALETTE.indigo}
        />
        {maybeKpi("Suppliers Monitored", s.suppliers_monitored)}
        {maybeKpi("New This Period", s.new_suppliers_in_period)}
        {maybeKpi("Users Adding", s.users_adding_suppliers)}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {maybeKpi("Data Refreshes 30d", s.data_refreshes_last_30d)}
        {maybeKpi("Added vs Contracted %", s.suppliers_added_vs_contracted_pct)}
      </div>
    </div>
  );
}

function CustomUsageDash({ data: c }: { data: CustomUsage }) {
  const cbc = c.credits_by_complexity;
  return (
    <div className="space-y-3">
      {c.credits_by_complexity_note && (
        <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-1.5">
          ⚠ {c.credits_by_complexity_note}
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiTile label="Total (proxy)" value={fmtNum(c.total_credits_used)} accent={PALETTE.indigo} />
        <KpiTile label="L1" value={fmtNum(cbc.L1)} accent={PALETTE.aqua} />
        <KpiTile label="L2" value={fmtNum(cbc.L2)} accent={PALETTE.fuscia} />
        <KpiTile label="L3+L4" value={fmtNum(cbc.L3 + cbc.L4)} accent={PALETTE.bumblebee} />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <KpiTile label="Commodity Dashboards" value={fmtNum(c.commodity_dashboards)} />
        <KpiTile label="Country Reports" value={fmtNum(c.country_reports)} />
        <KpiTile
          label="Client Feedback"
          value={c.client_feedback_score == null ? "—" : c.client_feedback_score.toFixed(2)}
        />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        {maybeKpi("Credits Estimated", c.credits_estimated_active)}
        {maybeKpi("Credits Allocated", c.credits_allocated_tier)}
        {maybeKpi("Utilization %", c.credits_utilization_pct)}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardTitle>AI SWAT vs Basics</CardTitle>
          <DonutChart
            slices={c.ai_swat_vs_basics.map((r) => ({ label: r.label, value: r.count }))}
          />
        </Card>
        <Card>
          <CardTitle>Top categories</CardTitle>
          <BarChart rows={barRows(c.top_categories)} />
        </Card>
        <Card>
          <CardTitle>Top spendpools</CardTitle>
          <BarChart rows={barRows(c.top_spendpools)} />
        </Card>
        <Card>
          <CardTitle>Top deliverables</CardTitle>
          <BarChart rows={barRows(c.top_deliverables)} />
        </Card>
      </div>
    </div>
  );
}

function ThoughtLeadershipDash({ data: t }: { data: ThoughtLeadership }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiTile label="Webinar Views" value={fmtNum(t.webinar_views)} accent={PALETTE.indigo} />
        <KpiTile label="Articles Opened" value={fmtNum(t.articles_opened)} accent={PALETTE.aqua} />
        <KpiTile
          label="Beigebook Views"
          value={fmtNum(t.beigebook_views)}
          accent={PALETTE.fuscia}
        />
        <KpiTile
          label="Beigebook Downloads"
          value={fmtNum(t.beigebook_downloads)}
          accent={PALETTE.bumblebee}
        />
      </div>
      <Card>
        <CardTitle>By type</CardTitle>
        <BarChart rows={barRows(t.by_type)} />
      </Card>
    </div>
  );
}

function InflationWatchDash({ data: iw }: { data: InflationWatch }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiTile label="Unique Visitors" value={fmtNum(iw.unique_visitors)} accent={PALETTE.indigo} />
        <KpiTile label="Total Sessions" value={fmtNum(iw.total_sessions)} accent={PALETTE.aqua} />
        <KpiTile
          label="Total Time (mins)"
          value={fmtNum(Math.round(iw.total_time_mins))}
          accent={PALETTE.fuscia}
        />
        <KpiTile
          label="Avg Sessions / Visitor"
          value={iw.avg_sessions_per_visitor.toFixed(1)}
          accent={PALETTE.bumblebee}
        />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
        <KpiTile label="Avg Session Time" value={`${iw.avg_session_time_mins.toFixed(1)} m`} />
        <KpiTile
          label="Avg Time / Visitor"
          value={`${iw.avg_time_per_visitor_mins.toFixed(1)} m`}
        />
        <KpiTile
          label="Scenario Modelling Ran"
          value={fmtNum(iw.scenario_modelling.ran)}
          sub={`saved: ${iw.scenario_modelling.saved}`}
        />
      </div>
      <Card>
        <CardTitle>Top features (visitors / views)</CardTitle>
        <SimpleTable
          cols={[
            { key: "feature", label: "Feature" },
            { key: "visitors", label: "Visitors", numeric: true },
            { key: "views", label: "Views", numeric: true },
          ]}
          rows={iw.top_features.map((f) => ({
            feature: f.feature,
            visitors: f.visitors,
            views: f.views,
          }))}
        />
      </Card>
      <Card>
        <CardTitle>Top pages</CardTitle>
        {isUnavailable(iw.top_pages) ? (
          <NaPill reason={iw.top_pages.reason} />
        ) : (
          <div className="text-[11px] text-text-muted">No data</div>
        )}
      </Card>
    </div>
  );
}

function AlertsDash({ data: al }: { data: AlertsBundle }) {
  return (
    <div className="space-y-3">
      <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-1.5">
        ⚠ {al._scope_note}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-2 gap-2">
        <KpiTile label="Open Rate" value={`${al.open_rate_pct}%`} accent={PALETTE.indigo} />
        <KpiTile label="# Alert types" value={fmtNum(al.types_sent.length)} accent={PALETTE.aqua} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardTitle>Type of alert sent</CardTitle>
          <BarChart rows={barRows(al.types_sent)} />
        </Card>
        <Card>
          <CardTitle>Open rate by category</CardTitle>
          <BarChart
            rows={al.open_rate_by_category.slice(0, 10).map((r, i) => ({
              label: r.label,
              value: r.open_rate_pct,
              color: SERIES_COLORS[i % SERIES_COLORS.length],
            }))}
          />
        </Card>
      </div>
    </div>
  );
}

function SuperUsersDash({ data: su }: { data: SuperUsersBundle }) {
  return (
    <div className="space-y-3">
      <Card>
        <CardTitle>Top {su.top_n} super-users — activity score</CardTitle>
        <SimpleTable
          cols={[
            { key: "email", label: "User" },
            { key: "score", label: "Score", numeric: true },
            { key: "logins", label: "Logins", numeric: true },
            { key: "queries", label: "Abi", numeric: true },
            { key: "searches", label: "SD", numeric: true },
            { key: "mmd_time", label: "MMD min", numeric: true },
            { key: "sm_time", label: "SM min", numeric: true },
            { key: "downloads", label: "Downloads", numeric: true },
            { key: "last_login", label: "Last login" },
          ]}
          rows={su.users.map((u) => ({
            email: u.email,
            score: u.activity_score,
            logins: u.logins,
            queries: u.abi_queries,
            searches: u.sd_searches,
            mmd_time: u.mmd_time_mins,
            sm_time: u.sm_time_mins,
            downloads: u.report_downloads,
            last_login: fmtDate(u.last_login),
          }))}
        />
      </Card>
      <Card>
        <CardTitle>Login distribution (top 5)</CardTitle>
        <BarChart
          rows={su.login_distribution_top5.map((u, i) => ({
            label: u.email,
            value: u.logins,
            color: SERIES_COLORS[i % SERIES_COLORS.length],
          }))}
        />
      </Card>
    </div>
  );
}
