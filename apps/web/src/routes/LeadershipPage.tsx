// M24 — Leadership view: cross-account portfolio dashboard.
//
// Layout matches prototype/beroe_awb_v20.html "Leadership View" at
// line 2491+:
//
//   Header: title · accounts count · today · view-toggle pills
//   KPI strip (4 KPIs, brand-coloured top borders)
//   View body (Portfolio | Pipeline):
//     Portfolio = data table with one row per account
//     Pipeline  = per-CO cards with expand plays grouped + sorted
//
// Director / VP / Admin only — guarded by RequireLeadership in App.tsx.

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

type ViewMode = "portfolio" | "pipeline";

const MODE_COLOR: Record<string, string> = {
  rescue: "#CF4548",   // Risk Red
  retain: "#F0BC41",   // Risk Amber
  expand: "#6EC457",   // Risk Green
};

const OUTCOME_TONE: Record<
  string,
  { bg: string; border: string; color: string; label: string }
> = {
  renewed: {
    bg: "bg-beroe-green/15",
    border: "border-beroe-green/30",
    color: "text-beroe-green",
    label: "✓ Renewed",
  },
  at_risk: {
    bg: "bg-beroe-amber/15",
    border: "border-beroe-amber/40",
    color: "text-beroe-amber",
    label: "⚠ At Risk",
  },
  not_renewed: {
    bg: "bg-beroe-red/10",
    border: "border-beroe-red/30",
    color: "text-beroe-red",
    label: "✕ Not Renewed",
  },
};

function fmtUsd(n: number, compact = true): string {
  if (!Number.isFinite(n) || n === 0) return "$0";
  if (compact && Math.abs(n) >= 1_000_000) {
    return `$${(n / 1_000_000).toFixed(2)}M`;
  }
  if (compact && Math.abs(n) >= 1_000) {
    return `$${Math.round(n / 1_000)}K`;
  }
  return `$${n.toLocaleString()}`;
}

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

  const today = new Date(data.generated_at).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <AppShell title="Leadership View">
      <div className="space-y-4 p-4">
        {/* ─── Header ─── */}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-[20px] font-bold text-text-primary">
              Leadership View
            </h1>
            <div className="text-[12px] text-text-muted mt-0.5">
              {data.accounts.length} accounts · {today}
            </div>
          </div>
          {/* View toggle pills — Portfolio | Pipeline */}
          <div className="inline-flex bg-beroe-bg rounded-lg p-[3px]">
            {(["portfolio", "pipeline"] as ViewMode[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn(
                  "px-3.5 py-1.5 rounded-md text-[11px] font-semibold capitalize transition-colors",
                  view === v
                    ? "bg-white text-text-primary shadow-sm"
                    : "text-text-muted hover:text-text-secondary",
                )}
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {/* ─── KPI strip ─── */}
        <KpiStrip data={data} />

        {/* ─── Body ─── */}
        {view === "portfolio" ? (
          <PortfolioView
            data={data}
            filteredAccounts={filteredAccounts}
            search={search}
            setSearch={setSearch}
            onOpen={(a) => navigate(`/accounts/${a.slug}`)}
          />
        ) : (
          <PipelineView pipeline={data.pipeline_by_co} onOpen={(slug) => navigate(`/accounts/${slug}`)} />
        )}
      </div>
    </AppShell>
  );
}

// ============================================================
// KPI strip
// ============================================================

