// 05-Jun · Per-sheet dashboards for the IntelligenceTab.
//
// One component per sheet of Analytics_DataPoints_v10.xlsx (16 sheets,
// excluding Auto-computed Scores which lives on the existing
// /appetite-score endpoint). Each component renders EVERY parameter
// from its spec sheet — live values for what we can fetch, NaPill for
// what's pending DBA grants or offline.

import React from "react";

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
} from "./charts";

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

function val(v: number | string | null | undefined): React.ReactNode {
  if (v == null || v === "") return <span className="text-text-muted">—</span>;
  return typeof v === "number" ? fmtNum(v) : v;
}

function na(reason: string): React.ReactNode {
  return <NaPill reason={reason} />;
}

function maybeVal(m: Maybe<number | string>): React.ReactNode {
  if (isUnavailable(m)) return na(m.reason);
  return val(m as number | string);
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

export function SubscribersSheet({ data: a }: { data: AccountSubscribers }) {
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
    </div>
  );
}

// ============================================================
// 2 — Category Watch (29 spec params: 16 CI + 8 MMD + 5 BM)
// ============================================================

export function CategoryWatchSheet({ data: cw }: { data: CategoryWatch }) {
  const ci = cw.category_intelligence;
  const mmd = cw.mmd;
  const bm = cw.benchmarks;

  // MMD is the only fully-live subsection — KPIs + charts first.
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
        <CardTitle>Category Intelligence (16 params)</CardTitle>
        <div className="text-[10px] text-text-muted mb-2">
          Most pending DBA grants on stg_user_cat_sup_report +
          stg_category*_reporttype.
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardTitle>Grades viewed (top 10)</CardTitle>
          <BarChart rows={barRows(mmd.grades_viewed)} />
        </Card>
        <Card>
          <CardTitle>Regions viewed (top 10)</CardTitle>
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

      <Card>
        <CardTitle>Category Benchmarks (5 params)</CardTitle>
        <ParamRow label="Total benchmark responses" value={maybeVal(bm.total_benchmark_responses as Maybe<number>)} />
        <ParamRow label="Total subscribers responded" value={maybeVal(bm.total_subscribers_responded as Maybe<number>)} />
        <ParamRow label="Benchmark question categories" value={maybeVal(bm.benchmark_question_categories as Maybe<number>)} />
        <ParamRow label="Total time spent in benchmark (mins)" value={val(bm.benchmark_time_mins as number)} />
        <ParamRow label="RFx template downloads" value={maybeVal(bm.rfx_template_downloads as Maybe<number>)} />
      </Card>
    </div>
  );
}

// ============================================================
// 3 — Abi (16 spec params)
// ============================================================

export function AbiSheet({ data: a }: { data: Abi }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiTile label="Total Queries" value={fmtNum(a.total_queries)} accent={PALETTE.indigo} />
        <KpiTile label="Unique Users" value={fmtNum(a.unique_users)} accent={PALETTE.aqua} />
        <KpiTile label="Bot Resolution" value={`${a.bot_resolution_pct}%`} accent={PALETTE.fuscia} />
        <KpiTile label="Repeat Users" value={`${a.repeat_users_pct}%`} accent={PALETTE.bumblebee} />
      </div>
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
            slices={a.inside_vs_outside_split.map((c) => ({ label: c.label, value: c.count }))}
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
          rows={a.time_per_user_top50.map((u) => ({ email: u.email, hours: u.hours.toFixed(1) }))}
        />
      </Card>
    </div>
  );
}

// ============================================================
// 4 — Supplier Discovery (11 spec params)
// ============================================================

