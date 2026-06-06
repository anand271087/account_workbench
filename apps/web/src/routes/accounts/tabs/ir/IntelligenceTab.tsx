// 05-Jun · Phase 2c — Sheetwise IntelligenceTab.
//
// 16 sub-tabs (one per spec sheet, excluding Auto-computed Scores
// which lives on /appetite-score already). Each sub-tab renders
// EVERY parameter from its spec sheet — live values for what we
// can fetch, NaPill with reason for the rest.
//
// All colors locked to the Beroe brand palette.

import { useState } from "react";

import { cn } from "@/lib/utils";
import { useAccountFromLayout, useAccountPeriod } from "../../AccountProfileLayout";
import { useIntelBundle, type IntelSection } from "@/hooks/useIntelAll";
import type {
  Abi,
  AccountSubscribers,
  Alerts as AlertsBundle,
  CategoryWatch,
  CustomUsage,
  DataHub as DataHubBundle,
  InflationWatch,
  OfflineBundle,
  SuperUsersBundle,
  SupplierDiscovery,
  SupplierMonitoring,
  ThoughtLeadership,
} from "@/types/intel";
import { Card, InfraBanner } from "./charts";
import type { InfraHealth } from "@/types/intel";
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
} from "./intel_sheets";

interface SubMeta {
  id: IntelSection;
  label: string;
  count: number; // # spec parameters
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

const TOTAL_PARAMS = SUB_TABS.reduce((s, t) => s + t.count, 0); // 136

export default function IntelligenceTab() {
  const account = useAccountFromLayout();
  const { period } = useAccountPeriod();
  const [sub, setSub] = useState<IntelSection>("account-subscribers");

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
          {" · "}
          <span className="text-text-muted">
            {TOTAL_PARAMS} parameters across {SUB_TABS.length} spec sheets
          </span>
        </div>
      </div>

      {/* Sub-tab strip — sheetwise */}
      <div className="flex gap-1 mb-3 flex-wrap">
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

      {/* Active sheet header */}
      <div className="text-[11px] text-text-muted mb-2">
        Sheet:{" "}
        <span className="font-semibold text-text-secondary">{active.label}</span>
        {" — "}
        <span className="font-semibold">{active.count} parameters</span> from
        Analytics_DataPoints_v10.xlsx
      </div>

      <SubLoader accountId={account.id} period={period} section={sub} />
    </div>
  );
}

// ---------------- lazy fetch + dispatch ----------------

function SubLoader({
  accountId,
  period,
  section,
}: {
  accountId: string;
  period: ReturnType<typeof useAccountPeriod>["period"];
  section: IntelSection;
}) {
  switch (section) {
    case "account-subscribers":
      return <FetchAndRender<AccountSubscribers> accountId={accountId} period={period} section={section}
        render={(d) => <SubscribersSheet data={d} />} />;
    case "category-watch":
      return <FetchAndRender<CategoryWatch> accountId={accountId} period={period} section={section}
        render={(d) => <CategoryWatchSheet data={d} />} />;
    case "abi":
      return <FetchAndRender<Abi> accountId={accountId} period={period} section={section}
        render={(d) => <AbiSheet data={d} />} />;
    case "supplier-discovery":
      return <FetchAndRender<SupplierDiscovery> accountId={accountId} period={period} section={section}
        render={(d) => <SDSheet data={d} />} />;
    case "supplier-monitoring":
      return <FetchAndRender<SupplierMonitoring> accountId={accountId} period={period} section={section}
        render={(d) => <SMSheet data={d} />} />;
    case "custom-usage":
      return <FetchAndRender<CustomUsage> accountId={accountId} period={period} section={section}
        render={(d) => <CustomUsageSheet data={d} />} />;
    case "thought-leadership":
      return <FetchAndRender<ThoughtLeadership> accountId={accountId} period={period} section={section}
        render={(d) => <TLSheet data={d} />} />;
    case "datahub":
      return <FetchAndRender<DataHubBundle> accountId={accountId} period={period} section={section}
        render={(d) => <DataHubSheet data={d} />} />;
    case "inflation-watch":
      return <FetchAndRender<InflationWatch> accountId={accountId} period={period} section={section}
        render={(d) => <IWSheet data={d} />} />;
    case "cirtuo":
      return <FetchAndRender<OfflineBundle> accountId={accountId} period={period} section={section}
        render={(d) => <CirtuoSheet data={d} />} />;
    case "nnamu":
      return <FetchAndRender<OfflineBundle> accountId={accountId} period={period} section={section}
        render={(d) => <NnamuSheet data={d} />} />;
    case "upply":
      return <FetchAndRender<OfflineBundle> accountId={accountId} period={period} section={section}
        render={(d) => <UpplySheet data={d} />} />;
    case "alerts":
      return <FetchAndRender<AlertsBundle> accountId={accountId} period={period} section={section}
        render={(d) => <AlertsSheet data={d} />} />;
    case "training":
      return <FetchAndRender<OfflineBundle> accountId={accountId} period={period} section={section}
        render={(d) => <TrainingSheet data={d} />} />;
    case "nps":
      return <FetchAndRender<OfflineBundle> accountId={accountId} period={period} section={section}
        render={(d) => <NpsSheet data={d} />} />;
    case "super-users":
      return <FetchAndRender<SuperUsersBundle> accountId={accountId} period={period} section={section}
        render={(d) => <SuperUsersSheet data={d} />} />;
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
