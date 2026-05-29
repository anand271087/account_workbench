// M29 — Intelligence & Reports · Intelligence section.
//
// 6 sub-tabs (faithful port of prototype bIntel):
//   Category Watch · Supplier Watch · Abi Engagement · Industry Benchmark
//   · Engagement Metrics · NPS

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAccountFromLayout } from "../../AccountProfileLayout";
import {
  HEAT_COLOR,
  HEAT_ICON,
  RISK_COLOR,
  RISK_LABEL,
  type PlatformIntel,
  type SupplierRisk,
} from "@/types/platform_intel";

type SubTab =
  | "category"
  | "supplier"
  | "abi"
  | "benchmark"
  | "engagement"
  | "nps";

const SUB_TABS: Array<{ id: SubTab; label: string }> = [
  { id: "category", label: "Category Watch" },
  { id: "supplier", label: "Supplier Watch" },
  { id: "abi", label: "Abi Engagement" },
  { id: "benchmark", label: "Industry Benchmark" },
  { id: "engagement", label: "Engagement Metrics" },
  { id: "nps", label: "NPS" },
];

export default function IntelligenceTab() {
  const account = useAccountFromLayout();
  const [sub, setSub] = useState<SubTab>("category");

  const { data, isLoading } = useQuery<PlatformIntel>({
    queryKey: ["platform-intel", account.id],
    queryFn: () =>
      api.get<PlatformIntel>(`/api/v1/accounts/${account.id}/platform-intel`),
  });

  return (
    <div>
      {/* Pill sub-tab strip */}
      <div className="flex gap-1 mb-3 flex-wrap">
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setSub(t.id)}
            className={cn(
              "text-[12px] px-3 py-1.5 rounded-md border-[1.5px] transition-colors",
              sub === t.id
                ? "border-beroe-teal/40 bg-beroe-teal/100/10 text-beroe-teal font-bold"
                : "border-beroe-card-border bg-white text-text-secondary font-medium hover:bg-beroe-bg/60",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {isLoading || !data ? (
        <Card>
          <div className="text-sm text-text-muted">Loading intelligence…</div>
        </Card>
      ) : !data.has_data ? (
        <Card>
          <div className="text-center py-12 text-text-muted">
            <div className="text-[28px] mb-2">📡</div>
            <div className="text-[13px] font-semibold">No platform data yet</div>
            <div className="text-[11px] mt-1">
              Once {account.name} starts using the Beroe platform, intelligence
              will populate here automatically.
            </div>
          </div>
        </Card>
      ) : sub === "category" ? (
        <CategoryWatch data={data} />
      ) : sub === "supplier" ? (
        <SupplierWatch data={data} />
      ) : sub === "abi" ? (
        <AbiEngagement data={data} />
      ) : sub === "benchmark" ? (
        <IndustryBenchmark data={data} accountName={account.name} accountIndustry={account.industry} />
      ) : sub === "engagement" ? (
        <EngagementMetrics data={data} />
      ) : (
        <Nps data={data} />
      )}
    </div>
  );
}

// ============================================================
// Sub-tab — Category Watch
// ============================================================

function CategoryWatch({ data }: { data: PlatformIntel }) {
  const ci = data.cat_intel;
  const sectionRows: Array<[string, number, string]> = [
    ["Price Intelligence", ci.section_avg.price, "#4A00F8"],
    ["Supplier Analysis", ci.section_avg.supplier, "#C344C7"],
    ["Market Dynamics", ci.section_avg.market, "#35E1D4"],
    ["Forecasts", ci.section_avg.forecast, "#6EC457"],
    ["Risk & Alerts", ci.section_avg.risk, "#F0BC41"],
  ];
  const maxVisits = Math.max(...(ci.top_cats?.map((c) => c.visits) ?? [1]), 1);

  return (
    <Card>
      <div className="text-[14px] font-bold mb-3">
        Category Watch — Section-Level Analysis
      </div>
      <div className="grid grid-cols-2 gap-4">
        {/* Left: section avg */}
        <div>
          <SectionHeader>Avg time per section (min)</SectionHeader>
          <div className="space-y-1.5 mt-2">
            {sectionRows.map(([label, val, col]) => (
              <div
                key={label}
                className="flex items-center justify-between text-[12px]"
              >
                <span className="flex items-center gap-2">
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ background: col }}
                  />
                  {label}
                </span>
                <b style={{ color: col }}>{val.toFixed(1)} min</b>
              </div>
            ))}
          </div>
        </div>
        {/* Right: category heat */}
        <div>
          <SectionHeader>Category activity + heat</SectionHeader>
          <div className="space-y-2 mt-2">
            {(ci.top_cats ?? []).map((cat) => {
              const pct = Math.min(100, Math.round((cat.visits / maxVisits) * 100));
              return (
                <div key={cat.name}>
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[12px]">
                      {HEAT_ICON[cat.heat]} <b>{cat.name}</b>
                    </span>
                    <span className="text-[11px] font-semibold">
                      {cat.visits} visits
                    </span>
                  </div>
                  <div className="h-1.5 bg-beroe-bg rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, background: HEAT_COLOR[cat.heat] }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {(ci.insights ?? []).length > 0 && (
        <div className="mt-4">
          <SectionHeader>Insights</SectionHeader>
          <div className="space-y-1.5 mt-2">
            {ci.insights.map((ins, i) => {
              const tone =
                ins.tone === "red"
                  ? "bg-beroe-red/10 text-beroe-red border-beroe-red/30"
                  : ins.tone === "warn"
                    ? "bg-beroe-amber/15 text-beroe-amber border-beroe-amber/40"
                    : "bg-beroe-green/15 text-beroe-green border-beroe-green/30";
              return (
                <div
                  key={i}
                  className={cn(
                    "text-[12px] px-3 py-2 rounded-md border",
                    tone,
                  )}
                >
                  {ins.text}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

// ============================================================
// Sub-tab — Supplier Watch
// ============================================================

function SupplierWatch({ data }: { data: PlatformIntel }) {
  const sw = data.supplier_watch;
  const cards: Array<[string, number, string]> = [
    ["Total Tracked", sw.tracked, "#4A00F8"],
    ["High Risk", sw.by_risk.high, RISK_COLOR.high],
    ["Med-High", sw.by_risk.med_high, RISK_COLOR.med_high],
    ["Medium", sw.by_risk.med, RISK_COLOR.med],
    ["Low Risk", sw.by_risk.low, RISK_COLOR.low],
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-5 gap-2">
        {cards.map(([label, val, col]) => (
          <Kpi key={label} label={label} value={String(val)} color={col} />
        ))}
      </div>
      <Card>
        <div className="text-[13px] font-bold mb-3">Tracked Suppliers</div>
        {sw.suppliers.length === 0 ? (
          <div className="text-center py-5 text-text-muted text-[12px]">
            No suppliers tracked yet
          </div>
        ) : (
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-text-muted text-left border-b border-beroe-card-border">
                <th className="py-2 px-2">Supplier</th>
                <th className="py-2 px-2">Category</th>
                <th className="py-2 px-2">Country</th>
                <th className="py-2 px-2">Risk Level</th>
              </tr>
            </thead>
            <tbody>
              {sw.suppliers.map((s, i) => (
                <tr
                  key={i}
                  className="border-b border-beroe-card-border/60 last:border-b-0"
                >
                  <td className="py-2 px-2 font-semibold">{s.name}</td>
                  <td className="py-2 px-2">{s.cat ?? "—"}</td>
                  <td className="py-2 px-2">{s.country ?? "—"}</td>
                  <td className="py-2 px-2">
                    <RiskPill risk={s.risk} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

function RiskPill({ risk }: { risk: SupplierRisk }) {
  const col = RISK_COLOR[risk];
  return (
    <span
      className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
      style={{ background: col + "18", color: col }}
    >
      {RISK_LABEL[risk]}
    </span>
  );
}

// ============================================================
// Sub-tab — Abi Engagement
// ============================================================

function AbiEngagement({ data }: { data: PlatformIntel }) {
  const abi = data.abi;
  const cm = abi.complexity_mix;
  const totalMix = cm.l1a + cm.l1m + cm.l2 + cm.l3 + cm.l4 || 1;
  // Usage Trend can be carried directly on the abi payload when telemetry
  // exists (allowed via extra="allow" on AbiIntel). Falls back to "—"
  // until the field is populated.
  const usageTrend =
    (abi as unknown as { usage_trend?: string | null }).usage_trend ?? "—";
  const cards: Array<[string, string, string]> = [
    ["Total Queries", String(abi.total_queries), "#4A00F8"],
    ["Queries/User", abi.queries_per_user.toFixed(1), "#C344C7"],
    ["Resolution Rate", abi.resolution_rate ?? "—", "#6EC457"],
    ["Avg Response", abi.avg_response ?? "—", "#F0BC41"],
    ["Usage Trend", usageTrend, "#6EC457"],
  ];
  const complexityRows: Array<[string, number, string, string]> = [
    ["L1 Auto", cm.l1a, "#4A00F8", "Quick lookups"],
    ["L1 Manual", cm.l1m, "#C344C7", "Guided queries"],
    ["L2", cm.l2, "#6EC457", "Multi-source analysis"],
    ["L3", cm.l3, "#F0BC41", "Deep research"],
    ["L4", cm.l4, "#CF4548", "Strategic advisory"],
  ];
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-5 gap-2">
        {cards.map(([label, val, col]) => (
          <Kpi key={label} label={label} value={val} color={col} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <div className="text-[14px] font-bold mb-3">
            Query Complexity Breakdown
          </div>
          <div className="space-y-2">
            {complexityRows.map(([label, val, col, hint]) => {
              const pct = Math.round((val / totalMix) * 100);
              return (
                <div key={label}>
                  <div className="flex items-center justify-between text-[12px] mb-0.5">
                    <span>
                      <b style={{ color: col }}>{label}</b>{" "}
                      <span className="text-text-muted">— {hint}</span>
                    </span>
                    <span className="font-semibold">
                      {val} <span className="text-text-muted">({pct}%)</span>
                    </span>
                  </div>
                  <div className="h-1.5 bg-beroe-bg rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, background: col }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
        <Card>
          <div className="text-[14px] font-bold mb-3">Top Query Types</div>
          {(abi.top_types ?? []).length === 0 ? (
            <div className="text-text-muted text-[12px]">No query types logged</div>
          ) : (
            <div className="space-y-2">
              {abi.top_types.map((t, i) => {
                const col = ["#4A00F8", "#C344C7", "#6EC457", "#F0BC41", "#35E1D4"][i % 5];
                return (
                  <div
                    key={i}
                    className="flex items-center gap-3 py-1.5 border-b border-beroe-card-border/60 last:border-b-0 text-[12px]"
                  >
                    <span
                      className="w-6 h-6 rounded-md flex items-center justify-center font-bold text-[10px]"
                      style={{ background: col + "20", color: col }}
                    >
                      {i + 1}
                    </span>
                    <span>{t}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
      {abi.insight && (
        <Card>
          <div className="text-[14px] font-bold mb-2">Abi Usage Insight</div>
          <div className="text-[12px] text-text-secondary bg-beroe-teal/10 border border-beroe-teal/30 rounded px-3 py-2 leading-relaxed">
            {abi.insight}
          </div>
        </Card>
      )}
    </div>
  );
}

// ============================================================
// Sub-tab — Industry Benchmark
// ============================================================

function IndustryBenchmark({
  data,
  accountName,
  accountIndustry,
}: {
  data: PlatformIntel;
  accountName: string;
  accountIndustry: string | null;
}) {
  const b = data.benchmark;
  // Account-side numbers come from M27 signals + M20 metrics in production;
  // here we render straight from the seeded data.
  const accAbi = data.abi.total_queries;
  const accEngagement =
    data.engagement.alerts +
    data.engagement.newsletters +
    data.engagement.webinars +
    data.engagement.podcasts +
    data.engagement.training;

  const metrics: Array<[string, number, number, string]> = [
    ["Abi Queries", accAbi, b.avg_abi, "#C344C7"],
    ["Engagement", accEngagement, b.avg_engagement, "#6EC457"],
    ["Health Avg", b.avg_health, b.avg_health, "#4A00F8"],
    ["Seat % Avg", b.avg_seat_pct, b.avg_seat_pct, "#35E1D4"],
    ["Logins Avg", b.avg_logins, b.avg_logins, "#F0BC41"],
  ];

  return (
    <Card>
      <div className="text-[14px] font-bold mb-1">
        Industry Benchmark Comparison
      </div>
      <div className="text-[12px] text-text-muted mb-3">
        {accountName} vs {accountIndustry ?? "—"}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {metrics.map(([label, val, avg, col]) => {
          const pct = avg > 0 ? Math.round((val / avg) * 100) : 0;
          const status = pct >= 120 ? "Above" : pct >= 80 ? "On Par" : "Below";
          const sc =
            pct >= 120 ? "#6EC457" : pct >= 80 ? "#4A00F8" : "#CF4548";
          return (
            <div
              key={label}
              className="bg-beroe-bg rounded-md p-3.5 text-center"
            >
              <div
                className="text-[24px] font-extrabold"
                style={{ color: col }}
              >
                {val}
              </div>
              <div className="text-[10px] text-text-muted my-1">{label}</div>
              <div className="text-[10px] text-text-muted mb-1.5">
                Avg: {avg}
              </div>
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ background: sc + "15", color: sc }}
              >
                {status} ({pct}%)
              </span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ============================================================
// Sub-tab — Engagement Metrics
// ============================================================

function EngagementMetrics({ data }: { data: PlatformIntel }) {
  const e = data.engagement;
  const items: Array<[string, number, number, string]> = [
    ["🔔 Alerts", e.alerts, 100, "#4A00F8"],
    ["📧 Newsletters", e.newsletters, 100, "#6EC457"],
    ["🎥 Webinars", e.webinars, 30, "#C344C7"],
    ["🎙 Podcasts", e.podcasts, 20, "#F0BC41"],
    ["📚 Training", e.training, 30, "#35E1D4"],
  ];
  const us = e.user_segmentation;
  const segRows: Array<[string, number, string]> = [
    ["Cat. Managers", us.cat_managers, "#4A00F8"],
    ["Buyers", us.buyers, "#6EC457"],
    ["Sourcing", us.sourcing_analysts, "#C344C7"],
    ["Directors", us.directors, "#F0BC41"],
    ["Exec Team", us.exec_team, "#CF4548"],
    ["COE", us.coe, "#35E1D4"],
    ["CPO", us.cpo, "#C344C7"],
  ];
  const segHasData = segRows.some(([, v]) => v > 0);

  return (
    <Card>
      <div className="text-[14px] font-bold mb-3">Engagement Activeness</div>
      <div className="grid grid-cols-5 gap-2 mb-4">
        {items.map(([label, val, max, col]) => {
          const pct = Math.min(100, Math.round((val / max) * 100));
          return (
            <div
              key={label}
              className="bg-beroe-bg rounded-md p-3.5 text-center"
            >
              <div
                className="text-[20px] font-extrabold"
                style={{ color: col }}
              >
                {val}
              </div>
              <div className="text-[10px] text-text-muted my-1">{label}</div>
              <div className="h-1 bg-beroe-bg rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${pct}%`, background: col }}
                />
              </div>
            </div>
          );
        })}
      </div>
      {segHasData && (
        <div>
          <div className="text-[14px] font-bold mb-2">User Segmentation</div>
          <div className="grid grid-cols-7 gap-1.5">
            {segRows.map(([label, val, col]) => (
              <div
                key={label}
                className="bg-beroe-bg rounded-md p-2 text-center"
              >
                <div
                  className="text-[16px] font-extrabold"
                  style={{ color: col }}
                >
                  {val}
                </div>
                <div className="text-[9px] text-text-muted mt-0.5 leading-tight">
                  {label}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

// ============================================================
// Sub-tab — NPS
// ============================================================

function Nps({ data }: { data: PlatformIntel }) {
  const nps = data.nps;
  const score = nps.score;
  const npsCol =
    score === null
      ? "#94a3b8"
      : score >= 50
        ? "#6EC457"
        : score >= 0
          ? "#F0BC41"
          : "#CF4548";
  const label =
    score === null
      ? "—"
      : score >= 50
        ? "Promoter"
        : score >= 0
          ? "Passive"
          : "Detractor";

  return (
    <div className="grid grid-cols-2 gap-3">
      <Card>
        <div className="text-[14px] font-bold mb-3">NPS Score</div>
        {score !== null ? (
          <div className="text-center py-5">
            <div className="text-[48px] font-extrabold" style={{ color: npsCol }}>
              {score}
            </div>
            <div
              className="text-[13px] font-semibold mt-1"
              style={{ color: npsCol }}
            >
              {label}
            </div>
          </div>
        ) : (
          <div className="text-center py-8 text-text-muted text-[12px]">
            No NPS score recorded yet.
          </div>
        )}
      </Card>
      <Card>
        <div className="text-[14px] font-bold mb-3">Voice of Customer</div>
        {nps.voc.length === 0 ? (
          <div className="text-center py-8 text-text-muted text-[12px]">
            No testimonials yet
          </div>
        ) : (
          <div className="space-y-2">
            {nps.voc.map((v, i) => {
              const sc =
                v.sentiment === "positive"
                  ? "#6EC457"
                  : v.sentiment === "negative"
                    ? "#CF4548"
                    : "#64748b";
              return (
                <div
                  key={i}
                  className="border-l-[3px] rounded-r-md px-3 py-2"
                  style={{ borderLeftColor: sc, background: sc + "08" }}
                >
                  <div className="text-[12px] italic text-text-primary leading-relaxed">
                    “{v.quote}”
                  </div>
                  <div className="text-[11px] text-text-muted mt-1">
                    — {v.author ?? "—"}
                    {v.role && <>, {v.role}</>}
                    {v.date && (
                      <> · {new Date(v.date).toLocaleDateString()}</>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

// ============================================================
// Shared primitives
// ============================================================

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white border border-beroe-card-border rounded-card p-4">
      {children}
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
      {children}
    </div>
  );
}

function Kpi({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="bg-white border border-beroe-card-border rounded-card px-3 py-3 text-center">
      <div className="text-[18px] font-extrabold" style={{ color }}>
        {value}
      </div>
      <div className="text-[10px] text-text-muted mt-0.5">{label}</div>
    </div>
  );
}
