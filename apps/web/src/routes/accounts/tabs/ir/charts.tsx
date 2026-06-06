// 05-Jun · Shared zero-dependency SVG chart vocab for the Intelligence
// dashboards. Originally inlined in M30 AnalyticsTab; extracted here
// so the new live IntelligenceTab (Phase 2) can render the same shapes
// against /intel/all data. All colors come from the locked Beroe
// brand palette (Indigo / Fuscia / Aqua / Bumblebee + RAG + neutrals).
//
// Vocab: KpiTile, LineChart, MultiLineChart, BarChart, DonutChart,
// SimpleTable, Card, CardTitle, NaPill (for source_unavailable KPIs).

import React from "react";
import { cn } from "@/lib/utils";

// ============================================================
// Brand palette (locked). Use these — no off-palette colors.
// ============================================================
export const PALETTE = {
  indigo: "#4A00F8",
  midnight: "#001137",
  bumblebee: "#FFE61E",
  fuscia: "#C344C7",
  aqua: "#35E1D4",
  green: "#6EC457",
  amber: "#F0BC41",
  red: "#CF4548",
  slate: "#64748b",
  card: "#e4eaf6",
  bg: "#f8f9fb",
} as const;

export const SERIES_COLORS = [
  PALETTE.indigo,
  PALETTE.fuscia,
  PALETTE.aqua,
  PALETTE.amber,
  PALETTE.green,
  PALETTE.red,
];

// ============================================================
// Card primitives
// ============================================================

export function Card({
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

export function CardTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-[13px] font-bold mb-3">{children}</div>;
}

// ============================================================
// KPI tile — one big metric, optional sub-label
// ============================================================

export function KpiTile({
  label,
  value,
  sub,
  accent,
  na,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accent?: string;
  na?: { reason: string };
}) {
  return (
    <div
      className="bg-white border border-beroe-card-border rounded-card p-3 flex flex-col gap-1"
      style={accent ? { borderLeftColor: accent, borderLeftWidth: 4 } : undefined}
    >
      <div className="text-[10px] uppercase tracking-wider text-text-muted font-semibold">
        {label}
      </div>
      {na ? (
        <NaPill reason={na.reason} />
      ) : (
        <div className="text-[20px] font-bold text-text-strong leading-tight">
          {value}
        </div>
      )}
      {sub && !na && <div className="text-[11px] text-text-muted">{sub}</div>}
    </div>
  );
}

// ============================================================
// NaPill — surfaces "source_unavailable: true" markers from /intel/all
// ============================================================

export function NaPill({ reason }: { reason: string }) {
  return (
    <span
      title={reason}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200 self-start"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
      data pipeline pending
    </span>
  );
}

// ============================================================
// LineChart — single series
// ============================================================

export function LineChart({
  labels,
  values,
  color = PALETTE.indigo,
  height = 160,
}: {
  labels: string[];
  values: number[];
  color?: string;
  height?: number;
}) {
  const W = 280;
  const H = height;
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
          fill={PALETTE.slate}
        >
          {l}
        </text>
      ))}
      <text x={4} y={padding.top + 8} fontSize={8} fill={PALETTE.slate}>
        {max}
      </text>
      <text x={4} y={padding.top + innerH} fontSize={8} fill={PALETTE.slate}>
        0
      </text>
    </svg>
  );
}

// ============================================================
// BarChart — horizontal bars
// ============================================================

