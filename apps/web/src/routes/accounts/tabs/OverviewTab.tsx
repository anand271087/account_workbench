import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { formatACV, formatRelativeDate } from "@/lib/format";
import type { ActivityFeedResponse, ActivityItem } from "@/types/account";
import { useAccountFromLayout } from "../AccountProfileLayout";

export default function OverviewTab() {
  const account = useAccountFromLayout();

  const { data, isLoading, isError } = useQuery<ActivityFeedResponse>({
    queryKey: ["activity", account.id, 1],
    queryFn: () =>
      api.get<ActivityFeedResponse>(
        `/api/v1/accounts/${account.id}/activity?page=1&page_size=5`,
      ),
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Key metrics */}
      <div className="lg:col-span-2 space-y-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-sm font-bold text-text-primary mb-3">Key metrics</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Metric label="Current ACV" value={formatACV(account.current_acv)} />
            <Metric label="Target ACV" value={formatACV(account.target_acv)} />
            <Metric
              label="Renewal date"
              value={account.renewal_date ?? "—"}
              sub={
                account.days_to_renewal !== null
                  ? `${account.days_to_renewal} day${account.days_to_renewal === 1 ? "" : "s"}`
                  : undefined
              }
            />
            <Metric
              label="Health score"
              value={account.health_score !== null ? String(account.health_score) : "—"}
            />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-sm font-bold text-text-primary mb-3">Engagement context</h2>
          <Pair label="CSM" value={account.csm_full_name ?? "Unassigned"} />
          <Pair label="Commercial Owner" value={account.co_full_name ?? "Unassigned"} />
          <Pair label="Account type" value={account.account_type ?? "—"} />
          <Pair label="Segment" value={account.segment ?? "—"} />
          <Pair label="Region" value={account.region ?? "—"} />
          <Pair
            label="Contract"
            value={
              account.contract_start && account.contract_end
                ? `${account.contract_start} → ${account.contract_end}`
                : "—"
            }
          />
        </div>
      </div>

      {/* Activity feed */}
      <div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-text-primary">Recent activity</h2>
            <span className="text-[11px] text-text-muted">last 5</span>
          </div>
          {isLoading && <div className="text-sm text-text-muted">Loading…</div>}
          {isError && (
            <div className="text-sm text-red-700">Could not load activity.</div>
          )}
          {data && data.items.length === 0 && (
            <div className="text-sm text-text-muted">No recent activity.</div>
          )}
          {data && data.items.length > 0 && (
            <ul className="space-y-3">
              {data.items.map((it) => (
                <ActivityRow key={it.id} item={it} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-slate-50 rounded-lg p-3">
      <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">{label}</div>
      <div className="text-base font-semibold text-text-primary mt-0.5">{value}</div>
      {sub && <div className="text-[11px] text-text-muted">{sub}</div>}
    </div>
  );
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between py-1.5 border-b border-slate-100 last:border-b-0">
      <span className="text-[11px] uppercase tracking-wider text-text-muted font-bold">
        {label}
      </span>
      <span className="text-sm text-text-primary font-medium">{value}</span>
    </div>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const summary = describe(item);
  return (
    <li className="flex gap-3">
      <div className="mt-1.5 w-1.5 h-1.5 rounded-full bg-beroe-blue/60 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-text-primary">{summary}</div>
        <div className="text-[11px] text-text-muted">
          {formatRelativeDate(item.changed_at)} ·{" "}
          {item.changed_by_full_name ?? <em className="not-italic">system</em>}
        </div>
      </div>
    </li>
  );
}

function describe(it: ActivityItem): string {
  const table = TABLE_LABEL[it.table_name] ?? it.table_name;
  if (it.action === "insert") {
    return `${table} created`;
  }
  if (it.action === "delete") {
    return `${table} removed`;
  }
  // update — try to render the changed field
  if (it.field_name) {
    const oldV = renderJsonValue(it.old_value, it.field_name);
    const newV = renderJsonValue(it.new_value, it.field_name);
    return `${table} — ${it.field_name}${
      oldV ? ` changed from ${oldV}` : ""
    }${newV ? ` to ${newV}` : ""}`;
  }
  return `${table} updated`;
}

function renderJsonValue(v: unknown, key: string): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && v !== null && key in (v as Record<string, unknown>)) {
    const inner = (v as Record<string, unknown>)[key];
    if (inner === null) return "—";
    return String(inner);
  }
  return "";
}

const TABLE_LABEL: Record<string, string> = {
  accounts: "Account",
  account_engagement: "Engagement Info",
  client_contacts: "Contact",
  documents: "Document",
  account_assignments: "Assignment",
};
