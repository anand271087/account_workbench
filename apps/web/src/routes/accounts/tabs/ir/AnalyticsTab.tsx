// 05-Jun · Phase 2b — Analytics tab on live Redshift data.
//
// Replaces the platform_intel-jsonb-driven version. Each sub-tab
// fetches only its bundle via useIntelBundle (5-25s cold, instant
// from TanStack cache on revisit). Numbers / Charts mode toggle
// retained. Period scaling removed — backend honors the window
// parameter directly.
//
// 8 sub-tabs map to the matching Redshift bundle:
//   usage   → account-subscribers
//   modules → category-watch (MMD subsection focus)
//   cw      → category-watch (Category Intelligence — mostly NA today)
//   abi     → abi
//   sd      → supplier-discovery
//   srm     → supplier-monitoring
//   cc      → custom-usage
//   su      → super-users

import { useState } from "react";

import { cn } from "@/lib/utils";
import { useAccountFromLayout, useAccountPeriod } from "../../AccountProfileLayout";
import { useIntelBundle, type IntelSection } from "@/hooks/useIntelAll";
import type {
  Abi,
  AccountSubscribers,
  CategoryWatch,
  CustomUsage,
  LabelCount,
  Maybe,
  SuperUsersBundle,
  SupplierDiscovery,
  SupplierMonitoring,
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

type Sub = "usage" | "modules" | "cw" | "abi" | "sd" | "srm" | "cc" | "su";
type Mode = "numbers" | "charts";

interface SubMeta {
  id: Sub;
  label: string;
  section: IntelSection;
}

const SUB_TABS: SubMeta[] = [
  { id: "usage",   label: "Usage & Logins",     section: "account-subscribers" },
  { id: "modules", label: "Module Activity",    section: "category-watch" },
  { id: "cw",      label: "Category Watch",     section: "category-watch" },
  { id: "abi",     label: "Abi Intelligence",   section: "abi" },
  { id: "sd",      label: "Supplier Discovery", section: "supplier-discovery" },
  { id: "srm",     label: "Supplier Risk",      section: "supplier-monitoring" },
  { id: "cc",      label: "Custom Credits",     section: "custom-usage" },
  { id: "su",      label: "Super Users",        section: "super-users" },
];

// ---------------- helpers ----------------

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

// ---------------- top-level ----------------

export default function AnalyticsTab() {
  const account = useAccountFromLayout();
  const { period } = useAccountPeriod();
  const [sub, setSub] = useState<Sub>("usage");
  const [mode, setMode] = useState<Mode>("charts");

  const meta = SUB_TABS.find((t) => t.id === sub)!;

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
          · window: <span className="font-semibold">{period ?? "90d"}</span>
        </div>
      </div>

      {/* Sub-tab strip + Numbers/Charts toggle */}
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex gap-1 flex-wrap">
          {SUB_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setSub(t.id)}
              className={cn(
                "text-[11px] px-2.5 py-1.5 rounded-md border-[1.5px] transition-colors",
                sub === t.id
                  ? "border-beroe-teal/40 bg-beroe-teal/10 text-beroe-teal font-bold"
                  : "border-beroe-card-border bg-white text-text-secondary font-medium hover:bg-beroe-bg/60",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex gap-0.5 bg-beroe-bg rounded-md p-0.5 flex-shrink-0">
          {(["numbers", "charts"] as Mode[]).map((mv) => (
            <button
              key={mv}
              onClick={() => setMode(mv)}
              className={cn(
                "text-[11px] px-2.5 py-1 rounded font-semibold uppercase tracking-wider",
                mode === mv
                  ? "bg-white shadow-sm text-beroe-teal"
                  : "text-text-muted",
              )}
            >
              {mv === "numbers" ? "#" : "📊 Chart"}
            </button>
          ))}
        </div>
      </div>

      <SubLoader
        accountId={account.id}
        period={period}
        sub={sub}
        section={meta.section}
        mode={mode}
      />
    </div>
  );
}

// ---------------- lazy fetch + dispatch ----------------

function SubLoader({
  accountId,
  period,
  sub,
  section,
  mode,
}: {
  accountId: string;
  period: ReturnType<typeof useAccountPeriod>["period"];
  sub: Sub;
  section: IntelSection;
  mode: Mode;
}) {
  switch (sub) {
    case "usage":
      return <FetchAndRender<AccountSubscribers> accountId={accountId} period={period} section={section}
        render={(d) => <UsageSection data={d} mode={mode} />} />;
    case "modules":
    case "cw":
      return <FetchAndRender<CategoryWatch> accountId={accountId} period={period} section={section}
        render={(d) => sub === "modules"
          ? <ModulesSection data={d} mode={mode} />
          : <CWSection data={d} mode={mode} />} />;
    case "abi":
      return <FetchAndRender<Abi> accountId={accountId} period={period} section={section}
        render={(d) => <AbiSection data={d} mode={mode} />} />;
    case "sd":
      return <FetchAndRender<SupplierDiscovery> accountId={accountId} period={period} section={section}
        render={(d) => <SDSection data={d} mode={mode} />} />;
    case "srm":
      return <FetchAndRender<SupplierMonitoring> accountId={accountId} period={period} section={section}
        render={(d) => <SRMSection data={d} mode={mode} />} />;
    case "cc":
      return <FetchAndRender<CustomUsage> accountId={accountId} period={period} section={section}
        render={(d) => <CCSection data={d} mode={mode} />} />;
    case "su":
      return <FetchAndRender<SuperUsersBundle> accountId={accountId} period={period} section={section}
        render={(d) => <SUSection data={d} mode={mode} />} />;
  }
}

function FetchAndRender<T>({
  accountId, period, section, render,
}: {
  accountId: string;
  period: ReturnType<typeof useAccountPeriod>["period"];
  section: IntelSection;
  render: (d: T) => React.ReactNode;
}) {
  const { data, isLoading, isError, error } = useIntelBundle<T>(accountId, period, section);
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
        <div className="text-[13px] font-semibold mb-1 text-risk-red">Couldn't load this section</div>
        <div className="text-[11px] text-text-secondary">
          {status === 409
            ? "Account not mapped to redshift_company_name yet."
            : (error as { message?: string })?.message ?? "Unknown error"}
        </div>
      </Card>
    );
  }
  if (!data) return null;
  return <>{render(data)}</>;
}

