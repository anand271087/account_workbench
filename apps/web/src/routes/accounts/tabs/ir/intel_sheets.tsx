// 05-Jun · Per-sheet dashboards for the IntelligenceTab.
//
// One component per sheet of Analytics_DataPoints_v10.xlsx (16 sheets,
// excluding Auto-computed Scores which lives on the existing
// /appetite-score endpoint). Each component renders EVERY parameter
// from its spec sheet — live values for what we can fetch, NaPill for
// what's pending DBA grants or offline.

import React, { useMemo, useState } from "react";

import type {
  Abi,
  AccountSubscribers,
  Alerts as AlertsBundle,
  CategoryWatch,
  CustomUsage,
  DataHub as DataHubBundle,
  InflationWatch,
  LabelCount,
  Maybe,
  OfflineBundle,
  ScoresBundle,
  SuperUsersBundle,
  SupplierDiscovery,
  SupplierMonitoring,
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
  ParamRow,
  SERIES_COLORS,
  SimpleTable,
  SplitBar,
} from "./charts";
import { IntelUploadButton, type IntelUploadSource } from "@/components/IntelUploadButton";
import { useAccountFromLayout } from "../../AccountProfileLayout";

// AnalyticsTab passes mode="numbers" to render a compact parameter
// list only (no KPI tiles, no charts). IntelligenceTab leaves it
// undefined → full rich dashboard.
export type SheetMode = "numbers" | "charts";

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

function val(v: unknown): React.ReactNode {
  if (v == null || v === "") return <span className="text-text-muted">—</span>;
  if (typeof v === "number") return fmtNum(v);
  if (typeof v === "string") return v;
  // 08-Jun · Defensive — after wiring Redshift bundles, several fields
  // that used to be Maybe<number> stubs now return arrays of
  // {label, count} / {month, value} / row records. Rendering an object
  // directly throws "Objects are not valid as a React child", blanking
  // the whole sheet. Summarize gracefully here so the Numbers view
  // still loads; Chart mode renders these as bars / lists / tables.
  if (Array.isArray(v)) {
    if (v.length === 0) return <span className="text-text-muted">—</span>;
    // Short list of strings? Join. Otherwise show a count summary.
    if (v.every((x) => typeof x === "string")) {
      const s = (v as string[]).slice(0, 6).join(", ");
      return v.length > 6 ? `${s} · +${v.length - 6} more` : s;
    }
    return `${v.length} entries`;
  }
  if (typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>);
    const compact = entries.every(
      ([, x]) => typeof x === "number" || typeof x === "string",
    );
    if (compact && entries.length <= 6) {
      return entries.map(([k, x]) => `${k}: ${x}`).join(" · ");
    }
    return `${entries.length} fields`;
  }
  return String(v);
}

function na(reason: string): React.ReactNode {
  return <NaPill reason={reason} />;
}

function maybeVal(m: Maybe<unknown>): React.ReactNode {
  if (isUnavailable(m)) return na(m.reason);
  return val(m);
}

function barRows(items: LabelCount[]): Array<{ label: string; value: number; color: string }> {
  return items.slice(0, 10).map((r, i) => ({
    label: r.label || "(blank)",
    value: r.count,
    color: SERIES_COLORS[i % SERIES_COLORS.length],
  }));
}

// ============================================================
// 1 — Account & Subscribers (9 spec params)
// ============================================================

// 09-Jun · DevSpec parity rebuild — 10 KPI tiles with source pills,
// Subscriber Status donut, 12-month trend line, Account Details
// metadata card. Mirrors the prototype HTML the stakeholder is
// comparing against.
type KpiSource = "redshift" | "app" | "offline";
// 10-Jun · Per-chart source badges hidden by stakeholder request — the
// SOURCE_LABEL / SOURCE_TONE maps are no longer rendered. Kept the
// KpiSource union so existing prop types still typecheck.

// 10-Jun · Stakeholder request — drop the per-chart "In Redshift" /
// "Offline" badges so the page reads cleaner. SourcePill, SourcedKpi
// (its badge overlay), SourceLegend and SourcePillCounter all render
// nothing; every existing call site keeps compiling without churn.
function SourcePill(_: { source: KpiSource }) {
  return null;
}

function SourcedKpi({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  source: KpiSource;
  accent?: string;
}) {
  return <KpiTile label={label} value={value} sub={sub} accent={accent} />;
}

function SourceLegend() {
  return null;
}

