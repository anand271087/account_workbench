// 05-Jun · Shared zero-dependency SVG chart vocab for the Intelligence
// dashboards. Originally inlined in M30 AnalyticsTab; extracted here
// so the new live IntelligenceTab (Phase 2) can render the same shapes
// against /intel/all data.
//
// 09-Jun · Repainted to match Account_Analytics_DevSpec_v3.html. Uses
// the analytics-teal palette + Manrope (text) / IBM Plex Mono (numbers).
// Sizing locked: card radius 13px, card padding 14px 15px, KPI val 30px
// /800 / -1px / tabular-nums, gauge 84px, bars 84px height.
//
// Vocab: KpiTile, LineChart, MultiLineChart, BarChart, DonutChart,
// SimpleTable, Card, CardTitle, NaPill (for source_unavailable KPIs).

import React from "react";
import { cn } from "@/lib/utils";

// ============================================================
// Spec palette — Account_Analytics_DevSpec_v3.html
// (was the locked Beroe brand mix; analytics now sits on the
// teal-family per stakeholder design refresh).
// ============================================================
export const PALETTE = {
  // Teal scale
  teal950: "#063038",
  teal900: "#0a4a54",
  teal800: "#0b5e6b",
  teal700: "#0c7c8c",
  teal600: "#0e8fa3",
  teal500: "#129aad",
  teal400: "#3bb3c2",
  teal300: "#7fd0db",
  teal100: "#cdeef2",
  teal50:  "#e9f7f9",
  // Backwards-compat aliases — many existing callers still reference
  // these names. Re-pointed to the closest spec colour so nothing
  // visually drifts off-palette.
  indigo:   "#0c7c8c",  // teal-700
  midnight: "#063038",  // teal-950
  fuscia:   "#5b54c9",  // spec --derived (purple-blue for "computed")
  aqua:     "#3bb3c2",  // teal-400
  bumblebee:"#c4811a",  // spec --offline (amber-brown)
  green:    "#0e8fa3",  // spec --ok
  amber:    "#c4811a",  // spec --offline
  red:      "#c0392b",  // spec --danger
  slate:    "#6a8088",  // spec --muted
  ink:      "#0f2228",
  ink2:     "#3a5158",
  muted:    "#6a8088",
  line:     "#dce8ea",
  line2:    "#eef4f5",
  bg:       "#f3f7f8",
  card:     "#ffffff",
} as const;

// Default series order for multi-colour charts (bar / split / donut)
// — first three teal shades, then derived/offline/pipe for variety.
export const SERIES_COLORS = [
  PALETTE.teal600,
  PALETTE.teal400,
  PALETTE.teal700,
  PALETTE.fuscia,     // derived
  PALETTE.teal800,
  PALETTE.teal300,
  PALETTE.bumblebee,  // offline
  PALETTE.slate,
];

// ============================================================
// Card — spec sizing: 13px radius, 14px 15px padding, --shadow,
// 1px var(--line) border. Hover lifts to --shadow-lg.
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
        "font-manrope bg-analytics-card border border-analytics-line",
        "rounded-[13px] py-[14px] px-[15px]",
        "shadow-[0_1px_2px_rgba(10,74,84,0.04),0_4px_14px_rgba(10,74,84,0.05)]",
        "hover:shadow-[0_8px_28px_rgba(10,74,84,0.11)] transition-shadow",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardTitle({ children }: { children: React.ReactNode }) {
  // Spec `.ttl`: 13px / 700 / line 1.25
  return (
    <div className="font-manrope text-[13px] font-bold leading-[1.25] text-analytics-ink mb-[10px]">
      {children}
    </div>
  );
}

