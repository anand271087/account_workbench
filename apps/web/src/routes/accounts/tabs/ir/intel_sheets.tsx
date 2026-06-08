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

export function SubscribersSheet({ data: a, mode }: { data: AccountSubscribers; mode?: SheetMode }) {
  const active_pct = a.total_subscribers
    ? Math.round((a.active_subscribers / a.total_subscribers) * 100)
    : 0;
  const paramList = (
    <Card>
      <CardTitle>All 9 parameters from spec sheet</CardTitle>
      <ParamRow label="Total subscribers" definition="Licensed subscribers on the account" value={val(a.total_subscribers)} />
      <ParamRow label="Active subscribers" definition="Users with at least 1 login in the period" value={val(a.active_subscribers)} />
      <ParamRow label="Subscription start date" value={val(fmtDate(a.subscription_start))} />
      <ParamRow label="Subscription end date" value={val(fmtDate(a.subscription_end))} />
      <ParamRow label="Company's last login" value={val(fmtDate(a.company_last_login))} />
      <ParamRow label="Total logins" definition="Logins within current term" value={val(a.total_logins)} />
      <ParamRow label="Total time spent (mins)" value={val(Math.round(a.total_time_spent_mins))} />
      <ParamRow label="# categories unlocked (account)" value={val(a.categories_unlocked)} />
      <ParamRow label="# suppliers added (account)" value={maybeVal(a.suppliers_added as Maybe<number>)} />
    </Card>
  );
  if (mode === "numbers") return paramList;
  // 08-Jun · Chart mode now surfaces all 9 spec KPIs as tiles (was 4).
  // Date-valued KPIs render as date strings; the dash from val()/fmtDate()
  // shows when the value isn't set yet.
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
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
        <KpiTile
          label="Categories Unlocked"
          value={fmtNum(a.categories_unlocked)}
          accent={PALETTE.midnight}
        />
        <KpiTile
          label="Suppliers Added"
          value={fmtNum(((a.suppliers_added as Maybe<number>) as number) ?? 0)}
          accent={PALETTE.indigo}
        />
        <KpiTile
          label="Last Login"
          value={val(fmtDate(a.company_last_login)) as string}
          accent={PALETTE.aqua}
        />
        <KpiTile
          label="Subscription Start"
          value={val(fmtDate(a.subscription_start)) as string}
          accent={PALETTE.fuscia}
        />
        <KpiTile
          label="Subscription End"
          value={val(fmtDate(a.subscription_end)) as string}
          accent={PALETTE.bumblebee}
        />
      </div>
      {paramList}
    </div>
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
        <ParamRow label="Category type breakdown" value={maybeVal(ci.category_type_breakdown as Maybe<number>)} />
        <ParamRow label="# Category visits" value={maybeVal(ci.category_visits as Maybe<number>)} />
        <ParamRow label="Category revisit %" value={maybeVal(ci.category_revisit_pct as Maybe<number>)} />
        <ParamRow label="Avg time spent / subscriber (mins)" value={val(ci.avg_time_per_subscriber_mins as number)} />
        <ParamRow label="Industry-relevant categories added %" value={maybeVal(ci.industry_relevant_pct as Maybe<number>)} />
        <ParamRow label="Spend pool (top n)" value={maybeVal(ci.spend_pool_top_n as Maybe<number>)} />
        <ParamRow label="# Report downloads (total)" value={maybeVal(ci.report_downloads_total as Maybe<number>)} />
        <ParamRow label="# Report views (total)" value={maybeVal(ci.report_views_total as Maybe<number>)} />
        <ParamRow label="Top 10 report views" value={maybeVal(ci.top_report_views as Maybe<number>)} />
        <ParamRow label="Top 10 report downloads" value={maybeVal(ci.top_report_downloads as Maybe<number>)} />
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
        <ParamRow label="Grades viewed in MMD" value={val(mmd.grades_viewed.length || 0)} />
        <ParamRow label="Regions viewed in MMD" value={val(mmd.regions_viewed.length || 0)} />
        <ParamRow label="MMD module visits (monthly)" value={val(mmd.monthly_trend.length || 0)} />
      </Card>
  );

  const bmCard = (
      <Card>
        <CardTitle>Category Benchmarks (5 params)</CardTitle>
        <ParamRow label="Total benchmark responses" value={maybeVal(bm.total_benchmark_responses as Maybe<number>)} />
        <ParamRow label="Total subscribers responded" value={maybeVal(bm.total_subscribers_responded as Maybe<number>)} />
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
  const catTypeBreakdown = Array.isArray(ci.category_type_breakdown)
    ? (ci.category_type_breakdown as Array<{ label: string; count: number }>)
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

        {/* KPI-stat row (spec: rows 6, 7, 9, 13, 16, 17 + revisit-as-KPI) */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 mb-3">
          <KpiTile label="Categories unlocked" value={fmtNum(ci.categories_unlocked as number)} accent={PALETTE.indigo} />
          <KpiTile label="Avg cats / user" value={(ci.avg_categories_per_user as number).toFixed(2)} accent={PALETTE.aqua} />
          <KpiTile label="Newly added (period)" value={fmtNum(newlyAdded.length)} accent={PALETTE.fuscia} />
          <KpiTile label="Avg time / subscriber (m)" value={(ci.avg_time_per_subscriber_mins as number).toFixed(1)} accent={PALETTE.bumblebee} />
          <KpiTile label="Report views" value={fmtNum(ci.report_views_total as number)} accent={PALETTE.midnight} />
          <KpiTile label="Report downloads" value={fmtNum(ci.report_downloads_total as number)} accent={PALETTE.indigo} />
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

        {/* Categories added trend — Line chart (row 8) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          <div>
            <div className="text-[11px] font-semibold mb-1">Categories added — monthly trend</div>
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
            <div className="text-[11px] font-semibold mb-1">Reports downloaded — monthly trend</div>
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

        {/* Category type breakdown — Stacked bar (row 10) */}
        {catTypeBreakdown.length > 0 && (
          <div className="mb-3">
            <div className="text-[11px] font-semibold mb-1">Category type breakdown</div>
            <SplitBar
              slices={catTypeBreakdown.map((r, i) => ({
                label: r.label,
                value: r.count,
                color: SERIES_COLORS[i % SERIES_COLORS.length],
              }))}
            />
          </div>
        )}

        {/* Spend pool + Top report views — Bar charts (rows 15, 18, 19) */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-3">
          <div>
            <div className="text-[11px] font-semibold mb-1">Spend pool (top 10)</div>
            <BarChart rows={barRows(spendPool)} />
          </div>
          <div>
            <div className="text-[11px] font-semibold mb-1">Top 10 report views</div>
            <BarChart rows={barRows(topViews)} />
          </div>
          <div>
            <div className="text-[11px] font-semibold mb-1">Top 10 report downloads</div>
            <BarChart rows={barRows(topDownloads)} />
          </div>
        </div>

        {/* Categories newly added — Table / chips (rows 9, 14) */}
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

        {/* Added categories detail — grouped-by-user (row 21).
            08-Jun · Was a 50-row table; reads as one giant block. Group
            by user, show their categories as small chips, with a
            "Show all" toggle for users beyond the first 8. */}
        {addedDetail.length > 0 && (
          <AddedCategoriesDetailGrouped rows={addedDetail} />
        )}
      </Card>

      {/* MMD — section header */}
      <Card>
        <CardTitle>Market Movement Dashboard (MMD)</CardTitle>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
          <KpiTile label="MMD Subscribers" value={fmtNum(mmd.subscribers)} accent={PALETTE.indigo} />
          <KpiTile label="Total time (m)" value={fmtNum(Math.round(mmd.total_time_mins))} accent={PALETTE.aqua} />
          <KpiTile label="Avg time / user (m)" value={mmd.avg_time_per_user_mins.toFixed(1)} accent={PALETTE.fuscia} />
          <KpiTile label="Unique categories" value={fmtNum(mmd.unique_categories_viewed)} accent={PALETTE.bumblebee} />
          <KpiTile label="Avg cats / user" value={mmd.avg_categories_per_user.toFixed(1)} accent={PALETTE.midnight} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
          <div>
            <div className="text-[11px] font-semibold mb-1">Grades viewed (top 10)</div>
            <BarChart rows={barRows(mmd.grades_viewed)} />
          </div>
          <div>
            <div className="text-[11px] font-semibold mb-1">Regions viewed (top 10)</div>
            <BarChart rows={barRows(mmd.regions_viewed)} />
          </div>
        </div>
        <div>
          <div className="text-[11px] font-semibold mb-1">MMD module visits — monthly</div>
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
          <KpiTile
            label="Total responses"
            value={isUnavailable(bm.total_benchmark_responses) ? "—" : fmtNum(bm.total_benchmark_responses as number)}
            na={isUnavailable(bm.total_benchmark_responses) ? { reason: bm.total_benchmark_responses.reason } : undefined}
            accent={PALETTE.indigo}
          />
          <KpiTile
            label="Subscribers responded"
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
function RadialGauge({
  label, pct, color = PALETTE.indigo,
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
    <div className="rounded-lg border border-beroe-card-border bg-white p-3 flex items-center gap-3">
      <svg width={92} height={92} viewBox="0 0 92 92" className="flex-none">
        <circle cx={46} cy={46} r={R} stroke="#e5e7eb" strokeWidth={9} fill="none" />
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
          y={50}
          textAnchor="middle"
          className="font-bold"
          style={{ fill: color, fontSize: 17 }}
        >
          {clamped.toFixed(0)}%
        </text>
      </svg>
      <div>
        <div className="text-[10.5px] font-bold uppercase tracking-wider text-text-muted mb-0.5">
          {label}
        </div>
        <div className="text-[11px] text-text-secondary">
          % of categories viewed more than once
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
        <CardTitle>All 16 parameters from spec sheet</CardTitle>
        <ParamRow label="Abi engagement insight (narrative)" value={maybeVal(a.engagement_insight as Maybe<string>)} />
        <ParamRow label="Total Abi queries" value={val(a.total_queries)} />
        <ParamRow label="# Unique subscribers who raised queries" value={val(a.unique_users)} />
        <ParamRow label="Queries by complexity (L1-L4)" value={val(a.by_complexity.length)} />
        <ParamRow label="Query status (workflow)" value={val(a.by_status.length)} />
        <ParamRow label="Bot resolution rate %" value={val(`${a.bot_resolution_pct}%`)} />
        <ParamRow label="# time spent on Abi per user (top 50)" value={val(a.time_per_user_top50.length)} />
        <ParamRow label="Repeat users %" value={val(`${a.repeat_users_pct}%`)} />
        <ParamRow
          label="Feedback (avg rating 1-5)"
          value={val(a.avg_feedback == null ? "—" : a.avg_feedback.toFixed(2))}
        />
        <ParamRow
          label="Feedback (thumbs-up %)"
          value={val(a.thumbs_up_pct == null ? "—" : `${a.thumbs_up_pct}%`)}
        />
        <ParamRow label="Top deliverable (top 5)" value={val(a.top_deliverable.length)} />
        <ParamRow label="Top categories (Live.ai vs outside split)" value={val(a.inside_vs_outside_split.length)} />
        <ParamRow label="Top declined deliverables (top 5)" value={val(a.top_declined_deliverable.length)} />
        <ParamRow label="# declined queries — module-wise" value={val(a.declined_by_module.length)} />
        <ParamRow label="Research referral reasons" value={val(a.research_referral_reasons.length)} />
        <ParamRow label="Query channel" value={val(a.by_source.length)} />
        <ParamRow label="Top geographies queried" value={val(a.top_geographies.length)} />
      </Card>
  );

  if (mode === "numbers") return paramList;

  return <AbiDashboard data={a} paramList={paramList} />;
}

// AbiDashboard — compact above-fold layout. Previous version sprawled
// vertically (4 KPI tiles + 16-row param list + 8 chart cards + 50-row
// user table). New layout: KPI strip → 3-up donut row → 2×2 bar grid
// → top-10 users with show-all toggle. Param list + lower-priority
// breakdowns hidden behind a <details> accordion.
function AbiDashboard({ data: a, paramList }: { data: Abi; paramList: React.ReactNode }) {
  const [showAllUsers, setShowAllUsers] = useState(false);
  const totalUsers = a.time_per_user_top50.length;
  const usersToShow = showAllUsers
    ? a.time_per_user_top50
    : a.time_per_user_top50.slice(0, 10);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiTile label="Total Queries" value={fmtNum(a.total_queries)} accent={PALETTE.indigo} />
        <KpiTile label="Unique Users" value={fmtNum(a.unique_users)} accent={PALETTE.aqua} />
        <KpiTile label="Bot Resolution" value={`${a.bot_resolution_pct}%`} accent={PALETTE.fuscia} />
        <KpiTile label="Repeat Users" value={`${a.repeat_users_pct}%`} accent={PALETTE.bumblebee} />
      </div>

      {/* Inside vs Outside renders as a compact horizontal SplitBar (low
          cardinality → donut overkill) above the two main donuts. */}
      <Card>
        <CardTitle>Inside vs Outside Live.ai</CardTitle>
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
          <CardTitle>Query status</CardTitle>
          <DonutChart slices={a.by_status.map((c) => ({ label: c.label, value: c.count }))} />
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardTitle>Top deliverable (top 5)</CardTitle>
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
          <CardTitle>Top geographies</CardTitle>
          <BarChart rows={barRows(a.top_geographies)} />
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
          More breakdowns + all 16 spec parameters
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
          {paramList}
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
      {paramList}
      <Card>
        <CardTitle>Top categories searched</CardTitle>
        <BarChart rows={barRows(s.top_categories_searched)} />
      </Card>
    </div>
  );
}

// ============================================================
// 5 — Supplier Monitoring Risk (10 spec params)
// ============================================================

export function SMSheet({ data: s, mode }: { data: SupplierMonitoring; mode?: SheetMode }) {
  void mode; // identical numbers/charts (entire sheet is a param list today)
  return (
    <div className="space-y-3">
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
    </div>
  );
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
        <CardTitle>All 14 parameters from spec sheet</CardTitle>
        <ParamRow label="Credits used — L1" value={val(cbc.L1)} />
        <ParamRow label="Credits used — L2" value={val(cbc.L2)} />
        <ParamRow label="Credits used — L3" value={val(cbc.L3)} />
        <ParamRow label="Credits used — L4" value={val(cbc.L4)} />
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
        <ParamRow label="AI SWAT vs BASICS split" value={val(c.ai_swat_vs_basics.length)} />
        <ParamRow label="Top categories" value={val(c.top_categories.length)} />
        <ParamRow label="Top spendpools" value={val(c.top_spendpools.length)} />
        <ParamRow label="Top deliverables" value={val(c.top_deliverables.length)} />
      </Card>
  );
  if (mode === "numbers") {
    return <div className="space-y-3">{note}{paramList}</div>;
  }
  return (
    <div className="space-y-3">
      {note}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiTile label="Total (proxy)" value={fmtNum(c.total_credits_used)} accent={PALETTE.indigo} />
        <KpiTile label="L1" value={fmtNum(cbc.L1)} accent={PALETTE.aqua} />
        <KpiTile label="L2" value={fmtNum(cbc.L2)} accent={PALETTE.fuscia} />
        <KpiTile label="L3+L4" value={fmtNum(cbc.L3 + cbc.L4)} accent={PALETTE.bumblebee} />
      </div>
      {paramList}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardTitle>AI SWAT vs Basics</CardTitle>
          <DonutChart slices={c.ai_swat_vs_basics.map((r) => ({ label: r.label, value: r.count }))} />
        </Card>
        <Card>
          <CardTitle>Top deliverables</CardTitle>
          <BarChart rows={barRows(c.top_deliverables)} />
        </Card>
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiTile label="Webinar Views" value={fmtNum(t.webinar_views)} accent={PALETTE.indigo} />
        <KpiTile label="Articles Opened" value={fmtNum(t.articles_opened)} accent={PALETTE.aqua} />
        <KpiTile label="Beigebook Views" value={fmtNum(t.beigebook_views)} accent={PALETTE.fuscia} />
        <KpiTile label="Beigebook Downloads" value={fmtNum(t.beigebook_downloads)} accent={PALETTE.bumblebee} />
      </div>
      {paramList}
      <Card>
        <CardTitle>By type</CardTitle>
        <BarChart rows={barRows(t.by_type)} />
      </Card>
    </div>
  );
}

// ============================================================
// 8 — DataHub (1 spec param)
// ============================================================

export function DataHubSheet({ data: d, mode }: { data: DataHubBundle; mode?: SheetMode }) {
  void mode; // single-param sheet — same layout either way
  return (
    <Card>
      <CardTitle>1 parameter from spec sheet</CardTitle>
      <ParamRow label="# data pulls" value={maybeVal(d.data_pulls)} />
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
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiTile label="Unique Visitors" value={fmtNum(iw.unique_visitors)} accent={PALETTE.indigo} />
        <KpiTile label="Total Sessions" value={fmtNum(iw.total_sessions)} accent={PALETTE.aqua} />
        <KpiTile
          label="Total Time (m)"
          value={fmtNum(Math.round(iw.total_time_mins))}
          accent={PALETTE.fuscia}
        />
        <KpiTile
          label="Avg Sessions / Visitor"
          value={iw.avg_sessions_per_visitor.toFixed(1)}
          accent={PALETTE.bumblebee}
        />
      </div>
      {paramList}
      <Card>
        <CardTitle>Top features (visitors / views)</CardTitle>
        <SimpleTable
          cols={[
            { key: "feature", label: "Feature" },
            { key: "visitors", label: "Visitors", numeric: true },
            { key: "views", label: "Views", numeric: true },
          ]}
          rows={iw.top_features.map((f) => ({ feature: f.feature, visitors: f.visitors, views: f.views }))}
        />
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
        { key: "categories_supported", label: "# Categories Supported (Cirtuo projects)" },
        { key: "feedback_captured_pct", label: "% Feedback captured" },
        { key: "average_feedback", label: "Average feedback" },
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
        { key: "routes_by_medium", label: "Routes by medium (AIR / OCEAN / ROAD)" },
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
  return (
    <div className="space-y-3">
      {scopeNote}
      <div className="grid grid-cols-2 md:grid-cols-2 gap-2">
        <KpiTile label="Open Rate" value={`${al.open_rate_pct}%`} accent={PALETTE.indigo} />
        <KpiTile label="# Alert Types" value={fmtNum(al.types_sent.length)} accent={PALETTE.aqua} />
      </div>
      {paramList}
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
      params={[{ key: "average_feedback_nps", label: "Average feedback (NPS score)" }]}
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
        <ParamRow label="Super users (count + identity) — top N" value={val(su.users.length)} />
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
  return <SuperUsersDashboard data={su} paramList={paramList} />;
}

// SuperUsersDashboard — compact view. 20-user table → top 10 by default
// with show-all toggle. Login-distribution chart prominent at top so
// users see the concentration at a glance. Param list accordion'd.
function SuperUsersDashboard({
  data: su,
  paramList,
}: {
  data: SuperUsersBundle;
  paramList: React.ReactNode;
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
        <CardTitle>Login distribution — top 5</CardTitle>
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

      <details className="bg-white border border-beroe-card-border rounded-card">
        <summary className="cursor-pointer px-4 py-2 text-[12px] font-semibold text-text-secondary hover:bg-beroe-bg/60">
          All 12 spec parameters
        </summary>
        <div className="px-4 pb-4 pt-2">{paramList}</div>
      </details>
    </div>
  );
}