export function SDSheet({ data: s }: { data: SupplierDiscovery }) {
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

export function SMSheet({ data: s }: { data: SupplierMonitoring }) {
  return (
    <div className="space-y-3">
      <Card>
        <CardTitle>All 10 parameters from spec sheet</CardTitle>
        <div className="text-[10px] text-text-muted mb-2">
          Most pending DBA grant on stg_user_cat_sup_report; SM time computed
          from session_log + module filter.
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

export function CustomUsageSheet({ data: c }: { data: CustomUsage }) {
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

export function TLSheet({ data: t }: { data: ThoughtLeadership }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiTile label="Webinar Views" value={fmtNum(t.webinar_views)} accent={PALETTE.indigo} />
        <KpiTile label="Articles Opened" value={fmtNum(t.articles_opened)} accent={PALETTE.aqua} />
        <KpiTile label="Beigebook Views" value={fmtNum(t.beigebook_views)} accent={PALETTE.fuscia} />
        <KpiTile label="Beigebook Downloads" value={fmtNum(t.beigebook_downloads)} accent={PALETTE.bumblebee} />
      </div>
      <Card>
        <CardTitle>All 4 parameters from spec sheet</CardTitle>
        <ParamRow label="# Webinar views in TL page" value={val(t.webinar_views)} />
        <ParamRow label="# TL articles opened" value={val(t.articles_opened)} />
        <ParamRow label="# Beigebook views" value={val(t.beigebook_views)} />
        <ParamRow label="# Beigebook downloads" value={val(t.beigebook_downloads)} />
      </Card>
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

export function DataHubSheet({ data: d }: { data: DataHubBundle }) {
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

export function IWSheet({ data: iw }: { data: InflationWatch }) {
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
  data,
  params,
}: {
  title: string;
  data: OfflineBundle;
  params: Array<{ key: string; label: string }>;
}) {
  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      <div className="text-[10px] text-text-muted mb-2">
        Source: offline file (SharePoint / CSV) — Phase 3 ingestion will populate
        these.
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

export function CirtuoSheet({ data: d }: { data: OfflineBundle }) {
  return (
    <OfflineParamList
      title="Cirtuo — 3 parameters from spec sheet"
      data={d}
      params={[
        { key: "categories_supported", label: "# Categories Supported (Cirtuo projects)" },
        { key: "feedback_captured_pct", label: "% Feedback captured" },
        { key: "average_feedback", label: "Average feedback" },
      ]}
    />
  );
}

export function NnamuSheet({ data: d }: { data: OfflineBundle }) {
  return (
    <OfflineParamList
      title="nnamu — 6 parameters from spec sheet"
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

export function UpplySheet({ data: d }: { data: OfflineBundle }) {
  return (
    <OfflineParamList
      title="Upply — 6 parameters from spec sheet"
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

export function AlertsSheet({ data: al }: { data: AlertsBundle }) {
  return (
    <div className="space-y-3">
      <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-1.5">
        ⚠ {al._scope_note}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-2 gap-2">
        <KpiTile label="Open Rate" value={`${al.open_rate_pct}%`} accent={PALETTE.indigo} />
        <KpiTile label="# Alert Types" value={fmtNum(al.types_sent.length)} accent={PALETTE.aqua} />
      </div>
      <Card>
        <CardTitle>All 4 parameters from spec sheet</CardTitle>
        <ParamRow label="Type of alert sent (distinct categories)" value={val(al.types_sent.length)} />
        <ParamRow label="Open rate" value={val(`${al.open_rate_pct}%`)} />
        <ParamRow label="Open rate by categories (rows)" value={val(al.open_rate_by_category.length)} />
        <ParamRow label="Open rate by type of reachout (rows)" value={val(al.open_rate_by_reachout.length)} />
      </Card>
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

export function TrainingSheet({ data: d }: { data: OfflineBundle }) {
  return (
    <OfflineParamList
      title="Platform Training — 2 parameters from spec sheet"
      data={d}
      params={[
        { key: "users_attended", label: "# users who attended trainings" },
        { key: "users_attended_pct", label: "% of users who attended trainings" },
      ]}
    />
  );
}

export function NpsSheet({ data: d }: { data: OfflineBundle }) {
  return (
    <OfflineParamList
      title="NPS — 1 parameter from spec sheet"
      data={d}
      params={[{ key: "average_feedback_nps", label: "Average feedback (NPS score)" }]}
    />
  );
}

// ============================================================
// 16 — Super Users (12 spec params)
// ============================================================

export function SuperUsersSheet({ data: su }: { data: SuperUsersBundle }) {
  return (
    <div className="space-y-3">
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
      <Card>
        <CardTitle>Top {su.top_n} super-users — activity score</CardTitle>
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
          rows={su.users.map((u) => ({
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