function KpiStrip({ data }: { data: LeadershipPortfolio }) {
  const kpis = data.kpis;
  const tiles: Array<{
    label: string;
    value: string;
    sub?: string;
    color: string;
  }> = [
    {
      label: "Forecast (current ACV)",
      value: fmtUsd(kpis.current_acv_total_usd),
      sub: `${kpis.accounts_total} accounts`,
      color: "#4A00F8", // Indigo
    },
    {
      label: "At-Risk ACV",
      value: fmtUsd(kpis.at_risk_acv_usd),
      sub: `${data.renewals.at_risk} accounts · ${fmtUsd(kpis.not_renewed_acv_usd)} not renewed`,
      color: "#F0BC41", // Risk Amber
    },
    {
      label: "Critical Signals",
      value: String(kpis.critical_signals),
      sub: `${kpis.overdue_checkpoints_total} overdue checkpoints`,
      color: "#CF4548", // Risk Red
    },
    {
      label: "Expand Pipeline (weighted)",
      value: fmtUsd(kpis.expand_weighted_pipeline_usd),
      sub: `${data.pipeline_by_co.length} commercial owners`,
      color: "#6EC457", // Risk Green
    },
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {tiles.map((t) => (
        <div
          key={t.label}
          className="bg-white rounded-card px-4 py-3"
          style={{ border: "1px solid #e4eaf6", borderTop: `3px solid ${t.color}` }}
        >
          <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted">
            {t.label}
          </div>
          <div
            className="text-[22px] font-extrabold leading-tight mt-0.5"
            style={{ color: t.color }}
          >
            {t.value}
          </div>
          {t.sub && (
            <div className="text-[10px] text-text-muted mt-0.5">
              {t.sub}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Portfolio View — data table
// ============================================================

function PortfolioView({
  data,
  filteredAccounts,
  search,
  setSearch,
  onOpen,
}: {
  data: LeadershipPortfolio;
  filteredAccounts: AccountRow[];
  search: string;
  setSearch: (v: string) => void;
  onOpen: (a: AccountRow) => void;
}) {
  return (
    <div className="space-y-3">
      {/* Forecast summary line — sourced from renewals breakdown */}
      <div className="bg-beroe-bg rounded-md px-4 py-2.5 flex items-center gap-4 flex-wrap text-[11px]">
        <div className="font-bold uppercase tracking-wider text-text-muted">
          Forecast Summary
        </div>
        <span>
          <b className="text-beroe-green">{data.renewals.renewed}</b>{" "}
          <span className="text-text-muted">renewed</span>
        </span>
        <span>
          <b className="text-beroe-amber">{data.renewals.at_risk}</b>{" "}
          <span className="text-text-muted">at risk</span>
        </span>
        <span>
          <b className="text-beroe-red">{data.renewals.not_renewed}</b>{" "}
          <span className="text-text-muted">not renewed</span>
        </span>
        <span>
          <b className="text-text-primary">{data.renewals.undecided}</b>{" "}
          <span className="text-text-muted">undecided</span>
        </span>
        <span className="ml-auto">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by account / CSM / CO"
            className="text-[11px] border border-beroe-card-border rounded px-2 py-1 w-56 bg-white focus:outline-none focus:border-beroe-blue"
          />
        </span>
      </div>

      {/* Portfolio table */}
      <div className="bg-white rounded-card border border-beroe-card-border overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="bg-beroe-bg/60 text-text-muted">
            <tr>
              <Th>Account</Th>
              <Th>CO</Th>
              <Th>CSM</Th>
              <Th title="Success Contract locked?">SC</Th>
              <Th>Mode</Th>
              <Th align="right">Health</Th>
              <Th align="right">Current ACV</Th>
              <Th>Top Play</Th>
              <Th>Renewal</Th>
              <Th>Forecast</Th>
              <Th align="right"> </Th>
            </tr>
          </thead>
          <tbody>
            {filteredAccounts.map((a) => (
              <PortfolioRow key={a.account_id} row={a} onOpen={onOpen} />
            ))}
            {filteredAccounts.length === 0 && (
              <tr>
                <td
                  colSpan={11}
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
  const modeCol = a.mode ? MODE_COLOR[a.mode] : "#94a3b8";
  const outcome = OUTCOME_TONE[a.dr_outcome ?? ""];
  const dtr = a.days_to_renewal;
  const dtrTone =
    dtr === null || dtr === undefined
      ? "text-text-muted"
      : dtr < 30
        ? "text-beroe-red font-bold"
        : dtr < 90
          ? "text-beroe-amber font-semibold"
          : "text-text-secondary";
  return (
    <tr className="border-t border-beroe-card-border/60 hover:bg-beroe-bg/40">
      <Td>
        <div className="font-semibold text-text-primary">{a.name}</div>
        <div className="text-[9px] text-text-muted">
          {a.account_type ?? "—"}
          {a.tier && ` · ${a.tier}`}
        </div>
      </Td>
      <Td>{a.co_name ?? "—"}</Td>
      <Td>{a.csm_name ?? "—"}</Td>
      <Td>
        {a.success_contract_locked ? (
          <span className="text-beroe-green">🔒</span>
        ) : (
          <span className="text-text-muted">—</span>
        )}
      </Td>
      <Td>
        {a.mode ? (
          <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
            style={{
              background: `${modeCol}15`,
              color: modeCol,
              border: `1px solid ${modeCol}40`,
            }}
          >
            {a.mode}
          </span>
        ) : (
          <span className="text-text-muted">auto</span>
        )}
      </Td>
      <Td align="right">
        <span
          className={cn(
            "font-bold",
            (a.health_score ?? 0) >= 70
              ? "text-beroe-green"
              : (a.health_score ?? 0) >= 40
                ? "text-beroe-amber"
                : "text-beroe-red",
          )}
        >
          {a.health_score ?? "—"}
        </span>
      </Td>
      <Td align="right">
        <div className="font-semibold text-text-primary">
          {fmtUsd(a.current_acv_usd)}
        </div>
        {a.target_acv_usd > 0 && (
          <div className="text-[9px] text-text-muted">
            tgt {fmtUsd(a.target_acv_usd)}
          </div>
        )}
      </Td>
      <Td>
        {a.top_play_title ? (
          <div>
            <div className="truncate max-w-[160px] font-medium">
              {a.top_play_title}
            </div>
            <div className="text-[9px] text-text-muted">
              {fmtUsd(a.top_play_value_usd)} · {a.top_play_prob}%
            </div>
          </div>
        ) : (
          <span className="text-text-muted">—</span>
        )}
      </Td>
      <Td>
        {a.renewal_date ? (
          <div>
            <div className="text-text-secondary">
              {new Date(a.renewal_date).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "2-digit",
              })}
            </div>
            {dtr !== null && dtr !== undefined && (
              <div className={cn("text-[9px]", dtrTone)}>
                {dtr < 0 ? "overdue" : `${dtr}d`}
              </div>
            )}
          </div>
        ) : (
          <span className="text-text-muted">—</span>
        )}
      </Td>
      <Td>
        {outcome ? (
          <span
            className={cn(
              "text-[10px] font-bold px-1.5 py-0.5 rounded-full border",
              outcome.bg,
              outcome.border,
              outcome.color,
            )}
          >
            {outcome.label}
          </span>
        ) : (
          <span className="text-[10px] text-text-muted italic">undecided</span>
        )}
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
}

function Th({
  children,
  align,
  title,
}: {
  children: React.ReactNode;
  align?: "right" | "left";
  title?: string;
}) {
  return (
    <th
      title={title}
      className={cn(
        "px-3 py-2 text-[10px] font-bold uppercase tracking-wider",
        align === "right" ? "text-right" : "text-left",
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
  align?: "right" | "left";
}) {
  return (
    <td
      className={cn(
        "px-3 py-2 text-[11px] align-top",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      {children}
    </td>
  );
}

// ============================================================
// Pipeline View — per-CO cards
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
        CSMs identify opportunities · COs validate and own commercially ·
        Sorted by weighted value · Expansion plays only.
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
      {/* Dark CO header */}
      <div className="bg-beroe-navy flex items-center justify-between gap-3 px-4 py-3">
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
      {/* Plays table */}
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
              <Th align="right"> </Th>
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
                      onClick={() => {
                        // The Pipeline play row doesn't carry the slug,
                        // so navigate by /accounts/<id> via the account row
                        // lookup is impossible here. Fall back to slug if
                        // we can resolve it from window — otherwise leave
                        // it as a no-op. (Account UUID lookup-by-id route
                        // exists at /accounts/:accountId which the SPA
                        // router accepts.)
                        onOpen(p.account_id);
                      }}
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
