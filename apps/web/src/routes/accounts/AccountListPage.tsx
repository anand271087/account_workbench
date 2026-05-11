import { useMemo, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";

import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { ReassignOwnerModal } from "@/components/ReassignOwnerModal";
import { StarButton } from "@/components/StarButton";
import { api } from "@/lib/api";
import { useFavoriteAccounts } from "@/lib/use-favorites";
import { cn } from "@/lib/utils";
import {
  formatACV,
  formatRelativeDate,
  formatRenewalDays,
  healthBucket,
  initials,
} from "@/lib/format";
import type { AccountListItem, AccountListResponse, AccountListQuery } from "@/types/account";

const SORT_KEYS = [
  { key: "name", label: "Name" },
  { key: "current_acv", label: "ACV" },
  { key: "renewal_date", label: "Renewal" },
  { key: "health_score", label: "Health" },
  { key: "last_activity_at", label: "Last activity" },
] as const;

type SortKey = (typeof SORT_KEYS)[number]["key"];

function buildQS(q: AccountListQuery): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

const DEBOUNCE_MS = 250;

export default function AccountListPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { me } = useAuth();
  const isAdmin = me?.user.role === "admin";
  const fav = useFavoriteAccounts(me?.user.id);
  const [reassignTarget, setReassignTarget] = useState<AccountListItem | null>(null);

  // Read filters from URL (so they're shareable/bookmarkable)
  const q = params.get("q") ?? "";
  const industry = params.get("industry") ?? "";
  const tier = params.get("tier") ?? "";
  const region = params.get("region") ?? "";
  const renewalWithin = params.get("renewal_within_days") ?? "";
  const sort = (params.get("sort") ?? "name") as SortKey;
  const sortDir = (params.get("sort_dir") ?? "asc") as "asc" | "desc";
  const page = parseInt(params.get("page") ?? "1", 10);
  const pageSize = parseInt(params.get("page_size") ?? "50", 10);

  // Bulk select state
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const canBulkReassign = isAdmin;

  // M9 — create account
  const canCreateAccount =
    me?.user.role === "admin" || me?.user.role === "cs_director" || me?.user.role === "vp_csm";
  const [createOpen, setCreateOpen] = useState(false);

  const [searchInput, setSearchInput] = useState(q);

  // Debounce search input → URL
  useMemoizedDebounce(searchInput, DEBOUNCE_MS, (v) => {
    if (v === q) return;
    const next = new URLSearchParams(params);
    if (v) next.set("q", v);
    else next.delete("q");
    next.delete("page");
    setParams(next, { replace: true });
  });

  const queryKey = useMemo(
    () => ["accounts", { q, industry, tier, region, renewalWithin, sort, sortDir, page, pageSize }],
    [q, industry, tier, region, renewalWithin, sort, sortDir, page, pageSize],
  );

  const { data, isLoading, isError, error, isFetching } = useQuery<AccountListResponse>({
    queryKey,
    queryFn: () =>
      api.get<AccountListResponse>(
        "/api/v1/accounts" +
          buildQS({
            q: q || undefined,
            industry: industry || undefined,
            tier: tier || undefined,
            region: region || undefined,
            renewal_within_days: renewalWithin || undefined,
            sort,
            sort_dir: sortDir,
            page,
            page_size: pageSize,
          }),
      ),
    placeholderData: keepPreviousData,
  });

  const facets = useMemo(() => {
    if (!data) return { industries: [], tiers: [], regions: [] };
    const items = data.items;
    return {
      industries: [...new Set(items.map((i) => i.industry).filter(Boolean) as string[])].sort(),
      tiers: [...new Set(items.map((i) => i.tier).filter(Boolean) as string[])].sort(),
      regions: [...new Set(items.map((i) => i.region).filter(Boolean) as string[])].sort(),
    };
  }, [data]);

  function setParam(key: string, val: string | null) {
    const next = new URLSearchParams(params);
    if (val) next.set(key, val);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    setParams(next, { replace: true });
  }

  function setSort(key: SortKey) {
    const sameKey = sort === key;
    const dir = sameKey && sortDir === "asc" ? "desc" : "asc";
    const next = new URLSearchParams(params);
    next.set("sort", key);
    next.set("sort_dir", dir);
    setParams(next, { replace: true });
  }

  return (
    <AppShell>
      <div className="px-6 py-5">
        {/* Header */}
        <div className="flex items-end justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-text-primary">Accounts</h1>
            <p className="text-xs text-text-muted mt-1">
              {data
                ? `${data.total} accounts · showing page ${data.page}`
                : isLoading
                  ? "Loading…"
                  : ""}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {isFetching && !isLoading && (
              <div className="text-xs text-text-muted">Refreshing…</div>
            )}
            {canCreateAccount && (
              <button
                onClick={() => setCreateOpen(true)}
                className="px-3 py-1.5 rounded-lg bg-beroe-blue text-white text-sm font-semibold hover:bg-beroe-blue/90"
              >
                + New account
              </button>
            )}
          </div>
        </div>

        {/* Search + filters */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search name, slug, country, industry, CSM email, primary contact…"
            className="flex-1 min-w-[320px] px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:border-beroe-blue"
          />
          <Select value={industry} onChange={(v) => setParam("industry", v)} label="Industry" options={facets.industries} />
          <Select value={tier} onChange={(v) => setParam("tier", v)} label="Tier" options={facets.tiers} />
          <Select value={region} onChange={(v) => setParam("region", v)} label="Region" options={REGION_OPTIONS} />
          <RenewalSelect value={renewalWithin} onChange={(v) => setParam("renewal_within_days", v)} />
          {(industry || tier || region || renewalWithin || q) && (
            <button
              onClick={() => setParams(new URLSearchParams(), { replace: true })}
              className="text-xs text-beroe-blue hover:underline"
            >
              Clear filters
            </button>
          )}
          <button
            onClick={() => downloadCsv(params)}
            className="ml-auto text-xs px-3 py-2 rounded-lg border border-slate-200 text-text-secondary hover:bg-slate-50"
            title="Export the current filtered list as CSV"
          >
            ⬇ Export CSV
          </button>
        </div>

        {/* Bulk action bar */}
        {selected.size > 0 && canBulkReassign && (
          <div className="mb-3 flex items-center gap-3 px-4 py-2 rounded-lg bg-beroe-blue/5 border border-beroe-blue/30">
            <span className="text-xs font-semibold text-beroe-blue">
              {selected.size} selected
            </span>
            <button
              onClick={() => setBulkOpen(true)}
              className="text-xs px-3 py-1.5 rounded-md bg-beroe-blue text-white font-semibold"
            >
              Reassign owner
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="text-xs text-text-muted hover:text-text-secondary ml-auto"
            >
              Clear selection
            </button>
          </div>
        )}

        {/* States */}
        {isError && (
          <ErrorBanner message={(error as Error)?.message || "Failed to load accounts"} />
        )}
        {isLoading && <SkeletonRows />}
        {!isLoading && data && data.items.length === 0 && (
          <EmptyState hasFilters={!!(q || industry || tier || region)} />
        )}

        {/* Table */}
        {!isLoading && data && data.items.length > 0 && (
          <div className="bg-white rounded-card border border-beroe-card-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-beroe-bg text-text-muted text-[11px] uppercase tracking-wider">
                  <tr>
                    {canBulkReassign && (
                      <th className="px-4 py-2.5 w-8">
                        <input
                          type="checkbox"
                          checked={data.items.length > 0 && data.items.every((i) => selected.has(i.id))}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelected(new Set(data.items.map((i) => i.id)));
                            } else {
                              setSelected(new Set());
                            }
                          }}
                          aria-label="Select all on this page"
                        />
                      </th>
                    )}
                    <Th>Account</Th>
                    {SORT_KEYS.slice(1).map((k) => (
                      <Th
                        key={k.key}
                        sortable
                        active={sort === k.key}
                        dir={sort === k.key ? sortDir : undefined}
                        onClick={() => setSort(k.key)}
                      >
                        {k.label}
                      </Th>
                    ))}
                    <Th>CSM</Th>
                    <Th>Industry / Country</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((it) => (
                    <Row
                      key={it.id}
                      item={it}
                      isAdmin={isAdmin}
                      selectable={canBulkReassign}
                      checked={selected.has(it.id)}
                      onToggleSelected={() =>
                        setSelected((s) => {
                          const n = new Set(s);
                          if (n.has(it.id)) n.delete(it.id);
                          else n.add(it.id);
                          return n;
                        })
                      }
                      onOpen={() => navigate(`/accounts/${it.id}`)}
                      onReassign={() => setReassignTarget(it)}
                      pinned={fav.isFavorite(it.id)}
                      onTogglePinned={() =>
                        fav.toggle({ id: it.id, name: it.name, slug: it.slug })
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Pagination + page size */}
        {data && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-text-secondary">
            <div className="flex items-center gap-3">
              <span>
                Page <b>{data.page}</b> of {Math.max(1, Math.ceil(data.total / pageSize))} · {data.total} total
              </span>
              <label className="text-xs text-text-muted flex items-center gap-1.5">
                Rows per page
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setParam("page_size", e.target.value);
                    setParam("page", "1");
                  }}
                  className="px-2 py-1 rounded-md border border-slate-200 text-sm bg-white"
                >
                  {[25, 50, 100].map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex gap-1">
              <button
                onClick={() => setParam("page", String(Math.max(1, page - 1)))}
                disabled={page <= 1}
                className="px-3 py-1.5 rounded-md border border-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ← Prev
              </button>
              <button
                onClick={() => setParam("page", String(page + 1))}
                disabled={page * pageSize >= data.total}
                className="px-3 py-1.5 rounded-md border border-slate-200 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next →
              </button>
            </div>
          </div>
        )}

        {reassignTarget && (
          <ReassignOwnerModal
            account={reassignTarget}
            onClose={() => setReassignTarget(null)}
          />
        )}

        {bulkOpen && canBulkReassign && (
          <BulkReassignModal
            ids={[...selected]}
            onClose={() => setBulkOpen(false)}
            onDone={() => {
              setBulkOpen(false);
              setSelected(new Set());
              // Refetch
              window.dispatchEvent(new Event("focus"));
            }}
          />
        )}

        {createOpen && canCreateAccount && (
          <CreateAccountModal
            onClose={() => setCreateOpen(false)}
            onCreated={(newId) => {
              setCreateOpen(false);
              navigate(`/accounts/${newId}/overview`);
            }}
          />
        )}
      </div>
    </AppShell>
  );
}

