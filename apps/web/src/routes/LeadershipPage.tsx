// M24 — Leadership view: cross-account portfolio dashboard.
//
// Four roll-ups in one screen, read-only:
//   1. Renewal outcome counts (renewed / at_risk / not_renewed / undecided)
//   2. Value-delivered totals from M22 VDDs ($identified / $committed / $implemented)
//   3. Overdue checkpoints (count + top accounts)
//   4. Open red flags across the portfolio
//
// Director / VP / Admin only — surfaced as an "AT-A-GLANCE" item in the
// sidebar, gated by permissions.can_view_leadership.

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { AppShell } from "@/components/AppShell";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { LeadershipPortfolio } from "@/types/leadership";

export default function LeadershipPage() {
  const { data, isLoading, error } = useQuery<LeadershipPortfolio>({
    queryKey: ["leadership-portfolio"],
    queryFn: () => api.get<LeadershipPortfolio>("/api/v1/leadership/portfolio"),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <AppShell title="Leadership view">
        <div className="text-sm text-text-muted p-4">Loading portfolio…</div>
      </AppShell>
    );
  }
  if (error || !data) {
    return (
      <AppShell title="Leadership view">
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-card p-4 text-sm">
          Couldn't load the leadership portfolio.
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Leadership view">
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-[18px] font-bold text-text-primary">
            Leadership view
          </h1>
          <div className="text-[12px] text-text-muted mt-0.5">
            Cross-account portfolio roll-ups · generated{" "}
            {new Date(data.generated_at).toLocaleString()}
          </div>
        </div>
      </div>

      {/* Row 1 — Renewals + Value delivered */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <RenewalCard counts={data.renewals} />
        <ValueDeliveredCard totals={data.value_delivered} />
      </div>

      {/* Row 2 — Overdue checkpoints + Red flags */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <OverdueCheckpointsCard
          total={data.overdue_checkpoints.total_overdue}
          accounts={data.overdue_checkpoints.accounts}
        />
        <RedFlagsCard flags={data.open_red_flags} />
      </div>
    </div>
    </AppShell>
  );
}

// ============================================================
// Cards
// ============================================================

function RenewalCard({
  counts,
}: {
  counts: LeadershipPortfolio["renewals"];
}) {
  const segments: { label: string; value: number; tone: string }[] = [
    { label: "Renewed", value: counts.renewed, tone: "bg-emerald-500" },
    { label: "At risk", value: counts.at_risk, tone: "bg-amber-500" },
    { label: "Not renewed", value: counts.not_renewed, tone: "bg-red-500" },
    { label: "Undecided", value: counts.undecided, tone: "bg-slate-300" },
  ];
  return (
    <Card title="Renewal outcomes" subtitle={`${counts.total} accounts`}>
      <div className="space-y-2.5 mt-2">
        {segments.map((s) => {
          const pct = counts.total === 0 ? 0 : (s.value / counts.total) * 100;
          return (
            <div key={s.label}>
              <div className="flex items-center justify-between text-[12px] mb-1">
                <span className="text-text-secondary">{s.label}</span>
                <span className="font-bold text-text-primary">
                  {s.value}{" "}
                  <span className="text-text-muted font-normal">
                    ({pct.toFixed(0)}%)
                  </span>
                </span>
              </div>
              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={cn("h-full transition-all", s.tone)}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function ValueDeliveredCard({
  totals,
}: {
  totals: LeadershipPortfolio["value_delivered"];
}) {
  const fmt = (n: number) => `$${n.toFixed(2)}M`;
  return (
    <Card
      title="Value delivered"
      subtitle={`Across ${totals.contributing_accounts} contributing account${totals.contributing_accounts === 1 ? "" : "s"}`}
    >
      <div className="grid grid-cols-3 gap-2 mt-2">
        <Stat label="Identified" value={fmt(totals.identified_musd)} tone="slate" />
        <Stat label="Committed" value={fmt(totals.committed_musd)} tone="amber" />
        <Stat label="Implemented" value={fmt(totals.implemented_musd)} tone="green" />
      </div>
      <div className="text-[10px] text-text-muted mt-3">
        Sourced from each account's Value Delivery Document (M22).
      </div>
    </Card>
  );
}

function OverdueCheckpointsCard({
  total,
  accounts,
}: {
  total: number;
  accounts: LeadershipPortfolio["overdue_checkpoints"]["accounts"];
}) {
  return (
    <Card
      title="Overdue checkpoints"
      subtitle={`${total} across ${accounts.length} account${accounts.length === 1 ? "" : "s"}`}
    >
      {accounts.length === 0 ? (
        <div className="text-[12px] text-text-muted italic mt-2">
          No overdue checkpoints — Kickoff / MBR / QBR / Renewal cadence on
          track everywhere.
        </div>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {accounts.map((a) => (
            <li
              key={a.account_id}
              className="flex items-center gap-2 border-b border-beroe-card-border/60 pb-1.5 last:border-b-0 last:pb-0"
            >
              <Link
                to={`/accounts/${a.account_id}/success-management/checkpoints`}
                className="text-[12px] font-semibold text-beroe-blue hover:underline"
              >
                {a.account_name}
              </Link>
              <span className="text-[11px] text-red-700 font-bold">
                {a.overdue_count} overdue
              </span>
              {a.oldest_scheduled_date && (
                <span className="ml-auto text-[10px] text-text-muted">
                  oldest{" "}
                  {new Date(a.oldest_scheduled_date).toLocaleDateString()}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RedFlagsCard({
  flags,
}: {
  flags: LeadershipPortfolio["open_red_flags"];
}) {
  return (
    <Card
      title="Open red flags"
      subtitle={`${flags.length} unresolved across the portfolio`}
    >
      {flags.length === 0 ? (
        <div className="text-[12px] text-text-muted italic mt-2">
          No open red flags — Delivery & Renewal looks healthy.
        </div>
      ) : (
        <ul className="mt-2 space-y-1.5 max-h-[280px] overflow-y-auto">
          {flags.map((f, i) => (
            <li
              key={`${f.account_id}-${i}`}
              className="border-b border-beroe-card-border/60 pb-1.5 last:border-b-0 last:pb-0"
            >
              <div className="flex items-center gap-2 flex-wrap">
                <Link
                  to={`/accounts/${f.account_id}/success-management/delivery-renewal`}
                  className="text-[12px] font-semibold text-beroe-blue hover:underline"
                >
                  {f.account_name}
                </Link>
                <span className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200">
                  {f.type.replace(/_/g, " ")}
                </span>
                {f.raised_at && (
                  <span className="ml-auto text-[10px] text-text-muted">
                    {new Date(f.raised_at).toLocaleDateString()}
                  </span>
                )}
              </div>
              {f.note && (
                <div className="text-[11px] text-text-secondary mt-0.5 leading-snug">
                  {f.note}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ============================================================
// Primitives
// ============================================================

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-beroe-card-border rounded-card p-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
        <h2 className="text-[14px] font-bold text-text-primary">{title}</h2>
        {subtitle && (
          <span className="text-[11px] text-text-muted">{subtitle}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "slate" | "amber" | "green";
}) {
  const cls =
    tone === "green"
      ? "bg-emerald-50 border-emerald-200 text-emerald-900"
      : tone === "amber"
        ? "bg-amber-50 border-amber-200 text-amber-900"
        : "bg-slate-50 border-slate-200 text-slate-900";
  return (
    <div className={cn("rounded-lg border px-3 py-2", cls)}>
      <div className="text-[10px] uppercase tracking-wider font-bold opacity-80">
        {label}
      </div>
      <div className="text-[16px] font-bold mt-0.5">{value}</div>
    </div>
  );
}
