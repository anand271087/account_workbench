// M24 — Leadership view: cross-account portfolio dashboard.
//
// Faithful match to the prototype screenshot shared by stakeholder:
//   • Title strip with "Leadership View" + accounts count + today's date
//   • Right-aligned 3-pill toggle: 📋 Portfolio · 👥 By CSM · 🚀 Pipeline by CO
//   • 7 KPI tiles with brand-coloured top borders:
//       ACCOUNTS · HEALTHY (≥65) · AT RISK (48-64) · ⚠ ATTENTION (DTR ≤90) ·
//       CRITICAL SIGNALS · RENEWAL PIPELINE (weighted) · EXPANSION PIPELINE (weighted)
//   • Portfolio table with 11 columns, colored initials badge, account+type
//     stacked, SC icon, Activity days-ago, Health badge, Mode pill, ACV,
//     Top Play, Renewal indicator, Forecast dropdown, View button.
//   • By CSM view groups accounts under each CSM's section.
//   • Pipeline by CO view = per-CO dark navy header + plays table.
//
// Director / VP / Admin only — gated by RequireLeadership in App.tsx.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { AppShell } from "@/components/AppShell";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type {
  AccountRow,
  LeadershipPortfolio,
  PipelineCO,
} from "@/types/leadership";

type ViewMode = "portfolio" | "by_csm" | "pipeline";

// ============================================================
// Helpers
// ============================================================

const MODE_CONF: Record<
  string,
  { icon: string; label: string; color: string; bg: string; border: string }
> = {
  rescue: {
    icon: "🚨",
    label: "Rescue",
    color: "#CF4548",
    bg: "rgba(207,69,72,0.10)",
    border: "rgba(207,69,72,0.40)",
  },
  retain: {
    icon: "🛡️",
    label: "Retain",
    color: "#F0BC41",
    bg: "rgba(240,188,65,0.15)",
    border: "rgba(240,188,65,0.40)",
  },
  expand: {
    icon: "🚀",
    label: "Expand",
    color: "#6EC457",
    bg: "rgba(110,196,87,0.15)",
    border: "rgba(110,196,87,0.40)",
  },
};

// Deterministic colour palette for the leading-initials badge — 6 brand
// hex anchors cycled by hashing the account name. Matches the prototype's
// per-account avatar tinting where each row gets a distinct hue.
const BADGE_COLORS: Array<{ bg: string; color: string }> = [
  { bg: "#35E1D420", color: "#0D7A6F" }, // Aqua
  { bg: "#6EC45720", color: "#1F7032" }, // Risk Green
  { bg: "#C344C720", color: "#7A1C7C" }, // Fuscia
  { bg: "#CF454820", color: "#7A1C1F" }, // Risk Red
  { bg: "#4A00F820", color: "#2E0099" }, // Indigo
  { bg: "#F0BC4120", color: "#7A5E0B" }, // Risk Amber
];

function pickBadgeColor(name: string): { bg: string; color: string } {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return BADGE_COLORS[h % BADGE_COLORS.length];
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n) || n === 0) return "$0";
  if (Math.abs(n) >= 1_000_000) {
    return `$${(n / 1_000_000).toFixed(2)}M`;
  }
  if (Math.abs(n) >= 1_000) {
    return `$${Math.round(n / 1_000)}K`;
  }
  return `$${n.toLocaleString()}`;
}

function healthTone(h: number | null): {
  bg: string;
  color: string;
  label: "healthy" | "amber" | "red" | "—";
} {
  if (h === null || h === undefined)
    return { bg: "#94a3b820", color: "#94a3b8", label: "—" };
  if (h >= 65)
    return { bg: "rgba(110,196,87,0.18)", color: "#1F7032", label: "healthy" };
  if (h >= 48)
    return { bg: "rgba(240,188,65,0.20)", color: "#7A5E0B", label: "amber" };
  return { bg: "rgba(207,69,72,0.15)", color: "#A32D2D", label: "red" };
}