// ---------- Sub-components ----------

function Th({
  children,
  sortable,
  active,
  dir,
  onClick,
}: {
  children: React.ReactNode;
  sortable?: boolean;
  active?: boolean;
  dir?: "asc" | "desc";
  onClick?: () => void;
}) {
  return (
    <th
      className={cn(
        "text-left px-4 py-2.5 font-bold whitespace-nowrap",
        sortable && "cursor-pointer hover:text-text-primary",
        active && "text-beroe-blue",
      )}
      onClick={onClick}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {sortable && active && <span>{dir === "asc" ? "↑" : "↓"}</span>}
      </span>
    </th>
  );
}

function Row({
  item,
  isAdmin,
  selectable,
  checked,
  onToggleSelected,
  onOpen,
  onReassign,
  pinned,
  onTogglePinned,
}: {
  item: AccountListItem;
  isAdmin: boolean;
  selectable: boolean;
  checked: boolean;
  onToggleSelected: () => void;
  onOpen: () => void;
  onReassign: () => void;
  pinned: boolean;
  onTogglePinned: () => void;
}) {
  const renewal = formatRenewalDays(item.days_to_renewal);
  const health = healthBucket(item.health_score);
  return (
    <tr
      className="border-t border-beroe-card-border/60 hover:bg-slate-50 cursor-pointer"
      onClick={onOpen}
    >
      {selectable && (
        <td className="px-4 py-3 w-8" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggleSelected}
            aria-label={`Select ${item.name}`}
          />
        </td>
      )}
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <StarButton pinned={pinned} onToggle={onTogglePinned} />
          <div className="w-8 h-8 rounded-md bg-beroe-blue/10 border border-beroe-blue/30 flex items-center justify-center text-[10px] font-extrabold text-beroe-blue">
            {initials(item.name)}
          </div>
          <div>
            <div className="font-semibold text-text-primary flex items-center gap-2">
              <span className="hover:text-beroe-blue">{item.name}</span>
              {!item.is_editable && (
                <span className="text-[10px] text-text-muted">(read-only)</span>
              )}
              {isAdmin && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onReassign();
                  }}
                  className="text-[10px] text-beroe-blue hover:underline font-semibold"
                  title="Reassign owner (admin)"
                >
                  Reassign
                </button>
              )}
            </div>
            <div className="text-[11px] text-text-muted">
              {item.tier ?? "—"} · {item.account_type ?? "—"}
            </div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="font-semibold">{formatACV(item.current_acv)}</div>
        <div className="text-[11px] text-text-muted">target {formatACV(item.target_acv)}</div>
      </td>
      <td className="px-4 py-3">
        <Pill tone={renewal.tone}>{renewal.label}</Pill>
        <div className="text-[11px] text-text-muted mt-0.5">
          {item.renewal_date ?? "—"}
        </div>
      </td>
      <td className="px-4 py-3">
        <Pill tone={health.tone}>
          {health.label}
          {item.health_score !== null && ` · ${item.health_score}`}
        </Pill>
      </td>
      <td className="px-4 py-3 text-text-secondary text-[12px]">
        {formatRelativeDate(item.last_activity_at)}
      </td>
      <td className="px-4 py-3 text-text-secondary text-[12px]">
        {item.csm_full_name ?? "—"}
      </td>
      <td className="px-4 py-3 text-text-secondary text-[12px]">
        <div>{item.industry ?? "—"}</div>
        <div className="text-[11px] text-text-muted">{item.country ?? "—"}</div>
      </td>
    </tr>
  );
}

