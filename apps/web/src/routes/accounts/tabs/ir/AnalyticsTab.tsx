// 05-Jun · Phase 2d — Analytics tab aligned to the 16-sheet structure.
//
// Same 16 sub-tabs as IntelligenceTab (one per spec sheet), differentiator
// is the Numbers / Charts mode toggle. In Numbers mode we render only
// the compact spec-parameter list (Card + ParamRows); in Charts mode we
// render the rich KPI tiles + bar/donut/line charts.
//
// Both modes delegate to the same intel_sheets.tsx components — they
// honor the `mode` prop.

import { useState } from "react";

import { cn } from "@/lib/utils";
import { useAccountFromLayout, useAccountPeriod } from "../../AccountProfileLayout";
import { useIntelAll, type IntelSection } from "@/hooks/useIntelAll";
import type {
  Abi,
  AccountSubscribers,
  Alerts as AlertsBundle,
  CategoryWatch,
  CustomUsage,
  DataHub as DataHubBundle,
  InflationWatch,
  InfraHealth,
  OfflineBundle,
  SuperUsersBundle,
  SupplierDiscovery,
  SupplierMonitoring,
  ThoughtLeadership,
} from "@/types/intel";
import { Card, InfraBanner } from "./charts";
import {
  AbiSheet,
  AlertsSheet,
  CategoryWatchSheet,
  CirtuoSheet,
  CustomUsageSheet,
  DataHubSheet,
  IWSheet,
  NnamuSheet,
  NpsSheet,
  SDSheet,
  SMSheet,
  SubscribersSheet,
  SuperUsersSheet,
  TLSheet,
  TrainingSheet,
  UpplySheet,
  type SheetMode,
} from "./intel_sheets";

interface SubMeta {
  id: IntelSection;
  label: string;
  count: number;
}

const SUB_TABS: SubMeta[] = [
  { id: "account-subscribers", label: "Account & Subscribers", count: 9 },
  { id: "category-watch",      label: "Category Watch",        count: 29 },
  { id: "abi",                 label: "Abi",                   count: 16 },
  { id: "supplier-discovery",  label: "Supplier Discovery",    count: 11 },
  { id: "supplier-monitoring", label: "Supplier Monitoring",   count: 10 },
  { id: "custom-usage",        label: "Custom Usage",          count: 14 },
  { id: "thought-leadership",  label: "Thought Leadership",    count: 4 },
  { id: "datahub",             label: "DataHub",               count: 1 },
  { id: "inflation-watch",     label: "Inflation Watch GIT",   count: 8 },
  { id: "cirtuo",              label: "Cirtuo",                count: 3 },
  { id: "nnamu",               label: "nnamu",                 count: 6 },
  { id: "upply",               label: "Upply",                 count: 6 },
  { id: "alerts",              label: "Alerts",                count: 4 },
  { id: "training",            label: "Platform Training",     count: 2 },
  { id: "nps",                 label: "NPS",                   count: 1 },
  { id: "super-users",         label: "Super Users",           count: 12 },
];

