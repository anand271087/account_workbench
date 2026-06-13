import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNotify } from "@/components/DialogProvider";
import { NavLink, Outlet, useParams, useNavigate, useLocation } from "react-router-dom";

import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { StarButton } from "@/components/StarButton";
import { api, ApiError } from "@/lib/api";
import { useFavoriteAccounts } from "@/lib/use-favorites";
import { cn } from "@/lib/utils";
import { initials } from "@/lib/format";
import type { AccountDetail, ActivityFeedResponse } from "@/types/account";
import type { Appetite } from "@/types/play";
import { MODE_CONF } from "@/types/play";

// M33 — Period selector. The prototype's account header has a 30d/90d/FY
// toggle in the top-right. We store the choice in localStorage scoped by
// account so navigation keeps your view stable across reloads, and pass
// it down via outlet context so leaf tabs (Home, Analytics) can react.
// "All" added 05-Jun for Intelligence dashboards — Redshift extract is
// stale by ~7 months on some tables (freshservice_abi etc.) so 30d/90d/FY
// return zeros even though historical data exists. The "All" pill is a
// stakeholder workaround until the extract refresh ships.
export type AccountPeriod = "30d" | "90d" | "FY" | "All";
const PERIODS: AccountPeriod[] = ["30d", "90d", "FY", "All"];
const PERIOD_KEY = "awb:account-period";

interface SubNavItem {
  to: string;
  label: string;
  col: string;
  bg: string;
  show: (a: AccountDetail) => boolean;
}

