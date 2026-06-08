// 05-Jun · Phase 2d — Analytics tab aligned to the 16-sheet structure.
//
// Same 16 sub-tabs as IntelligenceTab (one per spec sheet), differentiator
// is the Numbers / Charts mode toggle. In Numbers mode we render only
// the compact spec-parameter list (Card + ParamRows); in Charts mode we
// render the rich KPI tiles + bar/donut/line charts.
//
// Both modes delegate to the same intel_sheets.tsx components — they
// honor the `mode` prop.

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAccountFromLayout, useAccountPeriod } from "../../AccountProfileLayout";
import { useIntelBundle, type IntelSection } from "@/hooks/useIntelAll";
import { periodToWindow } from "@/types/intel";
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
  const qc = useQueryClient();

  // 08-Jun · Background prefetch — the active sub-tab fires its query
  // via useIntelBundle below; the other 15 sections used to wait until
  // the user clicked them, each one costing another 5-25s Redshift
  // round-trip. Now we kick all 15 off in parallel on mount so that
  // switching between sub-tabs reads from the TanStack cache (instant).
  // Sequenced via setTimeout so the active query gets the first slot
  // and doesn't compete with the background ones for the Redshift
  // tunnel's first connection.
  useEffect(() => {
    if (!account?.id) return;
    const window = periodToWindow(period);
    const ALL_SECTIONS: IntelSection[] = [
      "account-subscribers", "category-watch", "abi",
      "supplier-discovery", "supplier-monitoring", "custom-usage",
      "thought-leadership", "datahub", "inflation-watch",
      "cirtuo", "nnamu", "upply", "alerts", "training", "nps",
      "super-users",
    ];
    // Give the active section a head-start before prefetching the rest.
    const handle = setTimeout(() => {
      ALL_SECTIONS.forEach((s) => {
        if (s === sub) return; // already firing via useIntelBundle
        const qs = s === "super-users" ? "?top_n=20" : `?window=${window}`;
        qc.prefetchQuery({
          queryKey: ["intel-bundle", account.id, s, window, s === "super-users" ? 20 : undefined],
          queryFn: () =>
            api.get(`/api/v1/accounts/${account.id}/intel/${s}${qs}`),
          staleTime: 5 * 60_000,
        });
      });
    }, 1200);
    return () => clearTimeout(handle);
  }, [account?.id, period, qc, sub]);

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

      <SubLoader accountId={account.id} period={period} section={sub} mode={mode} />
    </div>
  );
}

// ---------------- lazy fetch + dispatch ----------------

function SubLoader({
  accountId,
  period,
  section,
  mode,
}: {
  accountId: string;
  period: ReturnType<typeof useAccountPeriod>["period"];
  section: IntelSection;
  mode: SheetMode;
}) {
  switch (section) {
    case "account-subscribers":
      return <FetchAndRender<AccountSubscribers> accountId={accountId} period={period} section={section}
        render={(d) => <SubscribersSheet data={d} mode={mode} />} />;
    case "category-watch":
      return <FetchAndRender<CategoryWatch> accountId={accountId} period={period} section={section}
        render={(d) => <CategoryWatchSheet data={d} mode={mode} />} />;
    case "abi":
      return <FetchAndRender<Abi> accountId={accountId} period={period} section={section}
        render={(d) => <AbiSheet data={d} mode={mode} />} />;
    case "supplier-discovery":
      return <FetchAndRender<SupplierDiscovery> accountId={accountId} period={period} section={section}
        render={(d) => <SDSheet data={d} mode={mode} />} />;
    case "supplier-monitoring":
      return <FetchAndRender<SupplierMonitoring> accountId={accountId} period={period} section={section}
        render={(d) => <SMSheet data={d} mode={mode} />} />;
    case "custom-usage":
      return <FetchAndRender<CustomUsage> accountId={accountId} period={period} section={section}
        render={(d) => <CustomUsageSheet data={d} mode={mode} />} />;
    case "thought-leadership":
      return <FetchAndRender<ThoughtLeadership> accountId={accountId} period={period} section={section}
        render={(d) => <TLSheet data={d} mode={mode} />} />;
    case "datahub":
      return <FetchAndRender<DataHubBundle> accountId={accountId} period={period} section={section}
        render={(d) => <DataHubSheet data={d} mode={mode} />} />;
    case "inflation-watch":
      return <FetchAndRender<InflationWatch> accountId={accountId} period={period} section={section}
        render={(d) => <IWSheet data={d} mode={mode} />} />;
    case "cirtuo":
      return <FetchAndRender<OfflineBundle> accountId={accountId} period={period} section={section}
        render={(d) => <CirtuoSheet data={d} mode={mode} />} />;
    case "nnamu":
      return <FetchAndRender<OfflineBundle> accountId={accountId} period={period} section={section}
        render={(d) => <NnamuSheet data={d} mode={mode} />} />;
    case "upply":
      return <FetchAndRender<OfflineBundle> accountId={accountId} period={period} section={section}
        render={(d) => <UpplySheet data={d} mode={mode} />} />;
    case "alerts":
      return <FetchAndRender<AlertsBundle> accountId={accountId} period={period} section={section}
        render={(d) => <AlertsSheet data={d} mode={mode} />} />;
    case "training":
      return <FetchAndRender<OfflineBundle> accountId={accountId} period={period} section={section}
        render={(d) => <TrainingSheet data={d} mode={mode} />} />;
    case "nps":
      return <FetchAndRender<OfflineBundle> accountId={accountId} period={period} section={section}
        render={(d) => <NpsSheet data={d} mode={mode} />} />;
    case "super-users":
      return <FetchAndRender<SuperUsersBundle> accountId={accountId} period={period} section={section}
        render={(d) => <SuperUsersSheet data={d} mode={mode} />} />;
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
    return <SectionSkeleton />;
  }
  if (isError) {
    const status = (error as { status?: number } | null)?.status;
    return (
      <Card>
        <div className="text-[13px] font-semibold mb-1 text-risk-red">Couldn't load this sheet</div>
        <div className="text-[11px] text-text-secondary">
          {status === 409
            ? "Account not mapped to redshift_company_name yet."
            : (error as { message?: string })?.message ?? "Unknown error"}
        </div>
      </Card>
    );
  }
  if (!data) return null;
  const infra = (data as { _infra?: InfraHealth })._infra;
  return (
    <>
      {infra?.tunnel_recovering && (
        <InfraBanner message={infra.message} secondsAgo={Math.round(infra.seconds_since_error)} />
      )}
      {render(data)}
    </>
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
