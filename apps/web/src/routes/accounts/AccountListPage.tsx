import { useMemo, useState } from "react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";

import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/components/AuthProvider";
import { ReassignOwnerModal } from "@/components/ReassignOwnerModal";
import { StarButton } from "@/components/StarButton";
import { api, ApiError } from "@/lib/api";
import { useFavoriteAccounts } from "@/lib/use-favorites";
import { cn } from "@/lib/utils";
import { useNotify } from "@/components/DialogProvider";
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
  const notify = useNotify();
  // Bug 7 — reassign-owner widened to admin / CS Director / VP CSM / VP Sales.
  const canReassign = !!me && [
    "admin",
    "cs_director",
    "vp_csm",
    "vp_sales",
  ].includes(me.user.role);
  // 08-Jun · Hard-delete is strictly admin (matches backend
  // can_delete_account predicate — even cs_director/vp_csm can't).
  const canDelete = me?.user.role === "admin";
  const fav = useFavoriteAccounts(me?.user.id);
  const [reassignTarget, setReassignTarget] = useState<AccountListItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AccountListItem | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);
  const qc = useQueryClient();

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
  const canBulkReassign = canReassign;

  // M9 — create account
  const canCreateAccount =
    me?.user.role === "admin" || me?.user.role === "cs_director" || me?.user.role === "vp_csm";
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

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
                onClick={() => setImportOpen(true)}
                className="px-3 py-1.5 rounded-lg border border-beroe-card-border bg-white text-sm font-semibold text-text-primary hover:bg-beroe-bg/60"
              >
                📥 Import accounts
              </button>
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
            className="flex-1 min-w-[220px] px-3 py-2 rounded-lg border border-beroe-card-border text-sm bg-white focus:outline-none focus:border-beroe-blue"
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
            onClick={() =>
              downloadCsv(params).catch((e: Error) =>
                notify({ title: "CSV export failed", body: e.message, tone: "error" }),
              )
            }
            className="ml-auto text-xs px-3 py-2 rounded-lg border border-beroe-card-border text-text-secondary hover:bg-beroe-bg"
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

        {/* M25 — renewal alerts banner */}
        {!isLoading && data && data.items.length > 0 && (
          <RenewalAlertsBanner
            items={data.items}
            onOpen={(slug) =>
              navigate(`/accounts/${data.items.find((i) => i.slug === slug)?.id}/overview`)
            }
          />
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
                    <Th>Industry / Sector · Country</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((it) => (
                    <Row
                      key={it.id}
                      item={it}
                      canReassign={canReassign}
                      canDelete={canDelete}
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
                      onDelete={() => {
                        setDeleteTarget(it);
                        setDeleteConfirm("");
                      }}
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
                  className="px-2 py-1 rounded-md border border-beroe-card-border text-sm bg-white"
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
                className="px-3 py-1.5 rounded-md border border-beroe-card-border disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ← Prev
              </button>
              <button
                onClick={() => setParam("page", String(page + 1))}
                disabled={page * pageSize >= data.total}
                className="px-3 py-1.5 rounded-md border border-beroe-card-border disabled:opacity-40 disabled:cursor-not-allowed"
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

        {deleteTarget && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-xl w-[min(520px,95vw)] p-5">
              <div className="text-[15px] font-bold text-beroe-red mb-2">
                ⚠ Permanently delete this account?
              </div>
              <div className="text-[12px] text-text-secondary mb-3">
                <b>{deleteTarget.name}</b> and every related row will be removed —
                engagement, contacts, documents (with their storage objects),
                goals, checkpoints, plays, signals, intel — all gone. This
                action cannot be undone.
              </div>
              <div className="text-[12px] text-text-secondary mb-2">
                Type the account slug{" "}
                <code className="font-mono font-semibold text-text-primary bg-beroe-bg px-1.5 py-0.5 rounded">
                  {deleteTarget.slug}
                </code>{" "}
                to confirm.
              </div>
              <input
                type="text"
                autoFocus
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                placeholder={deleteTarget.slug}
                className="w-full px-3 py-2 border border-beroe-card-border rounded-md text-sm font-mono mb-3 focus:outline-none focus:border-beroe-red"
              />
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setDeleteTarget(null);
                    setDeleteConfirm("");
                  }}
                  disabled={deleting}
                  className="px-3 py-1.5 rounded-md border border-beroe-card-border text-sm bg-white disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={deleteConfirm !== deleteTarget.slug || deleting}
                  onClick={async () => {
                    if (deleteConfirm !== deleteTarget.slug) return;
                    setDeleting(true);
                    try {
                      await api.delete(
                        `/api/v1/accounts/${deleteTarget.id}?confirm=${encodeURIComponent(deleteTarget.slug)}`,
                      );
                      notify({
                        title: "Account deleted",
                        body: `${deleteTarget.name} and all related data removed.`,
                        tone: "success",
                      });
                      qc.invalidateQueries({ queryKey: ["accounts"] });
                      setDeleteTarget(null);
                      setDeleteConfirm("");
                    } catch (e) {
                      const msg =
                        e instanceof Error ? e.message : "Delete failed.";
                      notify({ title: "Delete failed", body: msg, tone: "error" });
                    } finally {
                      setDeleting(false);
                    }
                  }}
                  className="px-3 py-1.5 rounded-md bg-beroe-red text-white text-sm font-semibold disabled:opacity-50"
                >
                  {deleting ? "Deleting…" : "Delete forever"}
                </button>
              </div>
            </div>
          </div>
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
        {importOpen && canCreateAccount && (
          <ImportAccountsModal
            onClose={() => setImportOpen(false)}
            onImported={() => {
              setImportOpen(false);
              qc.invalidateQueries({ queryKey: ["accounts"] });
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
  canReassign,
  canDelete,
  selectable,
  checked,
  onToggleSelected,
  onOpen,
  onReassign,
  onDelete,
  pinned,
  onTogglePinned,
}: {
  item: AccountListItem;
  canReassign: boolean;
  canDelete: boolean;
  selectable: boolean;
  checked: boolean;
  onToggleSelected: () => void;
  onOpen: () => void;
  onReassign: () => void;
  onDelete: () => void;
  pinned: boolean;
  onTogglePinned: () => void;
}) {
  const renewal = formatRenewalDays(item.days_to_renewal);
  const health = healthBucket(item.health_score);
  return (
    <tr
      className="border-t border-beroe-card-border/60 hover:bg-beroe-bg cursor-pointer"
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
              {canReassign && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onReassign();
                  }}
                  className="text-[10px] text-beroe-blue hover:underline font-semibold"
                  title="Reassign owner (admin / CS Director / VPs)"
                >
                  Reassign
                </button>
              )}
              {canDelete && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                  }}
                  className="text-[10px] text-beroe-red hover:underline font-semibold"
                  title="Hard-delete account (admin only) — removes the row + all related data + storage"
                >
                  Delete
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
        <RollupBadges item={item} />
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
        <div className="flex items-center gap-1.5">
          {item.renewal_risk && (
            <span
              title={`Renewal Risk · ${item.renewal_risk}`}
              className="inline-block w-2 h-2 rounded-full flex-shrink-0"
              style={{
                background:
                  item.renewal_risk === "Low"
                    ? "#6EC457"
                    : item.renewal_risk === "Medium"
                      ? "#F0BC41"
                      : "#CF4548",
              }}
            />
          )}
          <span className="truncate">{item.industry ?? "—"}</span>
          {item.sector && (
            <span className="text-[10px] text-text-muted">· {item.sector}</span>
          )}
        </div>
        <div className="text-[11px] text-text-muted flex items-center gap-1.5">
          <span>{item.country ?? "—"}</span>
          {item.revenue_bucket && (
            <span
              className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide"
              style={{ background: "#f3f0ff", color: "#4A00F8" }}
            >
              {item.revenue_bucket}
            </span>
          )}
          {item.is_fortune_500 && (
            <span
              className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide"
              style={{ background: "#FFE61E30", color: "#854F0B" }}
              title="Fortune 500"
            >
              F500
            </span>
          )}
        </div>
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
      className="px-3 py-2 rounded-lg border border-beroe-card-border text-sm bg-white text-text-secondary focus:outline-none focus:border-beroe-blue"
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

// M25 — portfolio rollups rendered as inline badges under the Renewal cell.
function RollupBadges({ item }: { item: AccountListItem }) {
  const align =
    item.alignment_status === "green"
      ? { dot: "bg-beroe-green/150", title: `${item.goal_count} goal(s) aligned` }
      : item.alignment_status === "amber"
        ? {
            dot: "bg-beroe-amber/150",
            title: `${item.goal_count} goal(s) — partial alignment`,
          }
        : item.alignment_status === "red"
          ? {
              dot: "bg-beroe-red/100",
              title: `${item.goal_count} goal(s) — not started`,
            }
          : null;
  const cp = item.next_checkpoint_type
    ? (() => {
        const d = item.next_checkpoint_days_until;
        const tone =
          d !== null && d < 0
            ? "bg-beroe-red/10 text-beroe-red border-beroe-red/30"
            : d !== null && d <= 7
              ? "bg-beroe-amber/15 text-beroe-amber border-beroe-amber/40"
              : "bg-beroe-bg text-text-secondary border-beroe-card-border";
        const label =
          d !== null && d < 0
            ? `${item.next_checkpoint_type} ${Math.abs(d)}d overdue`
            : d !== null
              ? `${item.next_checkpoint_type} in ${d}d`
              : item.next_checkpoint_type;
        return { tone, label };
      })()
    : null;
  const outcomeTone: Record<string, string> = {
    renewed: "bg-beroe-green/15 text-beroe-green border-beroe-green/30",
    at_risk: "bg-beroe-amber/15 text-beroe-amber border-beroe-amber/40",
    not_renewed: "bg-beroe-red/10 text-beroe-red border-beroe-red/30",
    undecided: "bg-beroe-bg text-text-secondary border-beroe-card-border",
  };
  const outcomeLabel: Record<string, string> = {
    renewed: "Renewed",
    at_risk: "At risk",
    not_renewed: "Not renewed",
    undecided: "Undecided",
  };

  if (!align && !cp && !item.dr_outcome) return null;
  return (
    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
      {align && (
        <span
          className={cn("inline-block w-2 h-2 rounded-full", align.dot)}
          title={align.title}
        />
      )}
      {cp && (
        <span
          className={cn(
            "text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap",
            cp.tone,
          )}
        >
          {cp.label}
        </span>
      )}
      {item.dr_outcome && (
        <span
          className={cn(
            "text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap font-semibold",
            outcomeTone[item.dr_outcome],
          )}
        >
          {outcomeLabel[item.dr_outcome]}
        </span>
      )}
    </div>
  );
}

// M25 — top-of-list banner. Lists every account with a renewal in the
// next 60 days (T-60 amber, T-7 red). Clicking jumps to that account.
function RenewalAlertsBanner({
  items,
  onOpen,
}: {
  items: AccountListItem[];
  onOpen: (slug: string) => void;
}) {
  const targets = items
    .filter(
      (i) =>
        i.days_to_renewal !== null &&
        i.days_to_renewal >= 0 &&
        i.days_to_renewal <= 60,
    )
    .sort((a, b) => (a.days_to_renewal ?? 0) - (b.days_to_renewal ?? 0));
  if (targets.length === 0) return null;
  return (
    <div className="bg-beroe-amber/15 border border-beroe-amber/40 rounded-card px-4 py-2.5 mb-3 flex items-start gap-3">
      <span className="text-beroe-amber font-bold">⏰</span>
      <div className="flex-1 text-[12px]">
        <div className="font-semibold text-beroe-amber">
          {targets.length} renewal{targets.length === 1 ? "" : "s"} within 60 days
        </div>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {targets.slice(0, 10).map((t) => {
            const d = t.days_to_renewal ?? 0;
            const tone =
              d <= 7
                ? "bg-beroe-red/15 text-beroe-red border-beroe-red/30"
                : d <= 30
                  ? "bg-beroe-amber/20 text-beroe-amber border-beroe-amber/50"
                  : "bg-white text-beroe-amber border-beroe-amber/40";
            return (
              <button
                key={t.id}
                onClick={() => onOpen(t.slug)}
                className={cn(
                  "text-[11px] px-2 py-0.5 rounded border hover:underline font-medium",
                  tone,
                )}
                title={`Renews ${t.renewal_date ?? "—"}`}
              >
                {t.name} · T-{d}d
              </button>
            );
          })}
          {targets.length > 10 && (
            <span className="text-[11px] text-beroe-amber">
              + {targets.length - 10} more
            </span>
          )}
        </div>
      </div>
    </div>
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
    ok: "bg-beroe-green/15 text-beroe-green border-beroe-green/30",
    warn: "bg-beroe-amber/15 text-beroe-amber border-beroe-amber/40",
    danger: "bg-beroe-red/10 text-beroe-red border-beroe-red/30",
    muted: "bg-beroe-bg text-text-muted border-beroe-card-border",
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
          <div className="h-5 w-48 bg-beroe-bg rounded animate-pulse" />
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
    <div className="bg-beroe-red/10 border border-beroe-red/30 rounded-lg px-4 py-3 mb-3 text-sm text-beroe-red">
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
      className="px-3 py-2 rounded-lg border border-beroe-card-border text-sm bg-white text-text-secondary focus:outline-none focus:border-beroe-blue"
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
    throw new Error(`Export failed (HTTP ${r.status})`);
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
  const notify = useNotify();
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
      notify({
        title: `Reassigned ${r.updated} account${r.updated === 1 ? "" : "s"}`,
        tone: "success",
      });
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
            className="w-full px-3 py-2 rounded-lg border border-beroe-card-border text-sm focus:outline-none focus:border-beroe-blue"
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
          <div className="mt-3 text-xs text-beroe-red bg-beroe-red/10 border border-beroe-red/30 rounded-lg px-3 py-2">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-sm border border-beroe-card-border text-text-secondary"
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

// 03-Jun bug — Add Account form simplified per stakeholder spec:
// removed Segment / Category / Health; new dropdowns for Industry /
// Country / Tier / Account Type / Commercial Owner / CSM Owner.
// All dropdowns use SearchablePicker (same UX as Currency / Spend Pool
// pickers on Pre-Sales).
import {
  INDUSTRY_OPTIONS,
  COUNTRY_OPTIONS,
  TIER_OPTIONS as NEW_TIER_OPTIONS,
  ACCOUNT_TYPE_OPTIONS as NEW_ACCOUNT_TYPE_OPTIONS,
  // 04-Jun bug — CSM_OWNER_OPTIONS + COMMERCIAL_OWNER_OPTIONS no longer
  // used inside the create-account modal (both fields removed).
} from "@/types/account_options";
import { SearchablePicker } from "@/components/SearchablePicker";

interface CreateAccountForm {
  name: string;
  industry: string;
  country: string;
  region: string;
  // 12-Jun · Sector, Commercial Owner, CSM brought back into the
  // always-visible top section per stakeholder ask. Stored as free text
  // (matching the bulk-import behaviour); the FK csm_user_id /
  // co_user_id stays empty until the named staff are invited as
  // real users.
  sector: string;
  csm_owner_name: string;
  commercial_owner_name: string;
  tier: string;
  account_type: string;
  // 12-Jun · Real-data fields surfaced under "Add more details".
  revenue_bucket: string;
  procurement_maturity: string;  // Low | Medium | High
  genai_adoption: string;        // Low | Medium | High
  current_acv: string;
  target_acv: string;
  contract_start: string;
  contract_end: string;
  renewal_date: string;
}

const REGION_OPTIONS = [
  "North America",
  "Europe",
  "APAC",
  "MEA",
  "Rest of the World",
  "LATAM",
];

function CreateAccountModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [showMore, setShowMore] = useState(false);
  const [form, setForm] = useState<CreateAccountForm>({
    name: "", industry: "", country: "", region: "",
    sector: "",
    csm_owner_name: "", commercial_owner_name: "",
    tier: "", account_type: "",
    revenue_bucket: "", procurement_maturity: "", genai_adoption: "",
    current_acv: "", target_acv: "",
    contract_start: "", contract_end: "", renewal_date: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    setError(null);
    if (form.name.trim().length < 2) return setError("Name must be at least 2 characters.");
    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
      };
      const optStr = (k: keyof CreateAccountForm) =>
        form[k] && (body[k] = (form[k] as string).trim());
      optStr("industry"); optStr("country"); optStr("region");
      optStr("tier"); optStr("account_type");
      // 12-Jun · Sector, Commercial Owner, CSM brought back into the
      // create-account body. Free-text matches the bulk-import shape.
      optStr("sector");
      optStr("commercial_owner_name");
      optStr("csm_owner_name");
      // 12-Jun · Real-data fields under Add more details.
      optStr("revenue_bucket");
      optStr("procurement_maturity");
      optStr("genai_adoption");
      if (form.current_acv) body.current_acv = form.current_acv;
      if (form.target_acv) body.target_acv = form.target_acv;
      if (form.contract_start) body.contract_start = form.contract_start;
      if (form.contract_end) body.contract_end = form.contract_end;

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
            <SearchablePicker
              value={form.industry}
              options={INDUSTRY_OPTIONS}
              placeholder="Select industry"
              onChange={(v) => setForm({ ...form, industry: v })}
              testId="add-account-industry"
            />
          </ModalField>
          {/* 04-Jun bug — Region comes BEFORE Country (stakeholder spec). */}
          <ModalField label="Region">
            <SearchablePicker
              value={form.region}
              options={REGION_OPTIONS}
              placeholder="Select region"
              onChange={(v) => setForm({ ...form, region: v })}
              testId="add-account-region"
            />
          </ModalField>
          {/* 12-Jun · Label updated from "Country" to "Country / Headquarters".
              Beroe data team confirmed billing-country IS the headquarters
              for every imported account; one input populates both intents. */}
          <ModalField label="Country / Headquarters">
            <SearchablePicker
              value={form.country}
              options={COUNTRY_OPTIONS}
              placeholder="Select country"
              pinned={["United States", "United Kingdom", "India", "Germany", "Singapore", "Australia"]}
              onChange={(v) => setForm({ ...form, country: v })}
              testId="add-account-country"
            />
          </ModalField>

          {/* 12-Jun · Sector (always-visible). Distinct from Industry —
              e.g. Industry=Pharmaceuticals · Sector=Health Care. Free text
              so any sector taxonomy works. */}
          <ModalField label="Sector">
            <input
              type="text"
              value={form.sector}
              onChange={(e) => setForm({ ...form, sector: e.target.value })}
              placeholder="e.g. Health Care, Industrials, Energy"
              className={modalInputCls}
            />
          </ModalField>

          <ModalField label="Tier" full>
            <SearchablePicker
              value={form.tier}
              options={NEW_TIER_OPTIONS}
              placeholder="Select tier"
              onChange={(v) => setForm({ ...form, tier: v })}
              testId="add-account-tier"
            />
          </ModalField>

          {/* 12-Jun · Commercial Owner + CSM brought back into the
              always-visible section as free-text inputs (per stakeholder
              ask). Matches the bulk-import shape — the named staff can
              be invited later and have FKs back-filled. */}
          <ModalField label="Commercial Owner">
            <input
              type="text"
              value={form.commercial_owner_name}
              onChange={(e) =>
                setForm({ ...form, commercial_owner_name: e.target.value })
              }
              placeholder="e.g. Norman"
              className={modalInputCls}
            />
          </ModalField>
          <ModalField label="CSM">
            <input
              type="text"
              value={form.csm_owner_name}
              onChange={(e) =>
                setForm({ ...form, csm_owner_name: e.target.value })
              }
              placeholder="e.g. Suchismita Dhal"
              className={modalInputCls}
            />
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
                <SearchablePicker
                  value={form.account_type}
                  options={NEW_ACCOUNT_TYPE_OPTIONS}
                  placeholder="Select type"
                  onChange={(v) => setForm({ ...form, account_type: v })}
                  testId="add-account-type"
                />
              </ModalField>

              {/* 12-Jun · Revenue bucket — same set the bulk-import sheet
                  uses (Below 1B / 1B-3B / 3B-10B / 10B-25B / 25B-50B / Above 50B). */}
              <ModalField label="Revenue Bucket">
                <select
                  value={form.revenue_bucket}
                  onChange={(e) =>
                    setForm({ ...form, revenue_bucket: e.target.value })
                  }
                  className={modalInputCls}
                >
                  <option value="">— select —</option>
                  <option value="Below 1B">Below 1B</option>
                  <option value="1B-3B">1B – 3B</option>
                  <option value="3B-10B">3B – 10B</option>
                  <option value="10B-25B">10B – 25B</option>
                  <option value="25B-50B">25B – 50B</option>
                  <option value="Above 50B">Above 50B</option>
                </select>
              </ModalField>

              {/* 12-Jun · Low / Medium / High enums constrained by
                  migration 0075 CHECK constraints on procurement_maturity
                  and genai_adoption columns. */}
              <ModalField label="Procurement Maturity">
                <select
                  value={form.procurement_maturity}
                  onChange={(e) =>
                    setForm({ ...form, procurement_maturity: e.target.value })
                  }
                  className={modalInputCls}
                >
                  <option value="">— select —</option>
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                </select>
              </ModalField>

              <ModalField label="GenAI Adoption">
                <select
                  value={form.genai_adoption}
                  onChange={(e) =>
                    setForm({ ...form, genai_adoption: e.target.value })
                  }
                  className={modalInputCls}
                >
                  <option value="">— select —</option>
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
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
              {/* 04-Jun bug — Renewal date field removed from the create
                  modal. It auto-derives from signed_date + term once the
                  account is signed on Sales Hand-off. */}
              {/* 03-Jun bug — Health score / Segment / Category fields
                  removed from the Add Account modal per stakeholder spec. */}
            </>
          )}
        </div>

        {error && (
          <div className="mt-3 text-xs text-beroe-red bg-beroe-red/10 border border-beroe-red/30 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-sm border border-beroe-card-border text-text-secondary"
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
  "w-full px-3 py-1.5 rounded-lg border border-beroe-card-border text-sm focus:outline-none focus:border-beroe-blue";


// ============================================================
// Import Accounts modal (bulk XLSX upload — migration 0075)
// ============================================================

type ImportPreviewRow = {
  row: number;
  name: string | null;
  errors: string[];
  products_purchased: number;
  products_unknown: number;
};
type ImportPreview = {
  parsed: number;
  preview: ImportPreviewRow[];
};
type ImportFinalRow = {
  row: number;
  name: string;
  account_id?: string;
  slug?: string;
  old_renamed_to?: string;
  reason?: string;
};
type ImportFinal = {
  parsed: number;
  created: ImportFinalRow[];
  renamed: ImportFinalRow[];
  skipped: ImportFinalRow[];
  errors: ImportFinalRow[];
};

function ImportAccountsModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const notify = useNotify();
  const [file, setFile] = useState<File | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<ImportFinal | null>(null);

  async function doPreview(f: File) {
    setPreviewing(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await api.postForm<ImportPreview>(
        "/api/v1/accounts/import?dry_run=true", fd,
      );
      setPreview(r);
    } catch (e) {
      const err = e as ApiError;
      notify({ title: "Could not parse file", body: err.message, tone: "error" });
      setFile(null);
    } finally {
      setPreviewing(false);
    }
  }

  async function doImport() {
    if (!file) return;
    setCommitting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api.postForm<ImportFinal>("/api/v1/accounts/import", fd);
      setResult(r);
      notify({
        title: "Import complete",
        body: `${r.created.length} created · ${r.renamed.length} renamed · ${r.errors.length} errors`,
        tone: r.errors.length ? "warning" : "success",
      });
    } catch (e) {
      const err = e as ApiError;
      notify({ title: "Import failed", body: err.message, tone: "error" });
    } finally {
      setCommitting(false);
    }
  }

  function onFilePicked(f: File | null) {
    setFile(f);
    setPreview(null);
    setResult(null);
    if (f) doPreview(f);
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-beroe-card-border flex items-center">
          <div className="font-bold text-base">Import accounts from XLSX</div>
          <span className="flex-1" />
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary text-xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="p-5 overflow-y-auto flex-1">
          {!result && (
            <>
              <label className="block">
                <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted mb-1">
                  XLSX file
                </div>
                <input
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(e) => onFilePicked(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm border border-beroe-card-border rounded-lg p-2"
                />
                <div className="text-[11px] text-text-muted mt-1">
                  Expects the canonical column shape (Client Name in row 4 or earlier;
                  data rows below). Existing accounts with the same name will be
                  renamed to "&lt;name&gt;_old" and a fresh row inserted.
                </div>
              </label>

              {previewing && (
                <div className="mt-3 text-sm text-text-muted">Parsing…</div>
              )}

              {preview && (
                <div className="mt-4">
                  <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted mb-2">
                    Preview · {preview.parsed} rows parsed
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-beroe-bg text-text-muted uppercase tracking-wide text-[10px] font-bold">
                        <th className="px-2 py-1.5 text-left">Row</th>
                        <th className="px-2 py-1.5 text-left">Client Name</th>
                        <th className="px-2 py-1.5 text-right">Products: ✓ / ?</th>
                        <th className="px-2 py-1.5 text-left">Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.preview.map((p) => (
                        <tr key={p.row} className="border-b border-beroe-card-border">
                          <td className="px-2 py-1.5">{p.row}</td>
                          <td className="px-2 py-1.5 font-semibold">{p.name ?? "—"}</td>
                          <td className="px-2 py-1.5 text-right">
                            <span className="text-beroe-green font-bold">
                              {p.products_purchased}
                            </span>
                            {" / "}
                            <span className="text-text-muted">{p.products_unknown}</span>
                          </td>
                          <td className="px-2 py-1.5">
                            {p.errors.length === 0 ? (
                              <span className="text-text-muted">—</span>
                            ) : (
                              p.errors.map((e, i) => (
                                <div key={i} className="text-beroe-red">
                                  {e}
                                </div>
                              ))
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}

          {result && (
            <div>
              <div className="text-[11px] uppercase tracking-wider font-bold text-text-muted mb-2">
                Result · {result.parsed} rows parsed
              </div>
              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="bg-beroe-bg rounded-md p-2.5 text-center">
                  <div className="text-2xl font-bold text-beroe-green">
                    {result.created.length}
                  </div>
                  <div className="text-[10px] uppercase text-text-muted">Created</div>
                </div>
                <div className="bg-beroe-bg rounded-md p-2.5 text-center">
                  <div className="text-2xl font-bold text-beroe-amber">
                    {result.renamed.length}
                  </div>
                  <div className="text-[10px] uppercase text-text-muted">Renamed (old)</div>
                </div>
                <div className="bg-beroe-bg rounded-md p-2.5 text-center">
                  <div className="text-2xl font-bold text-beroe-red">
                    {result.errors.length}
                  </div>
                  <div className="text-[10px] uppercase text-text-muted">Errors</div>
                </div>
              </div>
              {result.renamed.length > 0 && (
                <div className="text-xs">
                  <div className="font-bold mb-1">Renamed accounts</div>
                  <ul className="list-disc ml-5 text-text-muted mb-3">
                    {result.renamed.map((r) => (
                      <li key={r.row}>
                        Row {r.row} · &quot;{r.name}&quot; — old row renamed to{" "}
                        &quot;{r.old_renamed_to}&quot;
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {result.errors.length > 0 && (
                <div className="text-xs">
                  <div className="font-bold mb-1">Errors</div>
                  <ul className="list-disc ml-5 text-beroe-red mb-3">
                    {result.errors.map((r) => (
                      <li key={r.row}>
                        Row {r.row} · {r.name ?? "—"} · {r.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-beroe-card-border flex justify-end gap-2 bg-beroe-bg/40">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg border border-beroe-card-border bg-white text-sm font-semibold"
          >
            {result ? "Close" : "Cancel"}
          </button>
          {!result && (
            <button
              onClick={doImport}
              disabled={!file || !preview || committing || previewing}
              className="px-4 py-1.5 rounded-lg bg-beroe-blue text-white text-sm font-semibold disabled:opacity-60"
            >
              {committing ? "Importing…" : `Import ${preview?.parsed ?? 0} rows →`}
            </button>
          )}
          {result && (
            <button
              onClick={onImported}
              className="px-4 py-1.5 rounded-lg bg-beroe-blue text-white text-sm font-semibold"
            >
              Done · refresh list
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
