import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { formatACV, formatRelativeDate } from "@/lib/format";
import type { ActivityFeedResponse, ActivityItem } from "@/types/account";
import type { Engagement } from "@/types/engagement";
import type { ContactListResponse } from "@/types/contact";
import type {
  DiscoverySummary,
  DocumentListResponse,
} from "@/types/document";
import type { Solutioning } from "@/types/solutioning";
import { useAccountFromLayout } from "../AccountProfileLayout";

export default function OverviewTab() {
  const account = useAccountFromLayout();
  const navigate = useNavigate();

  const activity = useQuery<ActivityFeedResponse>({
    queryKey: ["activity", account.id, 1],
    queryFn: () =>
      api.get<ActivityFeedResponse>(
        `/api/v1/accounts/${account.id}/activity?page=1&page_size=5`,
      ),
  });

  const eng = useQuery<Engagement>({
    queryKey: ["engagement", account.id],
    queryFn: () => api.get<Engagement>(`/api/v1/accounts/${account.id}/engagement`),
  });

  const contacts = useQuery<ContactListResponse>({
    queryKey: ["contacts", account.id, false, null, "asc"],
    queryFn: () =>
      api.get<ContactListResponse>(`/api/v1/accounts/${account.id}/contacts`),
  });

  const docs = useQuery<DocumentListResponse>({
    queryKey: ["documents", account.id],
    queryFn: () =>
      api.get<DocumentListResponse>(`/api/v1/accounts/${account.id}/documents`),
  });

  const discovery = useQuery<DiscoverySummary>({
    queryKey: ["discovery-summary", account.id],
    queryFn: () =>
      api.get<DiscoverySummary>(`/api/v1/accounts/${account.id}/discovery-summary`),
  });

  const solutioning = useQuery<Solutioning>({
    queryKey: ["solutioning", account.id],
    queryFn: () =>
      api.get<Solutioning>(`/api/v1/accounts/${account.id}/solutioning`),
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2 space-y-4">
        {/* Engagement snapshot — fed by /engagement */}
        <Card
          title="Engagement snapshot"
          action={{ label: "Open Pre-Sales →", onClick: () => navigate(`/accounts/${account.id}/pre-sales`) }}
        >
          {eng.isLoading ? (
            <SkLine />
          ) : (
            <>
              {/* Objective */}
              <Field label="Discovery objective">
                {eng.data?.engagement_objective ? (
                  <p className="text-sm text-text-primary leading-relaxed line-clamp-3">
                    {eng.data.engagement_objective}
                  </p>
                ) : (
                  <span className="text-xs text-text-muted italic">
                    Not captured yet — go to Pre-Sales to add one.
                  </span>
                )}
              </Field>

              {/* Categories + geographies as chips */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                <Field label={`Target categories (${eng.data?.target_categories.length ?? 0})`}>
                  <Chips items={eng.data?.target_categories ?? []} empty="None yet" />
                </Field>
                <Field label={`Geographies (${eng.data?.geographies.length ?? 0})`}>
                  <Chips items={eng.data?.geographies ?? []} empty="None yet" />
                </Field>
              </div>

              {/* Maturity / AI / spend mini-grid */}
              <div className="grid grid-cols-3 gap-2 mt-3">
                <MiniStat
                  label="Procurement maturity"
                  value={eng.data?.procurement_maturity ?? "—"}
                  tone={maturityTone(eng.data?.procurement_maturity)}
                />
                <MiniStat
                  label="AI penetration"
                  value={eng.data?.ai_penetration ?? "—"}
                  tone={maturityTone(eng.data?.ai_penetration)}
                />
                <MiniStat
                  label="Procurement spend"
                  value={
                    eng.data?.procurement_spend_musd
                      ? `$${Number(eng.data.procurement_spend_musd).toLocaleString()}M`
                      : "—"
                  }
                />
              </div>
            </>
          )}
        </Card>

        {/* Pre-Sales status: roster + docs + solutioning side-by-side */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card
            title="Roster"
            action={{ label: "Open →", onClick: () => navigate(`/accounts/${account.id}/contacts`) }}
            compact
          >
            <BigStat
              value={contacts.data?.items.filter((c) => !c.deleted_at).length ?? 0}
              label="active contacts"
            />
            <div className="flex gap-2 mt-2 text-[11px]">
              <span className="px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-800 font-bold">
                {contacts.data?.items.filter((c) => c.is_spoc && !c.deleted_at).length ?? 0} SPOC
              </span>
              <span className="px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-800 font-bold">
                {contacts.data?.items.filter((c) => c.is_sponsor && !c.deleted_at).length ?? 0} Sponsor
              </span>
            </div>
          </Card>

          <Card
            title="Documents"
            action={{ label: "Open Pre-Sales →", onClick: () => navigate(`/accounts/${account.id}/pre-sales`) }}
            compact
          >
            <BigStat value={docs.data?.items.length ?? 0} label="uploaded" />
            <div className="flex gap-2 mt-2 text-[11px] flex-wrap">
              <span className="px-1.5 py-0.5 rounded-full bg-green-100 text-green-800 font-bold">
                {docs.data?.items.filter((d) => d.ai_status === "complete").length ?? 0} ready
              </span>
              {(docs.data?.items.filter((d) => d.ai_status === "pending" || d.ai_status === "processing").length ?? 0) > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold animate-pulse">
                  {docs.data!.items.filter((d) => d.ai_status === "pending" || d.ai_status === "processing").length} processing
                </span>
              )}
            </div>
            {(() => {
              const last = docs.data?.items[0];
              return last ? (
                <div className="text-[10px] text-text-muted mt-1.5 truncate">
                  Last: {last.filename}
                </div>
              ) : null;
            })()}
          </Card>

          <Card
            title="Solutioning"
            action={{ label: "Open →", onClick: () => navigate(`/accounts/${account.id}/solutioning`) }}
            compact
          >
            {account.handed_off_to_solutioning ? (
              <>
                <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-800 font-bold mb-1">
                  Handed off
                </span>
                <div className="text-[11px] text-text-muted">
                  {account.handed_off_at && new Date(account.handed_off_at).toLocaleDateString()}
                </div>
                {solutioning.data?.estimated_value_musd && (
                  <div className="text-sm font-bold text-text-primary mt-1">
                    Est. value ${Number(solutioning.data.estimated_value_musd).toLocaleString()}M
                  </div>
                )}
                {solutioning.data?.engagement_type && (
                  <div className="text-[11px] text-text-muted">
                    {solutioning.data.engagement_type.replace("_", " ")}
                    {solutioning.data.engagement_duration_months
                      ? ` · ${solutioning.data.engagement_duration_months}wk`
                      : ""}
                  </div>
                )}
              </>
            ) : (
              <>
                <span className="inline-block text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-text-secondary font-bold mb-1">
                  Pre-handover
                </span>
                <div className="text-[11px] text-text-muted leading-snug">
                  Capture the engagement objective + a VPD before handing off.
                </div>
              </>
            )}
          </Card>
        </div>

        {/* Lifecycle timeline */}
        <Card title="Lifecycle">
          <Lifecycle account={account} />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3 pt-3 border-t border-beroe-card-border/60">
            <KvCol label="Account type" value={account.account_type ?? "—"} />
            <KvCol label="Segment" value={account.segment ?? "—"} />
            <KvCol
              label="Last activity"
              value={
                account.last_activity_at
                  ? formatRelativeDate(account.last_activity_at)
                  : "—"
              }
            />
            <KvCol
              label="Target ACV"
              value={formatACV(account.target_acv)}
              sub={
                account.target_acv && account.current_acv
                  ? `+${formatACV(
                      String(Number(account.target_acv) - Number(account.current_acv)) as unknown as never,
                    )} headroom`
                  : undefined
              }
            />
          </div>
        </Card>

        {/* Sales Discovery Summary preview (if any) */}
        {discovery.data?.summary_text && (
          <Card
            title="Sales Discovery Summary"
            action={{ label: "Open Pre-Sales →", onClick: () => navigate(`/accounts/${account.id}/pre-sales`) }}
          >
            <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap line-clamp-6">
              {discovery.data.summary_text}
            </p>
            {discovery.data.generated_at && (
              <div className="text-[10px] text-text-muted mt-2">
                {discovery.data.source_document_ids.length} source doc
                {discovery.data.source_document_ids.length === 1 ? "" : "s"} · last regenerated{" "}
                {new Date(discovery.data.generated_at).toLocaleString()}
              </div>
            )}
          </Card>
        )}
      </div>

      {/* Activity feed (right column) */}
      <div>
        <Card title="Recent activity" badge="last 5">
          {activity.isLoading && <div className="text-sm text-text-muted">Loading…</div>}
          {activity.isError && (
            <div className="text-sm text-red-700">Could not load activity.</div>
          )}
          {activity.data && activity.data.items.length === 0 && (
            <div className="text-sm text-text-muted">No recent activity.</div>
          )}
          {activity.data && activity.data.items.length > 0 && (
            <ul className="space-y-3">
              {activity.data.items.map((it) => (
                <ActivityRow key={it.id} item={it} />
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

// ---------- Reusable bits ----------

function Card({
  title,
  badge,
  action,
  compact,
  children,
}: {
  title: string;
  badge?: string;
  action?: { label: string; onClick: () => void };
  compact?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("bg-white rounded-card border border-beroe-card-border", compact ? "p-4" : "p-5")}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-text-primary">{title}</h2>
        {badge && <span className="text-[11px] text-text-muted">{badge}</span>}
        {action && (
          <button
            onClick={action.onClick}
            className="text-[11px] text-beroe-blue font-semibold hover:underline"
          >
            {action.label}
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold mb-1">
        {label}
      </div>
      {children}
    </div>
  );
}

function Chips({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) {
    return <span className="text-xs text-text-muted italic">{empty}</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {items.slice(0, 8).map((it) => (
        <span
          key={it}
          className="text-[11px] px-2 py-0.5 rounded-full bg-beroe-blue/10 text-beroe-blue border border-beroe-blue/30 font-semibold"
        >
          {it}
        </span>
      ))}
      {items.length > 8 && (
        <span className="text-[11px] text-text-muted">+{items.length - 8}</span>
      )}
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "danger" | "muted";
}) {
  const valueCls = {
    ok: "text-green-700",
    warn: "text-amber-700",
    danger: "text-red-700",
    muted: "text-text-primary",
  }[tone ?? "muted"];
  return (
    <div className="bg-beroe-bg/60 rounded-ctl p-2.5 border border-beroe-card-border/60">
      <div className="text-[9px] uppercase tracking-wider text-text-muted font-bold">
        {label}
      </div>
      <div className={cn("text-sm font-bold capitalize mt-0.5", valueCls)}>{value}</div>
    </div>
  );
}

function BigStat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-2xl font-extrabold text-text-primary leading-none">
        {value}
      </span>
      <span className="text-[11px] text-text-muted">{label}</span>
    </div>
  );
}

function KvCol({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-text-muted font-bold">
        {label}
      </div>
      <div className="text-sm font-semibold text-text-primary">{value}</div>
      {sub && <div className="text-[11px] text-text-muted">{sub}</div>}
    </div>
  );
}

function SkLine() {
  return <div className="h-3 bg-slate-100 rounded animate-pulse w-2/3" />;
}

function maturityTone(level: string | null | undefined): "ok" | "warn" | "muted" {
  if (level === "high") return "ok";
  if (level === "medium") return "warn";
  return "muted";
}

// ---------- Lifecycle progress bar ----------

function Lifecycle({
  account,
}: {
  account: ReturnType<typeof useAccountFromLayout>;
}) {
  const start = account.contract_start ? new Date(account.contract_start).getTime() : null;
  const end = account.contract_end ? new Date(account.contract_end).getTime() : null;
  const renewal = account.renewal_date ? new Date(account.renewal_date).getTime() : null;
  const now = Date.now();

  if (!start || !end) {
    return (
      <div className="text-xs text-text-muted">
        Contract dates not set yet. Add them from Pre-Sales.
      </div>
    );
  }
  const total = end - start;
  const pct = Math.max(0, Math.min(100, ((now - start) / total) * 100));
  const dtr = account.days_to_renewal;

  return (
    <div>
      <div className="flex items-center justify-between text-[11px] text-text-muted mb-1.5">
        <span>{new Date(start).toLocaleDateString()}</span>
        {renewal && (
          <span className={cn("font-semibold", dtr !== null && dtr < 0 ? "text-red-700" : "text-text-secondary")}>
            Renewal {new Date(renewal).toLocaleDateString()}
            {dtr !== null && (
              <> · {Math.abs(dtr)}d {dtr < 0 ? "overdue" : "to go"}</>
            )}
          </span>
        )}
        <span>{new Date(end).toLocaleDateString()}</span>
      </div>
      <div className="relative h-2 bg-beroe-card-border rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            dtr !== null && dtr < 0
              ? "bg-red-500"
              : pct > 80
                ? "bg-amber-500"
                : "bg-beroe-blue",
          )}
          style={{ width: `${pct}%` }}
        />
        {/* Today marker */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-text-primary"
          style={{ left: `${pct}%` }}
          title={`Today (${new Date(now).toLocaleDateString()})`}
        />
      </div>
      <div className="text-[10px] text-text-muted mt-1">
        {pct.toFixed(0)}% through contract
      </div>
    </div>
  );
}

// ---------- Activity feed ----------

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
  if (it.action === "insert") return `${table} created`;
  if (it.action === "delete") return `${table} removed`;
  if (it.field_name) {
    const oldV = renderJsonValue(it.old_value, it.field_name);
    const newV = renderJsonValue(it.new_value, it.field_name);
    return `${table} — ${it.field_name}${oldV ? ` changed from ${oldV}` : ""}${newV ? ` to ${newV}` : ""}`;
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
  account_solutioning: "Solutioning",
};