export default function AnalyticsTab() {
  const account = useAccountFromLayout();
  const { period } = useAccountPeriod();
  const [sub, setSub] = useState<IntelSection>("account-subscribers");
  const [mode, setMode] = useState<SheetMode>("charts");

  // 08-Jun · Single batched fetch instead of 16 per-section calls.
  // Backend `/intel/all` parallelizes the 16 bundles via asyncio.gather
  // + a 10-connection Redshift pool, so wall-clock ≈ slowest single
  // bundle. The earlier per-section prefetch was a stopgap when the
  // backend was sequential; with /intel/all parallelized server-side
  // it's both faster (one HTTP round-trip) and simpler (no client
  // orchestration needed). Each sub-tab below reads its slice from
  // `all.data` directly — instant sub-tab switching, no per-tab fetch.
  const all = useIntelAll(account.id, period);

  const active = SUB_TABS.find((t) => t.id === sub)!;

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

      {/* Sub-tab strip + mode toggle */}
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex gap-1 flex-wrap">
          {SUB_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setSub(t.id)}
              className={cn(
                "text-[11px] px-2.5 py-1.5 rounded-md border-[1.5px] transition-colors flex items-center gap-1.5",
                sub === t.id
                  ? "border-beroe-teal/40 bg-beroe-teal/10 text-beroe-teal font-bold"
                  : "border-beroe-card-border bg-white text-text-secondary font-medium hover:bg-beroe-bg/60",
              )}
            >
              {t.label}
              <span
                className={cn(
                  "text-[9px] px-1 rounded-full",
                  sub === t.id ? "bg-beroe-teal/20" : "bg-beroe-bg",
                )}
              >
                {t.count}
              </span>
            </button>
          ))}
        </div>
        <div className="flex gap-0.5 bg-beroe-bg rounded-md p-0.5 flex-shrink-0">
          {(["numbers", "charts"] as SheetMode[]).map((mv) => (
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

      <div className="text-[11px] text-text-muted mb-2">
        Sheet:{" "}
        <span className="font-semibold text-text-secondary">{active.label}</span>
        {" — "}
        <span className="font-semibold">{active.count} parameters</span>{" · "}
        Mode:{" "}
        <span className="font-semibold text-beroe-teal">
          {mode === "numbers" ? "Numbers (compact)" : "Charts (full dashboard)"}
        </span>
      </div>

      {/* 08-Jun · Single-fetch flow. The 16 bundles arrive together
          (server parallelizes), so loading state is global and
          sub-tab switches are instant cache reads. */}
      {all.isLoading ? (
        <SectionSkeleton />
      ) : all.isError ? (
        <ErrorCard error={all.error} />
      ) : all.data ? (
        <AnalyticsBody data={all.data} section={sub} mode={mode} />
      ) : null}
    </div>
  );
}

// ---------------- read from rollup + dispatch to sheet ----------------

function AnalyticsBody({
  data,
  section,
  mode,
}: {
  data: import("@/types/intel").IntelAll;
  section: IntelSection;
  mode: SheetMode;
}) {
  // The /intel/all response carries an optional _infra block (Redshift
  // tunnel recovery) that's not on the IntelAll type. Read via cast.
  const infra = (data as unknown as { _infra?: InfraHealth })._infra;
  return (
    <>
      {infra?.tunnel_recovering && (
        <InfraBanner
          message={infra.message}
          secondsAgo={Math.round(infra.seconds_since_error)}
        />
      )}
      <SubRender data={data} section={section} mode={mode} />
    </>
  );
}

function SubRender({
  data,
  section,
  mode,
}: {
  data: import("@/types/intel").IntelAll;
  section: IntelSection;
  mode: SheetMode;
}) {
  switch (section) {
    case "account-subscribers":
      return <SubscribersSheet data={data.account_subscribers as AccountSubscribers} mode={mode} />;
    case "category-watch":
      return <CategoryWatchSheet data={data.category_watch as CategoryWatch} mode={mode} />;
    case "abi":
      return <AbiSheet data={data.abi as Abi} mode={mode} />;
    case "supplier-discovery":
      return <SDSheet data={data.supplier_discovery as SupplierDiscovery} mode={mode} />;
    case "supplier-monitoring":
      return <SMSheet data={data.supplier_monitoring as SupplierMonitoring} mode={mode} />;
    case "custom-usage":
      return <CustomUsageSheet data={data.custom_usage as CustomUsage} mode={mode} />;
    case "thought-leadership":
      return <TLSheet data={data.thought_leadership as ThoughtLeadership} mode={mode} />;
    case "datahub":
      return <DataHubSheet data={data.datahub as DataHubBundle} mode={mode} />;
    case "inflation-watch":
      return <IWSheet data={data.inflation_watch as InflationWatch} mode={mode} />;
    case "cirtuo":
      return <CirtuoSheet data={data.cirtuo as OfflineBundle} mode={mode} />;
    case "nnamu":
      return <NnamuSheet data={data.nnamu as OfflineBundle} mode={mode} />;
    case "upply":
      return <UpplySheet data={data.upply as OfflineBundle} mode={mode} />;
    case "alerts":
      return <AlertsSheet data={data.alerts as AlertsBundle} mode={mode} />;
    case "training":
      return <TrainingSheet data={data.training as OfflineBundle} mode={mode} />;
    case "nps":
      return <NpsSheet data={data.nps as OfflineBundle} mode={mode} />;
    case "super-users":
      return <SuperUsersSheet data={data.super_users as SuperUsersBundle} mode={mode} />;
  }
}

function ErrorCard({ error }: { error: unknown }) {
  const status = (error as { status?: number } | null)?.status;
  return (
    <Card>
      <div className="text-[13px] font-semibold mb-1 text-risk-red">
        Couldn't load Intelligence & Reports
      </div>
      <div className="text-[11px] text-text-secondary">
        {status === 409
          ? "Account not mapped to redshift_company_name yet."
          : (error as { message?: string } | null)?.message ?? "Unknown error"}
      </div>
    </Card>
  );
}

// 08-Jun · Skeleton shown while a section's bundle is in flight. Mirrors
// the typical KPI-tile + chart layout so the page doesn't visually
// collapse during the 5-25s cold Redshift query. Background prefetch
// (see AnalyticsTab useEffect) means subsequent sub-tab switches will
// usually hit the cache and never see this.
function SectionSkeleton() {
  return (
    <Card>
      <div className="flex items-center gap-2 text-[11px] font-semibold text-beroe-teal mb-3">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-beroe-teal opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-beroe-teal" />
        </span>
        Loading from Redshift… first load takes 5-25s, then it's cached
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-[68px] rounded-md bg-beroe-bg animate-pulse"
          />
        ))}
      </div>
      <div className="space-y-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-3 rounded bg-beroe-bg animate-pulse"
            style={{ width: `${85 - i * 8}%` }}
          />
        ))}
      </div>
    </Card>
  );
}
