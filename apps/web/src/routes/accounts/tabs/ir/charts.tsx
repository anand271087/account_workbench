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
// InfraBanner — shown when a bundle response carries `_infra`
// (Redshift tunnel recovering). Better UX than a row of zero tiles.
// ============================================================

export function InfraBanner({
  message,
  secondsAgo,
}: {
  message: string;
  secondsAgo?: number;
}) {
  return (
    <div className="mb-3 flex items-center gap-3 px-3 py-2 rounded-md bg-amber-50 border border-amber-300">
      <span className="relative flex h-2 w-2 flex-shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
      </span>
      <div className="text-[11px] text-amber-900 flex-1">
        <span className="font-semibold">Redshift tunnel recovering</span>
        {" — "}
        {message}
        {typeof secondsAgo === "number" && (
          <span className="text-amber-700"> ({secondsAgo}s ago)</span>
        )}
      </div>
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

// MMD/IW monthly trends arrive as 'YYYY-MM' strings. Shorten to 'MMM yy'
// for the x-axis so 12 buckets fit without overlap.
function shortMonth(label: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(label);
  if (!m) return label;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[+m[2] - 1]} ${m[1].slice(2)}`;
}

export function LineChart({
  labels,
  values,
  color = PALETTE.indigo,
  height = 180,
  maxWidth = 560,
}: {
  labels: string[];
  values: number[];
  color?: string;
  height?: number;
  /** Cap the rendered width so the chart doesn't sprawl into a full-row banner. */
  maxWidth?: number;
}) {
  const W = 480;
  const H = height;
  const padding = { top: 12, right: 12, bottom: 32, left: 36 };
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

  // Auto-skip x-axis labels to prevent overlap. Aim for ≤8 visible labels.
  const stride = Math.max(1, Math.ceil(labels.length / 8));
  const shortLabels = labels.map(shortMonth);
  const lastIdx = labels.length - 1;

  return (
    <div style={{ maxWidth }} className="mx-auto">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="w-full">
        <path d={area} fill={color} opacity={0.12} />
        <path d={path} fill="none" stroke={color} strokeWidth={2} />
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={2.5} fill={color} />
        ))}
        {shortLabels.map((l, i) => {
          // Always show first + last; show every stride-th in between.
          const show = i === 0 || i === lastIdx || i % stride === 0;
          if (!show) return null;
          return (
            <text
              key={i}
              x={padding.left + i * stepX}
              y={H - 10}
              fontSize={9}
              textAnchor="middle"
              fill={PALETTE.slate}
            >
              {l}
            </text>
          );
        })}
        <text x={4} y={padding.top + 8} fontSize={9} fill={PALETTE.slate}>
          {max}
        </text>
        <text x={4} y={padding.top + innerH} fontSize={9} fill={PALETTE.slate}>
          0
        </text>
      </svg>
    </div>
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
// SplitBar — single-row horizontal stacked bar for 2-4 slice metrics
// (Inside-vs-Outside, AI-SWAT vs Basics, etc). Way more compact than
// a donut+legend for low-cardinality splits.
// ============================================================

export function SplitBar({
  slices,
}: {
  slices: Array<{ label: string; value: number; color?: string }>;
}) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  if (total === 0) {
    return <div className="text-[11px] text-text-muted py-3 text-center">No data</div>;
  }
  // Sort large-first so labels-on-segment fit visually
  const ordered = [...slices]
    .map((s, i) => ({ ...s, _i: i }))
    .sort((a, b) => b.value - a.value);
  return (
    <div>
      {/* Tall enough (24px) to host an inline label on wide segments */}
      <div className="flex h-7 w-full rounded-md overflow-hidden bg-beroe-bg">
        {ordered.map((sl) => {
          if (sl.value === 0) return null;
          const pct = (sl.value / total) * 100;
          const color = sl.color ?? SERIES_COLORS[sl._i % SERIES_COLORS.length];
          // Only show inline label if segment ≥ 12% — anything less is unreadable
          const inline = pct >= 12;
          return (
            <div
              key={sl.label}
              title={`${sl.label}: ${fmtNumCompact(sl.value)} (${pct.toFixed(1)}%)`}
              className="h-full flex items-center justify-center text-white text-[11px] font-semibold tracking-tight transition-all"
              style={{ width: `${pct}%`, background: color }}
            >
              {inline && (
                <span className="px-1 truncate" style={{ maxWidth: "100%" }}>
                  {sl.label} {pct.toFixed(0)}%
                </span>
              )}
            </div>
          );
        })}
      </div>
      {/* Compact legend ONLY for tiny segments that couldn't host an inline label */}
      {ordered.some((sl) => (sl.value / total) * 100 < 12 && sl.value > 0) && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px]">
          {ordered.map((sl) => {
            const pct = (sl.value / total) * 100;
            if (pct >= 12 || sl.value === 0) return null;
            const color = sl.color ?? SERIES_COLORS[sl._i % SERIES_COLORS.length];
            return (
              <span key={sl.label} className="inline-flex items-center gap-1.5">
                <span
                  className="w-2 h-2 rounded-sm flex-shrink-0"
                  style={{ background: color }}
                />
                <span className="text-text-secondary truncate max-w-[120px]" title={sl.label}>
                  {sl.label}
                </span>
                <span className="font-semibold tabular-nums">{pct.toFixed(0)}%</span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function fmtNumCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  return new Intl.NumberFormat("en-US").format(n);
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
  const size = 140;
  const r = 56;
  const cx = size / 2;
  const cy = size / 2;
  let acc = 0;
  if (slices.length === 0 || slices.every((s) => s.value === 0)) {
    return (
      <div className="text-[11px] text-text-muted py-4 text-center">No data</div>
    );
  }
  return (
    <div className="flex flex-col items-center">
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
        <circle cx={cx} cy={cy} r={34} fill="#fff" />
        <text
          x={cx}
          y={cy + 4}
          fontSize={13}
          textAnchor="middle"
          fontWeight="bold"
          fill={PALETTE.midnight}
        >
          {centerLabel ?? fmtNumCompact(total)}
        </text>
      </svg>
      {/* Compact pill legend below the donut, wraps naturally. Drops the
          raw count (kept implicit via the centre total) — keeps just
          `■ Label  pct%` per slice for a much cleaner read. */}
      <div className="flex flex-wrap justify-center gap-x-2.5 gap-y-1 mt-2 text-[11px] w-full">
        {slices.map((sl, i) => {
          if (sl.value === 0) return null;
          const color = sl.color ?? SERIES_COLORS[i % SERIES_COLORS.length];
          const pct = Math.round((sl.value / total) * 100);
          return (
            <span key={sl.label} className="inline-flex items-center gap-1">
              <span
                className="w-2 h-2 rounded-sm flex-shrink-0"
                style={{ background: color }}
              />
              <span className="text-text-secondary truncate max-w-[140px]" title={sl.label}>
                {sl.label}
              </span>
              <span className="font-semibold tabular-nums">{pct}%</span>
            </span>
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
  maxWidth = 640,
}: {
  labels: string[];
  series: Array<{ label: string; color: string; values: number[] }>;
  /** Cap rendered width to prevent full-row sprawl. */
  maxWidth?: number;
}) {
  const W = 520;
  const H = 220;
  const padding = { top: 14, right: 12, bottom: 44, left: 36 };
  const innerW = W - padding.left - padding.right;
  const innerH = H - padding.top - padding.bottom;
  const allVals = series.flatMap((s) => s.values);
  const max = Math.max(...allVals, 1);
  const len = Math.max(...series.map((s) => s.values.length), 1);
  const stepX = len > 1 ? innerW / (len - 1) : 0;
  const stride = Math.max(1, Math.ceil(labels.length / 8));
  const shortLabels = labels.map(shortMonth);
  const lastIdx = labels.length - 1;

  return (
    <div style={{ maxWidth }} className="mx-auto">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="w-full">
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
        {shortLabels.map((l, i) => {
          const show = i === 0 || i === lastIdx || i % stride === 0;
          if (!show) return null;
          return (
            <text
              key={i}
              x={padding.left + i * stepX}
              y={H - 28}
              fontSize={9}
              textAnchor="middle"
              fill={PALETTE.slate}
            >
              {l}
            </text>
          );
        })}
        <text x={4} y={padding.top + 8} fontSize={9} fill={PALETTE.slate}>
          {max}
        </text>
        {series.map((s, i) => (
          <g key={i} transform={`translate(${padding.left + i * 72}, ${H - 10})`}>
            <rect width={8} height={8} fill={s.color} />
            <text x={12} y={7} fontSize={9} fill={PALETTE.slate}>
              {s.label.slice(0, 12)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

// ============================================================
// ParamRow — one spec parameter (label + value/NA pill + optional def)
// ============================================================

export function ParamRow({
  label,
  definition,
  value,
}: {
  label: string;
  definition?: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 py-1.5 border-b border-beroe-card-border/40 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-semibold text-text-secondary truncate">
          {label}
        </div>
        {definition && (
          <div className="text-[10px] text-text-muted truncate" title={definition}>
            {definition}
          </div>
        )}
      </div>
      <div className="flex-shrink-0 text-[11px] font-semibold tabular-nums">
        {value}
      </div>
    </div>
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
