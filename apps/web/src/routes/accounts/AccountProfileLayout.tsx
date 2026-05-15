import { useQuery } from "@tanstack/react-query";
import { NavLink, Outlet, useParams, useNavigate, useLocation } from "react-router-dom";

import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { StarButton } from "@/components/StarButton";
import { api, ApiError } from "@/lib/api";
import { useFavoriteAccounts } from "@/lib/use-favorites";
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
  { to: "overview",   label: "Overview",   show: () => true },
  // M17 — Pre-Sales / Brief / Solutioning / Sales Handoff / CS Onboarding
  // are grouped under a single "Account Kit" tab. The sub-tab strip lives
  // inside AccountKitLayout. Visibility = at least one inner sub is visible.
  {
    to: "account-kit",
    label: "Account Kit",
    show: (a) =>
      a.can_view_pre_sales ||
      a.can_view_solutioning ||
      a.can_view_sales_handoff ||
      a.can_view_cs_onboarding,
  },
  // M18 — Success Management group: VDD / Contract+Goals / Value Tracking
  // / Checkpoints / Delivery+Renewal. Visible to anyone with CS-onboarding
  // view rights (same gate as the downstream CSM workflow).
  {
    to: "success-management",
    label: "Success Management",
    show: (a) => a.can_view_cs_onboarding,
  },
  { to: "contacts",  label: "Contacts",  show: (a) => a.can_view_contacts },
  { to: "value-def", label: "Value Def", show: () => true },
  // Goals folded into Success Management → Contract & Goals (M19).
  // Old /goals URL still works via the back-compat redirect in App.tsx.
];

export default function AccountProfileLayout() {
  const { accountId } = useParams<{ accountId: string }>();
  const navigate = useNavigate();
  const loc = useLocation();
  const { me } = useAuth();
  const fav = useFavoriteAccounts(me?.user.id);

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
      <div className="bg-white border-b border-beroe-card-border">
        {/* Breadcrumb */}
        <div className="px-6 pt-4 pb-1 text-[11px] text-text-muted">
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
        <div className="px-6 py-4 flex items-start gap-4 flex-wrap">
          <div className="w-12 h-12 rounded-ctl bg-beroe-blue/10 border border-beroe-blue/30 flex items-center justify-center text-sm font-extrabold text-beroe-blue flex-shrink-0">
            {initials(data.name)}
          </div>
          <div className="flex-1 min-w-0 self-center">
            <div className="flex items-center gap-2">
              <StarButton
                pinned={fav.isFavorite(data.id)}
                onToggle={() =>
                  fav.toggle({ id: data.id, name: data.name, slug: data.slug })
                }
                size="md"
              />
              <h1 className="text-[18px] font-bold truncate" style={{ color: "#003B73" }}>{data.name}</h1>
              {!data.is_editable && (
                <span className="text-[10px] text-text-muted">(read-only)</span>
              )}
            </div>
            <div className="text-[11px] text-text-secondary mt-0.5">
              {data.industry ?? "—"} · {data.country ?? "—"} ·{" "}
              <span className="font-semibold">{data.csm_full_name ?? "Unassigned"}</span>{" "}
              <span className="text-text-muted">CSM</span>
            </div>
          </div>

          {/* KPI strip — uniform cards (prototype `.kpi`), aligned baselines */}
          <div className="flex items-stretch gap-2 flex-wrap">
            <Stat label="ACV" value={formatACV(data.current_acv)} />
            <Stat
              label="Renewal"
              value={renewal.label}
              tone={renewal.tone}
              alert={renewal.tone === "danger"}
              sub={data.renewal_date ?? undefined}
            />
            <Stat
              label="Health"
              value={health.label}
              tone={health.tone}
              alert={health.tone === "danger"}
              sub={data.health_score !== null ? String(data.health_score) : undefined}
            />
            <Stat label="Tier" value={data.tier ?? "—"} />
            <Stat label="Category" value={data.category ?? "—"} />
          </div>
        </div>

        {/* Sub-nav — mirrors prototype `.tab-bar` / `.tab-b` exactly */}
        <div className="px-6 flex border-b-[1.5px] border-beroe-card-border overflow-x-auto -mb-px">
          {SUB_NAV.filter((t) => t.show(data)).map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) =>
                cn(
                  "px-[14px] py-[9px] text-[12px] font-medium whitespace-nowrap border-b-[2.5px] -mb-[1.5px] transition-colors duration-100",
                  isActive
                    ? "text-beroe-blue font-bold border-beroe-blue"
                    : "text-text-muted border-transparent hover:text-beroe-blue",
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
  alert,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "ok" | "warn" | "danger" | "muted";
  /** Render the value as a strong alert pill (red-tinted card + icon). */
  alert?: boolean;
}) {
  const cardCls = alert
    ? "border-red-300 bg-red-50/70"
    : tone === "warn"
      ? "border-amber-300 bg-amber-50/60"
      : tone === "ok"
        ? "border-green-200 bg-green-50/40"
        : "border-beroe-card-border bg-white";

  const valueTone = {
    ok: "text-green-700",
    warn: "text-amber-700",
    danger: "text-red-700",
    muted: "text-text-primary",
  }[tone ?? "muted"];

  return (
    <div
      className={cn(
        "rounded-ctl border px-3 py-2 min-w-[88px] flex flex-col justify-between",
        cardCls,
      )}
    >
      <div className="text-[9px] uppercase tracking-wider text-text-muted font-bold">
        {label}
      </div>
      <div className="flex items-center gap-1.5 mt-1">
        {alert && (
          <span aria-hidden className="text-red-600 text-sm leading-none">⚠</span>
        )}
        <span className={cn("text-[13px] font-bold leading-tight", valueTone)}>
          {value}
        </span>
      </div>
      {/* Reserve a slot for sub so all cards align at baseline */}
      <div className="text-[10px] text-text-muted mt-0.5 min-h-[14px]">
        {sub ?? " "}
      </div>
    </div>
  );
}

/** Hook that tabs use to access the parent layout's account. */
import { useOutletContext } from "react-router-dom";
export function useAccountFromLayout(): AccountDetail {
  return (useOutletContext<{ account: AccountDetail }>()).account;
}
