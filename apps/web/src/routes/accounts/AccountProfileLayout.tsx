import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink, Outlet, useParams, useNavigate, useLocation } from "react-router-dom";

import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { StarButton } from "@/components/StarButton";
import { api, ApiError } from "@/lib/api";
import { useFavoriteAccounts } from "@/lib/use-favorites";
import { cn } from "@/lib/utils";
import { initials } from "@/lib/format";
import type { AccountDetail } from "@/types/account";
import type { Appetite } from "@/types/play";
import { MODE_CONF } from "@/types/play";

// M33 — Period selector. The prototype's account header has a 30d/90d/FY
// toggle in the top-right. We store the choice in localStorage scoped by
// account so navigation keeps your view stable across reloads, and pass
// it down via outlet context so leaf tabs (Home, Analytics) can react.
export type AccountPeriod = "30d" | "90d" | "FY";
const PERIODS: AccountPeriod[] = ["30d", "90d", "FY"];
const PERIOD_KEY = "awb:account-period";

interface SubNavItem {
  to: string;
  label: string;
  show: (a: AccountDetail) => boolean;
}

// M32 — top-level nav matches the prototype's 5-tab structure exactly:
// Home (was Overview) · Account Kit · Success Management · Growth &
// Pipeline · Intelligence & Reports. Contacts and Value Def used to be
// top-level entries; both now live where the prototype puts them —
// Contacts inside Account Kit → Pre-Sales (Client Contacts group), and
// Value Def inside Account Kit → Solutioning. Back-compat redirects in
// App.tsx keep the old `/contacts` + `/value-def` URLs working.
const SUB_NAV: SubNavItem[] = [
  { to: "overview",   label: "🏠 Home",    show: () => true },
  // M17 — Pre-Sales / Brief / Solutioning / Sales Handoff / CS Onboarding
  // are grouped under a single "Account Kit" tab. The sub-tab strip lives
  // inside AccountKitLayout. Visibility = at least one inner sub is visible.
  {
    to: "account-kit",
    label: "📋 Account Kit",
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
    label: "🎯 Success Management",
    show: (a) => a.can_view_cs_onboarding,
  },
  // M26 — Growth & Pipeline. Three sub-tabs (Account Plan live; Signals
  // & Activity + External Intelligence stubs until M27 / M28). Visibility
  // gated on the same CS-onboarding view right as the rest of the funnel.
  {
    to: "growth-pipeline",
    label: "🚀 Growth & Pipeline",
    show: (a) => a.can_view_cs_onboarding,
  },
  // M29 — Intelligence & Reports group: Intelligence (live) + Analytics
  // (M30 stub) + Documents & Reports (M31 stub). Read-only platform-data
  // surface; anyone with view access on the account can read.
  {
    to: "intel-reports",
    label: "📊 Intelligence & Reports",
    show: () => true,
  },
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

  // M33 — Appetite score drives the mode pill in the header. Fetched
  // once at the layout so leaf tabs share the same view.
  const apptQ = useQuery<Appetite>({
    queryKey: ["appetite", accountId],
    queryFn: () =>
      api.get<Appetite>(`/api/v1/accounts/${accountId}/appetite-score`),
    enabled: !!accountId,
    retry: 0,
  });

  // M33 — Period selector state. Default 90d. Persisted in localStorage.
  const [period, setPeriodState] = useState<AccountPeriod>(() => {
    if (typeof window === "undefined") return "90d";
    const v = window.localStorage.getItem(PERIOD_KEY);
    return v === "30d" || v === "90d" || v === "FY" ? v : "90d";
  });
  const setPeriod = (p: AccountPeriod) => {
    setPeriodState(p);
    try {
      window.localStorage.setItem(PERIOD_KEY, p);
    } catch {
      // ignore (private-mode + storage-quota etc.)
    }
  };
  // Initial mount nudge in case localStorage changed in another tab.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onStorage = (e: StorageEvent) => {
      if (e.key === PERIOD_KEY && (e.newValue === "30d" || e.newValue === "90d" || e.newValue === "FY")) {
        setPeriodState(e.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

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
              {data.industry ?? "—"} · {data.country ?? "—"}
              {data.annual_revenue_text && (
                <> · <span className="font-semibold">{data.annual_revenue_text}</span></>
              )}
              {data.headquarters && <> · HQ {data.headquarters}</>}
              {" · "}
              <span className="font-semibold">{data.csm_full_name ?? "Unassigned"}</span>{" "}
              <span className="text-text-muted">CSM</span>
              {data.sf_link && (
                <>
                  {" · "}
                  <a
                    href={data.sf_link}
                    target="_blank"
                    rel="noreferrer"
                    className="text-beroe-blue hover:underline font-semibold"
                  >
                    Salesforce ↗
                  </a>
                </>
              )}
            </div>
          </div>

          {/* M33 — Header trio (faithful port of prototype account-header
              top-right, line 2807-2812 of beroe_awb_v20.html):
                1. Period selector (30d / 90d / FY) — pill group
                2. Health score badge — score number + status label
                3. Mode pill — current Appetite Score mode (rescue /
                   retain / expand) with icon + label. */}
          <div className="flex items-center gap-3 flex-wrap">
            <PeriodBar value={period} onChange={setPeriod} />
            <HealthBadge score={data.health_score} />
            <ModePill appetite={apptQ.data} />
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
        <Outlet context={{ account: data, period, setPeriod }} />
      </div>
    </AppShell>
  );
}

// M33 — Period selector. Pill group exactly matching the prototype's
// `.per-bar` + `.per-btn` styling.
function PeriodBar({
  value,
  onChange,
}: {
  value: AccountPeriod;
  onChange: (p: AccountPeriod) => void;
}) {
  return (
    <div className="flex gap-0.5 bg-slate-100 rounded-md p-0.5">
      {PERIODS.map((p) => (
        <button
          key={p}
          onClick={() => onChange(p)}
          className={cn(
            "text-[11px] px-3 py-1 rounded font-semibold transition-colors",
            value === p
              ? "bg-white shadow-sm text-beroe-blue"
              : "text-text-muted hover:text-text-secondary",
          )}
        >
          {p}
        </button>
      ))}
    </div>
  );
}

// M33 — Health badge. Score + colour-keyed status label, matching the
// prototype account-header trio (Healthy / At Risk / Critical bands).
function HealthBadge({ score }: { score: number | null }) {
  const s = score ?? 0;
  const tone =
    s >= 70
      ? { col: "#40CC8F", bg: "#E8F8EF", label: "Healthy" }
      : s >= 40
        ? { col: "#EF9637", bg: "#FFF4E5", label: "At Risk" }
        : { col: "#e63950", bg: "#FCEBED", label: "Critical" };
  return (
    <div
      className="text-center rounded-lg px-3 py-1.5"
      style={{ background: tone.bg }}
    >
      <div
        className="text-[16px] font-extrabold leading-none"
        style={{ color: tone.col }}
      >
        {score === null ? "—" : score}
      </div>
      <div
        className="text-[8px] font-bold uppercase tracking-wider mt-0.5"
        style={{ color: tone.col }}
      >
        {tone.label}
      </div>
    </div>
  );
}

// M33 — Mode pill. Mirrors the prototype's buildModePill — current
// recommended mode (rescue / retain / expand) with icon + label.
function ModePill({ appetite }: { appetite: Appetite | undefined }) {
  if (!appetite) {
    return (
      <span className="text-[10px] px-2 py-1 rounded-md border border-beroe-card-border text-text-muted">
        Mode —
      </span>
    );
  }
  const conf = MODE_CONF[appetite.current_mode];
  return (
    <span
      className="text-[11px] px-2.5 py-1 rounded-md border font-bold"
      style={{
        background: conf.bg,
        color: conf.col,
        borderColor: conf.col + "30",
      }}
      title={`Appetite ${appetite.score}/100 · ${appetite.is_overridden ? "Manual override" : "Auto-recommended"}`}
    >
      {conf.icon} {conf.label}
    </span>
  );
}

// Legacy Stat KPI card — exported so other tabs can still use the
// compact card primitive. Not rendered in the layout header anymore
// as of M33 (replaced by the trio above).
export function Stat({
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

/** Hook that tabs use to access the parent layout's account + period. */
import { useOutletContext } from "react-router-dom";

interface AccountOutletContext {
  account: AccountDetail;
  period: AccountPeriod;
  setPeriod: (p: AccountPeriod) => void;
}

export function useAccountFromLayout(): AccountDetail {
  return (useOutletContext<AccountOutletContext>()).account;
}

/** Hook for tabs that want to react to the period selector. */
export function useAccountPeriod(): {
  period: AccountPeriod;
  setPeriod: (p: AccountPeriod) => void;
} {
  const ctx = useOutletContext<AccountOutletContext>();
  return { period: ctx.period, setPeriod: ctx.setPeriod };
}
