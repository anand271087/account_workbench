// M30 — Intelligence & Reports · Analytics section.
//
// 8 sub-tabs (faithful port of prototype bAnalytics):
//   Usage & Logins · Module Activity · Category Watch · Abi Intelligence
//   · Supplier Discovery · Supplier Risk · Custom Credits · Super Users
//
// Numbers / Charts mode toggle. Charts rendered inline as SVG (no
// Chart.js dependency) — kept lightweight for sprint-1.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAccountFromLayout } from "../../AccountProfileLayout";
import {
  RISK_COLOR,
  RISK_LABEL,
  type PlatformIntel,
} from "@/types/platform_intel";

type Sub =
  | "usage"
  | "modules"
  | "cw"
  | "abi"
  | "sd"
  | "srm"
  | "cc"
  | "su";
type Mode = "numbers" | "charts";

const SUB_TABS: Array<{ id: Sub; label: string }> = [
  { id: "usage", label: "Usage & Logins" },
  { id: "modules", label: "Module Activity" },
  { id: "cw", label: "Category Watch" },
  { id: "abi", label: "Abi Intelligence" },
  { id: "sd", label: "Supplier Discovery" },
  { id: "srm", label: "Supplier Risk" },
  { id: "cc", label: "Custom Credits" },
  { id: "su", label: "Super Users" },
];

