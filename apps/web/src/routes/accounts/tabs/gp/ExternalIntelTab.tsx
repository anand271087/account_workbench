// M28 — Growth & Pipeline · External Intelligence sub-tab.
//
// Faithful port of the prototype's bExtIntel():
//   * Search input + 10-category filter pills + "All"
//   * Refresh button → POST /accounts/:id/intel-news/refresh (AI gen)
//   * Cards with category-coloured pill + relevance dot + headline +
//     summary + source + Read / Push-as-Signal actions
//
// Push-as-Signal creates a SoftSignal back-linked to the news item; the
// M26 Appetite Score's Signal Mix component picks up the new signal on
// the next read (we invalidate ["appetite", accountId] + ["signals", ..]).

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAccountFromLayout } from "../../AccountProfileLayout";
import {
  CATEGORY_COLOR,
  CATEGORY_LABELS,
  INTEL_CATEGORIES,
  RELEVANCE_LABELS,
  type IntelCategory,
  type IntelNewsItem,
  type IntelNewsListResponse,
  type IntelRefreshResponse,
} from "@/types/intel_news";

type Filter = "All" | IntelCategory;

export default function ExternalIntelTab() {
  const account = useAccountFromLayout();
  const qc = useQueryClient();
  const listKey = ["intel-news", account.id];

  const { data, isLoading } = useQuery<IntelNewsListResponse>({
    queryKey: listKey,
    queryFn: () =>
      api.get<IntelNewsListResponse>(`/api/v1/accounts/${account.id}/intel-news`),
  });

  const [filter, setFilter] = useState<Filter>("All");
  const [query, setQuery] = useState("");

  const refreshMutation = useMutation({
    mutationFn: () =>
      api.post<IntelRefreshResponse>(
        `/api/v1/accounts/${account.id}/intel-news/refresh`,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: listKey }),
  });

  const editable = data?.is_editable ?? false;
  const items = useMemo(() => data?.items ?? [], [data]);

  const filtered = useMemo(() => {
    let rows = items;
    if (filter !== "All") rows = rows.filter((r) => r.category === filter);
    if (query.trim()) {
      const q = query.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.headline.toLowerCase().includes(q) ||
          (r.summary ?? "").toLowerCase().includes(q) ||
          CATEGORY_LABELS[r.category].toLowerCase().includes(q),
      );
    }
    return rows;
  }, [items, filter, query]);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="bg-white border border-beroe-card-border rounded-card p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="text-[16px] font-bold text-text-primary">
              External Intelligence
            </div>
            <div className="text-[12px] text-text-secondary mt-0.5">
              Market intelligence, latest news, and strategic signals for{" "}
              <span className="font-semibold">{account.name}</span>.
            </div>
          </div>
          {editable && (
            <button
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
              className="text-[12px] px-3 py-1.5 rounded-md bg-emerald-600 text-white font-semibold disabled:opacity-50"
              title="Generate fresh intel via Claude (stub when no key)"
            >
              {refreshMutation.isPending ? "Refreshing…" : "🔄 Refresh"}
            </button>
          )}
        </div>
        {refreshMutation.data && (
          <div className="mt-2 text-[11px] text-text-muted">
            Last refresh: <b>{refreshMutation.data.created}</b> new item
            {refreshMutation.data.created === 1 ? "" : "s"}
            {refreshMutation.data.is_stub && (
              <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 uppercase tracking-wider font-semibold text-[10px]">
                Stub AI
              </span>
            )}
          </div>
        )}
      </div>

      {/* Search */}
      <div className="bg-white border border-beroe-card-border rounded-card p-3 space-y-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search news about ${account.name}…`}
          className="w-full text-[12px] border border-beroe-card-border rounded-md px-3 py-2 focus:border-emerald-500 focus:outline-none"
        />
        {/* Filter pills */}
        <div className="flex gap-1 flex-wrap">
          {(["All", ...INTEL_CATEGORIES] as Filter[]).map((f) => {
            const active = filter === f;
            const col = f === "All" ? "#64748b" : CATEGORY_COLOR[f];
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  "text-[10px] px-2 py-0.5 rounded-full border transition-colors",
                  active
                    ? "font-bold"
                    : "bg-white border-beroe-card-border text-text-muted hover:bg-beroe-bg/60",
                )}
                style={
                  active
                    ? {
                        background: col + "15",
                        color: col,
                        borderColor: col + "50",
                      }
                    : {}
                }
              >
                {f === "All" ? "All" : CATEGORY_LABELS[f]}
              </button>
            );
          })}
        </div>
        <div className="text-[11px] text-text-muted">
          {filtered.length} result{filtered.length === 1 ? "" : "s"}
          {filter !== "All" && (
            <> · filtered to <b>{CATEGORY_LABELS[filter]}</b></>
          )}
        </div>
      </div>

      {/* Cards */}
      {isLoading ? (
        <div className="bg-white border border-beroe-card-border rounded-card p-6 text-sm text-text-muted">
          Loading intel…
        </div>
      ) : items.length === 0 ? (
        <div className="bg-white border border-beroe-card-border rounded-card p-6 text-center">
          <div className="text-[24px] mb-2">📡</div>
          <div className="text-[13px] font-semibold mb-1">No intel yet</div>
          <div className="text-[11px] text-text-muted">
            {editable
              ? "Click Refresh to generate a starter set."
              : "Ask the assigned CSM to refresh this section."}
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-beroe-card-border rounded-card p-6 text-center text-[12px] text-text-muted">
          No results match the current filter.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((it) => (
            <IntelCard
              key={it.id}
              item={it}
              editable={editable}
              accountId={account.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Card
// ============================================================

function IntelCard({
  item,
  editable,
  accountId,
}: {
  item: IntelNewsItem;
  editable: boolean;
  accountId: string;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const col = CATEGORY_COLOR[item.category];

  const hide = useMutation({
    mutationFn: () =>
      api.patch(`/api/v1/intel-news/${item.id}`, { hidden: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["intel-news", accountId] }),
  });

  const push = useMutation({
    mutationFn: () =>
      api.post<IntelNewsItem>(
        `/api/v1/intel-news/${item.id}/push-as-signal`,
        {},
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["intel-news", accountId] });
      qc.invalidateQueries({ queryKey: ["signals", accountId] });
      qc.invalidateQueries({ queryKey: ["appetite", accountId] });
    },
    onError: (e: ApiError) => alert(e.message),
  });

  return (
    <div
      className={cn(
        "bg-white border rounded-card p-3.5",
        item.is_new ? "border-l-[3px]" : "",
      )}
      style={item.is_new ? { borderLeftColor: "#4A00F8" } : {}}
    >
      <div className="flex items-start gap-2.5">
        {item.signal_relevance === "high" && (
          <span
            className="w-2 h-2 rounded-full mt-2 flex-shrink-0 animate-pulse"
            style={{ background: "#e63950" }}
            title="High relevance"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span
              className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider"
              style={{ background: col + "15", color: col }}
            >
              {CATEGORY_LABELS[item.category]}
            </span>
            <span className="text-[10px] text-text-muted">
              {item.news_date
                ? new Date(item.news_date).toLocaleDateString()
                : "—"}
              {item.source && <> · {item.source}</>}
            </span>
            {item.is_new && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-violet-600 text-white">
                New
              </span>
            )}
            {item.ai_generated && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-cyan-50 text-cyan-700 border border-cyan-200 font-semibold uppercase tracking-wider">
                AI
              </span>
            )}
          </div>
          <button
            onClick={() => setOpen((v) => !v)}
            className="text-[13px] font-bold text-text-primary text-left hover:text-emerald-700"
          >
            {item.headline}
          </button>
          {item.summary && (
            <div className="text-[12px] text-text-secondary mt-1 leading-snug">
              {item.summary}
            </div>
          )}
          {open && (
            <div className="mt-2 text-[11px] text-text-muted">
              Relevance:{" "}
              <b className="text-text-primary">
                {RELEVANCE_LABELS[item.signal_relevance]}
              </b>
              {item.source_url && (
                <>
                  {" · "}
                  <a
                    href={item.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-emerald-700 hover:underline"
                  >
                    Source link
                  </a>
                </>
              )}
            </div>
          )}
          <div className="flex gap-1.5 mt-2 flex-wrap">
            {item.signal_created ? (
              <span className="text-[10px] text-emerald-700 inline-flex items-center gap-1 px-1.5 py-0.5">
                ✓ Signal created
              </span>
            ) : (
              editable && (
                <button
                  onClick={() => push.mutate()}
                  disabled={push.isPending}
                  className="text-[10px] px-2 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                  title="Promote this intel to a Soft Signal (drives the appetite score)"
                >
                  → Push as Soft Signal
                </button>
              )
            )}
            {editable && (
              <button
                onClick={() => {
                  if (confirm("Hide this intel item?")) hide.mutate();
                }}
                className="text-[10px] px-2 py-0.5 rounded border border-beroe-card-border text-text-muted hover:bg-beroe-bg/60"
              >
                👁️ Hide
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
