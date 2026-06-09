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
import { useIntelBundle, type IntelSection } from "@/hooks/useIntelAll";
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
  ScoresBundle,
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
  ScoresSheet,
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
  // 09-Jun — Scores tab first; it's a snapshot of everything else and
  // loads instantly (no Redshift round-trip).
  { id: "scores",              label: "Scores",                count: 9 },
  { id: "account-subscribers", label: "Account & Subscribers", count: 10 },
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
  const [sub, setSub] = useState<IntelSection>("scores");
  const [mode, setMode] = useState<SheetMode>("charts");

  // 09-Jun · Reverted from useIntelAll → per-section useIntelBundle.
  // Reason: /intel/all parallelizes server-side but blocks the page
  // on the slowest single bundle (Category Watch ~14s). Per-section
  // fetches let the lightweight bundles (DataHub, NPS, Training) paint
  // in 2-3s while the heavies fill in progressively. User sees the
  // page light up instead of staring at a 45s skeleton.
  //
  // All 16 hooks live below in SectionGrid — they fire in parallel
  // because React mounts every child component on first render. The
  // server still benefits from its connection pool + threadpool.

  const active = SUB_TABS.find((t) => t.id === sub)!;

  return (
    <div className="font-manrope bg-analytics-bg text-analytics-ink -mx-4 -my-4 px-4 py-4">
      {/* 09-Jun · Repainted top stripe — spec topbar gradient
          (teal-950 → teal-800), 58px tall, white text. */}
      <div
        className="mb-3 h-[58px] flex items-center gap-4 px-5 rounded-[10px] text-white shadow-[0_2px_12px_rgba(6,48,56,.22)]"
        style={{
          background: "linear-gradient(100deg, #063038, #0b5e6b)",
        }}
      >
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-analytics-teal-300 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-analytics-teal-300" />
          </span>
          <span className="text-[12.5px] font-extrabold tracking-[0.4px] uppercase">
            Live
          </span>
        </div>
        <div className="text-[12.5px] opacity-90 flex-1 truncate">
          Pulled from Redshift ·{" "}
          <span className="font-bold">
            {account.redshift_company_name ?? account.name}
          </span>
        </div>
        <div className="flex items-center gap-2.5 bg-white/10 border border-white/20 rounded-[9px] px-3 py-1.5 text-[12.5px] font-semibold">
          <span className="opacity-70 text-[10.5px] uppercase tracking-wider">
            Window
          </span>
          <span>{period ?? "90d"}</span>
        </div>
      </div>

      {/* Spec tab bar: sticky white, horizontal scroll, 2px teal underline
          on the active tab. */}
      <div className="mb-3 -mx-4 px-4 bg-white border-y border-analytics-line shadow-[0_1px_3px_rgba(10,74,84,.04)]">
        <div className="flex items-center gap-2 overflow-x-auto">
          <div className="flex">
            {SUB_TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setSub(t.id)}
                className={cn(
                  "flex-none flex items-center gap-1.5 px-[11px] py-[8px] cursor-pointer whitespace-nowrap",
                  "text-[12px] font-semibold border-b-[2px] transition-colors",
                  sub === t.id
                    ? "text-analytics-teal-700 border-analytics-teal-700"
                    : "text-analytics-ink-2 border-transparent hover:text-analytics-teal-700 hover:bg-analytics-teal-50",
                )}
              >
                {t.label}
                <span
                  className={cn(
                    "text-[9px] font-extrabold uppercase tracking-[0.4px] px-[5px] py-[1px] rounded-[6px]",
                    sub === t.id
                      ? "bg-analytics-teal-100 text-analytics-teal-800"
                      : "bg-analytics-line-2 text-analytics-muted",
                  )}
                >
                  {t.count}
                </span>
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <div className="flex-none flex gap-0.5 bg-analytics-line-2 rounded-[9px] p-[2px] my-1.5">
            {(["numbers", "charts"] as SheetMode[]).map((mv) => (
              <button
                key={mv}
                onClick={() => setMode(mv)}
                className={cn(
                  "text-[11px] px-[10px] py-[4px] rounded-[7px] font-bold uppercase tracking-[0.4px] transition-colors",
                  mode === mv
                    ? "bg-white text-analytics-teal-700 shadow-sm"
                    : "text-analytics-muted hover:text-analytics-ink",
                )}
              >
                {mv === "numbers" ? "# Numbers" : "📊 Charts"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Section header — spec `.section-row` */}
      <div className="flex items-center gap-3 mt-[6px] mb-[13px]">
        <h2 className="text-[12.5px] font-extrabold uppercase tracking-[0.4px] text-analytics-teal-800">
          {active.label}
        </h2>
        <div className="text-[11px] font-semibold text-analytics-muted whitespace-nowrap">
          {active.count} parameter{active.count === 1 ? "" : "s"} ·{" "}
          {mode === "numbers" ? "Compact view" : "Charts view"}
        </div>
        <div className="flex-1 h-px bg-analytics-line" />
      </div>

      {/* 09-Jun · Progressive load. 16 SectionFetcher instances mount
          on first render; React Query fires all 16 in parallel. The
          lightweight bundles (DataHub / NPS / Training / TL) paint in
          2-3s while heavier ones (Category Watch, Abi) fill in by
          15-20s. User sees the page light up instead of waiting on
          the slowest single bundle. */}
      <SectionFetcher
        accountId={account.id}
        period={period}
        section={sub}
        mode={mode}
      />
      {/* Hidden prefetcher row — keeps a useIntelBundle hook alive for
          every section so they all fire in parallel on first mount.
          Switching sub-tabs is then an instant cache read. */}
      <HiddenPrefetcher accountId={account.id} period={period} active={sub} />
    </div>
  );
}

// ---------------- per-section render + dispatch ----------------

function SectionFetcher({
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
  // useIntelBundle fires one request per section. While this section's
  // bundle is in flight, show the section skeleton. Once data lands,
  // render the matching sheet. Sub-tab switches hit the TanStack cache.
  const { data, isLoading, isError, error } = useIntelBundle<unknown>(
    accountId, period, section,
  );
  if (isLoading) return <SectionSkeleton />;
  if (isError) return <ErrorCard error={error} />;
  if (!data) return null;
  const infra = (data as { _infra?: InfraHealth })._infra;
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

// 09-Jun · Fires a useIntelBundle for every non-active section so all
// 16 requests go out in parallel on first mount. Renders nothing —
// just keeps the queries alive. Subsequent sub-tab switches read from
// the TanStack cache instead of starting a fresh request.
function HiddenPrefetcher({
  accountId,
  period,
  active,
}: {
  accountId: string;
  period: ReturnType<typeof useAccountPeriod>["period"];
  active: IntelSection;
}) {
  const ALL_SECTIONS: IntelSection[] = [
    "account-subscribers", "category-watch", "abi",
    "supplier-discovery", "supplier-monitoring", "custom-usage",
    "thought-leadership", "datahub", "inflation-watch",
    "cirtuo", "nnamu", "upply", "alerts", "training", "nps",
    "super-users",
  ];
  return (
    <div className="hidden">
      {ALL_SECTIONS.filter((s) => s !== active).map((s) => (
        <PrefetchOne key={s} accountId={accountId} period={period} section={s} />
      ))}
    </div>
  );
}

function PrefetchOne({
  accountId,
  period,
  section,
}: {
  accountId: string;
  period: ReturnType<typeof useAccountPeriod>["period"];
  section: IntelSection;
}) {
  // Mounting useIntelBundle is what fires the request; we don't read
  // the result here. The active section's own SectionFetcher reads
  // from the same cache once data lands.
  useIntelBundle(accountId, period, section);
  return null;
}

function SubRender({
  data,
  section,
  mode,
}: {
  data: unknown;
  section: IntelSection;
  mode: SheetMode;
}) {
  switch (section) {
    case "account-subscribers":
      return <SubscribersSheet data={data as AccountSubscribers} mode={mode} />;
    case "category-watch":
      return <CategoryWatchSheet data={data as CategoryWatch} mode={mode} />;
    case "abi":
      return <AbiSheet data={data as Abi} mode={mode} />;
    case "supplier-discovery":
      return <SDSheet data={data as SupplierDiscovery} mode={mode} />;
    case "supplier-monitoring":
      return <SMSheet data={data as SupplierMonitoring} mode={mode} />;
    case "custom-usage":
      return <CustomUsageSheet data={data as CustomUsage} mode={mode} />;
    case "thought-leadership":
      return <TLSheet data={data as ThoughtLeadership} mode={mode} />;
    case "datahub":
      return <DataHubSheet data={data as DataHubBundle} mode={mode} />;
    case "inflation-watch":
      return <IWSheet data={data as InflationWatch} mode={mode} />;
    case "cirtuo":
      return <CirtuoSheet data={data as OfflineBundle} mode={mode} />;
    case "nnamu":
      return <NnamuSheet data={data as OfflineBundle} mode={mode} />;
    case "upply":
      return <UpplySheet data={data as OfflineBundle} mode={mode} />;
    case "alerts":
      return <AlertsSheet data={data as AlertsBundle} mode={mode} />;
    case "training":
      return <TrainingSheet data={data as OfflineBundle} mode={mode} />;
    case "nps":
      return <NpsSheet data={data as OfflineBundle} mode={mode} />;
    case "super-users":
      return <SuperUsersSheet data={data as SuperUsersBundle} mode={mode} />;
    case "scores":
      return <ScoresSheet data={data as ScoresBundle} mode={mode} />;
  }
}

function ErrorCard({ error }: { error: unknown }) {
  const status = (error as { status?: number } | null)?.status;
  return (
    <Card>
      <div className="font-manrope text-[13px] font-bold mb-1" style={{ color: "#c0392b" }}>
        Couldn't load Intelligence & Reports
      </div>
      <div className="font-manrope text-[12px] text-analytics-ink-2">
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
      <div className="font-manrope flex items-center gap-2 text-[11px] font-bold text-analytics-teal-700 mb-3">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-analytics-teal-500 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-analytics-teal-500" />
        </span>
        Loading from Redshift… first load takes 5-25s, then it's cached
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-[88px] rounded-[13px] bg-analytics-line-2 animate-pulse"
          />
        ))}
      </div>
      <div className="space-y-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-3 rounded bg-analytics-line-2 animate-pulse"
            style={{ width: `${85 - i * 8}%` }}
          />
        ))}
      </div>
    </Card>
  );
}