export function BarChart({
  rows,
}: {
  rows: Array<{ label: string; value: number; color?: string }>;
}) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  if (rows.length === 0) {
    return (
      <div className="text-[11px] text-text-muted py-4 text-center">No data</div>
    );
  }
  return (
    <div className="space-y-1.5">
      {rows.map((r, i) => {
        const pct = Math.max(2, Math.round((r.value / max) * 100));
        const color = r.color ?? SERIES_COLORS[i % SERIES_COLORS.length];
        return (
          <div key={i}>
            <div className="flex items-center justify-between text-[11px] mb-0.5">
              <span className="font-medium truncate pr-2" title={r.label}>
                {r.label}
              </span>
              <span className="font-semibold tabular-nums">{r.value}</span>
            </div>
            <div className="h-2 bg-beroe-bg rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, background: color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// DonutChart — proportional slices + centre total + legend
// ============================================================

export function DonutChart({
  slices,
  centerLabel,
}: {
  slices: Array<{ label: string; value: number; color?: string }>;
  centerLabel?: string;
}) {
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  const size = 160;
  const r = 60;
  const cx = size / 2;
  const cy = size / 2;
  let acc = 0;
  if (slices.length === 0 || slices.every((s) => s.value === 0)) {
    return (
      <div className="text-[11px] text-text-muted py-4 text-center">No data</div>
    );
  }
  return (
    <div className="flex items-center gap-4">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        {slices.map((sl, i) => {
          if (sl.value === 0) return null;
          const color = sl.color ?? SERIES_COLORS[i % SERIES_COLORS.length];
          const startAngle = (acc / total) * Math.PI * 2 - Math.PI / 2;
          acc += sl.value;
          const endAngle = (acc / total) * Math.PI * 2 - Math.PI / 2;
          const x1 = cx + r * Math.cos(startAngle);
          const y1 = cy + r * Math.sin(startAngle);
          const x2 = cx + r * Math.cos(endAngle);
          const y2 = cy + r * Math.sin(endAngle);
          const large = endAngle - startAngle > Math.PI ? 1 : 0;
          return (
            <path
              key={i}
              d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`}
              fill={color}
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
          fill={PALETTE.midnight}
        >
          {centerLabel ?? total}
        </text>
      </svg>
      <div className="space-y-1 text-[11px] flex-1">
        {slices.map((sl, i) => {
          if (sl.value === 0) return null;
          const color = sl.color ?? SERIES_COLORS[i % SERIES_COLORS.length];
          return (
            <div key={sl.label} className="flex items-center gap-1.5">
              <span
                className="w-2 h-2 rounded-sm flex-none"
                style={{ background: color }}
              />
              <span className="truncate" title={sl.label}>
                {sl.label}
              </span>
              <span className="font-semibold ml-1 tabular-nums">{sl.value}</span>
              <span className="text-text-muted tabular-nums">
                ({Math.round((sl.value / total) * 100)}%)
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================
// MultiLineChart — overlaid series with a tiny legend
// ============================================================

export function MultiLineChart({
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
        const path = pts
          .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
          .join(" ");
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
          fill={PALETTE.slate}
        >
          {l}
        </text>
      ))}
      <text x={4} y={padding.top + 8} fontSize={8} fill={PALETTE.slate}>
        {max}
      </text>
      {series.map((s, i) => (
        <g key={i} transform={`translate(${padding.left + i * 60}, ${H - 8})`}>
          <rect width={8} height={8} fill={s.color} />
          <text x={12} y={7} fontSize={8} fill={PALETTE.slate}>
            {s.label.slice(0, 10)}
          </text>
        </g>
      ))}
    </svg>
  );
}

// ============================================================
// SimpleTable — header row + data rows
// ============================================================

export function SimpleTable({
  cols,
  rows,
  empty = "No data",
}: {
  cols: Array<{ key: string; label: string; numeric?: boolean }>;
  rows: Array<Record<string, React.ReactNode>>;
  empty?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="text-[11px] text-text-muted py-3 text-center">{empty}</div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-wider text-text-muted border-b border-beroe-card-border">
            {cols.map((c) => (
              <th
                key={c.key}
                className={cn(
                  "py-1.5 px-2 font-semibold",
                  c.numeric ? "text-right" : "text-left",
                )}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-beroe-card-border/40 last:border-0">
              {cols.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    "py-1.5 px-2",
                    c.numeric ? "text-right tabular-nums" : "",
                  )}
                >
                  {r[c.key] ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