// ============================================================
// Section components — Numbers + Charts variants
// ============================================================

function UsageSection({ data: a, mode }: { data: AccountSubscribers; mode: Mode }) {
  if (mode === "numbers") {
    return (
      <Card>
        <CardTitle>Usage & Logins — raw figures</CardTitle>
        <SimpleTable
          cols={[
            { key: "metric", label: "Metric" },
            { key: "value", label: "Value", numeric: true },
          ]}
          rows={[
            { metric: "Total subscribers", value: fmtNum(a.total_subscribers) },
            { metric: "Active subscribers (≥1 login)", value: fmtNum(a.active_subscribers) },
            { metric: "Total logins", value: fmtNum(a.total_logins) },
            { metric: "Total time on platform (mins)", value: fmtNum(Math.round(a.total_time_spent_mins)) },
            { metric: "Categories unlocked", value: fmtNum(a.categories_unlocked) },
            { metric: "Subscription start", value: fmtDate(a.subscription_start) },
            { metric: "Subscription end", value: fmtDate(a.subscription_end) },
            { metric: "Company last login", value: fmtDate(a.company_last_login) },
          ]}
        />
      </Card>
    );
  }
  const active_pct = a.total_subscribers
    ? Math.round((a.active_subscribers / a.total_subscribers) * 100)
    : 0;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiTile label="Total Subscribers" value={fmtNum(a.total_subscribers)} accent={PALETTE.indigo} />
        <KpiTile
          label="Active Subscribers"
          value={fmtNum(a.active_subscribers)}
          sub={`${active_pct}% of total`}
          accent={PALETTE.aqua}
        />
        <KpiTile label="Total Logins" value={fmtNum(a.total_logins)} accent={PALETTE.fuscia} />
        <KpiTile
          label="Total Time (mins)"
          value={fmtNum(Math.round(a.total_time_spent_mins))}
          accent={PALETTE.bumblebee}
        />
      </div>
      <Card>
        <CardTitle>Active / Inactive split</CardTitle>
        <DonutChart
          slices={[
            { label: "Active", value: a.active_subscribers, color: PALETTE.aqua },
            {
              label: "Inactive",
              value: Math.max(0, a.total_subscribers - a.active_subscribers),
              color: PALETTE.slate,
            },
          ]}
        />
      </Card>
    </div>
  );
}