function activityTone(daysAgo: number | null): { color: string; text: string } {
  if (daysAgo === null || daysAgo === undefined) return { color: "#CF4548", text: "—" };
  if (daysAgo === 0) return { color: "#1F7032", text: "Today" };
  if (daysAgo <= 14) return { color: "#1F7032", text: `${daysAgo}d ago` };
  if (daysAgo <= 30) return { color: "#7A5E0B", text: `${daysAgo}d ago` };
  return { color: "#CF4548", text: `${daysAgo}d ago` };
}

function renewalTone(dtr: number | null): { color: string; text: string } {
  if (dtr === null || dtr === undefined) return { color: "#94a3b8", text: "—" };
  if (dtr < 0) return { color: "#CF4548", text: `${Math.abs(dtr)}d overdue` };
  if (dtr <= 90) return { color: "#CF4548", text: `${dtr}d` };
  if (dtr <= 180) return { color: "#7A5E0B", text: `${dtr}d` };
  return { color: "#1F7032", text: `${dtr}d` };
}

// ============================================================
// Page
// ============================================================

export default function LeadershipPage() {
  const navigate = useNavigate();
  const [view, setView] = useState<ViewMode>("portfolio");
  const [search, setSearch] = useState("");

  const { data, isLoading, error } = useQuery<LeadershipPortfolio>({
    queryKey: ["leadership-portfolio"],
    queryFn: () =>
      api.get<LeadershipPortfolio>("/api/v1/leadership/portfolio"),
    staleTime: 60_000,
  });

  const filteredAccounts = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    if (!q) return data.accounts;
    return data.accounts.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        (a.csm_name ?? "").toLowerCase().includes(q) ||
        (a.co_name ?? "").toLowerCase().includes(q),
    );
  }, [data, search]);

  if (isLoading) {
    return (
      <AppShell title="Leadership View">
        <div className="text-sm text-text-muted p-4">Loading portfolio…</div>
      </AppShell>
    );
  }
  if (error || !data) {
    return (
      <AppShell title="Leadership View">
        <div className="bg-beroe-red/10 border border-beroe-red/30 text-beroe-red rounded-card p-4 text-sm">
          Couldn't load the leadership portfolio.
        </div>
      </AppShell>
    );
  }

  const todayLabel = new Date(data.generated_at).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <AppShell title="Leadership View">
      <div className="p-4 space-y-4">
        {/* ─── Header strip ─── */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-[22px] font-bold text-text-primary leading-tight">
              Leadership View
            </h1>
            <div className="text-[12px] text-text-muted mt-0.5">
              {data.accounts.length} accounts · {todayLabel}
            </div>
          </div>
          {/* 3-pill view toggle — Portfolio / By CSM / Pipeline by CO */}
          <div className="inline-flex bg-white rounded-lg p-1 border border-beroe-card-border">
            {([
              { v: "portfolio" as const, icon: "📋", label: "Portfolio" },
              { v: "by_csm" as const, icon: "👥", label: "By CSM" },
              { v: "pipeline" as const, icon: "🚀", label: "Pipeline by CO" },
            ]).map(({ v, icon, label }) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  "px-3.5 py-1.5 rounded-md text-[11px] font-semibold transition-all flex items-center gap-1",
                  view === v
                    ? "bg-beroe-blue/10 text-beroe-blue"
                    : "text-text-muted hover:text-text-secondary",
                )}
              >
                <span>{icon}</span>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* ─── KPI strip (7 tiles) ─── */}
        <KpiStrip data={data} />

        {/* ─── Body ─── */}
        {view === "portfolio" && (
          <PortfolioTable
            rows={filteredAccounts}
            search={search}
            setSearch={setSearch}
            onOpen={(a) => navigate(`/accounts/${a.slug}`)}
          />
        )}
        {view === "by_csm" && (
          <ByCsmView
            rows={filteredAccounts}
            onOpen={(a) => navigate(`/accounts/${a.slug}`)}
          />
        )}
        {view === "pipeline" && (
          <PipelineView
            pipeline={data.pipeline_by_co}
            onOpen={(id) => navigate(`/accounts/${id}`)}
          />
        )}
      </div>
    </AppShell>
  );
}