function fmtMonth(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

const STATUS_TONE: Record<string, string> = {
  // 10-Jun · Analytics Error Tracker row 4 — labels now come from
  // existing_user_sub_start_rev_v2.status. Active is kept for callers
  // that still synthesize the split client-side.
  "Logged-in": "#6EC457",
  Active: "#6EC457",
  Inactive: "#F0BC41",
  "Yet to login": "#94a3b8",
};

export function SubscribersSheet({ data: a, mode }: { data: AccountSubscribers; mode?: SheetMode }) {
  const account = useAccountFromLayout();
  const active_pct = a.total_subscribers
    ? Math.round((a.active_subscribers / a.total_subscribers) * 100)
    : 0;
  const avg_logins_per_user = a.active_subscribers
    ? +(a.total_logins / a.active_subscribers).toFixed(1)
    : 0;
  const total_time_hrs = Math.round(a.total_time_spent_mins / 60);

  if (mode === "numbers") {
    return (
      <Card>
        <CardTitle>All 10 parameters from spec sheet</CardTitle>
        <ParamRow label="Total subscribers" definition="Licensed subscribers on the account" value={val(a.total_subscribers)} />
        <ParamRow label="Active subscribers" definition={`${active_pct}% of total`} value={val(a.active_subscribers)} />
        <ParamRow label="Total logins — current subscription" value={val(a.total_logins)} />
        <ParamRow label="Total time spent (mins)" value={val(Math.round(a.total_time_spent_mins))} />
        <ParamRow label="# Categories unlocked" value={val(a.categories_unlocked)} />
        <ParamRow label="# Suppliers unlocked" value={maybeVal(a.suppliers_added as Maybe<number>)} />
        <ParamRow label="# Categories contracted" value={val(a.categories_contracted ?? 0)} />
        <ParamRow label="# Suppliers contracted" value={val(a.suppliers_contracted ?? 0)} />
        <ParamRow label="Type of Contract" value={a.type_of_contract || "—"} />
        <ParamRow label="Repeat Users" value={a.repeat_users_pct == null ? "—" : `${a.repeat_users_pct}%`} />
        <ParamRow label="WAU / MAU" value={a.wau_mau_pct == null ? "—" : `${a.wau_mau_pct}%`} />
        <ParamRow
          label="Subscriber Status"
          value={a.subscriber_status_split.map((s) => `${s.label} ${s.count}`).join(" · ") || "—"}
        />
        <ParamRow
          label="% Active Users — Trailing 12 Months"
          value={`${a.active_users_12m_trend.length} months of data`}
        />
      </Card>
    );
  }

  // Donut + line data
  const statusSplit = a.subscriber_status_split.length
    ? a.subscriber_status_split
    : [
        { label: "Active" as const, count: a.active_subscribers, pct: active_pct },
        {
          label: "Inactive" as const,
          count: Math.max(a.total_subscribers - a.active_subscribers, 0),
          pct: Math.max(100 - active_pct, 0),
        },
      ];

  return (
    <div className="space-y-3">
      {/* 8 KPI tiles matching DevSpec Account Summary order */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
        <SourcedKpi label="Total Subscribers" value={fmtNum(a.total_subscribers)} source="redshift" accent={PALETTE.indigo} />
        <SourcedKpi
          label="Active Subscribers"
          value={fmtNum(a.active_subscribers)}
          sub={`${active_pct}% of total`}
          source="redshift"
          accent={PALETTE.aqua}
        />
        <SourcedKpi
          label="Total Logins — Current Subscription"
          value={fmtNum(a.total_logins)}
          source="redshift"
          accent={PALETTE.fuscia}
        />
        <SourcedKpi
          label="Total Time Spent"
          value={`${fmtNum(total_time_hrs)}h`}
          sub={`${fmtNum(Math.round(a.total_time_spent_mins))} mins`}
          source="redshift"
          accent={PALETTE.bumblebee}
        />
        <SourcedKpi label="# Categories Unlocked" value={fmtNum(a.categories_unlocked)} source="redshift" accent={PALETTE.midnight} />
        <SourcedKpi
          label="# Suppliers Unlocked"
          value={fmtNum(((a.suppliers_added as Maybe<number>) as number) ?? 0)}
          source="redshift"
          accent={PALETTE.indigo}
        />
        <SourcedKpi
          label="Repeat Users"
          value={a.repeat_users_pct == null ? "—" : `${a.repeat_users_pct}%`}
          sub="logins > 1 per user"
          source="redshift"
          accent={PALETTE.aqua}
        />
        <SourcedKpi
          label="WAU / MAU"
          value={a.wau_mau_pct == null ? "—" : `${a.wau_mau_pct}%`}
          sub="7-day ÷ 30-day actives"
          source="redshift"
          accent={PALETTE.fuscia}
        />
      </div>

      {/* Subscriber Status donut + 12-month trend line */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <Card>
          <div className="flex items-center justify-between mb-2">
            <CardTitle>Subscriber Status</CardTitle>
            <SourcePill source="redshift" />
          </div>
          <DonutChart
            slices={statusSplit.map((s) => ({
              label: s.label,
              value: s.count,
              color: STATUS_TONE[s.label] || PALETTE.midnight,
            }))}
            centerLabel={fmtNum(a.total_subscribers)}
          />
          <div className="mt-2 space-y-1">
            {statusSplit.map((s) => (
              <div key={s.label} className="flex items-center justify-between text-[11.5px]">
                <span className="flex items-center gap-2 text-analytics-ink-2">
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ background: STATUS_TONE[s.label] || PALETTE.midnight }}
                  />
                  {s.label}
                </span>
                <span className="font-mono text-analytics-ink">
                  {fmtNum(s.count)} <span className="text-analytics-muted">({s.pct}%)</span>
                </span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <div className="flex items-center justify-between mb-2">
            <CardTitle>% Active Users — Trailing 12 Months</CardTitle>
            <SourcePill source="redshift" />
          </div>
          {a.active_users_12m_trend.length === 0 ? (
            <div className="text-[11.5px] text-analytics-muted italic py-6 text-center">
              No session activity in the past 12 months.
            </div>
          ) : (
            <LineChart
              labels={a.active_users_12m_trend.map((p) => fmtMonth(p.month))}
              values={a.active_users_12m_trend.map((p) => p.pct_active)}
            />
          )}
        </Card>
      </div>

      {/* Account Details metadata card */}
      <Card>
        <div className="flex items-center justify-between mb-2">
          <CardTitle>Account Details</CardTitle>
          <div className="text-[10px] uppercase tracking-wider font-bold text-analytics-muted">
            Reference
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
          <ParamRow label="Segment Type" value={account.segment ?? "—"} />
          <ParamRow label="Subscription Start" value={fmtDate(a.subscription_start) ?? "—"} />
          <ParamRow label="Subscription End" value={fmtDate(a.subscription_end) ?? "—"} />
          <ParamRow label="Company Last Login" value={fmtDate(a.company_last_login) ?? "—"} />
          <ParamRow label="CSM Name" value={account.csm_full_name ?? "—"} />
          <ParamRow label="CO Name" value={account.co_full_name ?? "—"} />
          <ParamRow
            label="Avg. Logins / User"
            value={avg_logins_per_user ? `${avg_logins_per_user} / month` : "—"}
          />
          <ParamRow label="Type of Contract" value={a.type_of_contract || account.gate_contract_term || "—"} />
          <ParamRow label="# Categories Contracted" value={a.categories_contracted != null ? fmtNum(a.categories_contracted) : "—"} />
          <ParamRow label="# Suppliers Contracted" value={a.suppliers_contracted != null ? fmtNum(a.suppliers_contracted) : "—"} />
        </div>
        <SourceLegend />
      </Card>

      {/* Spec v11 row 14 — per-user first/last login table. */}
      <PerUserLoginsTable rows={a.per_user_logins ?? []} />
    </div>
  );
}

function PerUserLoginsTable({
  rows,
}: {
  rows: Array<{
    email: string;
    first_login: string | null;
    last_login: string | null;
    sessions: number;
  }>;
}) {
  const [open, setOpen] = useState(false);
  if (!rows.length) return null;
  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between text-left"
      >
        <CardTitle>Per-user activity ({rows.length})</CardTitle>
        <span className="text-[11px] font-semibold text-analytics-teal-700">
          {open ? "Hide ▴" : "Show all ▾"}
        </span>
      </button>
      {open && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-[11.5px]">
            <thead>
              <tr className="border-b border-analytics-line text-left text-analytics-muted font-semibold uppercase tracking-[0.4px] text-[10px]">
                <th className="py-1.5 pr-3">Email</th>
                <th className="py-1.5 pr-3">First login</th>
                <th className="py-1.5 pr-3">Last login</th>
                <th className="py-1.5 pr-3 text-right">Sessions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.email} className="border-b border-analytics-line-2 last:border-b-0">
                  <td className="py-1.5 pr-3 font-mono text-analytics-ink text-[11px]">
                    {r.email}
                  </td>
                  <td className="py-1.5 pr-3 text-analytics-ink-2">
                    {fmtDate(r.first_login) ?? "—"}
                  </td>
                  <td className="py-1.5 pr-3 text-analytics-ink-2">
                    {fmtDate(r.last_login) ?? "—"}
                  </td>
                  <td className="py-1.5 pr-3 text-right font-mono text-analytics-ink">
                    {r.sessions}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ============================================================
// 2 — Category Watch (29 spec params: 16 CI + 8 MMD + 5 BM)
// ============================================================

export function CategoryWatchSheet({ data: cw, mode }: { data: CategoryWatch; mode?: SheetMode }) {
  const ci = cw.category_intelligence;
  const mmd = cw.mmd;
  const bm = cw.benchmarks;

  // Three Cards summarising all 29 parameters — these are shown in both modes.
  const ciCard = (
    <Card>
        <CardTitle>Category Intelligence (16 params)</CardTitle>
        <div className="text-[10px] text-text-muted mb-2">
          Live from Redshift (stg_user_cat_sup_report +
          stg_category*_reporttype). Only "Industry-relevant %" remains
          NA — sourced from a SharePoint Industry Mapping file.
        </div>
        <ParamRow label="# Categories Unlocked" value={maybeVal(ci.categories_unlocked as Maybe<number>)} />
        <ParamRow label="Avg categories unlocked / user" value={maybeVal(ci.avg_categories_per_user as Maybe<number>)} />
        <ParamRow label="Categories added trend (monthly)" value={maybeVal(ci.categories_added_monthly_trend as Maybe<number>)} />
        <ParamRow label="Categories newly added (period)" value={maybeVal(ci.categories_newly_added_period as Maybe<number>)} />
        {/* 10-Jun · Analytics Error Tracker row 12 — Category type breakdown removed. */}
        <ParamRow label="# Category visits" value={maybeVal(ci.category_visits as Maybe<number>)} />
        <ParamRow label="Category revisit %" value={maybeVal(ci.category_revisit_pct as Maybe<number>)} />
        <ParamRow label="Avg time spent / subscriber (mins)" value={val(ci.avg_time_per_subscriber_mins as number)} />
        <ParamRow label="Industry-relevant categories added %" value={maybeVal(ci.industry_relevant_pct as Maybe<number>)} />
        <ParamRow label="Spend pool (top n)" value={maybeVal(ci.spend_pool_top_n as Maybe<number>)} />
        <ParamRow label="# Report downloads (total)" value={maybeVal(ci.report_downloads_total as Maybe<number>)} />
        <ParamRow label="# Report views (total)" value={maybeVal(ci.report_views_total as Maybe<number>)} />
        {/* 10-Jun · Analytics Error Tracker rows 13, 14 — renamed to Reports. */}
        <ParamRow label="Top 10 Reports Viewed" value={maybeVal(ci.top_report_views as Maybe<number>)} />
        <ParamRow label="Top 10 Reports Downloaded" value={maybeVal(ci.top_report_downloads as Maybe<number>)} />
        <ParamRow label="Reports downloaded monthly trend" value={maybeVal(ci.reports_downloaded_monthly_trend as Maybe<number>)} />
        <ParamRow label="Added categories detail" value={maybeVal(ci.added_categories_detail as Maybe<number>)} />
      </Card>
  );

  const mmdCard = (
      <Card>
        <CardTitle>Market Movement Dashboard (8 params) — LIVE</CardTitle>
        <ParamRow label="Subscribers (MMD)" value={val(mmd.subscribers)} />
        <ParamRow label="Total time spent (mins)" value={val(Math.round(mmd.total_time_mins))} />
        <ParamRow label="Avg time spent (mins)" value={val(mmd.avg_time_per_user_mins)} />
        <ParamRow label="Unique categories viewed" value={val(mmd.unique_categories_viewed)} />
        <ParamRow label="Avg categories viewed / user" value={val(mmd.avg_categories_per_user)} />
        {/* 10-Jun · Analytics Error Tracker rows 17, 18 — MMD grade/region tables removed. */}
        <ParamRow label="MMD module visits (monthly)" value={val(mmd.monthly_trend.length || 0)} />
      </Card>
  );

  const bmCard = (
      <Card>
        <CardTitle>Category Benchmarks (5 params)</CardTitle>
        {/* 10-Jun · Analytics Error Tracker rows 19, 20, 21 — renamed. */}
        <ParamRow label="# Benchmarks done" value={maybeVal(bm.total_benchmark_responses as Maybe<number>)} />
        <ParamRow label="# Users" value={maybeVal(bm.total_subscribers_responded as Maybe<number>)} />
        <ParamRow label="Benchmark question categories" value={maybeVal(bm.benchmark_question_categories as Maybe<number>)} />
        <ParamRow label="Total time spent in benchmark (mins)" value={val(bm.benchmark_time_mins as number)} />
        <ParamRow label="RFx template downloads" value={maybeVal(bm.rfx_template_downloads as Maybe<number>)} />
      </Card>
  );

  if (mode === "numbers") {
    return <div className="space-y-3">{ciCard}{mmdCard}{bmCard}</div>;
  }

  // 08-Jun · Charts mode rebuilt to match Analytics_DataPoints_v10.xlsx
  // Representation column. Each KPI rendered with its spec-prescribed
  // viz: KPI stat → KpiTile, Line chart → LineChart, Bar chart → BarChart,
  // Stacked bar → SplitBar, Gauge → small radial badge, Table → SimpleTable.
  // KPI tiles row groups every "KPI stat" line into a tight 5-up grid.

  // ---- Category Intelligence helpers ----
  const catTrend = Array.isArray(ci.categories_added_monthly_trend)
    ? (ci.categories_added_monthly_trend as Array<{ month: string; categories: number }>)
    : [];
  const newlyAdded = Array.isArray(ci.categories_newly_added_period)
    ? (ci.categories_newly_added_period as string[])
    : [];
  const topViews = Array.isArray(ci.top_report_views)
    ? (ci.top_report_views as Array<{ label: string; count: number }>)
    : [];
  const topDownloads = Array.isArray(ci.top_report_downloads)
    ? (ci.top_report_downloads as Array<{ label: string; count: number }>)
    : [];
  const spendPool = Array.isArray(ci.spend_pool_top_n)
    ? (ci.spend_pool_top_n as Array<{ label: string; count: number }>)
    : [];
  const dlTrend = Array.isArray(ci.reports_downloaded_monthly_trend)
    ? (ci.reports_downloaded_monthly_trend as Array<{ month: string; downloads: number }>)
    : [];
  const addedDetail = Array.isArray(ci.added_categories_detail)
    ? (ci.added_categories_detail as Array<{
        email: string; category: string; supplier: string | null; added_at: string | null;
      }>)
    : [];
  const revisitPct = typeof ci.category_revisit_pct === "number"
    ? (ci.category_revisit_pct as number) : 0;

  return (
    <div className="space-y-3">
      {/* Category Intelligence — section header */}
      <Card>
        <CardTitle>Category Intelligence</CardTitle>
        <div className="text-[10px] text-text-muted mb-2.5">
          Live from Redshift (stg_user_cat_sup_report + stg_category*_reporttype).
        </div>

        {/* KPI-stat row — 09-Jun expanded from 6 to 8 tiles to cover
            DevSpec rows: # Unique users + # Total Time Spent. */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 gap-2 mb-3">
          <KpiTile label="# Unique users" value={fmtNum((ci.unique_users as number) ?? 0)} accent={PALETTE.aqua}
            sub={typeof ci.unique_users_note === "string" ? "downloads-only" : undefined} />
          <KpiTile label="% Revisits" value={`${revisitPct}%`} accent={PALETTE.indigo} />
          <KpiTile label="# Categories Unlocked" value={fmtNum(ci.categories_unlocked as number)} accent={PALETTE.fuscia} />
          <KpiTile label="Avg categories unlocked / user" value={(ci.avg_categories_per_user as number).toFixed(2)} accent={PALETTE.bumblebee} />
          <KpiTile
            label="# Total Time Spent"
            value={(() => {
              const m = (ci.total_time_mins as number) ?? 0;
              return m >= 60 ? `${(m / 60).toFixed(0)}h` : `${m.toFixed(0)}m`;
            })()}
            sub={`${fmtNum(Math.round((ci.total_time_mins as number) ?? 0))} mins`}
            accent={PALETTE.midnight}
          />
          <KpiTile label="Avg time spent / subscriber" value={`${(ci.avg_time_per_subscriber_mins as number).toFixed(1)} mins`} accent={PALETTE.indigo} />
          <KpiTile label="# Report views (total)" value={fmtNum(ci.report_views_total as number)} accent={PALETTE.aqua} />
          <KpiTile label="# Report downloads (total)" value={fmtNum(ci.report_downloads_total as number)} accent={PALETTE.fuscia} />
        </div>

        {/* Visits gauge + revisit gauge — spec calls Category visits "Bar
            chart" but it's a single scalar; pair it with revisit_pct as
            two side-by-side tiles to give visual weight. */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <KpiTile label="# Category visits" value={fmtNum(ci.category_visits as number)} accent={PALETTE.aqua} />
          <RadialGauge label="Category revisit %" pct={revisitPct} color={PALETTE.fuscia} />
          {isUnavailable(ci.industry_relevant_pct) ? (
            <KpiTile
              label="Industry-relevant %"
              value="—"
              na={{ reason: ci.industry_relevant_pct.reason }}
            />
          ) : (
            <KpiTile
              label="Industry-relevant %"
              value={(ci.industry_relevant_pct as number).toFixed(0) + "%"}
              accent={PALETTE.indigo}
            />
          )}
        </div>

        {/* Monthly trends — 09-Jun added Category Watch visits as a
            third line chart (uses proxy from downloads when the views
            scan times out — see backend note). */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <div>
            <div className="text-[11px] font-semibold mb-1">Category additions over last 12 months</div>
            {catTrend.length === 0 ? (
              <div className="text-[11px] text-text-muted py-4 text-center">No data</div>
            ) : (
              <LineChart
                labels={catTrend.map((m) => m.month)}
                values={catTrend.map((m) => m.categories)}
                color={PALETTE.indigo}
                height={140}
              />
            )}
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <div className="text-[11px] font-semibold">Category Watch visits over last 12 months</div>
              {typeof ci.category_visits_monthly_trend_note === "string" && (
                <span className="text-[9px] uppercase tracking-wider font-bold px-1 py-0.5 rounded bg-amber-100 text-amber-700">
                  proxy
                </span>
              )}
            </div>
            {(() => {
              const visits = Array.isArray(ci.category_visits_monthly_trend)
                ? (ci.category_visits_monthly_trend as Array<{ month: string; visits: number }>)
                : [];
              if (visits.length === 0) {
                return <div className="text-[11px] text-text-muted py-4 text-center">No data</div>;
              }
              return (
                <LineChart
                  labels={visits.map((m) => m.month)}
                  values={visits.map((m) => m.visits)}
                  color={PALETTE.aqua}
                  height={140}
                />
              );
            })()}
          </div>
          <div>
            {/* Bonus chart kept from earlier — not in v4 spec but useful */}
            <div className="text-[11px] font-semibold mb-1">Report downloads — monthly trend</div>
            {dlTrend.length === 0 ? (
              <div className="text-[11px] text-text-muted py-4 text-center">No data</div>
            ) : (
              <LineChart
                labels={dlTrend.map((m) => m.month)}
                values={dlTrend.map((m) => m.downloads)}
                color={PALETTE.fuscia}
                height={140}
              />
            )}
          </div>
        </div>

        {/* 09-Jun · Direct : Indirect (Split) — spec donut. Source
            doesn't have a category→type mapping in Redshift, so we
            reserve the card with a "Pipeline needed" pill matching
            the DevSpec legend. */}
        {(() => {
          const dis = ci.direct_indirect_split as
            | { source_unavailable?: boolean; reason?: string }
            | undefined;
          if (!isUnavailable(dis)) return null;
          return (
            <div className="mb-3 rounded-[13px] border border-dashed border-analytics-line-2 bg-analytics-line-2/30 p-4">
              <div className="flex items-center justify-between mb-1">
                <div className="text-[12px] font-bold text-analytics-ink">
                  Direct : Indirect (Split)
                </div>
                <span
                  className="text-[9px] font-extrabold uppercase tracking-[0.4px] px-1.5 py-0.5 rounded-[5px]"
                  style={{ background: "#fce7f3", color: "#9d174d" }}
                >
                  Pipeline needed
                </span>
              </div>
              <div className="text-[10.5px] text-analytics-muted italic">
                {dis?.reason || "category→type mapping not available in source"}
              </div>
            </div>
          );
        })()}

        {/* 10-Jun · Analytics Error Tracker row 12 — Category type
            breakdown chart removed (no issue, just unwanted clutter). */}

        {/* Spend pool + Top categories added + Top report views/downloads */}
        {/* 10-Jun · Analytics Error Tracker rows 13, 14 — Top 10 viewed
            and downloaded relabelled to "Reports". */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
          <div>
            <div className="text-[11px] font-semibold mb-1">Top Spendpools</div>
            <BarChart rows={barRows(spendPool)} />
          </div>
          <div>
            <div className="text-[11px] font-semibold mb-1">Top 10 categories added</div>
            <BarChart
              rows={barRows(
                Array.isArray(ci.top_categories_added)
                  ? (ci.top_categories_added as LabelCount[])
                  : [],
              )}
            />
          </div>
          <div>
            <div className="text-[11px] font-semibold mb-1">Top 10 Reports Viewed</div>
            <BarChart rows={barRows(topViews)} />
          </div>
          <div>
            <div className="text-[11px] font-semibold mb-1">Top 10 Reports Downloaded</div>
            <BarChart rows={barRows(topDownloads)} />
          </div>
        </div>
      </Card>

      {/* MMD — section header */}
      <Card>
        <CardTitle>Market Movement Dashboard (MMD)</CardTitle>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
          <KpiTile label="Subscribers (MMD)" value={fmtNum(mmd.subscribers)} accent={PALETTE.indigo} />
          <KpiTile label="Total time spent (Mins)" value={fmtNum(Math.round(mmd.total_time_mins))} accent={PALETTE.aqua} />
          <KpiTile label="Avg time spent (Mins)" value={mmd.avg_time_per_user_mins.toFixed(1)} accent={PALETTE.fuscia} />
          <KpiTile label="Unique categories viewed" value={fmtNum(mmd.unique_categories_viewed)} accent={PALETTE.bumblebee} />
          <KpiTile label="Avg cats / user" value={mmd.avg_categories_per_user.toFixed(1)} accent={PALETTE.midnight} />
        </div>
        {/* 10-Jun · Analytics Error Tracker rows 17, 18 — Grades viewed
            and Regions viewed tables removed. */}
        <div>
          <div className="text-[11px] font-semibold mb-1">MMD module visits (monthly)</div>
          {mmd.monthly_trend.length === 0 ? (
            <div className="text-[11px] text-text-muted py-4 text-center">No data</div>
          ) : (
            <LineChart
              labels={mmd.monthly_trend.map((m) => m.month)}
              values={mmd.monthly_trend.map((m) => m.visits)}
              color={PALETTE.indigo}
              height={150}
            />
          )}
        </div>
      </Card>

      {/* Category Benchmarks */}
      <Card>
        <CardTitle>Category Benchmarks</CardTitle>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          {/* 10-Jun · Analytics Error Tracker rows 19, 20, 21 — renamed. */}
          <KpiTile
            label="# Benchmarks done"
            value={isUnavailable(bm.total_benchmark_responses) ? "—" : fmtNum(bm.total_benchmark_responses as number)}
            na={isUnavailable(bm.total_benchmark_responses) ? { reason: bm.total_benchmark_responses.reason } : undefined}
            accent={PALETTE.indigo}
          />
          <KpiTile
            label="# Users"
            value={isUnavailable(bm.total_subscribers_responded) ? "—" : fmtNum(bm.total_subscribers_responded as number)}
            na={isUnavailable(bm.total_subscribers_responded) ? { reason: bm.total_subscribers_responded.reason } : undefined}
            accent={PALETTE.aqua}
          />
          <KpiTile
            label="Time spent (m)"
            value={(bm.benchmark_time_mins as number)?.toFixed?.(1) ?? "—"}
            accent={PALETTE.fuscia}
          />
          <KpiTile
            label="RFx downloads"
            value="—"
            na={isUnavailable(bm.rfx_template_downloads) ? { reason: bm.rfx_template_downloads.reason } : undefined}
            accent={PALETTE.bumblebee}
          />
        </div>
        <div>
          <div className="text-[11px] font-semibold mb-1">Benchmark question categories</div>
          {isUnavailable(bm.benchmark_question_categories) ? (
            <NaPill reason={(bm.benchmark_question_categories as { reason: string }).reason} />
          ) : (
            <BarChart
              rows={barRows(
                bm.benchmark_question_categories as Array<{ label: string; count: number }>,
              )}
            />
          )}
        </div>
      </Card>

      {/* 10-Jun · Analytics Error Tracker rows 15, 16 — Categories newly
          added + Added categories detail moved to the bottom of the
          Category Watch sub-tab. */}
      {(newlyAdded.length > 0 || addedDetail.length > 0) && (
        <Card>
          <CardTitle>Categories added — recent activity</CardTitle>
          {newlyAdded.length > 0 && (
            <div className="mb-3">
              <div className="text-[11px] font-semibold mb-1">Categories newly added (period)</div>
              <div className="flex flex-wrap gap-1">
                {newlyAdded.slice(0, 30).map((c, i) => (
                  <span
                    key={i}
                    className="text-[10px] px-2 py-0.5 rounded-full bg-beroe-blue/10 border border-beroe-blue/30 text-beroe-blue"
                  >
                    {c}
                  </span>
                ))}
                {newlyAdded.length > 30 && (
                  <span className="text-[10px] text-text-muted self-center">
                    +{newlyAdded.length - 30} more
                  </span>
                )}
              </div>
            </div>
          )}
          {addedDetail.length > 0 && (
            <AddedCategoriesDetailGrouped rows={addedDetail} />
          )}
        </Card>
      )}
    </div>
  );
}

// 08-Jun · Grouped-by-user view for the spec's "Added categories detail"
// table (row 21). The flat 50-row SimpleTable read as a wall of text;
// grouping by email turns it into one card per user with their
// categories as chips + the latest add date. Collapses past 8 users
// with a "Show all" toggle.
function AddedCategoriesDetailGrouped({
  rows,
}: {
  rows: Array<{
    email: string;
    category: string;
    supplier: string | null;
    added_at: string | null;
  }>;
}) {
  // Group rows by email; preserve first-seen order so the most-recent
  // adder (rows come back date-desc) stays on top.
  const grouped = useMemo(() => {
    const map = new Map<
      string,
      {
        email: string;
        categories: Set<string>;
        suppliers: Set<string>;
        latest: string | null;
      }
    >();
    rows.forEach((r) => {
      const cur = map.get(r.email) ?? {
        email: r.email,
        categories: new Set<string>(),
        suppliers: new Set<string>(),
        latest: null,
      };
      if (r.category) cur.categories.add(r.category);
      if (r.supplier) cur.suppliers.add(r.supplier);
      if (r.added_at && (!cur.latest || r.added_at > cur.latest)) {
        cur.latest = r.added_at;
      }
      map.set(r.email, cur);
    });
    return Array.from(map.values()).sort((a, b) =>
      (b.latest ?? "").localeCompare(a.latest ?? ""),
    );
  }, [rows]);

  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? grouped : grouped.slice(0, 8);

  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <div className="text-[11px] font-semibold">Added categories detail</div>
        <div className="text-[10px] text-text-muted">
          {grouped.length} user{grouped.length === 1 ? "" : "s"} ·{" "}
          {rows.length} add{rows.length === 1 ? "" : "s"}
        </div>
      </div>
      <div className="space-y-1.5">
        {visible.map((u) => {
          const cats = Array.from(u.categories);
          return (
            <div
              key={u.email}
              className="rounded-md border border-beroe-card-border bg-white px-2.5 py-1.5"
            >
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <div className="text-[11.5px] font-semibold text-text-primary truncate">
                  {u.email}
                </div>
                <div className="text-[10px] text-text-muted whitespace-nowrap">
                  {cats.length} cat{cats.length === 1 ? "" : "s"}
                  {u.latest ? ` · last ${u.latest.slice(0, 10)}` : ""}
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {cats.slice(0, 12).map((c, i) => (
                  <span
                    key={i}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-beroe-blue/10 text-beroe-blue border border-beroe-blue/20"
                  >
                    {c}
                  </span>
                ))}
                {cats.length > 12 && (
                  <span className="text-[10px] text-text-muted self-center">
                    +{cats.length - 12} more
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {grouped.length > 8 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="mt-2 text-[10.5px] font-semibold text-beroe-blue hover:underline"
        >
          {showAll ? "Show top 8" : `Show all ${grouped.length} users →`}
        </button>
      )}
    </div>
  );
}

// 08-Jun · Compact radial gauge for the spec's "Gauge / KPI" representations
// (Category revisit %, future similar). 0..100 input, renders a partial
// arc + the % in the center.
// 09-Jun · Repainted to match the Account_Analytics_DevSpec_v3 card
// idiom — uses spec teal palette, Manrope text + IBM Plex Mono for the %.
function RadialGauge({
  label, pct, color = PALETTE.teal600,
}: {
  label: string;
  pct: number;
  color?: string;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  const R = 38;
  const C = 2 * Math.PI * R;
  const arc = (clamped / 100) * C;
  return (
    <div className="font-manrope rounded-[13px] border border-analytics-line bg-analytics-card py-[14px] px-[15px] flex items-center gap-3 shadow-[0_1px_2px_rgba(36,12,120,0.05),0_4px_14px_rgba(36,12,120,0.06)] hover:shadow-[0_8px_28px_rgba(36,12,120,0.13)] transition-shadow">
      <svg width={92} height={92} viewBox="0 0 92 92" className="flex-none">
        <circle cx={46} cy={46} r={R} stroke="#e3def0" strokeWidth={9} fill="none" />
        <circle
          cx={46}
          cy={46}
          r={R}
          stroke={color}
          strokeWidth={9}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${arc} ${C - arc}`}
          transform="rotate(-90 46 46)"
        />
        <text
          x={46}
          y={51}
          textAnchor="middle"
          fontFamily="'IBM Plex Mono', monospace"
          style={{ fill: color, fontSize: 17, fontWeight: 800, letterSpacing: "-0.5px" }}
        >
          {clamped.toFixed(0)}%
        </text>
      </svg>
      <div>
        <div className="text-[13px] font-bold leading-[1.25] text-analytics-ink mb-[6px]">
          {label}
        </div>
        <div className="text-[11px] text-analytics-muted font-semibold">
          gauge · 0–100%
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 3 — Abi (16 spec params)
// ============================================================

export function AbiSheet({ data: a, mode }: { data: Abi; mode?: SheetMode }) {
  const paramList = (
      <Card>
        <CardTitle>All 19 parameters from spec sheet</CardTitle>
        <ParamRow label="Abi engagement insight (narrative)" value={maybeVal(a.engagement_insight as Maybe<string>)} />
        <ParamRow label="Total Abi queries" value={val(a.total_queries)} />
        <ParamRow label="# Unique subscribers who raised queries" value={val(a.unique_users)} />
        <ParamRow label="Queries by complexity (L1-L4)" value={val(a.by_complexity.length)} />
        <ParamRow label="Query status (workflow)" value={val(a.by_status.length)} />
        {/* 09-Jun v4 additions */}
        <ParamRow label="% resolved as L1.A" value={`${a.l1a_resolved_pct}%`} />
        <ParamRow label="# resolved by Bot" value={val(a.resolved_by_bot_count)} />
        <ParamRow label="# resolved by HITL" value={val(a.resolved_by_hitl_count)} />
        <ParamRow label="# passed to Research" value={val(a.passed_to_research_count)} />
        <ParamRow label="Avg Queries per user" value={a.avg_queries_per_user.toFixed(1)} />
        <ParamRow label="Repeat users %" value={`${a.repeat_users_pct}%`} />
        <ParamRow
          label="Feedback (avg rating 1-5)"
          value={a.avg_feedback == null ? "—" : a.avg_feedback.toFixed(2)}
        />
        <ParamRow label="% feedback ratings given" value={`${a.feedback_given_pct}%`} />
        <ParamRow label="Top deliverable (top 5)" value={val(a.top_deliverable.length)} />
        <ParamRow label="Top Categories" value={val((a.top_categories ?? a.inside_vs_outside_split).length)} />
        <ParamRow label="Top declined deliverables (top 5)" value={val(a.top_declined_deliverable.length)} />
        <ParamRow label="Research referral reasons" value={val(a.research_referral_reasons.length)} />
        <ParamRow label="Query channel" value={val(a.by_source.length)} />
        <ParamRow label="Top geographies queried" value={val(a.top_geographies.length)} />
      </Card>
  );

  if (mode === "numbers") return paramList;

  return <AbiDashboard data={a} />;
}

// AbiDashboard — compact above-fold layout. Previous version sprawled
// vertically (4 KPI tiles + 16-row param list + 8 chart cards + 50-row
// user table). New layout: KPI strip → 3-up donut row → 2×2 bar grid
// → top-10 users with show-all toggle. Lower-priority breakdowns
// behind a <details> accordion.
function AbiDashboard({ data: a }: { data: Abi }) {
  const [showAllUsers, setShowAllUsers] = useState(false);
  const totalUsers = a.time_per_user_top50.length;
  const usersToShow = showAllUsers
    ? a.time_per_user_top50
    : a.time_per_user_top50.slice(0, 10);

  return (
    <div className="space-y-3">
      {/* 09-Jun · KPI strip expanded from 4 → 8 tiles to surface
          the DevSpec v4 additions: % L1.A, # Bot/HITL/Research,
          Avg/user, % feedback given. */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 gap-2">
        <KpiTile label="Total Abi queries" value={fmtNum(a.total_queries)} accent={PALETTE.indigo} />
        <KpiTile label="# Unique Subscribers" sub="who have raised queries" value={fmtNum(a.unique_users)} accent={PALETTE.aqua} />
        <KpiTile label="Avg Queries per user" value={a.avg_queries_per_user.toFixed(1)} accent={PALETTE.fuscia} />
        <KpiTile label="Repeat users %" value={`${a.repeat_users_pct}%`} accent={PALETTE.bumblebee} />
        <KpiTile label="% resolved as L1.A" value={`${a.l1a_resolved_pct}%`} accent={PALETTE.indigo} />
        <KpiTile label="# resolved by Bot" value={fmtNum(a.resolved_by_bot_count)} accent={PALETTE.aqua} />
        <KpiTile label="# resolved by HITL" value={fmtNum(a.resolved_by_hitl_count)} accent={PALETTE.fuscia} />
        <KpiTile label="# passed to Research" value={fmtNum(a.passed_to_research_count)} accent={PALETTE.bumblebee} />
      </div>

      {/* Feedback row — 2 tiles together since spec separates avg
          rating and % feedback-given. */}
      <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-2 gap-2">
        <KpiTile
          label="Feedback (avg rating)"
          value={a.avg_feedback == null ? "—" : a.avg_feedback.toFixed(2)}
          sub="1-5 scale"
          accent={PALETTE.indigo}
        />
        <KpiTile
          label="% feedback ratings given"
          value={`${a.feedback_given_pct}%`}
          sub={`${fmtNum(Math.round((a.total_queries * a.feedback_given_pct) / 100))} of ${fmtNum(a.total_queries)} queries`}
          accent={PALETTE.aqua}
        />
      </div>

      {/* Inside vs Outside renders as a compact horizontal SplitBar (low
          cardinality → donut overkill) above the two main donuts. */}
      <Card>
        <CardTitle>% Queries in Live.ai vs Outside Live.ai</CardTitle>
        <SplitBar
          slices={a.inside_vs_outside_split.map((c) => ({ label: c.label, value: c.count }))}
        />
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardTitle>Queries by complexity</CardTitle>
          <DonutChart slices={a.by_complexity.map((c) => ({ label: c.label, value: c.count }))} />
        </Card>
        <Card>
          <CardTitle>Query status (workflow)</CardTitle>
          <DonutChart slices={a.by_status.map((c) => ({ label: c.label, value: c.count }))} />
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardTitle>Top deliverable</CardTitle>
          <BarChart rows={barRows(a.top_deliverable)} />
        </Card>
        <Card>
          {/* 09-Jun · DevSpec row 15 — alias of inside_vs_outside_split */}
          <CardTitle>Top Categories</CardTitle>
          <BarChart rows={barRows((a.top_categories ?? a.inside_vs_outside_split).slice(0, 10))} />
        </Card>
        <Card>
          <CardTitle>Query Channel</CardTitle>
          <BarChart rows={barRows(a.by_source)} />
        </Card>
        <Card>
          <CardTitle>Top declined Deliverables</CardTitle>
          <BarChart rows={barRows(a.top_declined_deliverable)} />
        </Card>
        <Card>
          <CardTitle>Top geographies queried</CardTitle>
          <BarChart rows={barRows(a.top_geographies)} />
        </Card>
        <Card>
          <CardTitle>Research referral Reasons</CardTitle>
          <BarChart rows={barRows(a.research_referral_reasons)} />
        </Card>
      </div>

      <Card>
        <div className="flex items-center justify-between mb-2">
          <CardTitle>
            Time on Abi per user — top {showAllUsers ? totalUsers : Math.min(10, totalUsers)}
          </CardTitle>
          {totalUsers > 10 && (
            <button
              type="button"
              onClick={() => setShowAllUsers((v) => !v)}
              className="text-[11px] font-semibold text-beroe-teal hover:underline"
            >
              {showAllUsers ? "Show top 10" : `Show all ${totalUsers}`}
            </button>
          )}
        </div>
        <SimpleTable
          cols={[
            { key: "email", label: "User" },
            { key: "hours", label: "Hours", numeric: true },
          ]}
          rows={usersToShow.map((u) => ({ email: u.email, hours: u.hours.toFixed(1) }))}
        />
      </Card>

      <details className="bg-white border border-beroe-card-border rounded-card">
        <summary className="cursor-pointer px-4 py-2 text-[12px] font-semibold text-text-secondary hover:bg-beroe-bg/60">
          More breakdowns
        </summary>
        <div className="px-4 pb-4 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-3">
            <Card>
              <CardTitle># declined queries — module-wise</CardTitle>
              <BarChart rows={barRows(a.declined_by_module)} />
            </Card>
            <Card>
              <CardTitle>Research referral reasons</CardTitle>
              <BarChart rows={barRows(a.research_referral_reasons)} />
            </Card>
          </div>
        </div>
      </details>
    </div>
  );
}

// ============================================================
// 4 — Supplier Discovery (11 spec params)
// ============================================================

export function SDSheet({ data: s, mode }: { data: SupplierDiscovery; mode?: SheetMode }) {
  const paramList = (
      <Card>
        <CardTitle>All 11 parameters from spec sheet</CardTitle>
        <ParamRow label="# Users (subscribers who navigated to SD)" value={val(s.users)} />
        <ParamRow label="# Searches" value={val(s.total_searches)} />
        <ParamRow label="Avg searches / subscriber" value={val(s.avg_searches_per_user)} />
        <ParamRow label="Top categories searched" value={val(s.top_categories_searched.length)} />
        <ParamRow label="Top regions scoped" value={maybeVal(s.top_regions_scoped as Maybe<number>)} />
        <ParamRow label="Suppliers shortlisted (per search avg)" value={maybeVal(s.suppliers_shortlisted_avg as Maybe<number>)} />
        <ParamRow label="Repeat users %" value={val(`${s.repeat_users_pct}%`)} />
        <ParamRow label="Categories (direct/indirect %)" value={maybeVal(s.categories_pct_split as Maybe<number>)} />
        <ParamRow label="SD total visits" value={val(s.total_visits)} />
        <ParamRow label="SD total time spent (mins)" value={val(Math.round(s.total_time_mins))} />
        <ParamRow label="SD downloads" value={maybeVal(s.sd_downloads as Maybe<number>)} />
      </Card>
  );
  if (mode === "numbers") return paramList;
  // 08-Jun · Charts mode per Analytics_DataPoints_v10.xlsx · Supplier Discovery.
  // Spec → 7 KPI stats, 3 Bar charts (Top categories, Top regions, Categories %),
  // 1 Gauge (Repeat users %).
  const topRegionsList = Array.isArray(s.top_regions_scoped)
    ? (s.top_regions_scoped as Array<{ label: string; count: number }>)
    : [];
  const categoriesPctList = Array.isArray(s.categories_pct_split)
    ? (s.categories_pct_split as Array<{ label: string; count: number }>)
    : [];
  const sdDownloadsNum = typeof s.sd_downloads === "number"
    ? (s.sd_downloads as number) : null;
  const shortlistedNum = typeof s.suppliers_shortlisted_avg === "number"
    ? (s.suppliers_shortlisted_avg as number) : null;
  return (
    <div className="space-y-3">
      <Card>
        <CardTitle>Supplier Discovery</CardTitle>
        {/* 7 KPI tiles per spec */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2 mb-3">
          <KpiTile label="# Users" value={fmtNum(s.users)} accent={PALETTE.indigo} />
          <KpiTile label="# Searches" value={fmtNum(s.total_searches)} accent={PALETTE.aqua} />
          <KpiTile label="Avg searches / subscriber" value={s.avg_searches_per_user.toFixed(1)} accent={PALETTE.fuscia} />
          <KpiTile label="SD total visits" value={fmtNum(s.total_visits)} accent={PALETTE.bumblebee} />
          <KpiTile label="SD total time spent (Mins)" value={fmtNum(Math.round(s.total_time_mins))} accent={PALETTE.midnight} />
          <KpiTile
            label="SD downloads"
            value={sdDownloadsNum != null ? fmtNum(sdDownloadsNum) : "—"}
            na={isUnavailable(s.sd_downloads) ? { reason: s.sd_downloads.reason } : undefined}
            accent={PALETTE.indigo}
          />
          <KpiTile
            label="Suppliers shortlisted (per search avg)"
            value={shortlistedNum != null ? shortlistedNum.toFixed(1) : "—"}
            na={isUnavailable(s.suppliers_shortlisted_avg) ? { reason: s.suppliers_shortlisted_avg.reason } : undefined}
            accent={PALETTE.aqua}
          />
        </div>

        {/* Repeat users % — Gauge */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <RadialGauge label="Repeat users %" pct={s.repeat_users_pct ?? 0} color={PALETTE.fuscia} />
          <div className="md:col-span-2">
            <div className="text-[11px] font-semibold mb-1">Top Categories Searched</div>
            <BarChart rows={barRows(s.top_categories_searched)} />
          </div>
        </div>

        {/* Top regions + categories % — Bar charts */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <div className="text-[11px] font-semibold mb-1">Top Regions Scoped</div>
            {isUnavailable(s.top_regions_scoped) ? (
              <NaPill reason={(s.top_regions_scoped as { reason: string }).reason} />
            ) : (
              <BarChart rows={barRows(topRegionsList)} />
            )}
          </div>
          <div>
            <div className="text-[11px] font-semibold mb-1">Categories (%)</div>
            {isUnavailable(s.categories_pct_split) ? (
              <NaPill reason={(s.categories_pct_split as { reason: string }).reason} />
            ) : (
              <BarChart rows={barRows(categoriesPctList)} />
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

// ============================================================
// 5 — Supplier Monitoring Risk (10 spec params)
// ============================================================

export function SMSheet({ data: s, mode }: { data: SupplierMonitoring; mode?: SheetMode }) {
  const paramList = (
    <Card>
      <CardTitle>All 10 parameters from spec sheet</CardTitle>
      <div className="text-[10px] text-text-muted mb-2">
        Live from Redshift (stg_user_cat_sup_report). SM time computed
        from session_log + module filter. Contract-side fields
        (vs-contracted %, usage vs runway, data refreshes) stay NA —
        offline / no source column.
      </div>
      <ParamRow label="# suppliers monitored" value={maybeVal(s.suppliers_monitored)} />
      <ParamRow label="Suppliers by risk level" value={maybeVal(s.suppliers_by_risk_level as Maybe<number>)} />
      <ParamRow label="# new suppliers added (period)" value={maybeVal(s.new_suppliers_in_period)} />
      <ParamRow label="# users who added suppliers" value={maybeVal(s.users_adding_suppliers)} />
      <ParamRow label="MOM trend of suppliers added" value={maybeVal(s.mom_trend_suppliers_added as Maybe<number>)} />
      <ParamRow label="Data refreshes in last 30 days" value={maybeVal(s.data_refreshes_last_30d)} />
      <ParamRow label="% suppliers added vs contracted" value={maybeVal(s.suppliers_added_vs_contracted_pct)} />
      <ParamRow label="Usage against runway" value={maybeVal(s.usage_vs_runway as Maybe<number>)} />
      <ParamRow label="Total time spent (mins)" value={val(Math.round(s.total_time_mins))} />
      <ParamRow label="Suppliers added list" value={maybeVal(s.suppliers_added_list as Maybe<number>)} />
    </Card>
  );
  if (mode === "numbers") return paramList;

  // 08-Jun · Charts mode per Analytics_DataPoints_v10.xlsx · Supplier Monitoring.
  // Spec → 5 KPI stats, 2 Stacked bars (risk + runway), 1 Line chart (MoM trend),
  // 1 Gauge (vs contracted %), 1 Table (suppliers added list).
  const riskLevels = !isUnavailable(s.suppliers_by_risk_level)
    ? (s.suppliers_by_risk_level as Record<string, number>) : null;
  const momTrend = Array.isArray(s.mom_trend_suppliers_added)
    ? (s.mom_trend_suppliers_added as Array<{ month: string; suppliers_added: number }>)
    : null;
  const suppliersList = Array.isArray(s.suppliers_added_list)
    ? (s.suppliers_added_list as Array<{ email: string; supplier_name: string; category: string; added_at: string | null }>)
    : null;
  const monitoredNum = typeof s.suppliers_monitored === "number" ? s.suppliers_monitored : null;
  const newInPeriodNum = typeof s.new_suppliers_in_period === "number" ? s.new_suppliers_in_period : null;
  const usersAddingNum = typeof s.users_adding_suppliers === "number" ? s.users_adding_suppliers : null;

  // Risk-bucket colors (low → green / med → amber / high → red / unknown → grey)
  const RISK_COLORS: Record<string, string> = {
    low: "#10b981", medium: "#f59e0b", high: "#ef4444", unknown: "#94a3b8",
  };

  // 09-Jun · DevSpec v4 layout exactly. 9 params (1 stacked-bar + 1
  // line + 1 table + 6 KPI stats). Each tile carries a source pill in
  // the top-right corner. Header shows source counts ("8 In Redshift /
  // 1 Offline" — auto-derived from the params we render).
  const totalMinsNum = s.total_time_mins;
  const vsContractedAvailable = !isUnavailable(s.suppliers_added_vs_contracted_pct);
  const dataRefreshesAvailable = !isUnavailable(s.data_refreshes_last_30d);
  // Source-count header — match v4's "8 In Redshift / 1 Offline" badge.
  const inRedshift = 8;   // monitored / new / users / data-refreshes / time / risk-split / trend / list
  const offlineCt = vsContractedAvailable ? 0 : 1;

  return (
    <div className="space-y-3">
      {/* Source counter header — matches DevSpec "8 In Redshift / 1 Offline" */}
      <div className="flex items-center gap-2 mb-1">
        <SourcePillCounter count={inRedshift} source="redshift" />
        {offlineCt > 0 && <SourcePillCounter count={offlineCt} source="offline" />}
      </div>

      {/* KPI tiles — DevSpec v4 order:
          1. # Users who added suppliers
          2. # suppliers monitored
          3. # New suppliers added (period)
          4. Data refreshes in last 30 days
          5. Total time spent (Mins)
          6. % suppliers added vs contracted (offline)
          Each tile gets a source pill in the top-right; MoM deltas
          are placeholders until backend returns prev-period values. */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 gap-2">
        <SourcedKpi
          label="# Users who added suppliers"
          value={usersAddingNum != null ? fmtNum(usersAddingNum) : "—"}
          source="redshift"
          accent={PALETTE.indigo}
        />
        <SourcedKpi
          label="# suppliers monitored"
          value={monitoredNum != null ? fmtNum(monitoredNum) : "—"}
          source="redshift"
          accent={PALETTE.aqua}
        />
        <SourcedKpi
          label="# New suppliers added (period)"
          value={newInPeriodNum != null ? fmtNum(newInPeriodNum) : "—"}
          source="redshift"
          accent={PALETTE.fuscia}
        />
        <SourcedKpi
          label="Data refreshes in last 30 days"
          value={dataRefreshesAvailable
            ? fmtNum(s.data_refreshes_last_30d as number)
            : "—"}
          source="redshift"
          accent={PALETTE.bumblebee}
        />
        <SourcedKpi
          label="Total time spent (Mins)"
          value={(() => {
            const m = Math.round(totalMinsNum ?? 0);
            return m >= 60 ? `${Math.round(m / 60)}h` : `${m}m`;
          })()}
          sub={`${fmtNum(Math.round(totalMinsNum ?? 0))} mins`}
          source="redshift"
          accent={PALETTE.midnight}
        />
        <SourcedKpi
          label="% suppliers added vs contracted"
          value={vsContractedAvailable
            ? `${Math.round(s.suppliers_added_vs_contracted_pct as number)}%`
            : "—"}
          source={vsContractedAvailable ? "redshift" : "offline"}
          accent={PALETTE.indigo}
        />
      </div>

      {/* Suppliers by risk level — Stacked bar */}
      <Card>
        <div className="flex items-center justify-between mb-2">
          <CardTitle>Suppliers by risk level</CardTitle>
          <SourcePill source="redshift" />
        </div>
        {!riskLevels ? (
          <div className="text-[11px] text-analytics-muted italic py-4 text-center">
            No risk-level data
          </div>
        ) : (
          (() => {
            const entries = Object.entries(riskLevels);
            const total = entries.reduce((sum, [, v]) => sum + (v as number), 0) || 1;
            return (
              <>
                <SplitBar
                  slices={entries.map(([k, v]) => ({
                    label: k,
                    value: v as number,
                    color: RISK_COLORS[k] ?? "#94a3b8",
                  }))}
                />
                <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
                  {entries.map(([k, v]) => {
                    const pct = Math.round(((v as number) / total) * 100);
                    return (
                      <div
                        key={k}
                        className="flex items-center justify-between text-[11.5px]"
                      >
                        <span className="flex items-center gap-1.5 capitalize text-analytics-ink-2">
                          <span
                            className="inline-block w-2 h-2 rounded-full"
                            style={{ background: RISK_COLORS[k] ?? "#94a3b8" }}
                          />
                          {k}
                        </span>
                        <span className="font-mono text-analytics-ink">{pct}%</span>
                      </div>
                    );
                  })}
                </div>
              </>
            );
          })()
        )}
      </Card>

      {/* MOM trend of suppliers added — Line chart */}
      <Card>
        <div className="flex items-center justify-between mb-2">
          <CardTitle>MOM trend of suppliers added</CardTitle>
          <SourcePill source="redshift" />
        </div>
        {!momTrend || momTrend.length === 0 ? (
          <div className="text-[11.5px] text-analytics-muted italic py-6 text-center">
            No data
          </div>
        ) : (
          <LineChart
            labels={momTrend.map((m) => m.month)}
            values={momTrend.map((m) => m.suppliers_added)}
            color={PALETTE.indigo}
            height={140}
          />
        )}
      </Card>

      {/* Suppliers added list — Table */}
      <Card>
        <div className="flex items-center justify-between mb-2">
          <CardTitle>Suppliers added list</CardTitle>
          <SourcePill source="redshift" />
        </div>
        {!suppliersList || suppliersList.length === 0 ? (
          <div className="text-[11.5px] text-analytics-muted italic py-4 text-center">
            No suppliers added in window.
          </div>
        ) : (
          <SimpleTable
            cols={[
              { key: "supplier_name", label: "Supplier" },
              { key: "duns", label: "DUNS" },
              { key: "added_at", label: "Added", numeric: true },
            ]}
            rows={suppliersList.slice(0, 30).map((r) => ({
              supplier_name: r.supplier_name || "—",
              duns: (r as { duns?: string }).duns ?? "—",
              added_at: r.added_at ?? "—",
            }))}
          />
        )}
      </Card>
    </div>
  );
}

// 10-Jun · Stakeholder request — hide the section-level "N In Redshift
// / N Offline" counter chip so it doesn't show on any tab.
function SourcePillCounter(_: { count: number; source: KpiSource }) {
  return null;
}

// ============================================================
// 6 — Custom Usage (14 spec params)
// ============================================================

export function CustomUsageSheet({ data: c, mode }: { data: CustomUsage; mode?: SheetMode }) {
  const cbc = c.credits_by_complexity;
  const note = c.credits_by_complexity_note ? (
    <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-1.5">
      ⚠ {c.credits_by_complexity_note}
    </div>
  ) : null;
  const paramList = (
      <Card>
        <CardTitle>All 13 parameters from spec sheet</CardTitle>
        <ParamRow label="Credits used by complexity (L1-L4)" value={`L1 ${cbc.L1} · L2 ${cbc.L2} · L3 ${cbc.L3} · L4 ${cbc.L4}`} />
        <ParamRow label="Total credits used" value={val(c.total_credits_used)} />
        <ParamRow label="Credits estimated (active projects)" value={maybeVal(c.credits_estimated_active)} />
        <ParamRow label="Credits available / allocated (tier)" value={maybeVal(c.credits_allocated_tier)} />
        <ParamRow label="% credits utilized" value={maybeVal(c.credits_utilization_pct)} />
        <ParamRow label="Commodity dashboards" value={val(c.commodity_dashboards)} />
        <ParamRow label="Country reports" value={val(c.country_reports)} />
        <ParamRow
          label="Client feedback score"
          value={val(c.client_feedback_score == null ? "—" : c.client_feedback_score.toFixed(2))}
        />
        {/* 09-Jun · DevSpec row 9 */}
        <ParamRow label="% feedback ratings given" value={`${c.feedback_given_pct ?? 0}%`} />
        {/* 10-Jun · Analytics Error Tracker row 31 — AI SWAT vs BASICS split removed. */}
        <ParamRow label="Categories" value={val(c.top_categories.length)} />
        <ParamRow label="Spendpools" value={val(c.top_spendpools.length)} />
        <ParamRow label="Deliverables" value={val(c.top_deliverables.length)} />
      </Card>
  );
  if (mode === "numbers") {
    return <div className="space-y-3">{note}{paramList}</div>;
  }
  // 08-Jun · Charts mode per Analytics_DataPoints_v10.xlsx · Custom Usage.
  // Spec → KPI stats for totals + Stacked bar for L1-L4 + Gauge for %
  // utilized + Stacked bar for AI SWAT vs BASICS + chips for top
  // Categories / Spendpools / Deliverables.
  const utilizationPct = !isUnavailable(c.credits_utilization_pct) && typeof c.credits_utilization_pct === "number"
    ? (c.credits_utilization_pct as number) : null;
  return (
    <div className="space-y-3">
      {note}
      <Card>
        <CardTitle>Custom Credits</CardTitle>

        {/* KPI tiles — totals + per-tier counts (09-Jun added
            % feedback given to fill out spec row 9). */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 gap-2 mb-3">
          <KpiTile label="Total credits used" value={fmtNum(c.total_credits_used)} accent={PALETTE.indigo} />
          <KpiTile
            label="Credits estimated (active projects)"
            value={isUnavailable(c.credits_estimated_active) ? "—" : fmtNum(c.credits_estimated_active as number)}
            na={isUnavailable(c.credits_estimated_active) ? { reason: c.credits_estimated_active.reason } : undefined}
            accent={PALETTE.aqua}
          />
          <KpiTile
            label="Credits available / allocated (tier)"
            value={isUnavailable(c.credits_allocated_tier) ? "—" : fmtNum(c.credits_allocated_tier as number)}
            na={isUnavailable(c.credits_allocated_tier) ? { reason: c.credits_allocated_tier.reason } : undefined}
            accent={PALETTE.fuscia}
          />
          <KpiTile label="Commodity Dashboards" value={fmtNum(c.commodity_dashboards)} accent={PALETTE.bumblebee} />
          <KpiTile label="Country Reports" value={fmtNum(c.country_reports)} accent={PALETTE.midnight} />
          <KpiTile
            label="Client Feedback score"
            value={c.client_feedback_score == null ? "—" : c.client_feedback_score.toFixed(2)}
            sub="1-5 scale"
            accent={PALETTE.indigo}
          />
          <KpiTile
            label="% feedback ratings given"
            value={`${c.feedback_given_pct ?? 0}%`}
            accent={PALETTE.aqua}
          />
        </div>

        {/* L1-L4 stacked bar + utilization gauge */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <div className="md:col-span-2">
            <div className="text-[11px] font-semibold mb-1">Credits used by complexity (L1-L4)</div>
            <SplitBar
              slices={[
                { label: "L1", value: cbc.L1, color: SERIES_COLORS[0] },
                { label: "L2", value: cbc.L2, color: SERIES_COLORS[1] },
                { label: "L3", value: cbc.L3, color: SERIES_COLORS[2] },
                { label: "L4", value: cbc.L4, color: SERIES_COLORS[3] },
              ]}
            />
          </div>
          {utilizationPct != null ? (
            <RadialGauge label="% utilized" pct={utilizationPct} color={PALETTE.fuscia} />
          ) : (
            <KpiTile
              label="% utilized"
              value="—"
              na={isUnavailable(c.credits_utilization_pct) ? { reason: c.credits_utilization_pct.reason } : undefined}
            />
          )}
        </div>

        {/* 10-Jun · Analytics Error Tracker row 31 — AI SWAT vs BASICS
            split removed (the column is not used in the spec). */}

        {/* 10-Jun · Analytics Error Tracker rows 28, 29, 30 — Categories /
            Spendpools / Deliverables rendered as bar charts (was a chip
            cloud, which made counts hard to compare across items). */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <div className="text-[11px] font-semibold mb-1">Categories</div>
            <BarChart rows={barRows(c.top_categories as LabelCount[])} />
          </div>
          <div>
            <div className="text-[11px] font-semibold mb-1">Spendpools</div>
            <BarChart rows={barRows(c.top_spendpools as LabelCount[])} />
          </div>
          <div>
            <div className="text-[11px] font-semibold mb-1">Deliverables</div>
            <BarChart rows={barRows(c.top_deliverables as LabelCount[])} />
          </div>
        </div>
      </Card>
    </div>
  );
}

// 08-Jun · Chip-cloud rendering for spec "Table / chips" representations.
// Each item becomes a coloured pill showing its label + count.
function ChipCloud({
  title, items, max = 16,
}: {
  title: string;
  items: Array<{ label: string; count: number }>;
  max?: number;
}) {
  if (items.length === 0) {
    return (
      <div>
        <div className="text-[11px] font-semibold mb-1">{title}</div>
        <div className="text-[11px] text-text-muted">No data</div>
      </div>
    );
  }
  return (
    <div>
      <div className="text-[11px] font-semibold mb-1">{title}</div>
      <div className="flex flex-wrap gap-1">
        {items.slice(0, max).map((it, i) => (
          <span
            key={i}
            className="text-[10px] px-1.5 py-0.5 rounded-full bg-beroe-blue/10 text-beroe-blue border border-beroe-blue/20"
            title={`${it.label} · ${it.count}`}
          >
            {it.label} <span className="font-semibold">· {it.count}</span>
          </span>
        ))}
        {items.length > max && (
          <span className="text-[10px] text-text-muted self-center">
            +{items.length - max} more
          </span>
        )}
      </div>
    </div>
  );
}

// ============================================================
// 7 — Thought Leadership (4 spec params)
// ============================================================

export function TLSheet({ data: t, mode }: { data: ThoughtLeadership; mode?: SheetMode }) {
  const paramList = (
    <Card>
      <CardTitle>All 4 parameters from spec sheet</CardTitle>
      <ParamRow label="# Webinar views in TL page" value={val(t.webinar_views)} />
      <ParamRow label="# TL articles opened" value={val(t.articles_opened)} />
      <ParamRow label="# Beigebook views" value={val(t.beigebook_views)} />
      <ParamRow label="# Beigebook downloads" value={val(t.beigebook_downloads)} />
    </Card>
  );
  if (mode === "numbers") return paramList;
  return (
    <div className="space-y-3">
      <Card>
        <CardTitle>Thought Leadership</CardTitle>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          <KpiTile label="# Webinar views in TL page" value={fmtNum(t.webinar_views)} accent={PALETTE.indigo} />
          <KpiTile label="# TL articles opened" value={fmtNum(t.articles_opened)} accent={PALETTE.aqua} />
          <KpiTile label="# Beigebook views" value={fmtNum(t.beigebook_views)} accent={PALETTE.fuscia} />
          <KpiTile label="# Beigebook downloads" value={fmtNum(t.beigebook_downloads)} accent={PALETTE.bumblebee} />
        </div>
        <div>
          <div className="text-[11px] font-semibold mb-1">By type</div>
          <BarChart rows={barRows(t.by_type)} />
        </div>
      </Card>
    </div>
  );
}

// ============================================================
// 8 — DataHub (1 spec param)
// ============================================================

export function DataHubSheet({ data: d, mode }: { data: DataHubBundle; mode?: SheetMode }) {
  const paramList = (
    <Card>
      <CardTitle>1 parameter from spec sheet</CardTitle>
      <ParamRow label="# data pulls" value={maybeVal(d.data_pulls)} />
    </Card>
  );
  if (mode === "numbers") return paramList;
  // 08-Jun · Spec → KPI stat. Wide single tile centered.
  const pulls = typeof d.data_pulls === "number" ? d.data_pulls : null;
  return (
    <Card>
      <CardTitle>DataHub</CardTitle>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <KpiTile
          label="# data pulls"
          value={pulls != null ? fmtNum(pulls) : "—"}
          sub="API calls × frequency"
          na={isUnavailable(d.data_pulls) ? { reason: d.data_pulls.reason } : undefined}
          accent={PALETTE.indigo}
        />
      </div>
    </Card>
  );
}

// ============================================================
// 9 — Inflation Watch GIT (8 spec params + scenario modelling)
// ============================================================

export function IWSheet({ data: iw, mode }: { data: InflationWatch; mode?: SheetMode }) {
  const paramList = (
      <Card>
        <CardTitle>All 8 parameters from spec sheet</CardTitle>
        <ParamRow label="IW unique visitors" value={val(iw.unique_visitors)} />
        <ParamRow label="IW total visits (sessions)" value={val(iw.total_sessions)} />
        <ParamRow label="IW total time spent (mins)" value={val(Math.round(iw.total_time_mins))} />
        <ParamRow label="Avg sessions / visitor" value={val(iw.avg_sessions_per_visitor)} />
        <ParamRow label="Avg session time (mins)" value={val(iw.avg_session_time_mins)} />
        <ParamRow label="Avg time spent / visitor (mins)" value={val(iw.avg_time_per_visitor_mins)} />
        <ParamRow label="Top pages (visitors & views)" value={maybeVal(iw.top_pages as Maybe<number>)} />
        <ParamRow label="Top features (visitors & views)" value={val(iw.top_features.length)} />
        <ParamRow
          label="Scenario modelling completion"
          value={val(`${iw.scenario_modelling.ran} ran · ${iw.scenario_modelling.saved} saved`)}
        />
      </Card>
  );
  if (mode === "numbers") return paramList;
  // 08-Jun · Charts mode per Analytics_DataPoints_v10.xlsx · Inflation Watch.
  // Spec → 6 KPI stats, 2 Table/bar (top pages + top features), 1 Funnel
  // (Scenario Modelling completion).
  const topPagesList = Array.isArray(iw.top_pages)
    ? (iw.top_pages as Array<{ page: string; views: number }>)
    : null;
  const sm = iw.scenario_modelling ?? { ran: 0, saved: 0 };
  const completionPct = sm.ran > 0 ? Math.round((sm.saved / sm.ran) * 100) : 0;
  return (
    <div className="space-y-3">
      <Card>
        <CardTitle>Inflation Watch · GIT</CardTitle>
        {/* 6 KPI tiles per spec */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 mb-3">
          <KpiTile label="IW unique visitors" value={fmtNum(iw.unique_visitors)} accent={PALETTE.indigo} />
          <KpiTile label="IW total visits (sessions)" value={fmtNum(iw.total_sessions)} accent={PALETTE.aqua} />
          <KpiTile label="IW total time spent (mins)" value={fmtNum(Math.round(iw.total_time_mins))} accent={PALETTE.fuscia} />
          <KpiTile label="Avg sessions / visitor" value={iw.avg_sessions_per_visitor.toFixed(1)} accent={PALETTE.bumblebee} />
          <KpiTile label="Avg session time (mins)" value={iw.avg_session_time_mins.toFixed(1)} accent={PALETTE.midnight} />
          <KpiTile label="Avg time spent / visitor (mins)" value={iw.avg_time_per_visitor_mins.toFixed(1)} accent={PALETTE.indigo} />
        </div>

        {/* Top features + Top pages — Table / bar pair */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          <div>
            <div className="text-[11px] font-semibold mb-1">Top features (visitors / views)</div>
            <SimpleTable
              cols={[
                { key: "feature", label: "Feature" },
                { key: "visitors", label: "Visitors", numeric: true },
                { key: "views", label: "Views", numeric: true },
              ]}
              rows={iw.top_features.map((f) => ({
                feature: f.feature, visitors: f.visitors, views: f.views,
              }))}
            />
          </div>
          <div>
            <div className="text-[11px] font-semibold mb-1">Top pages</div>
            {isUnavailable(iw.top_pages) ? (
              <NaPill reason={(iw.top_pages as { reason: string }).reason} />
            ) : !topPagesList || topPagesList.length === 0 ? (
              <div className="text-[11px] text-text-muted py-3 text-center">No data</div>
            ) : (
              <BarChart
                rows={topPagesList.map((p, i) => ({
                  label: p.page,
                  value: p.views,
                  color: SERIES_COLORS[i % SERIES_COLORS.length],
                }))}
              />
            )}
          </div>
        </div>

        {/* Scenario Modelling — Funnel-ish KPI (Ran → Saved with completion %) */}
        <div>
          <div className="text-[11px] font-semibold mb-1">Scenario modelling completion</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <KpiTile label="Scenarios ran" value={fmtNum(sm.ran)} accent={PALETTE.aqua} />
            <KpiTile label="Scenarios saved" value={fmtNum(sm.saved)} accent={PALETTE.fuscia} />
            <RadialGauge label="Completion %" pct={completionPct} color={PALETTE.indigo} />
          </div>
        </div>
      </Card>
    </div>
  );
}

// ============================================================
// 10-12 — Offline sheets: Cirtuo (3) · nnamu (6) · Upply (6)
// ============================================================

function OfflineParamList({
  title,
  source,
  data,
  params,
}: {
  title: string;
  source: IntelUploadSource;
  data: OfflineBundle;
  params: Array<{ key: string; label: string }>;
}) {
  // 08-Jun · The upload button needs the current account's canonical
  // company name so it can warn the CSM when a portfolio-wide file
  // they just uploaded doesn't contain THIS account — explains why
  // the dashboard didn't change. Pull from the outlet context here
  // so the 5 callers (Cirtuo/Nnamu/Upply/Training/NPS sheets) don't
  // each need to thread it through.
  const account = useAccountFromLayout();
  const currentCompanyName = account.redshift_company_name ?? account.name;
  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      <div className="text-[10px] text-text-muted mb-2">
        Source: offline file (CSV / XLSX). Upload below — dashboard
        refreshes automatically when the file contains data for{" "}
        <span className="font-semibold">{currentCompanyName ?? "this account"}</span>.
      </div>
      {/* 08-Jun · in-app upload (Option C). admin / cs_director / vp_csm
          gated server-side; backend 403s surface inline on the button. */}
      <div className="mb-3">
        <IntelUploadButton source={source} currentCompanyName={currentCompanyName} />
      </div>
      {params.map((p) => (
        <ParamRow
          key={p.key}
          label={p.label}
          value={maybeVal(data[p.key] as Maybe<number>)}
        />
      ))}
    </Card>
  );
}

export function CirtuoSheet({ data: d, mode }: { data: OfflineBundle; mode?: SheetMode }) {
  void mode;
  return (
    <OfflineParamList
      title="Cirtuo — 3 parameters from spec sheet"
      source="cirtuo"
      data={d}
      params={[
        { key: "categories_supported", label: "# Categories Supported" },
        { key: "feedback_captured_pct", label: "% Feedback captured" },
        { key: "average_feedback", label: "average feedback" },
      ]}
    />
  );
}

export function NnamuSheet({ data: d, mode }: { data: OfflineBundle; mode?: SheetMode }) {
  void mode;
  return (
    <OfflineParamList
      title="nnamu — 6 parameters from spec sheet"
      source="nnamu"
      data={d}
      params={[
        { key: "total_spend_negotiated", label: "Total spend negotiated (USD)" },
        { key: "total_final_price", label: "Total final price (USD)" },
        { key: "total_absolute_savings", label: "Total absolute savings (USD)" },
        { key: "avg_relative_savings_pct", label: "Avg relative savings %" },
        { key: "savings_by_customer", label: "Savings by customer" },
        { key: "customers_with_savings", label: "Customers with negotiated savings" },
      ]}
    />
  );
}

export function UpplySheet({ data: d, mode }: { data: OfflineBundle; mode?: SheetMode }) {
  void mode;
  return (
    <OfflineParamList
      title="Upply — 6 parameters from spec sheet"
      source="upply"
      data={d}
      params={[
        { key: "routes_benchmarked", label: "# routes benchmarked" },
        { key: "unique_users", label: "Unique users" },
        { key: "avg_routes_per_user", label: "Avg routes / user" },
        { key: "routes_by_medium", label: "Routes by medium" },
        { key: "top_lanes", label: "Top origin→destination lanes" },
        { key: "benchmarks_trend_monthly", label: "Benchmarks trend (monthly)" },
      ]}
    />
  );
}

// ============================================================
// 13 — Alerts (4 spec params)
// ============================================================

export function AlertsSheet({ data: al, mode }: { data: AlertsBundle; mode?: SheetMode }) {
  const scopeNote = (
    <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-1.5">
      ⚠ {al._scope_note}
    </div>
  );
  const paramList = (
      <Card>
        <CardTitle>All 4 parameters from spec sheet</CardTitle>
        <ParamRow label="Type of alert sent (distinct categories)" value={val(al.types_sent.length)} />
        <ParamRow label="Open rate" value={val(`${al.open_rate_pct}%`)} />
        <ParamRow label="Open rate by categories (rows)" value={val(al.open_rate_by_category.length)} />
        <ParamRow label="Open rate by type of reachout (rows)" value={val(al.open_rate_by_reachout.length)} />
      </Card>
  );
  if (mode === "numbers") {
    return <div className="space-y-3">{scopeNote}{paramList}</div>;
  }
  // 08-Jun · Charts mode per Analytics_DataPoints_v10.xlsx · Alerts.
  // Spec → Open rate Gauge + Bar charts for the by-category and
  // by-reachout breakdowns + chips for types sent.
  return (
    <div className="space-y-3">
      {scopeNote}
      <Card>
        <CardTitle>Alerts</CardTitle>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
          <RadialGauge label="Open rate" pct={al.open_rate_pct ?? 0} color={PALETTE.indigo} />
          <KpiTile label="# Alert types" value={fmtNum(al.types_sent.length)} accent={PALETTE.aqua} />
          <KpiTile
            label="Total alerts sent"
            value={fmtNum(al.types_sent.reduce((s, r) => s + r.count, 0))}
            accent={PALETTE.fuscia}
          />
        </div>

        {/* Types sent — chips (spec: Table / chips) */}
        <div className="mb-3">
          <ChipCloud title="Type of alert sent" items={al.types_sent} max={20} />
        </div>

        {/* Open rate by category + by reachout — Bar charts */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <div className="text-[11px] font-semibold mb-1">Open rate by categories</div>
            {al.open_rate_by_category.length === 0 ? (
              <div className="text-[11px] text-text-muted py-3 text-center">No data</div>
            ) : (
              <BarChart
                rows={al.open_rate_by_category.slice(0, 10).map((r, i) => ({
                  label: r.label,
                  value: r.open_rate_pct,
                  color: SERIES_COLORS[i % SERIES_COLORS.length],
                }))}
              />
            )}
          </div>
          <div>
            <div className="text-[11px] font-semibold mb-1">Open rate by type of reachout</div>
            {al.open_rate_by_reachout.length === 0 ? (
              <div className="text-[11px] text-text-muted py-3 text-center">No data</div>
            ) : (
              <BarChart
                rows={al.open_rate_by_reachout.slice(0, 10).map((r, i) => ({
                  label: r.label,
                  value: r.open_rate_pct,
                  color: SERIES_COLORS[i % SERIES_COLORS.length],
                }))}
              />
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

// ============================================================
// 14-15 — Platform Training (2) · NPS (1)
// ============================================================

export function TrainingSheet({ data: d, mode }: { data: OfflineBundle; mode?: SheetMode }) {
  void mode;
  return (
    <OfflineParamList
      title="Platform Training — 2 parameters from spec sheet"
      source="training"
      data={d}
      params={[
        { key: "users_attended", label: "# users who attended trainings" },
        { key: "users_attended_pct", label: "% of users who attended trainings" },
      ]}
    />
  );
}

export function NpsSheet({ data: d, mode }: { data: OfflineBundle; mode?: SheetMode }) {
  void mode;
  return (
    <OfflineParamList
      title="NPS — 1 parameter from spec sheet"
      source="nps"
      data={d}
      params={[{ key: "average_feedback_nps", label: "Average Feedback (NPS)" }]}
    />
  );
}

// ============================================================
// 16 — Super Users (12 spec params)
// ============================================================

export function SuperUsersSheet({ data: su, mode }: { data: SuperUsersBundle; mode?: SheetMode }) {
  const paramList = (
      <Card>
        <CardTitle>All 12 parameters from spec sheet</CardTitle>
        <ParamRow label="Super users (count + identity)" value={val(su.users.length)} />
        <ParamRow label="Logins per user" value={val(su.users.length)} />
        <ParamRow label="Last login date (per user)" value={val(su.users.length)} />
        <ParamRow label="Login distribution (top 5)" value={val(su.login_distribution_top5.length)} />
        <ParamRow label="Category Intelligence per user" value={maybeVal(su.category_intelligence_per_user as Maybe<number>)} />
        <ParamRow label="Report downloads per user" value={val(su.users.length)} />
        <ParamRow label="Abi queries per user" value={val(su.users.length)} />
        <ParamRow label="Benchmark per user" value={maybeVal(su.benchmark_per_user as Maybe<number>)} />
        <ParamRow label="Supplier Monitoring per user" value={val(su.users.length)} />
        <ParamRow label="Supplier Discovery per user" value={val(su.users.length)} />
        <ParamRow label="MMD per user" value={val(su.users.length)} />
        <ParamRow label="Total time on platform per user" value={val(su.users.length)} />
      </Card>
  );
  if (mode === "numbers") return paramList;
  return <SuperUsersDashboard data={su} />;
}

// SuperUsersDashboard — compact view. 20-user table → top 10 by default
// with show-all toggle. Login-distribution chart prominent at top so
// users see the concentration at a glance.
function SuperUsersDashboard({
  data: su,
}: {
  data: SuperUsersBundle;
}) {
  const [showAll, setShowAll] = useState(false);
  const totalUsers = su.users.length;
  const usersToShow = showAll ? su.users : su.users.slice(0, 10);

  // 4 headline KPIs derived from the user list
  const topScore = su.users[0]?.activity_score ?? 0;
  const totalLogins = su.users.reduce((s, u) => s + u.logins, 0);
  const totalQueries = su.users.reduce((s, u) => s + u.abi_queries, 0);
  const totalPlatformMins = Math.round(
    su.users.reduce((s, u) => s + u.total_platform_mins, 0),
  );

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiTile label="Top Activity Score" value={fmtNum(topScore)} accent={PALETTE.indigo} />
        <KpiTile label="Total Logins" value={fmtNum(totalLogins)} accent={PALETTE.aqua} />
        <KpiTile label="Total Abi Queries" value={fmtNum(totalQueries)} accent={PALETTE.fuscia} />
        <KpiTile
          label="Total Platform Mins"
          value={fmtNum(totalPlatformMins)}
          accent={PALETTE.bumblebee}
        />
      </div>

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
        <div className="flex items-center justify-between mb-2">
          <CardTitle>
            Super-users — top {showAll ? totalUsers : Math.min(10, totalUsers)} by activity score
          </CardTitle>
          {totalUsers > 10 && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="text-[11px] font-semibold text-beroe-teal hover:underline"
            >
              {showAll ? "Show top 10" : `Show all ${totalUsers}`}
            </button>
          )}
        </div>
        <SimpleTable
          cols={[
            { key: "email", label: "User" },
            { key: "score", label: "Score", numeric: true },
            { key: "logins", label: "Logins", numeric: true },
            { key: "queries", label: "Abi", numeric: true },
            { key: "searches", label: "SD", numeric: true },
            { key: "mmd_time", label: "MMD m", numeric: true },
            { key: "sm_time", label: "SM m", numeric: true },
            { key: "total_time", label: "Total m", numeric: true },
            { key: "downloads", label: "Downloads", numeric: true },
            { key: "last_login", label: "Last login" },
          ]}
          rows={usersToShow.map((u) => ({
            email: u.email,
            score: u.activity_score,
            logins: u.logins,
            queries: u.abi_queries,
            searches: u.sd_searches,
            mmd_time: u.mmd_time_mins,
            sm_time: u.sm_time_mins,
            total_time: u.total_platform_mins,
            downloads: u.report_downloads,
            last_login: fmtDate(u.last_login),
          }))}
        />
      </Card>
    </div>
  );
}

// ============================================================
// 17 — Auto-computed Scores (09-Jun, spec sheet 17)
// Application-derived, not Redshift. 9 KPIs rendered as a tile grid.
// ============================================================

const RISK_TONE: Record<ScoresBundle["risk_bucket"], string> = {
  High: "#CF4548",
  Medium: "#F0BC41",
  Low: "#6EC457",
};

const MODE_TONE: Record<ScoresBundle["appetite_mode"], string> = {
  rescue: "#CF4548",
  retain: "#F0BC41",
  expand: "#6EC457",
};

export function ScoresSheet({
  data: s,
  mode,
}: {
  data: ScoresBundle;
  mode?: SheetMode;
}) {
  if (mode === "numbers") {
    return (
      <Card>
        <CardTitle>All 9 auto-computed scores</CardTitle>
        <ParamRow label="Account Health Score" value={val(s.health_score)} />
        <ParamRow label="Product Score (Health component)" value={val(s.product_score)} />
        <ParamRow label="Signal Score (Health component)" value={val(s.signal_score)} />
        <ParamRow label="Churn Risk Score" value={val(s.churn_risk_score)} />
        <ParamRow label="Risk Bucket" value={s.risk_bucket} />
        <ParamRow
          label="Appetite Score → Mode"
          value={`${s.appetite_score} → ${s.appetite_mode}${
            s.appetite_mode !== s.appetite_recommended_mode
              ? ` (recommended: ${s.appetite_recommended_mode})`
              : ""
          }`}
        />
        <ParamRow
          label="Renewal Readiness Score"
          value={s.renewal_readiness_score == null ? "—" : val(s.renewal_readiness_score)}
        />
        <ParamRow label="Days to Renewal" value={s.days_to_renewal == null ? "—" : val(s.days_to_renewal)} />
        <ParamRow
          label="Health trend (vs 30d ago)"
          value={s.health_trend_30d == null ? "—" : val(s.health_trend_30d)}
          definition={s.health_trend_note ?? undefined}
        />
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
        <KpiTile label="Health" value={fmtNum(s.health_score)} sub="of 100" accent={PALETTE.aqua} />
        <KpiTile label="Product" value={fmtNum(s.product_score)} sub="health component" accent={PALETTE.indigo} />
        <KpiTile label="Signal" value={fmtNum(s.signal_score)} sub="health component" accent={PALETTE.fuscia} />
        <KpiTile
          label="Churn Risk"
          value={fmtNum(s.churn_risk_score)}
          sub={s.risk_bucket}
          accent={RISK_TONE[s.risk_bucket]}
        />
        <KpiTile
          label="Appetite"
          value={fmtNum(s.appetite_score)}
          sub={`mode: ${s.appetite_mode}`}
          accent={MODE_TONE[s.appetite_mode]}
        />
        <KpiTile
          label="Renewal Readiness"
          value={s.renewal_readiness_score == null ? "—" : fmtNum(s.renewal_readiness_score)}
          sub="of 100"
          accent={PALETTE.bumblebee}
        />
        <KpiTile
          label="Days to Renewal"
          value={s.days_to_renewal == null ? "—" : fmtNum(s.days_to_renewal)}
          sub="days"
          accent={PALETTE.midnight}
        />
        <KpiTile
          label="Health Trend (30d)"
          value={s.health_trend_30d == null ? "—" : fmtNum(s.health_trend_30d)}
          sub={s.health_trend_30d == null ? "history pending" : "vs 30d ago"}
          accent={PALETTE.aqua}
        />
        <KpiTile label="Recommended Mode" value={s.appetite_recommended_mode} accent={MODE_TONE[s.appetite_recommended_mode]} />
      </div>

      <Card>
        <CardTitle>Appetite breakdown — how the score is calculated</CardTitle>
        <ParamRow label="Health (40%)" value={val(s.breakdown.health_pts)} />
        <ParamRow label="Signal mix (25%)" value={val(s.breakdown.sig_pts)} />
        <ParamRow label="Renewal proximity (15%)" value={val(s.breakdown.renew_pts)} />
        <ParamRow
          label="ARR growth (20%)"
          value={`${val(s.breakdown.arr_pts)} · ${s.breakdown.arr_status}`}
        />
      </Card>

      <div className="text-[10.5px] text-analytics-muted italic mt-1">
        Computed at {s.as_of} · derived in-app, not Redshift.
      </div>
    </div>
  );
}