function ModulesSection({ data: cw, mode }: { data: CategoryWatch; mode: Mode }) {
  const mmd = cw.mmd;
  if (mode === "numbers") {
    return (
      <Card>
        <CardTitle>Module Activity (MMD) — raw figures</CardTitle>
        <SimpleTable
          cols={[
            { key: "metric", label: "Metric" },
            { key: "value", label: "Value", numeric: true },
          ]}
          rows={[
            { metric: "MMD subscribers", value: fmtNum(mmd.subscribers) },
            { metric: "Total time (mins)", value: fmtNum(Math.round(mmd.total_time_mins)) },
            { metric: "Avg time per user (mins)", value: mmd.avg_time_per_user_mins.toFixed(1) },
            { metric: "Unique categories viewed", value: fmtNum(mmd.unique_categories_viewed) },
            { metric: "Avg categories per user", value: mmd.avg_categories_per_user.toFixed(1) },
          ]}
        />
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <KpiTile label="MMD Subscribers" value={fmtNum(mmd.subscribers)} accent={PALETTE.indigo} />
        <KpiTile
          label="Total Time (m)"
          value={fmtNum(Math.round(mmd.total_time_mins))}
          accent={PALETTE.aqua}
        />
        <KpiTile
          label="Avg Time / User"
          value={mmd.avg_time_per_user_mins.toFixed(1)}
          accent={PALETTE.fuscia}
        />
        <KpiTile
          label="Unique Categories"
          value={fmtNum(mmd.unique_categories_viewed)}
          accent={PALETTE.bumblebee}
        />
        <KpiTile label="Avg Cats / User" value={mmd.avg_categories_per_user.toFixed(1)} />
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
    </div>
  );
}

function CWSection({ data: cw, mode }: { data: CategoryWatch; mode: Mode }) {
  // Category Intelligence — most KPIs are NA pills today.
  void mode; // numbers/charts not differentiated for NA-heavy view
  const ci = cw.category_intelligence;
  return (
    <div className="space-y-3">
      <Card>
        <CardTitle>Category Intelligence — data-pipeline status</CardTitle>
        <div className="text-[11px] text-text-muted mb-3">
          Most KPIs in this section need DBA grants on
          <code className="mx-1">stg_user_cat_sup_report</code>
          and the <code>stg_category*_reporttype</code> family. Surfaced below
          for transparency.
        </div>
        <ul className="space-y-1.5 text-[11px]">
          {Object.entries(ci).map(([k, v]) => (
            <li key={k} className="flex items-start gap-2">
              <span className="font-medium text-text-secondary flex-1">
                {k.replace(/_/g, " ")}
              </span>
              {typeof v === "number" ? (
                <span className="font-semibold tabular-nums">{fmtNum(v)}</span>
              ) : isUnavailable(v) ? (
                <NaPill reason={v.reason} />
              ) : (
                <span className="text-text-muted">—</span>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function AbiSection({ data: a, mode }: { data: Abi; mode: Mode }) {
  if (mode === "numbers") {
    return (
      <Card>
        <CardTitle>Abi Intelligence — raw figures</CardTitle>
        <SimpleTable
          cols={[
            { key: "metric", label: "Metric" },
            { key: "value", label: "Value", numeric: true },
          ]}
          rows={[
            { metric: "Total queries", value: fmtNum(a.total_queries) },
            { metric: "Unique users", value: fmtNum(a.unique_users) },
            { metric: "Bot resolution %", value: `${a.bot_resolution_pct}%` },
            { metric: "Repeat users %", value: `${a.repeat_users_pct}%` },
            { metric: "Avg feedback (1-5)", value: a.avg_feedback == null ? "—" : a.avg_feedback.toFixed(2) },
            { metric: "Thumbs-up %", value: a.thumbs_up_pct == null ? "—" : `${a.thumbs_up_pct}%` },
          ]}
        />
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiTile label="Total Queries" value={fmtNum(a.total_queries)} accent={PALETTE.indigo} />
        <KpiTile label="Unique Users" value={fmtNum(a.unique_users)} accent={PALETTE.aqua} />
        <KpiTile label="Bot Resolution" value={`${a.bot_resolution_pct}%`} accent={PALETTE.fuscia} />
        <KpiTile label="Repeat Users" value={`${a.repeat_users_pct}%`} accent={PALETTE.bumblebee} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardTitle>Queries by complexity</CardTitle>
          <DonutChart slices={a.by_complexity.map((c) => ({ label: c.label, value: c.count }))} />
        </Card>
        <Card>
          <CardTitle>Query status</CardTitle>
          <DonutChart slices={a.by_status.map((c) => ({ label: c.label, value: c.count }))} />
        </Card>
        <Card>
          <CardTitle>Top deliverable</CardTitle>
          <BarChart rows={barRows(a.top_deliverable)} />
        </Card>
        <Card>
          <CardTitle>Query channel</CardTitle>
          <BarChart rows={barRows(a.by_source)} />
        </Card>
      </div>
    </div>
  );
}

function SDSection({ data: s, mode }: { data: SupplierDiscovery; mode: Mode }) {
  if (mode === "numbers") {
    return (
      <Card>
        <CardTitle>Supplier Discovery — raw figures</CardTitle>
        <SimpleTable
          cols={[{ key: "metric", label: "Metric" }, { key: "value", label: "Value", numeric: true }]}
          rows={[
            { metric: "Users", value: fmtNum(s.users) },
            { metric: "Total searches", value: fmtNum(s.total_searches) },
            { metric: "Total visits", value: fmtNum(s.total_visits) },
            { metric: "Total time (mins)", value: fmtNum(Math.round(s.total_time_mins)) },
            { metric: "Avg searches per user", value: s.avg_searches_per_user.toFixed(1) },
            { metric: "Repeat users %", value: `${s.repeat_users_pct}%` },
          ]}
        />
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiTile label="Users" value={fmtNum(s.users)} accent={PALETTE.indigo} />
        <KpiTile label="Total Searches" value={fmtNum(s.total_searches)} accent={PALETTE.aqua} />
        <KpiTile label="Total Visits" value={fmtNum(s.total_visits)} accent={PALETTE.fuscia} />
        <KpiTile
          label="Total Time (m)"
          value={fmtNum(Math.round(s.total_time_mins))}
          accent={PALETTE.bumblebee}
        />
      </div>
      <Card>
        <CardTitle>Top categories searched</CardTitle>
        <BarChart rows={barRows(s.top_categories_searched)} />
      </Card>
    </div>
  );
}

function SRMSection({ data: s, mode }: { data: SupplierMonitoring; mode: Mode }) {
  void mode;
  return (
    <div className="space-y-3">
      <Card>
        <CardTitle>Supplier Monitoring Risk — data-pipeline status</CardTitle>
        <div className="text-[11px] text-text-muted mb-3">
          Most KPIs require <code>stg_user_cat_sup_report</code> — pending DBA grant.
          Time-on-module is available via session_log filter.
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
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
      </Card>
    </div>
  );
}

function CCSection({ data: c, mode }: { data: CustomUsage; mode: Mode }) {
  const cbc = c.credits_by_complexity;
  if (mode === "numbers") {
    return (
      <Card>
        <CardTitle>Custom Credits — raw figures</CardTitle>
        {c.credits_by_complexity_note && (
          <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-1.5 mb-2">
            ⚠ {c.credits_by_complexity_note}
          </div>
        )}
        <SimpleTable
          cols={[{ key: "metric", label: "Metric" }, { key: "value", label: "Value", numeric: true }]}
          rows={[
            { metric: "L1", value: fmtNum(cbc.L1) },
            { metric: "L2", value: fmtNum(cbc.L2) },
            { metric: "L3", value: fmtNum(cbc.L3) },
            { metric: "L4", value: fmtNum(cbc.L4) },
            { metric: "Total (proxy)", value: fmtNum(c.total_credits_used) },
            { metric: "Commodity dashboards", value: fmtNum(c.commodity_dashboards) },
            { metric: "Country reports", value: fmtNum(c.country_reports) },
            {
              metric: "Client feedback",
              value: c.client_feedback_score == null ? "—" : c.client_feedback_score.toFixed(2),
            },
          ]}
        />
      </Card>
    );
  }
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
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardTitle>AI SWAT vs Basics</CardTitle>
          <DonutChart
            slices={c.ai_swat_vs_basics.map((r) => ({ label: r.label, value: r.count }))}
          />
        </Card>
        <Card>
          <CardTitle>Top deliverables</CardTitle>
          <BarChart rows={barRows(c.top_deliverables)} />
        </Card>
      </div>
    </div>
  );
}

function SUSection({ data: su, mode }: { data: SuperUsersBundle; mode: Mode }) {
  if (mode === "numbers") {
    return (
      <Card>
        <CardTitle>Super Users — top {su.top_n}</CardTitle>
        <SimpleTable
          cols={[
            { key: "email", label: "User" },
            { key: "score", label: "Score", numeric: true },
            { key: "logins", label: "Logins", numeric: true },
            { key: "queries", label: "Abi", numeric: true },
            { key: "searches", label: "SD", numeric: true },
            { key: "mmd_time", label: "MMD m", numeric: true },
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
            downloads: u.report_downloads,
            last_login: fmtDate(u.last_login),
          }))}
        />
      </Card>
    );
  }
  return (
    <div className="space-y-3">
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
      <Card>
        <CardTitle>Activity score (top {Math.min(10, su.users.length)})</CardTitle>
        <BarChart
          rows={su.users.slice(0, 10).map((u, i) => ({
            label: u.email,
            value: u.activity_score,
            color: SERIES_COLORS[i % SERIES_COLORS.length],
          }))}
        />
      </Card>
    </div>
  );
}
