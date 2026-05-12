// Review modal for AI-extracted MoM fields.
//
// Flow:
//   1) Opens with a loading shimmer, fires POST /documents/:id/extract-fields
//   2) Renders four sections (Account info / Engagement / Contacts / Brief)
//      with per-section + per-row toggles
//   3) Apply button fans out PATCH+POST to the existing endpoints in parallel
//   4) Reports per-section success/failure inline
//
// Account-info section is read-only (no PATCH endpoint yet) — surfaced as
// copy-paste chips so the CSM can update the account header manually.

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { api, ApiError } from "@/lib/api";
import {
  DECISION_POWER_LABELS,
  FUNCTION_LABELS,
  SENIORITY_LABELS,
  type ContactCreate,
} from "@/types/contact";
import type {
  ExtractedBrief,
  ExtractedContact,
  ExtractedEngagement,
  MomExtractionResult,
} from "@/types/mom_extraction";
import type { EngagementUpdate } from "@/types/engagement";
import type { MeetingBriefUpdate } from "@/types/meeting_brief";

type ApplyStatus = "idle" | "applying" | "done" | "error";

interface SectionResult {
  status: ApplyStatus;
  message?: string;
}

export function MomExtractionReview({
  accountId,
  documentId,
  filename,
  onClose,
}: {
  accountId: string;
  documentId: string;
  filename: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [result, setResult] = useState<MomExtractionResult | null>(null);

  const [applyEngagement, setApplyEngagement] = useState(true);
  const [applyBrief, setApplyBrief] = useState(true);

  const [contactSelected, setContactSelected] = useState<Record<number, boolean>>({});

  const [engagementResult, setEngagementResult] = useState<SectionResult>({ status: "idle" });
  const [briefResult, setBriefResult] = useState<SectionResult>({ status: "idle" });
  const [contactsResult, setContactsResult] = useState<SectionResult>({ status: "idle" });

  // Fire the extraction call on open.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    api
      .post<MomExtractionResult>(`/api/v1/documents/${documentId}/extract-fields`)
      .then((r) => {
        if (cancelled) return;
        setResult(r);
        // Default-select non-internal contacts.
        const sel: Record<number, boolean> = {};
        r.contacts.forEach((c, i) => {
          sel[i] = !c.is_internal_beroe;
        });
        setContactSelected(sel);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = e instanceof ApiError ? e.message : "Extraction failed";
        setLoadError(msg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [documentId]);

  const handleApply = async () => {
    if (!result) return;
    const tasks: Promise<unknown>[] = [];
    const selectedContactCount = Object.entries(contactSelected).filter(
      ([i, on]) => on && !result.contacts[Number(i)].is_internal_beroe,
    ).length;

    if (applyEngagement) {
      setEngagementResult({ status: "applying" });
      tasks.push(
        applyEngagementPatch(accountId, result.engagement)
          .then(() => setEngagementResult({ status: "done", message: "Engagement updated" }))
          .catch((e) =>
            setEngagementResult({ status: "error", message: extractMessage(e) }),
          ),
      );
    }

    if (applyBrief) {
      setBriefResult({ status: "applying" });
      tasks.push(
        applyBriefPatch(accountId, result.brief)
          .then(() => setBriefResult({ status: "done", message: "Brief updated" }))
          .catch((e) => setBriefResult({ status: "error", message: extractMessage(e) })),
      );
    }

    if (selectedContactCount > 0) {
      setContactsResult({ status: "applying" });
      tasks.push(
        applyContactsCreate(accountId, result.contacts, contactSelected)
          .then((stats) =>
            setContactsResult({
              status: stats.failed > 0 ? "error" : "done",
              message: `Created ${stats.created} contact${stats.created === 1 ? "" : "s"}` +
                (stats.skipped > 0 ? ` (${stats.skipped} skipped — already exists)` : "") +
                (stats.failed > 0 ? ` · ${stats.failed} failed` : ""),
            }),
          )
          .catch((e) => setContactsResult({ status: "error", message: extractMessage(e) })),
      );
    }

    await Promise.allSettled(tasks);
    qc.invalidateQueries({ queryKey: ["engagement", accountId] });
    qc.invalidateQueries({ queryKey: ["brief", accountId] });
    qc.invalidateQueries({ queryKey: ["contacts", accountId] });
    qc.invalidateQueries({ queryKey: ["account-detail", accountId] });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-card shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-beroe-card-border/60 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-text-primary">Review extracted fields</h2>
            <p className="text-xs text-text-muted truncate">
              from <span className="font-medium text-text-primary">{filename}</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary text-2xl leading-none px-1"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {loading && (
            <div className="text-center py-12 text-sm text-text-muted">
              <div className="animate-pulse">Asking Claude to extract fields…</div>
              <div className="text-xs mt-1">Usually 5-15 seconds.</div>
            </div>
          )}
          {loadError && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">
              <div className="font-semibold mb-1">Extraction failed</div>
              <div>{loadError}</div>
            </div>
          )}
          {result && !loading && (
            <>
              {result.is_stub && (
                <div className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">
                  <span className="font-bold">Stub AI</span> — Anthropic key not configured. Output is
                  parsed deterministically from the SDR template; quality is good for standard MoMs
                  but check before applying.
                </div>
              )}
              {result.notes && (
                <div className="text-xs bg-beroe-bg/60 border border-beroe-card-border/60 rounded-lg px-3 py-2 text-text-muted">
                  <span className="font-semibold text-text-primary">AI note:</span> {result.notes}
                </div>
              )}

              <AccountSection account={result.account_fields} />

              <EngagementSection
                value={result.engagement}
                checked={applyEngagement}
                onCheckedChange={setApplyEngagement}
                result={engagementResult}
              />

              <ContactsSection
                contacts={result.contacts}
                selected={contactSelected}
                onToggle={(i) =>
                  setContactSelected((prev) => ({ ...prev, [i]: !prev[i] }))
                }
                result={contactsResult}
              />

              <BriefSection
                value={result.brief}
                checked={applyBrief}
                onCheckedChange={setApplyBrief}
                result={briefResult}
              />
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-beroe-card-border/60 flex items-center justify-between gap-3 bg-beroe-bg/40">
          <div className="text-[11px] text-text-muted">
            Apply runs in parallel. Per-section errors are reported inline.
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="text-sm px-3 py-1.5 rounded-lg border border-beroe-card-border text-text-primary hover:bg-beroe-bg/60"
            >
              Close
            </button>
            <button
              onClick={handleApply}
              disabled={!result || loading || isAnyApplying({ engagementResult, briefResult, contactsResult })}
              className="text-sm px-4 py-1.5 rounded-lg bg-beroe-blue text-white font-semibold hover:bg-beroe-blue/90 disabled:opacity-50"
            >
              Apply selected
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Sections ----------

function AccountSection({ account }: { account: MomExtractionResult["account_fields"] }) {
  const items: Array<{ label: string; value: string | null }> = [
    { label: "Industry", value: account.industry },
    { label: "Country / HQ", value: account.headquarters || account.country },
    { label: "Annual Revenue", value: account.annual_revenue_text },
    { label: "Tier band", value: account.tier_band },
    { label: "SF Link", value: account.sf_link },
  ];
  const populated = items.filter((i) => i.value);
  return (
    <SectionCard
      title="Account info"
      subtitle="Informational only — paste into the account header manually (no PATCH endpoint yet)"
      headerRight={null}
    >
      {populated.length === 0 ? (
        <Empty>No account fields extracted.</Empty>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
          {populated.map((i) => (
            <div key={i.label} className="flex items-baseline gap-2">
              <span className="text-xs font-semibold text-text-muted shrink-0">{i.label}:</span>
              <span className="text-text-primary truncate">{i.value}</span>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function EngagementSection({
  value,
  checked,
  onCheckedChange,
  result,
}: {
  value: ExtractedEngagement;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  result: SectionResult;
}) {
  const rows: Array<{ label: string; value: string | null }> = [
    { label: "Meeting type", value: value.meeting_type },
    { label: "SPOC", value: value.spoc_text },
    { label: "Sponsor", value: value.sponsor_text },
    { label: "Procurement maturity", value: value.procurement_maturity },
  ];
  return (
    <SectionCard
      title="Engagement"
      subtitle="Applies to PATCH /accounts/:id/engagement"
      headerRight={
        <ApplyToggle checked={checked} onChange={onCheckedChange} result={result} />
      }
    >
      {value.engagement_objective && (
        <div className="mb-3">
          <div className="text-xs font-semibold text-text-muted mb-1">Engagement objective</div>
          <div className="text-sm text-text-primary whitespace-pre-wrap bg-beroe-bg/40 rounded-lg px-3 py-2 border border-beroe-card-border/60">
            {value.engagement_objective}
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-sm mb-3">
        {rows.filter((r) => r.value).map((r) => (
          <div key={r.label} className="flex items-baseline gap-2">
            <span className="text-xs font-semibold text-text-muted shrink-0">{r.label}:</span>
            <span className="text-text-primary truncate">{r.value}</span>
          </div>
        ))}
      </div>
      {value.target_categories.length > 0 && (
        <ChipRow label="Target categories" items={value.target_categories} tone="blue" />
      )}
      {value.geographies.length > 0 && (
        <ChipRow label="Geographies" items={value.geographies} tone="slate" />
      )}
    </SectionCard>
  );
}

function ContactsSection({
  contacts,
  selected,
  onToggle,
  result,
}: {
  contacts: ExtractedContact[];
  selected: Record<number, boolean>;
  onToggle: (i: number) => void;
  result: SectionResult;
}) {
  const externals = contacts.filter((c) => !c.is_internal_beroe);
  const internals = contacts.filter((c) => c.is_internal_beroe);
  return (
    <SectionCard
      title={`Contacts (${externals.length})`}
      subtitle="Applies to POST /accounts/:id/contacts (one per ticked row)"
      headerRight={<StatusPill result={result} />}
    >
      {contacts.length === 0 ? (
        <Empty>No contacts extracted.</Empty>
      ) : (
        <>
          <ul className="divide-y divide-beroe-card-border/40">
            {contacts.map((c, i) => (
              <li key={`${c.name}-${i}`} className="py-2 flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={!!selected[i]}
                  disabled={c.is_internal_beroe}
                  onChange={() => onToggle(i)}
                  className="mt-1"
                  title={c.is_internal_beroe ? "Beroe-internal — won't be created as a client contact" : ""}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-text-primary">{c.name}</span>
                    {c.is_spoc && <Pill tone="green">SPOC</Pill>}
                    {c.is_sponsor && <Pill tone="violet">Sponsor</Pill>}
                    {c.is_internal_beroe && <Pill tone="amber">Beroe internal</Pill>}
                  </div>
                  <div className="text-xs text-text-muted truncate">
                    {[c.title, c.function && FUNCTION_LABELS[c.function], c.seniority && SENIORITY_LABELS[c.seniority], c.decision_power && DECISION_POWER_LABELS[c.decision_power]].filter(Boolean).join(" · ")}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {internals.length > 0 && (
            <p className="text-[11px] text-text-muted mt-2">
              {internals.length} Beroe-internal MI Team {internals.length === 1 ? "person" : "people"} were detected and are excluded from contact creation.
            </p>
          )}
        </>
      )}
    </SectionCard>
  );
}

function BriefSection({
  value,
  checked,
  onCheckedChange,
  result,
}: {
  value: ExtractedBrief;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  result: SectionResult;
}) {
  const snapshotCount = value.company_snapshot?.length ?? 0;
  const attendeeCount = value.attendees?.length ?? 0;
  const newsCount = value.news?.length ?? 0;
  const anchorCount = value.value_anchors?.length ?? 0;
  return (
    <SectionCard
      title="Pre-Meeting Brief"
      subtitle="Applies to PATCH /accounts/:id/brief"
      headerRight={
        <ApplyToggle checked={checked} onChange={onCheckedChange} result={result} />
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        <Field label="Call date" value={value.call_date ?? null} />
        <Field label="Call type" value={value.call_type ?? null} />
        <Field label="Duration (min)" value={value.call_duration_minutes?.toString() ?? null} />
        <Field label="Win condition" value={value.win_condition ?? null} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-text-muted">
        <CountChip n={snapshotCount} label="snapshot stats" />
        <CountChip n={attendeeCount} label="attendees" />
        <CountChip n={newsCount} label="news items" />
        <CountChip n={anchorCount} label="value anchors" />
        <CountChip n={value.cheat_sheet_never_say?.length ?? 0} label="never-say" />
        <CountChip n={value.cheat_sheet_opening_asks?.length ?? 0} label="opening asks" />
      </div>
    </SectionCard>
  );
}

// ---------- Helpers ----------

function SectionCard({
  title,
  subtitle,
  headerRight,
  children,
}: {
  title: string;
  subtitle?: string;
  headerRight: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-beroe-card-border rounded-card p-4 bg-white">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <h3 className="text-sm font-bold text-text-primary">{title}</h3>
          {subtitle && <p className="text-[11px] text-text-muted">{subtitle}</p>}
        </div>
        {headerRight}
      </div>
      {children}
    </div>
  );
}

function ApplyToggle({
  checked,
  onChange,
  result,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  result: SectionResult;
}) {
  return (
    <div className="flex items-center gap-2">
      <StatusPill result={result} />
      <label className="text-xs text-text-primary flex items-center gap-1.5 cursor-pointer">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        Apply
      </label>
    </div>
  );
}

function StatusPill({ result }: { result: SectionResult }) {
  if (result.status === "idle") return null;
  const tone =
    result.status === "applying" ? "bg-blue-100 text-blue-800 animate-pulse"
      : result.status === "done" ? "bg-green-100 text-green-800"
        : "bg-red-100 text-red-800";
  return (
    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${tone}`} title={result.message}>
      {result.status === "applying" ? "Applying…" : result.message ?? result.status}
    </span>
  );
}

function ChipRow({ label, items, tone }: { label: string; items: string[]; tone: "blue" | "slate" }) {
  const cls = tone === "blue" ? "bg-blue-100 text-blue-800" : "bg-slate-100 text-slate-800";
  return (
    <div className="mb-2">
      <div className="text-xs font-semibold text-text-muted mb-1">{label}</div>
      <div className="flex flex-wrap gap-1">
        {items.map((it) => (
          <span key={it} className={`text-[11px] px-2 py-0.5 rounded-full ${cls}`}>{it}</span>
        ))}
      </div>
    </div>
  );
}

function Pill({ tone, children }: { tone: "green" | "violet" | "amber"; children: React.ReactNode }) {
  const cls =
    tone === "green" ? "bg-green-100 text-green-800"
      : tone === "violet" ? "bg-violet-100 text-violet-800"
        : "bg-amber-100 text-amber-800";
  return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${cls}`}>{children}</span>;
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs font-semibold text-text-muted shrink-0">{label}:</span>
      <span className="text-text-primary truncate">{value}</span>
    </div>
  );
}

function CountChip({ n, label }: { n: number; label: string }) {
  if (n === 0) return null;
  return (
    <span className="bg-beroe-bg/60 border border-beroe-card-border/60 rounded-full px-2 py-0.5">
      {n} {label}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-text-muted py-2">{children}</div>;
}

function isAnyApplying(rs: { engagementResult: SectionResult; briefResult: SectionResult; contactsResult: SectionResult }): boolean {
  return rs.engagementResult.status === "applying" || rs.briefResult.status === "applying" || rs.contactsResult.status === "applying";
}

function extractMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return "Unknown error";
}

// ---------- Fan-out apply helpers ----------

async function applyEngagementPatch(accountId: string, e: ExtractedEngagement): Promise<void> {
  const payload: EngagementUpdate = {};
  if (e.engagement_objective) payload.engagement_objective = e.engagement_objective;
  if (e.target_categories?.length) payload.target_categories = e.target_categories;
  if (e.geographies?.length) payload.geographies = e.geographies;
  if (e.spoc_text) payload.spoc_text = e.spoc_text;
  if (e.sponsor_text) payload.sponsor_text = e.sponsor_text;
  if (e.procurement_maturity) payload.procurement_maturity = e.procurement_maturity;
  if (Object.keys(payload).length === 0) return;
  await api.patch(`/api/v1/accounts/${accountId}/engagement`, payload);
}

async function applyBriefPatch(accountId: string, b: ExtractedBrief): Promise<void> {
  const payload: MeetingBriefUpdate = {};
  if (b.call_date) payload.call_date = b.call_date;
  if (b.call_type) payload.call_type = b.call_type;
  if (b.call_duration_minutes != null) payload.call_duration_minutes = b.call_duration_minutes;
  if (b.win_condition) payload.win_condition = b.win_condition;
  if (b.company_snapshot?.length) payload.company_snapshot = b.company_snapshot;
  if (b.attendees?.length) payload.attendees = b.attendees;
  if (b.news?.length) payload.news = b.news;
  if (b.public_signals?.length) payload.public_signals = b.public_signals;
  if (b.value_anchors?.length) payload.value_anchors = b.value_anchors;
  if (b.email_insights?.length) payload.email_insights = b.email_insights;
  if (b.cheat_sheet_never_say?.length) payload.cheat_sheet_never_say = b.cheat_sheet_never_say;
  if (b.cheat_sheet_opening_asks?.length) payload.cheat_sheet_opening_asks = b.cheat_sheet_opening_asks;
  if (Object.keys(payload).length === 0) return;
  await api.patch(`/api/v1/accounts/${accountId}/brief`, payload);
}

async function applyContactsCreate(
  accountId: string,
  contacts: ExtractedContact[],
  selected: Record<number, boolean>,
): Promise<{ created: number; skipped: number; failed: number }> {
  let created = 0;
  let skipped = 0;
  let failed = 0;

  await Promise.all(
    contacts.map(async (c, i) => {
      if (!selected[i] || c.is_internal_beroe) return;
      const payload: ContactCreate = {
        name: c.name,
        title: c.title,
        function: c.function,
        seniority: c.seniority,
        decision_power: c.decision_power,
        is_spoc: c.is_spoc,
        is_sponsor: c.is_sponsor,
        notes: c.linkedin_url ? `LinkedIn: ${c.linkedin_url}` : null,
      };
      try {
        await api.post(`/api/v1/accounts/${accountId}/contacts`, payload);
        created += 1;
      } catch (e: unknown) {
        // Likely a unique-email constraint or similar. Track but don't fail the whole batch.
        if (e instanceof ApiError && e.status === 409) {
          skipped += 1;
        } else {
          failed += 1;
        }
      }
    }),
  );

  return { created, skipped, failed };
}