// ============================================================
// KPI tile — spec `.kpi-val` 30px/800/-1px/tabular-nums, `.kpi-sub`
// 11px/600/muted, `.kpi-unit` 15px/700/muted. Labels above value
// in 13px/700 (the `.ttl` style).
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
      className={cn(
        "font-manrope bg-analytics-card border border-analytics-line",
        "rounded-[13px] py-[14px] px-[15px]",
        "shadow-[0_1px_2px_rgba(10,74,84,0.04),0_4px_14px_rgba(10,74,84,0.05)]",
        "hover:shadow-[0_8px_28px_rgba(10,74,84,0.11)] transition-shadow",
        "flex flex-col gap-0",
      )}
      style={accent ? { borderLeftColor: accent, borderLeftWidth: 3 } : undefined}
    >
      <div className="text-[13px] font-bold leading-[1.25] text-analytics-ink mb-[10px]">
        {label}
      </div>
      {na ? (
        <NaPill reason={na.reason} />
      ) : (
        <div
          className="font-plex-mono text-[30px] font-extrabold leading-none text-analytics-ink"
          style={{ letterSpacing: "-1px", fontVariantNumeric: "tabular-nums" }}
        >
          {value}
        </div>
      )}
      {sub && !na && (
        <div className="text-[11px] text-analytics-muted font-semibold mt-[6px]">
          {sub}
        </div>
      )}
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
    <div className="font-manrope mb-3 flex items-center gap-3 px-3 py-2 rounded-[9px] bg-analytics-offline-bg border border-analytics-offline/30">
      <span className="relative flex h-2 w-2 flex-shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-analytics-offline opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-analytics-offline" />
      </span>
      <div className="text-[11px] text-analytics-offline flex-1">
        <span className="font-semibold">Redshift tunnel recovering</span>
        {" — "}
        {message}
        {typeof secondsAgo === "number" && (
          <span className="opacity-80"> ({secondsAgo}s ago)</span>
        )}
      </div>
    </div>
  );
}

// ============================================================
// NaPill — surfaces "source_unavailable: true" markers from /intel/all.
// Matches spec `.badge.b-pipeline`: 9px / 800 / uppercase / pipe colour.
// ============================================================

