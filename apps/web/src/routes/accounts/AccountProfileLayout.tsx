import { useQuery } from "@tanstack/react-query";
import { NavLink, Outlet, useParams, useNavigate, useLocation } from "react-router-dom";

import { AppShell } from "@/components/AppShell";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  formatACV,
  formatRenewalDays,
  healthBucket,
  initials,
} from "@/lib/format";
import type { AccountDetail } from "@/types/account";

interface SubNavItem {
  to: string;
  label: string;
  show: (a: AccountDetail) => boolean;
}

const SUB_NAV: SubNavItem[] = [
  { to: "overview",     label: "Overview",      show: () => true },
  { to: "pre-sales",    label: "Pre-Sales",     show: (a) => a.can_view_pre_sales },
  { to: "contacts",     label: "Contacts",      show: (a) => a.can_view_contacts },
  { to: "documents",    label: "Documents",     show: (a) => a.can_view_documents },
  { to: "solutioning",  label: "Solutioning",   show: (a) => a.can_view_solutioning },
  { to: "value-def",    label: "Value Def",     show: () => true },
  { to: "goals",        label: "Goals",         show: () => true },
];

export default function AccountProfileLayout() {
  const { accountId } = useParams<{ accountId: string }>();
  const navigate = useNavigate();
  const loc = useLocation();

  const { data, isLoading, isError, error } = useQuery<AccountDetail>({
    queryKey: ["account", accountId],
    queryFn: () => api.get<AccountDetail>(`/api/v1/accounts/${accountId}`),
    enabled: !!accountId,
    retry: 0,
  });

  if (isLoading) {
    return (
      <AppShell>
        <div className="px-6 py-8 text-text-muted text-sm">Loading account…</div>
      </AppShell>
    );
  }

  if (isError) {
    const e = error as ApiError | Error;
    const status = e instanceof ApiError ? e.status : 0;
    return (
      <AppShell>
        <div className="px-6 py-8">
          <div className="bg-white border border-slate-200 rounded-2xl p-8 max-w-md text-center mx-auto">
            <div className="text-3xl mb-2">{status === 404 ? "🔎" : "⚠️"}</div>
            <h1 className="text-lg font-bold text-text-primary mb-1">
              {status === 404 ? "Account not found" : "Could not load account"}
            </h1>
            <p className="text-sm text-text-secondary mb-4">
              {status === 404
                ? "The account doesn't exist or you don't have access."
                : (e?.message ?? "Try again in a moment.")}
            </p>
            <button
              onClick={() => navigate("/accounts")}
              className="px-3 py-1.5 rounded-lg bg-beroe-blue text-white text-sm font-semibold"
            >
              Back to accounts
            </button>
          </div>
        </div>
      </AppShell>
    );
  }

  if (!data) return null;

  const renewal = formatRenewalDays(data.days_to_renewal);
  const health = healthBucket(data.health_score);

  // If the URL is /accounts/:id (no sub-tab), redirect to overview.
  const lastSeg = loc.pathname.split("/").filter(Boolean).pop();
  if (lastSeg === accountId) {
    navigate(`/accounts/${accountId}/overview`, { replace: true });
  }

  return (
    <AppShell>
      <div className="bg-white border-b border-slate-200">
        {/* Breadcrumb */}
        <div className="px-6 pt-4 pb-1 text-xs text-text-muted">
          <button
            onClick={() => navigate("/accounts")}
            className="hover:text-text-secondary"
          >
            Accounts
          </button>
          <span className="mx-1.5">›</span>
          <span className="text-text-secondary">{data.name}</span>
        </div>

        {/* Header */}
        <div className="px-6 py-4 flex items-center gap-4 flex-wrap">
          <div className="w-12 h-12 rounded-lg bg-beroe-blue/10 border border-beroe-blue/30 flex items-center justify-center text-sm font-extrabold text-beroe-blue flex-shrink-0">
            {initials(data.name)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-text-primary truncate">{data.name}</h1>
              {!data.is_editable && (
                <span className="text-[10px] text-text-muted">(read-only)</span>
              )}
            </div>
            <div className="text-xs text-text-secondary mt-0.5">
              {data.industry ?? "—"} · {data.country ?? "—"} ·{" "}
              <span className="font-semibold">{data.csm_full_name ?? "Unassigned"}</span>{" "}
              <span className="text-text-muted">CSM</span>
            </div>
          </div>
          <Stat label="ACV" value={formatACV(data.current_acv)} />
          <Stat
            label="Renewal"
            value={renewal.label}
            tone={renewal.tone}
            sub={data.renewal_date ?? undefined}
          />
          <Stat
            label="Health"
            value={health.label}
            tone={health.tone}
            sub={data.health_score !== null ? String(data.health_score) : undefined}
          />
          <Stat label="Tier" value={data.tier ?? "—"} />
          <Stat label="Category" value={data.category ?? "—"} />
        </div>

        {/* Sub-nav */}
        <div className="px-6 flex gap-1 -mb-px">
          {SUB_NAV.filter((t) => t.show(data)).map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) =>
                cn(
                  "px-3 py-2 text-sm border-b-2 -mb-px",
                  isActive
                    ? "border-beroe-blue text-beroe-blue font-semibold"
                    : "border-transparent text-text-secondary hover:text-text-primary",
                )
              }
            >
              {t.label}
            </NavLink>
          ))}
        </div>
      </div>

      {/* Tab outlet */}
      <div className="p-6">
        <Outlet context={{ account: data }} />
      </div>
    </AppShell>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "ok" | "warn" | "danger" | "muted";
}) {
  const toneCls = {
    ok: "text-green-700",
    warn: "text-amber-700",
    danger: "text-red-700",
    muted: "text-text-muted",
  }[tone ?? "muted"];
  return (
    <div className="text-right">
      <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">{label}</div>
      <div className={cn("text-sm font-semibold", tone ? toneCls : "text-text-primary")}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-text-muted">{sub}</div>}
    </div>
  );
}

/** Hook that tabs use to access the parent layout's account. */
import { useOutletContext } from "react-router-dom";
export function useAccountFromLayout(): AccountDetail {
  return (useOutletContext<{ account: AccountDetail }>()).account;
}