// M32 — top-level nav matches the prototype's 5-tab structure exactly:
// Home (was Overview) · Account Kit · Success Management · Growth &
// Pipeline · Intelligence & Reports. Contacts and Value Def used to be
// top-level entries; both now live where the prototype puts them —
// Contacts inside Account Kit → Pre-Sales (Client Contacts group), and
// Value Def inside Account Kit → Solutioning. Back-compat redirects in
// App.tsx keep the old `/contacts` + `/value-def` URLs working.
// 28-May — Per-tab colour palette ported from prototype line 2785-2790
// (`views` array in buildAcct). Each pill tints to its own colour when
// active so the user has a strong colour-coded sense of "which area
// am I in". Inactive pills are neutral white.
const SUB_NAV: SubNavItem[] = [
  { to: "overview",   label: "🏠 Home",    col: "#4A00F8", bg: "#f3f0ff", show: () => true },
  {
    to: "account-kit",
    label: "📋 Account Kit",
    col: "#F0BC41",
    bg: "#fff8eb",
    show: (a) =>
      a.can_view_pre_sales ||
      a.can_view_solutioning ||
      a.can_view_sales_handoff ||
      a.can_view_cs_onboarding,
  },
  {
    to: "success-management",
    label: "🎯 Success Management",
    col: "#CF4548",
    bg: "#fff0f2",
    show: (a) => a.can_view_cs_onboarding,
  },
  {
    to: "growth-pipeline",
    label: "🚀 Growth & Pipeline",
    col: "#6EC457",
    bg: "#f0fdf4",
    show: (a) => a.can_view_cs_onboarding,
  },
  {
    to: "intel-reports",
    label: "📊 Intelligence & Reports",
    col: "#35E1D4",
    bg: "#f0fdfa",
    show: () => true,
  },
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
    return v === "30d" || v === "90d" || v === "FY" || v === "All" ? v : "90d";
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
      if (e.key === PERIOD_KEY && (e.newValue === "30d" || e.newValue === "90d" || e.newValue === "FY" || e.newValue === "All")) {
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
          <div className="bg-white border border-beroe-card-border rounded-2xl p-8 max-w-md text-center mx-auto">
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
        {/* Breadcrumb + Last-updated (12-Jun bug 245) */}
        <div className="px-6 pt-4 pb-1 text-[11px] text-text-muted flex items-center gap-2">
          <button
            onClick={() => navigate("/accounts")}
            className="hover:text-text-secondary"
          >
            Accounts
          </button>
          <span className="mx-0.5">›</span>
          <span className="text-text-secondary">{data.name}</span>
          <span className="flex-1" />
          <LastUpdatedChip accountId={data.id} fallbackIso={data.updated_at} />
        </div>

        {/* Compact Account Header — verbatim port of prototype line 2802-2814
            (`beroe_awb_v20.html`):
              [36×36 logo, coloured by health status]
              [Name 15px bold] [account_type pill]
              [industry · CSM · tier (11px muted)]
              [period bar] [health score] [mode pill]
            The duplicate name/subtitle/mode chip on the HomeTab header
            strip is now stripped — single source of truth lives here. */}
        <div className="px-6 py-3 flex items-center gap-3.5 flex-wrap">
          <LogoBox name={data.name} healthScore={data.health_score} />
          <div className="flex-1 min-w-0 self-center">
            <div className="flex items-center gap-2 flex-wrap">
              <StarButton
                pinned={fav.isFavorite(data.id)}
                onToggle={() =>
                  fav.toggle({ id: data.id, name: data.name, slug: data.slug })
                }
                size="md"
              />
              <h1 className="text-[15px] font-bold truncate" style={{ color: "#0d1b2e" }}>{data.name}</h1>
              {data.account_type && (
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                  style={{
                    background: "#E8F8EF",
                    color: "#6EC457",
                    border: "1px solid #6EC45740",
                  }}
                >
                  {data.account_type}
                </span>
              )}
              {!data.is_editable && (
                <span className="text-[10px] text-text-muted">(read-only)</span>
              )}
            </div>
            <div className="text-[11px] text-text-muted mt-0.5 truncate">
              {data.industry ?? "—"}
              {data.sector && <> · {data.sector}</>}
              {data.country && <> · {data.country}</>}
              {data.revenue_bucket && <> · {data.revenue_bucket}</>}
              {data.tier && <> · {data.tier}</>}
              {/* 13-Jun · CSM + CO moved to AFTER tier so the breadcrumb
                  reads industry → tier → ownership. Fall back from the
                  FK-joined full_name (only set when the named staff are
                  invited as real users) to the free-text owner_name
                  (set by the bulk-import / create-account modal). */}
              {(() => {
                const csm = data.csm_full_name || data.csm_owner_name;
                const co = data.co_full_name || data.commercial_owner_name;
                if (!csm && !co) return null;
                return (
                  <>
                    {csm && (
                      <>
                        {" · CSM: "}
                        <span className="text-text-secondary">{csm}</span>
                      </>
                    )}
                    {co && (
                      <>
                        {" · CO: "}
                        <span className="text-text-secondary">{co}</span>
                      </>
                    )}
                  </>
                );
              })()}
            </div>
            {/* 13-Jun · Bulk-import chip row removed per stakeholder ask
                (Platform status, Fortune 500, Focus Region/Industry,
                Renewal Risk, Subscription Plan all gone). The data
                still lives on the row — surfaced inline on the
                AccountList page columns / Home tab callouts instead. */}
            {/* 12-Jun · Admin-only inline edit for the Redshift mapping.
                The /intel/* endpoints 409 when this is null, which
                quietly blanks the Analytics tab. Surfacing it here so
                admins can fix mismatches without a SQL trip. */}
            {me?.user.role === "admin" && (
              <RedshiftMappingEditor
                accountId={data.id}
                current={data.redshift_company_name ?? ""}
              />
            )}
          </div>

          {/* M33 — Header trio (faithful port of prototype account-header
              top-right, line 2807-2812 of beroe_awb_v20.html):
                1. Period selector (30d / 90d / FY) — pill group
                2. Health score badge — score number + status label
                3. Mode pill — current Appetite Score mode (rescue /
                   retain / expand) with icon + label.
              12-Jun bug 246 — Period selector hidden on every section
              except Home (/overview) and Intel & Reports (/intel-reports).
              Stakeholder ask: period scaling is only meaningful for the
              KPI-tile / analytics views; the other sections (Account Kit,
              Success Management, Growth & Pipeline) read static config,
              not time-windowed telemetry. */}
          <div className="flex items-center gap-3 flex-wrap">
            {(loc.pathname.includes("/overview") ||
              loc.pathname.includes("/intel-reports")) && (
              <PeriodBar value={period} onChange={setPeriod} />
            )}
            <HealthBadge score={data.health_score} />
            <ModePill appetite={apptQ.data} />
          </div>
        </div>

        {/* 28-May — Coloured pill sub-nav verbatim from prototype line
            2820 (the "3 view selector pills" block). Each tab tints to
            its assigned colour when active; inactive pills are neutral. */}
        <div className="px-6 pb-3 flex gap-2 overflow-x-auto">
          {SUB_NAV.filter((t) => t.show(data)).map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              className={({ isActive }) =>
                cn(
                  "flex-1 min-w-[140px] px-3 py-2.5 rounded-[10px] border-[1.5px] text-[13px] text-center whitespace-nowrap transition-colors duration-100",
                  isActive ? "font-bold" : "font-medium",
                )
              }
              style={({ isActive }) =>
                isActive
                  ? {
                      borderColor: t.col + "40",
                      background: t.bg,
                      color: t.col,
                    }
                  : {
                      borderColor: "var(--cb, #e4eaf6)",
                      background: "#fff",
                      color: "#64748b",
                    }
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

// 28-May — Compact logo box (port of prototype line 2803). 36×36 square
// with rounded corners, coloured by the current health-score band.
function LogoBox({
  name,
  healthScore,
}: {
  name: string;
  healthScore: number | null;
}) {
  const s = healthScore ?? 0;
  const tone =
    s >= 70
      ? { col: "#6EC457", bg: "#E8F8EF" }
      : s >= 40
        ? { col: "#F0BC41", bg: "#FFF4E5" }
        : { col: "#CF4548", bg: "#FCEBED" };
  return (
    <div
      className="w-9 h-9 rounded-lg flex items-center justify-center text-[11px] font-extrabold flex-shrink-0"
      style={{
        background: tone.bg,
        border: `2px solid ${tone.col}`,
        color: tone.col,
      }}
    >
      {initials(name)}
    </div>
  );
}

// 12-Jun bug 245 — "Last updated" chip on every account page. Reads the
// most recent audit_log entry via the activity feed (page_size=1) and
// falls back to accounts.updated_at when the feed is empty. Rendered in
// the breadcrumb row of this layout, so EVERY sub-tab inherits it with
// zero per-tab wiring.
function LastUpdatedChip({
  accountId,
  fallbackIso,
}: {
  accountId: string;
  fallbackIso: string | null;
}) {
  const q = useQuery<ActivityFeedResponse>({
    queryKey: ["activity", accountId, "latest"],
    queryFn: () =>
      api.get<ActivityFeedResponse>(
        `/api/v1/accounts/${accountId}/activity?page=1&page_size=1`,
      ),
    staleTime: 30_000,
  });
  const top = q.data?.items?.[0];
  const iso = top?.changed_at ?? fallbackIso;
  if (!iso) return null;
  const what = top?.field_name
    ? top.field_name.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())
    : null;
  const who = top?.changed_by_full_name ?? null;
  return (
    <span
      className="text-[10.5px] text-text-muted whitespace-nowrap truncate max-w-[420px]"
      title={new Date(iso).toLocaleString()}
    >
      Last updated {relTime(iso)}
      {what && (
        <>
          {" "}· <b className="font-semibold text-text-secondary">{what}</b>
        </>
      )}
      {who && <> by {who}</>}
    </span>
  );
}

function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
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
    <div className="flex gap-0.5 bg-beroe-bg rounded-md p-0.5">
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
      ? { col: "#6EC457", bg: "#E8F8EF", label: "Healthy" }
      : s >= 40
        ? { col: "#F0BC41", bg: "#FFF4E5", label: "At Risk" }
        : { col: "#CF4548", bg: "#FCEBED", label: "Critical" };
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
    ? "border-beroe-red/40 bg-beroe-red/10/70"
    : tone === "warn"
      ? "border-beroe-amber/50 bg-beroe-amber/15/60"
      : tone === "ok"
        ? "border-beroe-green/30 bg-beroe-green/15/40"
        : "border-beroe-card-border bg-white";

  const valueTone = {
    ok: "text-beroe-green",
    warn: "text-beroe-amber",
    danger: "text-beroe-red",
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
          <span aria-hidden className="text-beroe-red text-sm leading-none">⚠</span>
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


/**
 * Admin-only inline editor for `accounts.redshift_company_name` — the
 * canonical key that Analytics queries use to look up usage / category
 * watch / Abi data on the live Redshift cluster. When this is null
 * (or wrong), the /intel/* endpoints 409 and the Analytics tab blanks.
 *
 * Surfaces the current value as a small `🔗 RS:` tag with a pencil
 * action that swaps in an inline input. Saves via PATCH /accounts/:id.
 */
function RedshiftMappingEditor({
  accountId,
  current,
}: {
  accountId: string;
  current: string;
}) {
  const qc = useQueryClient();
  const notify = useNotify();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(current);

  useEffect(() => setDraft(current), [current]);

  const save = useMutation({
    mutationFn: (val: string) =>
      api.patch(`/api/v1/accounts/${accountId}`, {
        redshift_company_name: val.trim() || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["account", accountId] });
      // Bust any intel cache so Analytics re-fetches with the new name.
      qc.invalidateQueries({ queryKey: ["intel", accountId] });
      notify({ title: "Redshift mapping updated", tone: "success" });
      setEditing(false);
    },
    onError: (e) =>
      notify({
        title: "Save failed",
        body: e instanceof ApiError ? e.message : "Unknown error",
        tone: "error",
      }),
  });

  if (editing) {
    return (
      <div className="mt-1.5 flex items-center gap-1.5 text-[10px]">
        <span className="text-text-muted uppercase tracking-wide font-bold">
          🔗 Redshift mapping:
        </span>
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save.mutate(draft);
            if (e.key === "Escape") {
              setDraft(current);
              setEditing(false);
            }
          }}
          autoFocus
          placeholder="(unset)"
          className="px-2 py-0.5 border border-beroe-card-border rounded text-[11px] min-w-[260px]"
        />
        <button
          type="button"
          onClick={() => save.mutate(draft)}
          disabled={save.isPending}
          className="text-[10px] font-bold rounded px-1.5 py-0.5 bg-beroe-blue text-white disabled:opacity-50"
        >
          {save.isPending ? "…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => {
            setDraft(current);
            setEditing(false);
          }}
          className="text-[10px] text-text-muted px-1.5 py-0.5"
        >
          Cancel
        </button>
      </div>
    );
  }
  return (
    <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-text-muted">
      <span className="uppercase tracking-wide font-bold">🔗 Redshift:</span>
      <span
        className={cn(
          current ? "text-text-secondary" : "italic",
          current ? "" : "text-beroe-red",
        )}
        title="The `companyname` value Analytics uses to look up Redshift data for this account."
      >
        {current || "(unset — Analytics blank)"}
      </span>
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-beroe-blue hover:underline font-semibold"
      >
        edit
      </button>
    </div>
  );
}

/** Hook for tabs that want to react to the period selector. */
export function useAccountPeriod(): {
  period: AccountPeriod;
  setPeriod: (p: AccountPeriod) => void;
} {
  const ctx = useOutletContext<AccountOutletContext>();
  return { period: ctx.period, setPeriod: ctx.setPeriod };
}