export function NaPill({ reason }: { reason: string }) {
  return (
    <span
      title={reason}
      className={cn(
        "font-manrope inline-flex items-center gap-1 self-start",
        "text-[9px] font-extrabold uppercase tracking-[0.4px]",
        "bg-analytics-pipe-bg text-analytics-pipe",
        "px-[7px] py-[3px] rounded-[6px]",
      )}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-analytics-pipe" />
      Pipeline
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
  color = PALETTE.teal600,
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
  const axisFont = "'IBM Plex Mono', monospace";

  return (
    <div style={{ maxWidth }} className="mx-auto">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="w-full">
        <path d={area} fill={color} opacity={0.14} />
        <path d={path} fill="none" stroke={color} strokeWidth={2.2} />
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={2.8} fill={color} />
        ))}
        {shortLabels.map((l, i) => {
          const show = i === 0 || i === lastIdx || i % stride === 0;
          if (!show) return null;
          return (
            <text
              key={i}
              x={padding.left + i * stepX}
              y={H - 10}
              fontSize={9}
              fontFamily={axisFont}
              textAnchor="middle"
              fill={PALETTE.muted}
            >
              {l}
            </text>
          );
        })}
        <text x={4} y={padding.top + 8} fontSize={9} fontFamily={axisFont} fill={PALETTE.muted}>
          {max}
        </text>
        <text x={4} y={padding.top + innerH} fontSize={9} fontFamily={axisFont} fill={PALETTE.muted}>
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
      <div className="font-manrope text-[11px] text-analytics-muted py-4 text-center">
        No data
      </div>
    );
  }
  // Spec `.hbar`: 6px gap, label-row above 6px bar with teal-400→teal-600
  // linear gradient. Values rendered in IBM Plex Mono.
  return (
    <div className="font-manrope space-y-[6px]">
      {rows.map((r, i) => {
        const pct = Math.max(2, Math.round((r.value / max) * 100));
        const color = r.color ?? SERIES_COLORS[i % SERIES_COLORS.length];
        // Use a gradient when no explicit color was passed; flat color
        // otherwise so series-coded charts (e.g. risk levels) stay legible.
        const bg = r.color
          ? color
          : `linear-gradient(90deg, ${PALETTE.teal400}, ${PALETTE.teal600})`;
        return (
          <div key={i}>
            <div className="flex items-center justify-between text-[11px] mb-[3px]">
              <span
                className="font-semibold text-analytics-ink-2 truncate pr-2"
                title={r.label}
              >
                {r.label}
              </span>
              <span className="font-plex-mono font-medium text-analytics-ink tabular-nums">
                {r.value}
              </span>
            </div>
            <div className="h-[6px] bg-analytics-line-2 rounded-[4px] overflow-hidden">
              <div
                className="h-full rounded-[4px] transition-all"
                style={{ width: `${pct}%`, background: bg }}
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
    return (
      <div className="font-manrope text-[11px] text-analytics-muted py-3 text-center">
        No data
      </div>
    );
  }
  const ordered = [...slices]
    .map((s, i) => ({ ...s, _i: i }))
    .sort((a, b) => b.value - a.value);
  return (
    <div className="font-manrope">
      <div className="flex h-7 w-full rounded-[6px] overflow-hidden bg-analytics-line-2">
        {ordered.map((sl) => {
          if (sl.value === 0) return null;
          const pct = (sl.value / total) * 100;
          const color = sl.color ?? SERIES_COLORS[sl._i % SERIES_COLORS.length];
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
                <span
                  className="text-analytics-ink-2 truncate max-w-[120px]"
                  title={sl.label}
                >
                  {sl.label}
                </span>
                <span className="font-plex-mono font-medium tabular-nums">
                  {pct.toFixed(0)}%
                </span>
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
          y={cy + 5}
          fontSize={14}
          textAnchor="middle"
          fontWeight="800"
          fontFamily="'IBM Plex Mono', monospace"
          fill={PALETTE.ink}
        >
          {centerLabel ?? fmtNumCompact(total)}
        </text>
      </svg>
      <div className="font-manrope flex flex-wrap justify-center gap-x-2.5 gap-y-1 mt-2 text-[11px] w-full">
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
              <span className="text-analytics-ink-2 truncate max-w-[140px]" title={sl.label}>
                {sl.label}
              </span>
              <span className="font-plex-mono font-medium tabular-nums">
                {pct}%
              </span>
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
  // Spec `.metatable` rows: 12.5px, 9px 4px padding, IBM Plex Mono for
  // the right-aligned value, bottom-border var(--line-2).
  return (
    <div className="font-manrope flex items-start gap-3 py-[9px] px-1 border-b border-analytics-line-2 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] font-bold text-analytics-ink truncate">
          {label}
        </div>
        {definition && (
          <div
            className="text-[10.5px] text-analytics-muted truncate mt-0.5"
            title={definition}
          >
            {definition}
          </div>
        )}
      </div>
      <div className="flex-shrink-0 font-plex-mono text-[12.5px] font-medium text-analytics-ink-2 tabular-nums">
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
      <div className="font-manrope text-[11px] text-analytics-muted py-3 text-center">
        {empty}
      </div>
    );
  }
  return (
    <div className="font-manrope overflow-x-auto">
      <table className="w-full text-[12px] border-collapse">
        <thead>
          <tr className="text-[10px] uppercase tracking-[0.4px] text-analytics-muted border-b border-analytics-line">
            {cols.map((c) => (
              <th
                key={c.key}
                className={cn(
                  "py-[8px] px-[6px] font-bold",
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
            <tr key={i} className="border-b border-analytics-line-2 last:border-0">
              {cols.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    "py-[8px] px-[6px] text-analytics-ink-2",
                    c.numeric
                      ? "text-right font-plex-mono font-medium tabular-nums"
                      : "",
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