export default function AnalyticsTab() {
  const account = useAccountFromLayout();
  const [sub, setSub] = useState<Sub>("usage");
  const [mode, setMode] = useState<Mode>("charts");

  const { data, isLoading } = useQuery<PlatformIntel>({
    queryKey: ["platform-intel", account.id],
    queryFn: () =>
      api.get<PlatformIntel>(`/api/v1/accounts/${account.id}/platform-intel`),
  });

  return (
    <div>
      {/* Header — sub-tab pills + mode toggle */}
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="flex gap-1 flex-wrap">
          {SUB_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setSub(t.id)}
              className={cn(
                "text-[11px] px-2.5 py-1.5 rounded-md border-[1.5px] transition-colors",
                sub === t.id
                  ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-700 font-bold"
                  : "border-beroe-card-border bg-white text-text-secondary font-medium hover:bg-beroe-bg/60",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex gap-0.5 bg-slate-100 rounded-md p-0.5 flex-shrink-0">
          {(["numbers", "charts"] as Mode[]).map((mv) => (
            <button
              key={mv}
              onClick={() => setMode(mv)}
              className={cn(
                "text-[11px] px-2.5 py-1 rounded font-semibold uppercase tracking-wider",
                mode === mv
                  ? "bg-white shadow-sm text-cyan-700"
                  : "text-text-muted",
              )}
            >
              {mv === "numbers" ? "#" : "📊 Chart"}
            </button>
          ))}
        </div>
      </div>

      {isLoading || !data ? (
        <Card>
          <div className="text-sm text-text-muted">Loading analytics…</div>
        </Card>
      ) : !data.has_data ? (
        <Card>
          <div className="text-center py-12 text-text-muted">
            <div className="text-[28px] mb-2">📈</div>
            <div className="text-[13px] font-semibold">No platform data yet</div>
            <div className="text-[11px] mt-1">
              Analytics will populate once {account.name} starts using the Beroe
              platform.
            </div>
          </div>
        </Card>
      ) : sub === "usage" ? (
        <UsageSection data={data} mode={mode} />
      ) : sub === "modules" ? (
        <ModulesSection data={data} mode={mode} />
      ) : sub === "cw" ? (
        <CWSection data={data} mode={mode} />
      ) : sub === "abi" ? (
        <AbiSection data={data} mode={mode} />
      ) : sub === "sd" ? (
        <SDSection data={data} mode={mode} />
      ) : sub === "srm" ? (
        <SRMSection data={data} mode={mode} />
      ) : sub === "cc" ? (
        <CCSection data={data} mode={mode} />
      ) : (
        <SUSection data={data} />
      )}
    </div>
  );
}

// ============================================================
// Usage & Logins
// ============================================================

function UsageSection({ data, mode }: { data: PlatformIntel; mode: Mode }) {
  const u = data.usage;
  const adoption = [
    ["Active", u.active_seats, "#40CC8F"],
    ["Inactive", u.inactive_seats, "#FD576B"],
    ["Total Licensed", u.licensed_users, "#4A00F8"],
  ] as Array<[string, number, string]>;

  if (mode === "numbers") {
    return (
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardTitle>Monthly Logins</CardTitle>
          <SimpleTable
            rows={u.months.map((m, i) => [m, String(u.monthly_logins[i] ?? 0)])}
            headers={["Month", "Logins"]}
          />
        </Card>
        <Card>
          <CardTitle>Monthly Active Users</CardTitle>
          <SimpleTable
            rows={u.months.map((m, i) => [m, String(u.monthly_active[i] ?? 0)])}
            headers={["Month", "Active"]}
          />
        </Card>
        <Card className="col-span-2">
          <CardTitle>User Adoption</CardTitle>
          <SimpleTable
            rows={adoption.map(([l, v]) => [
              l,
              String(v),
              `${Math.round((v / Math.max(1, u.licensed_users)) * 100)}%`,
            ])}
            headers={["Status", "Users", "%"]}
          />
        </Card>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-3 gap-3">
      <Card>
        <CardTitle>Monthly Logins</CardTitle>
        <LineChart
          labels={u.months}
          values={u.monthly_logins}
          color="#4A00F8"
        />
      </Card>
      <Card>
        <CardTitle>Monthly Active Users</CardTitle>
        <LineChart
          labels={u.months}
          values={u.monthly_active}
          color="#40CC8F"
        />
      </Card>
      <Card>
        <CardTitle>User Adoption</CardTitle>
        <DonutChart
          slices={adoption.map(([label, val, color]) => ({
            label: label as string,
            value: val as number,
            color: color as string,
          }))}
        />
      </Card>
    </div>
  );
}

// ============================================================
// Module Activity
// ============================================================

function ModulesSection({ data, mode }: { data: PlatformIntel; mode: Mode }) {
  const m = data.modules;
  const items: Array<[string, number, string, keyof typeof m.monthly]> = [
    ["Market Monitor", m.mmd, "#4A00F8", "mmd"],
    ["Abi Queries", m.abi, "#C344C7", "abi"],
    ["Supplier Discovery", m.sd, "#40CC8F", "sd"],
    ["Downloads", m.dl, "#d88520", "dl"],
    ["Benchmarks", m.bm, "#35E1D4", "bm"],
  ];
  const total = items.reduce((s, [, v]) => s + v, 0);

  if (mode === "numbers") {
    return (
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardTitle>Module Activity</CardTitle>
          <SimpleTable
            headers={["Module", "Sessions", "Share"]}
            rows={items.map(([label, val, col]) => [
              <span key={label} className="inline-flex items-center gap-1.5">
                <span
                  className="w-2 h-2 rounded-sm"
                  style={{ background: col }}
                />
                {label}
              </span>,
              String(val),
              `${total > 0 ? Math.round((val / total) * 100) : 0}%`,
            ])}
          />
        </Card>
        <Card>
          <CardTitle>Module Trend (12 months)</CardTitle>
          <SimpleTable
            headers={["Month", ...items.map(([l]) => l)]}
            rows={data.usage.months.map((mo, i) => [
              mo,
              ...items.map(
                ([, , , key]) => String(m.monthly[key]?.[i] ?? 0),
              ),
            ])}
            compact
          />
        </Card>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      <Card>
        <CardTitle>Module Share</CardTitle>
        <DonutChart
          slices={items.map(([label, val, col]) => ({
            label,
            value: val,
            color: col,
          }))}
        />
      </Card>
      <Card>
        <CardTitle>Module Trend (12 months)</CardTitle>
        <MultiLineChart
          labels={data.usage.months}
          series={items.map(([label, , col, key]) => ({
            label,
            color: col,
            values: m.monthly[key] ?? [],
          }))}
        />
      </Card>
    </div>
  );
}

// ============================================================
// Category Watch
// ============================================================

function CWSection({ data, mode }: { data: PlatformIntel; mode: Mode }) {
  const ci = data.cat_intel;
  const cats = ci.top_cats.filter((c) => c.visits > 0);
  const sa = ci.section_avg;
  const sectionRows: Array<[string, number, string]> = [
    ["Price Intelligence", sa.price, "#4A00F8"],
    ["Supplier Analysis", sa.supplier, "#C344C7"],
    ["Market Dynamics", sa.market, "#35E1D4"],
    ["Forecasts", sa.forecast, "#40CC8F"],
    ["Risk & Alerts", sa.risk, "#EF9637"],
  ];

  if (mode === "numbers") {
    return (
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardTitle>Section Time (min)</CardTitle>
          <SimpleTable
            headers={["Section", "Avg min"]}
            rows={sectionRows.map(([label, val]) => [label, val.toFixed(1)])}
          />
        </Card>
        <Card>
          <CardTitle>Top Categories</CardTitle>
          <SimpleTable
            headers={["Category", "Visits", "Heat"]}
            rows={cats.map((c) => [c.name, String(c.visits), c.heat])}
          />
        </Card>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      <Card>
        <CardTitle>Avg time per section (min)</CardTitle>
        <BarChart
          rows={sectionRows.map(([label, val, col]) => ({
            label,
            value: val,
            color: col,
          }))}
        />
      </Card>
      <Card>
        <CardTitle>Top Categories — Visits</CardTitle>
        <BarChart
          rows={cats.map((c) => ({
            label: c.name,
            value: c.visits,
            color:
              c.heat === "hot"
                ? "#FD576B"
                : c.heat === "warm"
                  ? "#EF9637"
                  : c.heat === "whitespace"
                    ? "#94a3b8"
                    : "#cbd5e1",
          }))}
        />
      </Card>
    </div>
  );
}

// ============================================================
// Abi Intelligence
// ============================================================

function AbiSection({ data, mode }: { data: PlatformIntel; mode: Mode }) {
  const abi = data.abi;
  const totalQ = abi.total_queries;
  const cm = abi.complexity_mix;
  const totalMix = cm.l1a + cm.l1m + cm.l2 + cm.l3 + cm.l4 || 1;
  const rows: Array<[string, number, string]> = [
    ["L1 Auto", cm.l1a, "#4A00F8"],
    ["L1 Manual", cm.l1m, "#C344C7"],
    ["L2", cm.l2, "#40CC8F"],
    ["L3", cm.l3, "#EF9637"],
    ["L4", cm.l4, "#FD576B"],
  ];

  if (mode === "numbers") {
    return (
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardTitle>Abi KPIs</CardTitle>
          <SimpleTable
            headers={["Metric", "Value"]}
            rows={[
              ["Total Queries", String(totalQ)],
              ["Queries per User", abi.queries_per_user.toFixed(1)],
              ["Resolution Rate", abi.resolution_rate ?? "—"],
              ["Avg Response", abi.avg_response ?? "—"],
            ]}
          />
        </Card>
        <Card>
          <CardTitle>Complexity Breakdown</CardTitle>
          <SimpleTable
            headers={["Level", "%", "Queries"]}
            rows={rows.map(([label, val]) => {
              const pct = Math.round((val / totalMix) * 100);
              return [label, `${pct}%`, String(val)];
            })}
          />
        </Card>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      <Card>
        <CardTitle>Complexity Mix</CardTitle>
        <DonutChart
          slices={rows.map(([label, val, col]) => ({
            label,
            value: val,
            color: col,
          }))}
        />
      </Card>
      <Card>
        <CardTitle>Top Query Types</CardTitle>
        <BarChart
          rows={(abi.top_types ?? []).map((t, i) => ({
            label: t,
            value: 100 - i * 10,
            color: ["#4A00F8", "#C344C7", "#40CC8F", "#EF9637", "#35E1D4"][i % 5],
          }))}
        />
      </Card>
    </div>
  );
}

// ============================================================
// Supplier Discovery
// ============================================================

function SDSection({ data, mode }: { data: PlatformIntel; mode: Mode }) {
  const sd = data.modules.sd;
  const monthly = data.modules.monthly.sd ?? [];
  const months = data.usage.months;
  const shortlists = Math.round(sd * 0.4);
  const convRate = sd > 0 ? Math.round((shortlists / sd) * 100) : 0;
  const regions: Array<[string, number, string]> = [
    ["EMEA", Math.round(sd * 0.45), "#4A00F8"],
    ["APAC", Math.round(sd * 0.3), "#40CC8F"],
    ["Americas", Math.round(sd * 0.25), "#C344C7"],
  ];

  if (mode === "numbers") {
    return (
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardTitle>SD KPIs</CardTitle>
          <SimpleTable
            headers={["Metric", "Value"]}
            rows={[
              ["Searches", String(sd)],
              ["Shortlists", String(shortlists)],
              ["Conversion Rate", `${convRate}%`],
            ]}
          />
        </Card>
        <Card>
          <CardTitle>Searches by Region</CardTitle>
          <SimpleTable
            headers={["Region", "Searches"]}
            rows={regions.map(([r, v]) => [r, String(v)])}
          />
        </Card>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      <Card>
        <CardTitle>Searches Trend (12 months)</CardTitle>
        <LineChart labels={months} values={monthly} color="#40CC8F" />
      </Card>
      <Card>
        <CardTitle>Searches by Region</CardTitle>
        <DonutChart
          slices={regions.map(([label, val, col]) => ({
            label,
            value: val,
            color: col,
          }))}
        />
      </Card>
    </div>
  );
}

// ============================================================
// Supplier Risk
// ============================================================

function SRMSection({ data, mode }: { data: PlatformIntel; mode: Mode }) {
  const sw = data.supplier_watch;
  const rows: Array<[string, number, string]> = [
    ["High Risk", sw.by_risk.high, RISK_COLOR.high],
    ["Med-High", sw.by_risk.med_high, RISK_COLOR.med_high],
    ["Medium", sw.by_risk.med, RISK_COLOR.med],
    ["Low Risk", sw.by_risk.low, RISK_COLOR.low],
  ];

  if (mode === "numbers") {
    return (
      <Card>
        <CardTitle>Supplier Risk KPIs</CardTitle>
        <SimpleTable
          headers={["Metric", "Value"]}
          rows={[
            ["Suppliers Tracked", String(sw.tracked)],
            ...rows.map(([label, val]) => [label, String(val)] as [string, string]),
          ]}
        />
        <div className="mt-3">
          <CardTitle>Top Tracked Suppliers</CardTitle>
          {sw.suppliers.length === 0 ? (
            <div className="text-[12px] text-text-muted">None tracked</div>
          ) : (
            <SimpleTable
              headers={["Name", "Category", "Country", "Risk"]}
              rows={sw.suppliers.map((s) => [
                s.name,
                s.cat ?? "—",
                s.country ?? "—",
                RISK_LABEL[s.risk],
              ])}
            />
          )}
        </div>
      </Card>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      <Card>
        <CardTitle>Risk Distribution</CardTitle>
        <DonutChart
          slices={rows.map(([label, val, col]) => ({
            label,
            value: val,
            color: col,
          }))}
        />
      </Card>
      <Card>
        <CardTitle>Risk Tiers</CardTitle>
        <BarChart
          rows={rows.map(([label, val, col]) => ({
            label,
            value: val,
            color: col,
          }))}
        />
      </Card>
    </div>
  );
}

// ============================================================
// Custom Credits
// ============================================================

function CCSection({ data, mode }: { data: PlatformIntel; mode: Mode }) {
  const cm = data.abi.complexity_mix;
  const totalMix = cm.l1a + cm.l1m + cm.l2 + cm.l3 + cm.l4 || 1;
  const totalQ = data.abi.total_queries;
  const l1mQ = Math.round((totalQ * cm.l1m) / totalMix);
  const l2Q = Math.round((totalQ * cm.l2) / totalMix);
  const l3Q = Math.round((totalQ * cm.l3) / totalMix);
  const l4Q = Math.round((totalQ * cm.l4) / totalMix);
  const creditsEst = Math.round(l2Q * 0.5 + l3Q * 2 + l4Q * 5);

  const rows: Array<[string, number, number, string]> = [
    ["L1M", l1mQ, 0, "#C344C7"],
    ["L2", l2Q, Math.round(l2Q * 0.5), "#40CC8F"],
    ["L3", l3Q, l3Q * 2, "#EF9637"],
    ["L4", l4Q, l4Q * 5, "#FD576B"],
  ];

  if (mode === "numbers") {
    return (
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardTitle>Custom Credits KPIs</CardTitle>
          <SimpleTable
            headers={["Metric", "Value"]}
            rows={[
              ["Credits Estimated", String(creditsEst)],
              ["L3 Requests", String(l3Q)],
              ["L4 Requests", String(l4Q)],
              ["Avg Feedback", "8.5/10"],
            ]}
          />
        </Card>
        <Card>
          <CardTitle>Credits by Complexity</CardTitle>
          <SimpleTable
            headers={["Level", "Queries", "Est. Credits"]}
            rows={rows.map(([label, q, c]) => [label, String(q), String(c)])}
          />
        </Card>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3">
      <Card>
        <CardTitle>Estimated Credits by Level</CardTitle>
        <BarChart
          rows={rows.map(([label, , credits, col]) => ({
            label,
            value: credits,
            color: col,
          }))}
        />
      </Card>
      <Card>
        <CardTitle>Total Credits Estimated</CardTitle>
        <div className="text-center py-10">
          <div className="text-[48px] font-extrabold text-cyan-700">
            {creditsEst}
          </div>
          <div className="text-[12px] text-text-muted mt-2">
            Across {totalQ} Abi queries this period
          </div>
        </div>
      </Card>
    </div>
  );
}

// ============================================================
// Super Users
// ============================================================

function SUSection({ data }: { data: PlatformIntel }) {
  const users = data.super_users;
  if (users.length === 0) {
    return (
      <Card>
        <div className="text-center py-8 text-text-muted text-[13px]">
          No super-user data recorded.
        </div>
      </Card>
    );
  }
  return (
    <Card>
      <CardTitle>Super Users — top platform power-users</CardTitle>
      <SimpleTable
        headers={[
          "User",
          "Logins",
          "CW Views",
          "Abi Queries",
          "SD Searches",
          "Hours",
        ]}
        rows={users.map((u) => [
          <div key={u.name}>
            <div className="font-semibold">{u.name}</div>
            {u.role && (
              <div className="text-[10px] text-text-muted">{u.role}</div>
            )}
          </div>,
          String(u.logins),
          String(u.cw_views),
          String(u.abi_queries),
          String(u.sd_searches),
          String(u.hours),
        ])}
      />
    </Card>
  );
}

// ============================================================
// Inline SVG charts (zero-dependency)
// ============================================================

function LineChart({
  labels,
  values,
  color,
}: {
  labels: string[];
  values: number[];
  color: string;
}) {
  const W = 280;
  const H = 160;
  const padding = { top: 10, right: 6, bottom: 22, left: 28 };
  const innerW = W - padding.left - padding.right;
  const innerH = H - padding.top - padding.bottom;
  const max = Math.max(...values, 1);
  const stepX = values.length > 1 ? innerW / (values.length - 1) : 0;
  const pts = values.map((v, i) => {
    const x = padding.left + i * stepX;
    const y = padding.top + innerH - (v / max) * innerH;
    return { x, y };
  });
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const area = `${path} L ${pts[pts.length - 1]?.x ?? 0} ${padding.top + innerH} L ${pts[0]?.x ?? 0} ${padding.top + innerH} Z`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      <path d={area} fill={color} opacity={0.12} />
      <path d={path} fill="none" stroke={color} strokeWidth={2} />
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={2.5} fill={color} />
      ))}
      {labels.map((l, i) => (
        <text
          key={i}
          x={padding.left + i * stepX}
          y={H - 6}
          fontSize={8}
          textAnchor="middle"
          fill="#64748b"
        >
          {l}
        </text>
      ))}
      <text x={4} y={padding.top + 8} fontSize={8} fill="#64748b">
        {max}
      </text>
      <text x={4} y={padding.top + innerH} fontSize={8} fill="#64748b">
        0
      </text>
    </svg>
  );
}

function MultiLineChart({
  labels,
  series,
}: {
  labels: string[];
  series: Array<{ label: string; color: string; values: number[] }>;
}) {
  const W = 320;
  const H = 200;
  const padding = { top: 12, right: 6, bottom: 36, left: 28 };
  const innerW = W - padding.left - padding.right;
  const innerH = H - padding.top - padding.bottom;
  const allVals = series.flatMap((s) => s.values);
  const max = Math.max(...allVals, 1);
  const len = Math.max(...series.map((s) => s.values.length), 1);
  const stepX = len > 1 ? innerW / (len - 1) : 0;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {series.map((s, si) => {
        const pts = s.values.map((v, i) => {
          const x = padding.left + i * stepX;
          const y = padding.top + innerH - (v / max) * innerH;
          return { x, y };
        });
        const path = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
        return (
          <path
            key={si}
            d={path}
            fill="none"
            stroke={s.color}
            strokeWidth={1.5}
          />
        );
      })}
      {labels.map((l, i) => (
        <text
          key={i}
          x={padding.left + i * stepX}
          y={H - 22}
          fontSize={7}
          textAnchor="middle"
          fill="#64748b"
        >
          {l}
        </text>
      ))}
      <text x={4} y={padding.top + 8} fontSize={8} fill="#64748b">
        {max}
      </text>
      {/* Legend */}
      {series.map((s, i) => (
        <g key={i} transform={`translate(${padding.left + i * 60}, ${H - 8})`}>
          <rect width={8} height={8} fill={s.color} />
          <text x={12} y={7} fontSize={8} fill="#64748b">
            {s.label.slice(0, 8)}
          </text>
        </g>
      ))}
    </svg>
  );
}

function BarChart({
  rows,
}: {
  rows: Array<{ label: string; value: number; color: string }>;
}) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => {
        const pct = Math.max(2, Math.round((r.value / max) * 100));
        return (
          <div key={i}>
            <div className="flex items-center justify-between text-[11px] mb-0.5">
              <span className="font-medium">{r.label}</span>
              <span className="font-semibold">{r.value}</span>
            </div>
            <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${pct}%`, background: r.color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DonutChart({
  slices,
}: {
  slices: Array<{ label: string; value: number; color: string }>;
}) {
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  const size = 160;
  const r = 60;
  const cx = size / 2;
  const cy = size / 2;
  let acc = 0;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        {slices.map((sl, i) => {
          const startAngle = (acc / total) * Math.PI * 2 - Math.PI / 2;
          acc += sl.value;
          const endAngle = (acc / total) * Math.PI * 2 - Math.PI / 2;
          const x1 = cx + r * Math.cos(startAngle);
          const y1 = cy + r * Math.sin(startAngle);
          const x2 = cx + r * Math.cos(endAngle);
          const y2 = cy + r * Math.sin(endAngle);
          const large = endAngle - startAngle > Math.PI ? 1 : 0;
          // Skip 0-value slices.
          if (sl.value === 0) return null;
          return (
            <path
              key={i}
              d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`}
              fill={sl.color}
            />
          );
        })}
        <circle cx={cx} cy={cy} r={36} fill="#fff" />
        <text
          x={cx}
          y={cy + 4}
          fontSize={14}
          textAnchor="middle"
          fontWeight="bold"
          fill="#0d1b2e"
        >
          {total}
        </text>
      </svg>
      <div className="space-y-1 text-[11px]">
        {slices.map((sl) => (
          <div key={sl.label} className="flex items-center gap-1.5">
            <span
              className="w-2 h-2 rounded-sm"
              style={{ background: sl.color }}
            />
            <span>{sl.label}</span>
            <span className="font-semibold ml-1">{sl.value}</span>
            <span className="text-text-muted">
              ({total > 0 ? Math.round((sl.value / total) * 100) : 0}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// Shared primitives
// ============================================================

function Card({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-white border border-beroe-card-border rounded-card p-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

function CardTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[13px] font-bold text-text-primary mb-2.5">{children}</div>
  );
}

function SimpleTable({
  headers,
  rows,
  compact = false,
}: {
  headers: string[];
  rows: Array<Array<React.ReactNode | string>>;
  compact?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-[9px] uppercase tracking-wider text-text-muted text-left border-b border-beroe-card-border">
            {headers.map((h, i) => (
              <th
                key={i}
                className={cn("px-2 font-semibold", compact ? "py-1" : "py-2")}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className="border-b border-beroe-card-border/40 last:border-b-0"
            >
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={cn(
                    "px-2",
                    compact ? "py-0.5" : "py-1.5",
                    j === 0 ? "font-medium" : "",
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