function Select({
  value,
  onChange,
  label,
  options,
}: {
  value: string;
  onChange: (v: string | null) => void;
  label: string;
  options: string[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value || null)}
      className="px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white text-text-secondary focus:outline-none focus:border-beroe-blue"
    >
      <option value="">{label} (all)</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

function Pill({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "danger" | "muted";
  children: React.ReactNode;
}) {
  const cls = {
    ok: "bg-green-50 text-green-700 border-green-200",
    warn: "bg-amber-50 text-amber-700 border-amber-200",
    danger: "bg-red-50 text-red-700 border-red-200",
    muted: "bg-slate-50 text-slate-500 border-slate-200",
  }[tone];
  return (
    <span className={cn("inline-block px-2.5 py-0.5 rounded-full border text-[11px] font-semibold", cls)}>
      {children}
    </span>
  );
}

function SkeletonRows() {
  return (
    <div className="bg-white rounded-card border border-beroe-card-border overflow-hidden">
      {[0, 1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="h-14 border-t border-beroe-card-border/60 first:border-t-0 px-4 flex items-center"
        >
          <div className="h-5 w-48 bg-slate-100 rounded animate-pulse" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="bg-white rounded-card border border-beroe-card-border p-10 text-center">
      <div className="text-3xl mb-2">📭</div>
      <div className="font-bold text-text-primary mb-1">
        {hasFilters ? "No accounts match these filters" : "No accounts assigned"}
      </div>
      <div className="text-sm text-text-secondary">
        {hasFilters
          ? "Try clearing a filter or adjusting your search."
          : "Contact your CS Director to assign accounts to you."}
      </div>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-3 text-sm text-red-800">
      <b>Error</b> — {message}
    </div>
  );
}

// ---------- Tiny debounce hook ----------

import { useEffect } from "react";
function useMemoizedDebounce<T>(value: T, ms: number, cb: (v: T) => void) {
  useEffect(() => {
    const id = window.setTimeout(() => cb(value), ms);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, ms]);
}

// ---------- Renewal-window dropdown (BRD table 4) ----------

const RENEWAL_OPTIONS: { value: string; label: string }[] = [
  { value: "30", label: "Renewing ≤ 30d" },
  { value: "60", label: "Renewing ≤ 60d" },
  { value: "90", label: "Renewing ≤ 90d" },
  { value: "180", label: "Renewing ≤ 180d" },
];

function RenewalSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string | null) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value || null)}
      className="px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white text-text-secondary focus:outline-none focus:border-beroe-blue"
      title="Filter by renewal window"
    >
      <option value="">Renewal window (all)</option>
      {RENEWAL_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ---------- CSV download ----------

async function downloadCsv(params: URLSearchParams): Promise<void> {
  const { authProvider } = await import("@/lib/auth");
  const access = await authProvider.getAccessToken();
  // Strip pagination + sort — export should reflect filters, not page slice.
  const exportParams = new URLSearchParams();
  for (const k of ["q", "industry", "tier", "region", "category", "csm_user_id", "renewal_within_days"]) {
    const v = params.get(k);
    if (v) exportParams.set(k, v);
  }
  const url =
    `${import.meta.env.VITE_API_BASE_URL}/api/v1/accounts/export.csv` +
    (exportParams.toString() ? `?${exportParams.toString()}` : "");
  const r = await fetch(url, {
    headers: access ? { Authorization: `Bearer ${access}` } : {},
  });
  if (!r.ok) {
    alert(`Export failed (${r.status})`);
    return;
  }
  const blob = await r.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `accounts-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

// ---------- Bulk reassign modal ----------

interface UserOpt { id: string; full_name: string | null; email: string; role: string }

function BulkReassignModal({
  ids,
  onClose,
  onDone,
}: {
  ids: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [users, setUsers] = useState<UserOpt[] | null>(null);
  const [target, setTarget] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get<UserOpt[]>("/api/v1/users")
      .then((rows) => setUsers(rows.filter((u) => u.role === "csm" || u.role === "cs_team_manager")))
      .catch((e: Error) => setError(e.message));
  }, []);

  async function submit() {
    if (!target) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await api.post<{ updated: number }>("/api/v1/accounts/bulk/reassign-owner", {
        account_ids: ids,
        csm_user_id: target,
      });
      alert(`Reassigned ${r.updated} account${r.updated === 1 ? "" : "s"}.`);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bulk reassign failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6" data-testid="bulk-reassign-modal">
        <h3 className="text-base font-bold text-text-primary mb-2">
          Reassign {ids.length} account{ids.length === 1 ? "" : "s"}
        </h3>
        <p className="text-xs text-text-muted mb-4">
          Pick the new CSM. Only CSM and CS Team Manager roles can own accounts.
        </p>
        {users === null ? (
          <div className="text-sm text-text-muted">Loading users…</div>
        ) : (
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-beroe-blue"
          >
            <option value="">— Select target —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name ?? u.email} · {u.role}
              </option>
            ))}
          </select>
        )}
        {error && (
          <div className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-sm border border-slate-200 text-text-secondary"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!target || submitting}
            className="px-4 py-1.5 rounded-lg bg-beroe-blue text-white text-sm font-semibold disabled:opacity-50"
          >
            {submitting ? "Reassigning…" : "Reassign"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Create-account modal (M9) ----------

interface CreateAccountForm {
  name: string;
  industry: string;
  country: string;
  region: string;
  csm_user_id: string;
  co_user_id: string;
  category: string;
  tier: string;
  account_type: string;
  segment: string;
  current_acv: string;
  target_acv: string;
  contract_start: string;
  contract_end: string;
  renewal_date: string;
  health_score: string;
}

const TIER_OPTIONS = ["Strategic", "Enterprise", "Growth", "Emerging"];
const REGION_OPTIONS = [
  "North America",
  "Europe",
  "APAC",
  "MEA",
  "Rest of the World",
  "LATAM",
];
const ACCOUNT_TYPE_OPTIONS = ["New Logo", "Existing", "Renewal", "Pilot"];

function CreateAccountModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [users, setUsers] = useState<UserOpt[] | null>(null);
  const [showMore, setShowMore] = useState(false);
  const [form, setForm] = useState<CreateAccountForm>({
    name: "", industry: "", country: "", region: "", csm_user_id: "", co_user_id: "",
    category: "", tier: "", account_type: "", segment: "",
    current_acv: "", target_acv: "",
    contract_start: "", contract_end: "", renewal_date: "", health_score: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.get<UserOpt[]>("/api/v1/users")
      .then((rows) => setUsers(rows.filter((u) => !u.email.includes("deleted"))))
      .catch((e: Error) => setError(e.message));
  }, []);

  const csmCandidates = (users ?? []).filter(
    (u) => u.role === "csm" || u.role === "cs_team_manager",
  );
  const coCandidates = (users ?? []).filter((u) => u.role === "commercial_owner");

  async function submit() {
    setError(null);
    if (form.name.trim().length < 2) return setError("Name must be at least 2 characters.");
    if (!form.csm_user_id) return setError("Pick a CSM owner.");
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        csm_user_id: form.csm_user_id,
      };
      const optStr = (k: keyof CreateAccountForm) =>
        form[k] && (body[k] = (form[k] as string).trim());
      optStr("industry"); optStr("country"); optStr("region");
      optStr("category"); optStr("tier"); optStr("account_type"); optStr("segment");
      if (form.co_user_id) body.co_user_id = form.co_user_id;
      if (form.current_acv) body.current_acv = form.current_acv;
      if (form.target_acv) body.target_acv = form.target_acv;
      if (form.contract_start) body.contract_start = form.contract_start;
      if (form.contract_end) body.contract_end = form.contract_end;
      if (form.renewal_date) body.renewal_date = form.renewal_date;
      if (form.health_score) body.health_score = parseInt(form.health_score, 10);

      const created = await api.post<AccountListItem>("/api/v1/accounts", body);
      onCreated(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl p-6 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-base font-bold text-text-primary">New account</h3>
            <p className="text-xs text-text-muted">
              We'll drop you on the Overview tab so you can fill in engagement, contacts, and documents.
            </p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-xl leading-none">×</button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <ModalField label="Name *" full>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              autoFocus
              minLength={2}
              className={modalInputCls}
              placeholder="e.g. Acme Pharmaceuticals"
            />
          </ModalField>

          <ModalField label="Industry">
            <input
              type="text"
              value={form.industry}
              onChange={(e) => setForm({ ...form, industry: e.target.value })}
              className={modalInputCls}
              placeholder="Pharma, CPG, …"
            />
          </ModalField>
          <ModalField label="Country">
            <input
              type="text"
              value={form.country}
              onChange={(e) => setForm({ ...form, country: e.target.value })}
              className={modalInputCls}
              placeholder="Denmark, India, …"
            />
          </ModalField>

          <ModalField label="Region">
            <select
              value={form.region}
              onChange={(e) => setForm({ ...form, region: e.target.value })}
              className={modalInputCls}
            >
              <option value="">— Select —</option>
              {REGION_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </ModalField>
          <ModalField label="Tier">
            <select
              value={form.tier}
              onChange={(e) => setForm({ ...form, tier: e.target.value })}
              className={modalInputCls}
            >
              <option value="">— Select —</option>
              {TIER_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </ModalField>

          <ModalField label="CSM owner *" full>
            {users === null ? (
              <div className="text-xs text-text-muted">Loading users…</div>
            ) : csmCandidates.length === 0 ? (
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                No CSM users exist yet. Invite a CSM from the Admin → Users page first.
              </div>
            ) : (
              <select
                value={form.csm_user_id}
                onChange={(e) => setForm({ ...form, csm_user_id: e.target.value })}
                className={modalInputCls}
              >
                <option value="">— Pick a CSM —</option>
                {csmCandidates.map((u) => (
                  <option key={u.id} value={u.id}>{u.full_name ?? u.email} · {u.role}</option>
                ))}
              </select>
            )}
          </ModalField>

          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            className="col-span-2 text-xs text-beroe-blue font-semibold underline justify-self-start"
          >
            {showMore ? "Hide more details" : "Add more details (commercials, dates)"}
          </button>

          {showMore && (
            <>
              <ModalField label="Account type">
                <select
                  value={form.account_type}
                  onChange={(e) => setForm({ ...form, account_type: e.target.value })}
                  className={modalInputCls}
                >
                  <option value="">— Select —</option>
                  {ACCOUNT_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </ModalField>
              <ModalField label="Segment">
                <input
                  type="text"
                  value={form.segment}
                  onChange={(e) => setForm({ ...form, segment: e.target.value })}
                  className={modalInputCls}
                />
              </ModalField>

              <ModalField label="Category">
                <input
                  type="text"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  className={modalInputCls}
                />
              </ModalField>
              <ModalField label="Commercial Owner">
                <select
                  value={form.co_user_id}
                  onChange={(e) => setForm({ ...form, co_user_id: e.target.value })}
                  className={modalInputCls}
                >
                  <option value="">— None —</option>
                  {coCandidates.map((u) => (
                    <option key={u.id} value={u.id}>{u.full_name ?? u.email}</option>
                  ))}
                </select>
              </ModalField>

              <ModalField label="Current ACV ($)">
                <input
                  type="number"
                  step="1000"
                  min={0}
                  value={form.current_acv}
                  onChange={(e) =>
                    setForm({ ...form, current_acv: e.target.value.replace(/^-/, "") })
                  }
                  className={modalInputCls}
                />
              </ModalField>
              <ModalField label="Target ACV ($)">
                <input
                  type="number"
                  step="1000"
                  min={0}
                  value={form.target_acv}
                  onChange={(e) =>
                    setForm({ ...form, target_acv: e.target.value.replace(/^-/, "") })
                  }
                  className={modalInputCls}
                />
              </ModalField>

              <ModalField label="Contract start">
                <input
                  type="date"
                  value={form.contract_start}
                  onChange={(e) => setForm({ ...form, contract_start: e.target.value })}
                  className={modalInputCls}
                />
              </ModalField>
              <ModalField label="Contract end">
                <input
                  type="date"
                  value={form.contract_end}
                  onChange={(e) => setForm({ ...form, contract_end: e.target.value })}
                  className={modalInputCls}
                />
              </ModalField>
              <ModalField label="Renewal date">
                <input
                  type="date"
                  value={form.renewal_date}
                  onChange={(e) => setForm({ ...form, renewal_date: e.target.value })}
                  className={modalInputCls}
                />
              </ModalField>
              <ModalField label="Health score (0–100)">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={form.health_score}
                  onChange={(e) => {
                    // Clamp to [0, 100] so the UI matches the server schema
                    // (Pydantic ge=0/le=100 also rejects out-of-range).
                    const raw = e.target.value;
                    if (raw === "") return setForm({ ...form, health_score: "" });
                    const n = parseInt(raw, 10);
                    if (Number.isNaN(n)) return;
                    const clamped = Math.max(0, Math.min(100, n));
                    setForm({ ...form, health_score: String(clamped) });
                  }}
                  className={modalInputCls}
                />
              </ModalField>
            </>
          )}
        </div>

        {error && (
          <div className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-sm border border-slate-200 text-text-secondary"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="px-4 py-1.5 rounded-lg bg-beroe-blue text-white text-sm font-semibold disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create + open"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ModalField({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div className={full ? "col-span-2" : ""}>
      <label className="block text-[11px] uppercase tracking-wider text-text-muted font-bold mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}

const modalInputCls =
  "w-full px-3 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-beroe-blue";