// ============================================================
// KPI strip — 7 tiles with brand-coloured top borders
// ============================================================

function KpiStrip({ data }: { data: LeadershipPortfolio }) {
  const k = data.kpis;
  const tiles: Array<{
    label: string;
    value: string;
    sub?: string;
    color: string;
    icon?: string;
  }> = [
    {
      label: "Accounts",
      value: String(k.accounts_total),
      color: "#001137", // Midnight
    },
    {
      label: "Healthy",
      value: String(k.healthy_count),
      sub: "≥ 65",
      color: "#6EC457",
    },
    {
      label: "At Risk",
      value: String(k.at_risk_band_count),
      sub: "48 – 64",
      color: "#F0BC41",
    },
    {
      label: "⚠ Attention",
      value: String(k.attention_count),
      sub: "DTR ≤ 90",
      color: "#CF4548",
    },
    {
      label: "Critical Signals",
      value: String(k.critical_signals),
      color: "#CF4548",
    },
    {
      label: "Renewal Pipeline",
      value: fmtUsd(k.renewal_pipeline_weighted_usd),
      sub: "weighted",
      color: "#F0BC41",
    },
    {
      label: "Expansion Pipeline",
      value: fmtUsd(k.expansion_pipeline_weighted_usd),
      sub: "weighted",
      color: "#6EC457",
    },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
      {tiles.map((t) => (
        <div
          key={t.label}
          className="bg-white rounded-lg px-3.5 py-3"
          style={{
            border: "1px solid #e4eaf6",
            borderTop: `3px solid ${t.color}`,
          }}
        >
          <div className="text-[9px] font-bold uppercase tracking-wider text-text-muted">
            {t.label}
          </div>
          <div
            className="text-[22px] font-extrabold leading-tight mt-1"
            style={{ color: t.color }}
          >
            {t.value}
          </div>
          {t.sub && (
            <div className="text-[10px] text-text-muted mt-0.5">{t.sub}</div>
          )}
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Portfolio table
// ============================================================

function PortfolioTable({
  rows,
  search,
  setSearch,
  onOpen,
}: {
  rows: AccountRow[];
  search: string;
  setSearch: (v: string) => void;
  onOpen: (a: AccountRow) => void;
}) {
  return (
    <div className="bg-white rounded-card border border-beroe-card-border overflow-hidden">
      {/* Search row above the table */}
      <div className="px-4 py-2 border-b border-beroe-card-border/60 flex items-center justify-between gap-3">
        <div className="text-[11px] text-text-muted">
          Showing <b className="text-text-primary">{rows.length}</b> account
          {rows.length === 1 ? "" : "s"}
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by account / CSM / CO"
          className="text-[11px] border border-beroe-card-border rounded px-2 py-1 w-56 bg-white focus:outline-none focus:border-beroe-blue"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-text-muted">
              <Th>Account</Th>
              <Th>CO</Th>
              <Th>CSM</Th>
              <Th align="center" title="Success Contract status">
                SC
              </Th>
              <Th>Activity</Th>
              <Th align="center">Health</Th>
              <Th>Mode</Th>
              <Th align="right">ACV</Th>
              <Th>Top Play</Th>
              <Th>Renewal</Th>
              <Th>Forecast</Th>
              <Th align="right"></Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <PortfolioRow key={a.account_id} row={a} onOpen={onOpen} />
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={12}
                  className="text-center py-6 text-text-muted italic"
                >
                  No accounts match the filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PortfolioRow({
  row: a,
  onOpen,
}: {
  row: AccountRow;
  onOpen: (a: AccountRow) => void;
}) {
  const mode = a.mode && MODE_CONF[a.mode] ? MODE_CONF[a.mode] : null;
  const hTone = healthTone(a.health_score);
  const aTone = activityTone(a.activity_days_ago);
  const rTone = renewalTone(a.days_to_renewal);
  const badge = pickBadgeColor(a.name);
  const init = initials(a.name);
  // Subtle highlight on rows that need attention (overdue checkpoints or any flag).
  const highlight =
    a.overdue_checkpoint_count > 0 || a.open_red_flag_count > 0
      ? "bg-beroe-red/[0.03]"
      : "";

  return (
    <tr
      className={cn(
        "border-t border-beroe-card-border/60 hover:bg-beroe-bg/30 transition-colors",
        highlight,
      )}
    >
      {/* Account — colored initials badge + name + type subtitle */}
      <Td>
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-md flex items-center justify-center text-[11px] font-extrabold flex-shrink-0"
            style={{ background: badge.bg, color: badge.color }}
          >
            {init}
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-text-primary truncate">
              {a.name}
            </div>
            <div className="text-[10px] text-text-muted truncate">
              {a.account_type ?? "—"}
            </div>
          </div>
        </div>
      </Td>

      {/* CO */}
      <Td>{a.co_name ?? <span className="text-text-muted">—</span>}</Td>

      {/* CSM */}
      <Td>{a.csm_name ?? <span className="text-text-muted">—</span>}</Td>

      {/* SC — small icon based on status */}
      <Td align="center">
        <ScIcon status={a.sc_status} />
      </Td>

      {/* Activity */}
      <Td>
        <span className="font-semibold" style={{ color: aTone.color }}>
          {aTone.text}
        </span>
      </Td>

      {/* Health — rounded badge with the score */}
      <Td align="center">
        <span
          className="inline-block min-w-[36px] text-center text-[12px] font-bold rounded-md px-2 py-0.5"
          style={{ background: hTone.bg, color: hTone.color }}
        >
          {a.health_score ?? "—"}
        </span>
      </Td>

      {/* Mode pill */}
      <Td>
        {mode ? (
          <span
            className="text-[11px] font-semibold px-2 py-0.5 rounded-full inline-flex items-center gap-1"
            style={{
              background: mode.bg,
              color: mode.color,
              border: `1px solid ${mode.border}`,
            }}
          >
            <span>{mode.icon}</span>
            {mode.label}
          </span>
        ) : (
          <span className="text-text-muted text-[11px]">—</span>
        )}
      </Td>

      {/* ACV */}
      <Td align="right">
        <div className="font-bold text-text-primary">
          {fmtUsd(a.current_acv_usd)}
        </div>
      </Td>

      {/* Top Play */}
      <Td>
        {a.top_play_title ? (
          <div className="max-w-[180px]">
            <div
              className="text-[11px] text-text-primary leading-tight truncate"
              title={a.top_play_title}
            >
              {a.top_play_title}
            </div>
            <div className="text-[10px] font-bold text-beroe-green">
              {fmtUsd(a.top_play_value_usd)}
            </div>
          </div>
        ) : (
          <span className="text-text-muted">—</span>
        )}
      </Td>

      {/* Renewal */}
      <Td>
        {a.renewal_date ? (
          <div>
            <div
              className="font-semibold text-[11px]"
              style={{ color: rTone.color }}
            >
              {rTone.text}
            </div>
            {a.next_checkpoint_signoff_pending && (
              <div className="text-[9px] text-beroe-amber mt-0.5 flex items-center gap-0.5">
                <span>🏆</span> sign-off pending
              </div>
            )}
          </div>
        ) : (
          <span className="text-text-muted">—</span>
        )}
      </Td>

      {/* Forecast — dropdown placeholder. dr_outcome maps to the
          current value; selecting another value is a v1.1 mutation. */}
      <Td>
        <select
          value={a.dr_outcome ?? ""}
          onChange={() => {
            // Mutation lands in v1.1 — UX placeholder for now.
          }}
          className="text-[10px] border border-beroe-card-border rounded px-1.5 py-0.5 bg-white"
        >
          <option value="">Set tier</option>
          <option value="renewed">Commit</option>
          <option value="at_risk">At Risk</option>
          <option value="not_renewed">Not Renewed</option>
        </select>
      </Td>

      {/* View */}
      <Td align="right">
        <button
          type="button"
          onClick={() => onOpen(a)}
          className="text-[10px] px-3 py-1 rounded-md bg-beroe-blue text-white font-semibold hover:opacity-90"
        >
          View
        </button>
      </Td>
    </tr>
  );
}

function ScIcon({ status }: { status: AccountRow["sc_status"] }) {
  switch (status) {
    case "done":
      return (
        <span
          className="inline-flex w-5 h-5 rounded-md items-center justify-center text-[11px]"
          style={{ background: "rgba(110,196,87,0.18)", color: "#1F7032" }}
          title="Success Contract locked"
        >
          ✅
        </span>
      );
    case "warn":
      return (
        <span
          className="inline-flex w-5 h-5 rounded-md items-center justify-center text-[11px]"
          style={{ background: "rgba(240,188,65,0.20)", color: "#7A5E0B" }}
          title="Contract pending — renewal near"
        >
          ⚠
        </span>
      );
    case "ack":
      return (
        <span
          className="inline-flex w-5 h-5 rounded-md items-center justify-center text-[11px]"
          style={{ background: "rgba(74,0,248,0.10)", color: "#4A00F8" }}
          title="Acknowledged / partial"
        >
          ◐
        </span>
      );
    default:
      return <span className="text-text-muted text-[11px]">—</span>;
  }
}

function Th({
  children,
  align,
  title,
}: {
  children?: React.ReactNode;
  align?: "right" | "left" | "center";
  title?: string;
}) {
  return (
    <th
      title={title}
      className={cn(
        "px-3 py-2 font-bold",
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left",
      )}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: "right" | "left" | "center";
}) {
  return (
    <td
      className={cn(
        "px-3 py-2.5 align-middle",
        align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left",
      )}
    >
      {children}
    </td>
  );
}

// ============================================================
// By CSM view
// ============================================================

function ByCsmView({
  rows,
  onOpen,
}: {
  rows: AccountRow[];
  onOpen: (a: AccountRow) => void;
}) {
  // Group accounts by csm_name (null grouped under "Unassigned").
  const grouped = useMemo(() => {
    const m = new Map<string, AccountRow[]>();
    for (const a of rows) {
      const k = a.csm_name ?? "Unassigned";
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(a);
    }
    return [...m.entries()].sort((a, b) =>
      b[1].length - a[1].length || a[0].localeCompare(b[0]),
    );
  }, [rows]);

  if (grouped.length === 0) {
    return (
      <div className="bg-white rounded-card border border-beroe-card-border p-8 text-center text-sm text-text-muted">
        No accounts yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {grouped.map(([csm, group]) => {
        const totalAcv = group.reduce((s, a) => s + a.current_acv_usd, 0);
        const healthy = group.filter(
          (a) => (a.health_score ?? 0) >= 65,
        ).length;
        const atRiskBand = group.filter(
          (a) => (a.health_score ?? 0) >= 48 && (a.health_score ?? 0) < 65,
        ).length;
        const attention = group.filter(
          (a) =>
            a.days_to_renewal !== null &&
            a.days_to_renewal !== undefined &&
            a.days_to_renewal <= 90,
        ).length;
        return (
          <div
            key={csm}
            className="bg-white rounded-card border border-beroe-card-border overflow-hidden"
          >
            {/* CSM header strip */}
            <div className="bg-beroe-bg/60 px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap border-b border-beroe-card-border/60">
              <div className="flex items-center gap-2">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-extrabold text-white"
                  style={{ background: "#4A00F8" }}
                >
                  {initials(csm)}
                </div>
                <div>
                  <div className="text-[13px] font-bold text-text-primary">
                    {csm}
                  </div>
                  <div className="text-[10px] text-text-muted">
                    {group.length} account{group.length === 1 ? "" : "s"} ·{" "}
                    {fmtUsd(totalAcv)} ACV
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 text-[10px]">
                <span>
                  <b className="text-beroe-green">{healthy}</b>{" "}
                  <span className="text-text-muted">healthy</span>
                </span>
                <span>
                  <b className="text-beroe-amber">{atRiskBand}</b>{" "}
                  <span className="text-text-muted">at risk</span>
                </span>
                <span>
                  <b className="text-beroe-red">{attention}</b>{" "}
                  <span className="text-text-muted">attention</span>
                </span>
              </div>
            </div>
            {/* Account rows */}
            <table className="w-full text-[12px]">
              <thead className="text-[10px] uppercase tracking-wider text-text-muted">
                <tr>
                  <Th>Account</Th>
                  <Th align="center">Health</Th>
                  <Th>Mode</Th>
                  <Th align="right">ACV</Th>
                  <Th>Top Play</Th>
                  <Th>Renewal</Th>
                  <Th align="right"></Th>
                </tr>
              </thead>
              <tbody>
                {group.map((a) => {
                  const mode = a.mode && MODE_CONF[a.mode] ? MODE_CONF[a.mode] : null;
                  const hTone = healthTone(a.health_score);
                  const rTone = renewalTone(a.days_to_renewal);
                  return (
                    <tr
                      key={a.account_id}
                      className="border-t border-beroe-card-border/60 hover:bg-beroe-bg/30"
                    >
                      <Td>
                        <div className="flex items-center gap-2.5">
                          <div
                            className="w-7 h-7 rounded-md flex items-center justify-center text-[10px] font-extrabold flex-shrink-0"
                            style={pickBadgeColor(a.name)}
                          >
                            {initials(a.name)}
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-text-primary truncate">
                              {a.name}
                            </div>
                            <div className="text-[10px] text-text-muted truncate">
                              {a.account_type ?? "—"}
                              {a.tier && ` · ${a.tier}`}
                            </div>
                          </div>
                        </div>
                      </Td>
                      <Td align="center">
                        <span
                          className="inline-block min-w-[36px] text-center text-[11px] font-bold rounded-md px-2 py-0.5"
                          style={{ background: hTone.bg, color: hTone.color }}
                        >
                          {a.health_score ?? "—"}
                        </span>
                      </Td>
                      <Td>
                        {mode ? (
                          <span
                            className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full inline-flex items-center gap-0.5"
                            style={{
                              background: mode.bg,
                              color: mode.color,
                              border: `1px solid ${mode.border}`,
                            }}
                          >
                            {mode.icon} {mode.label}
                          </span>
                        ) : (
                          <span className="text-text-muted">—</span>
                        )}
                      </Td>
                      <Td align="right">
                        <div className="font-bold">
                          {fmtUsd(a.current_acv_usd)}
                        </div>
                      </Td>
                      <Td>
                        {a.top_play_title ? (
                          <div className="text-[10px] truncate max-w-[160px]">
                            {a.top_play_title}{" "}
                            <span className="text-text-muted">
                              · {fmtUsd(a.top_play_value_usd)}
                            </span>
                          </div>
                        ) : (
                          <span className="text-text-muted">—</span>
                        )}
                      </Td>
                      <Td>
                        <span
                          className="text-[11px] font-semibold"
                          style={{ color: rTone.color }}
                        >
                          {rTone.text}
                        </span>
                      </Td>
                      <Td align="right">
                        <button
                          type="button"
                          onClick={() => onOpen(a)}
                          className="text-[10px] px-2 py-0.5 rounded-md border border-beroe-blue/40 text-beroe-blue hover:bg-beroe-blue/10 font-semibold"
                        >
                          View
                        </button>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// Pipeline by CO view — per-CO cards
// ============================================================

function PipelineView({
  pipeline,
  onOpen,
}: {
  pipeline: PipelineCO[];
  onOpen: (slug: string) => void;
}) {
  if (pipeline.length === 0) {
    return (
      <div className="bg-white rounded-card border border-beroe-card-border p-8 text-center text-sm text-text-muted">
        No expansion plays in the portfolio yet.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="text-[11px] text-text-muted">
        CSMs identify opportunities · COs validate and own commercially · Sorted
        by weighted value · Expansion plays only.
      </div>
      {pipeline.map((co) => (
        <COCard key={co.co_name} co={co} onOpen={onOpen} />
      ))}
    </div>
  );
}

function COCard({
  co,
  onOpen,
}: {
  co: PipelineCO;
  onOpen: (slug: string) => void;
}) {
  return (
    <div className="bg-white rounded-card border border-beroe-card-border overflow-hidden">
      <div
        className="flex items-center justify-between gap-3 px-4 py-3"
        style={{ background: "#001137" }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-white text-[12px] font-extrabold flex-shrink-0"
            style={{ background: "#4A00F830" }}
          >
            {co.co_initials}
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-bold text-white truncate">
              {co.co_name}
            </div>
            <div
              className="text-[10px] truncate"
              style={{ color: "#8b8fa3" }}
            >
              {co.accounts.join(", ")}
            </div>
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-[18px] font-extrabold text-beroe-green">
            {fmtUsd(co.total_weighted_usd)}
          </div>
          <div className="text-[9px]" style={{ color: "#8b8fa3" }}>
            weighted expansion
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="bg-beroe-bg/60 text-text-muted">
            <tr>
              <Th>Account</Th>
              <Th>Play</Th>
              <Th align="right">Value</Th>
              <Th align="right">Prob</Th>
              <Th align="right">Weighted</Th>
              <Th>When</Th>
              <Th>Identified by</Th>
              <Th align="right"></Th>
            </tr>
          </thead>
          <tbody>
            {co.plays.map((p, i) => {
              const role = p.role ?? "";
              const isCsmIdentified = role === "CSM" || role === "CS";
              return (
                <tr
                  key={i}
                  className="border-t border-beroe-card-border/60 hover:bg-beroe-bg/40"
                >
                  <Td>{p.account_name}</Td>
                  <Td>
                    <div className="font-medium max-w-[200px] truncate">
                      {p.title}
                    </div>
                  </Td>
                  <Td align="right">{fmtUsd(p.value_usd)}</Td>
                  <Td align="right">{p.prob}%</Td>
                  <Td align="right">
                    <span className="font-bold text-beroe-green">
                      {fmtUsd(p.weighted_usd)}
                    </span>
                  </Td>
                  <Td>{p.when_text ?? "—"}</Td>
                  <Td>
                    <span className="text-[10px]">
                      {isCsmIdentified ? "🔍" : "✅"} {p.added_by_name ?? "—"}{" "}
                      <span
                        className={cn(
                          "text-[8px] px-1.5 py-[1px] rounded-full font-bold ml-0.5",
                          isCsmIdentified
                            ? "bg-beroe-purple/15 text-beroe-purple"
                            : "bg-beroe-green/15 text-beroe-green",
                        )}
                      >
                        {isCsmIdentified ? "Identified" : "CO Validated"}
                      </span>
                    </span>
                  </Td>
                  <Td align="right">
                    <button
                      type="button"
                      onClick={() => onOpen(p.account_id)}
                      className="text-[10px] px-2 py-0.5 rounded-md border border-beroe-blue/40 text-beroe-blue hover:bg-beroe-blue/10 font-semibold"
                    >
                      Open
                    </button>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
