/** KindUploadCard — drag-drop upload + filtered list for ONE document kind.
 *
 *  Pre-Sales uses kind=mom; Solutioning uses kind=vpd. Both pages embed this
 *  as the first card on the page so the upload flow lives next to the
 *  structured data the doc feeds.
 *
 *  The dedicated Documents tab was removed — this component is the single
 *  upload UX for the app, scoped to its relevant kind per page.
 */

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, ApiError } from "@/lib/api";
import { authProvider } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { saveExtractionDraft } from "@/lib/extractionDraft";
import {
  AI_STATUS_LABELS,
  DOC_KIND_LABELS,
  type AiStatus,
  type DocKind,
  type Document,
  type DocumentListResponse,
  type DocumentUploadResponse,
  type Job,
} from "@/types/document";
import type { ContactCreate } from "@/types/contact";
import type { ExtractedContact, MomExtractionResult } from "@/types/mom_extraction";

const ALLOWED_EXT = ".docx,.doc,.pdf,.txt,.vtt,.eml";
const MAX_MB = 100;

export function KindUploadCard({
  accountId,
  kind,
  title,
  description,
  emptyHint,
}: {
  accountId: string;
  kind: DocKind;
  title: string;
  description: string;
  emptyHint: string;
}) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [activeJobIds, setActiveJobIds] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [extractionToast, setExtractionToast] = useState<string | null>(null);

  const queryKey = ["documents", accountId, kind];
  const { data, isLoading } = useQuery<DocumentListResponse>({
    queryKey,
    queryFn: () =>
      api.get<DocumentListResponse>(
        `/api/v1/accounts/${accountId}/documents?kind=${kind}`,
      ),
  });

  // Auto-refetch when anything's processing — even if we didn't kick it off
  // in this session (cross-tab pickups also flip pills here). We also keep
  // polling for ~2 min after AI summary completes on an MoM until the worker
  // writes the structured-extraction result, so the "Extracting fields…"
  // chip eventually flips to "Fields populated" without a manual refresh.
  const EXTRACTION_WINDOW_MS = 120_000;
  const liveCount =
    data?.items.filter((d) => {
      if (d.deleted_at) return false;
      if (d.ai_status === "pending" || d.ai_status === "processing") return true;
      if (
        kind === "mom" &&
        d.ai_status === "complete" &&
        !d.mom_extracted_at &&
        Date.now() - new Date(d.uploaded_at).getTime() < EXTRACTION_WINDOW_MS
      ) {
        return true;
      }
      return false;
    }).length ?? 0;

  useEffect(() => {
    if (liveCount === 0) return;
    const id = window.setInterval(() => qc.invalidateQueries({ queryKey }), 1500);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveCount, accountId, kind]);

  // Auto-apply MoM extraction: when a doc lands with mom_extracted_fields
  // and we haven't already consumed it for THIS doc (localStorage flag),
  // write the draft + auto-create contacts + show a confirmation toast.
  // Per-doc localStorage flag survives reloads so we never double-apply.
  useEffect(() => {
    if (kind !== "mom" || !data?.items) return;
    const pending = data.items.filter(
      (d) =>
        !d.deleted_at &&
        d.mom_extracted_fields &&
        !sessionStorage.getItem(appliedKey(d.id)) &&
        !localStorage.getItem(appliedKey(d.id)),
    );
    if (pending.length === 0) return;
    // Mark synchronously to prevent re-entry while the async work runs.
    pending.forEach((d) => sessionStorage.setItem(appliedKey(d.id), "1"));
    void Promise.all(pending.map(async (d) => {
      const r = d.mom_extracted_fields as unknown as MomExtractionResult;
      saveExtractionDraft(accountId, {
        filename: d.filename,
        appliedAt: new Date().toISOString(),
        engagement: hasAnyEngagement(r.engagement) ? r.engagement : undefined,
        brief: hasAnyBrief(r.brief) ? r.brief : undefined,
      });
      const stats = await createExtractedContacts(accountId, r.contacts || []);
      // Persist the applied marker so reloads don't re-create contacts.
      localStorage.setItem(appliedKey(d.id), new Date().toISOString());
      const parts: string[] = [];
      if (hasAnyEngagement(r.engagement)) parts.push("engagement");
      if (hasAnyBrief(r.brief)) parts.push("brief");
      if (stats.created > 0) parts.push(`${stats.created} contact${stats.created === 1 ? "" : "s"}`);
      const skipped = stats.skipped > 0 ? ` · ${stats.skipped} duplicate contact skipped` : "";
      setExtractionToast(
        parts.length
          ? `Populated ${parts.join(", ")} from "${d.filename}". Review on Pre-Sales and Brief and click Save.${skipped}`
          : `Extraction from "${d.filename}" found no new fields to apply.${skipped}`,
      );
      qc.invalidateQueries({ queryKey: ["engagement", accountId] });
      qc.invalidateQueries({ queryKey: ["meeting-brief", accountId] });
      qc.invalidateQueries({ queryKey: ["contacts", accountId] });
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.items, kind, accountId]);

  // Poll jobs we kicked off — drop terminal ones, refresh queries.
  useEffect(() => {
    if (activeJobIds.length === 0) return;
    let cancelled = false;
    const tick = async () => {
      const stillActive: string[] = [];
      for (const jid of activeJobIds) {
        try {
          const job = await api.get<Job>(`/api/v1/jobs/${jid}`);
          if (job.status !== "complete" && job.status !== "failed") stillActive.push(jid);
        } catch { /* drop */ }
      }
      if (cancelled) return;
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ["discovery-summary", accountId] });
      qc.invalidateQueries({ queryKey: ["solutioning", accountId] });
      qc.invalidateQueries({ queryKey: ["activity", accountId] });
      setActiveJobIds(stillActive);
    };
    const id = window.setInterval(tick, 1500);
    return () => { cancelled = true; window.clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJobIds, accountId, kind]);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/v1/documents/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ["discovery-summary", accountId] });
    },
  });

  const rerunMutation = useMutation({
    mutationFn: (id: string) => api.post<Job>(`/api/v1/documents/${id}/rerun-ai`),
    onSuccess: (job) => {
      setActiveJobIds((s) => [...s, job.id]);
      qc.invalidateQueries({ queryKey });
    },
  });

  const uploadOne = async (file: File): Promise<{ ok: boolean; duplicate?: boolean; jobId?: string; error?: string }> => {
    if (file.size > MAX_MB * 1024 * 1024) {
      return { ok: false, error: `${file.name} exceeds ${MAX_MB} MB` };
    }
    const fd = new FormData();
    fd.append("file", file);
    fd.append("kind", kind);
    const access = await authProvider.getAccessToken();
    const r = await fetch(
      `${import.meta.env.VITE_API_BASE_URL}/api/v1/accounts/${accountId}/documents`,
      { method: "POST", headers: access ? { Authorization: `Bearer ${access}` } : {}, body: fd },
    );
    if (!r.ok) {
      const body = await r.json().catch(() => null);
      return { ok: false, error: body?.detail || `HTTP ${r.status}` };
    }
    const body = (await r.json()) as DocumentUploadResponse;
    return { ok: true, duplicate: body.duplicate, jobId: body.job_id };
  };

  const handleFiles = async (files: FileList | File[]) => {
    setUploadError(null);
    const arr = Array.from(files);
    if (arr.length === 0) return;
    let ok = 0, dup = 0;
    const errs: string[] = [];
    const newJobs: string[] = [];
    for (let i = 0; i < arr.length; i++) {
      const f = arr[i];
      setUploadStatus(arr.length === 1 ? `Uploading ${f.name}…` : `Uploading ${i + 1} of ${arr.length}: ${f.name}`);
      const res = await uploadOne(f);
      if (!res.ok) { errs.push(`${f.name}: ${res.error}`); continue; }
      if (res.duplicate) { dup += 1; continue; }
      ok += 1;
      if (res.jobId) newJobs.push(res.jobId);
    }
    if (newJobs.length) setActiveJobIds((s) => [...s, ...newJobs]);
    qc.invalidateQueries({ queryKey });
    if (errs.length) {
      setUploadStatus(null);
      setUploadError(errs.join(" · "));
    } else if (ok > 0) {
      setUploadStatus(`✓ ${ok} uploaded${dup ? ` · ${dup} duplicate` : ""}. Claude is processing — watch the pill below.`);
      window.setTimeout(() => setUploadStatus(null), 5000);
    } else if (dup) {
      setUploadStatus(`${dup} duplicate (already on this account)`);
      window.setTimeout(() => setUploadStatus(null), 4000);
    } else {
      setUploadStatus(null);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const visible = (data?.items ?? []).filter((d) => !d.deleted_at);

  return (
    <div className="space-y-3">
      {/* Drag-drop card */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          "bg-white rounded-card border-2 border-dashed p-5 transition-colors",
          dragOver ? "border-beroe-blue bg-beroe-blue/5" : "border-beroe-card-border",
        )}
      >
        <div className="flex items-start gap-3 mb-3">
          <div className="text-2xl shrink-0">📄</div>
          <div className="flex-1">
            <h2 className="text-sm font-bold text-text-primary">{title}</h2>
            <p className="text-xs text-text-muted mt-0.5">{description}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ALLOWED_EXT}
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
            disabled={!!uploadStatus}
            className="text-sm flex-1 min-w-[260px]"
          />
          <span className="text-[10px] text-text-muted">
            Drag files anywhere on this card · {ALLOWED_EXT.replaceAll(",", " · ")} · max {MAX_MB} MB
          </span>
        </div>
        {uploadStatus && (
          <div
            className={cn(
              "mt-3 px-3 py-2 rounded-lg text-sm border flex items-center gap-2",
              uploadStatus.startsWith("✓")
                ? "bg-green-50 border-green-200 text-green-800"
                : "bg-blue-50 border-blue-200 text-blue-900 animate-pulse",
            )}
          >
            {!uploadStatus.startsWith("✓") && (
              <span className="inline-block w-3 h-3 rounded-full bg-blue-500 animate-pulse" />
            )}
            {uploadStatus}
          </div>
        )}
        {uploadError && (
          <div className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {uploadError}
          </div>
        )}
      </div>

      {/* Live processing banner */}
      {liveCount > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-card px-4 py-2.5 flex items-center gap-2 text-xs text-blue-900">
          <span className="inline-block w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          <b>{liveCount}</b>
          <span>{DOC_KIND_LABELS[kind]}{liveCount === 1 ? "" : "s"} processing — Claude is reading them now.</span>
        </div>
      )}

      {/* List */}
      <div className="bg-white rounded-card border border-beroe-card-border overflow-hidden">
        <div className="px-5 py-3 border-b border-beroe-card-border/60 flex items-center justify-between">
          <h3 className="text-sm font-bold text-text-primary">
            {DOC_KIND_LABELS[kind]}s ({visible.length})
          </h3>
        </div>
        {isLoading ? (
          <div className="p-6 text-center text-sm text-text-muted">Loading…</div>
        ) : visible.length === 0 ? (
          <div className="p-8 text-center text-sm text-text-muted">{emptyHint}</div>
        ) : (
          <ul className="divide-y divide-beroe-card-border/60">
            {visible.map((d) => (
              <DocumentRow
                key={d.id}
                doc={d}
                onDelete={() => {
                  if (confirm(`Soft-delete "${d.filename}"?`)) deleteMutation.mutate(d.id);
                }}
                onRerun={() => {
                  if (confirm(`Re-run AI on "${d.filename}"? Existing summary will be replaced.`)) {
                    rerunMutation.mutate(d.id);
                  }
                }}
              />
            ))}
          </ul>
        )}
      </div>

      {extractionToast && (
        <div className="bg-green-50 border border-green-200 text-green-900 rounded-card px-4 py-2.5 text-xs flex items-start gap-2">
          <span className="font-bold mt-0.5">✓</span>
          <span className="flex-1">{extractionToast}</span>
          <button
            onClick={() => setExtractionToast(null)}
            className="text-green-900/60 hover:text-green-900 leading-none px-1"
            aria-label="Dismiss"
          >×</button>
        </div>
      )}
    </div>
  );
}

// ---------- Row ----------

function DocumentRow({
  doc,
  onDelete,
  onRerun,
}: {
  doc: Document;
  onDelete: () => void;
  onRerun: () => void;
}) {
  const [open, setOpen] = useState(false);
  const age = Date.now() - new Date(doc.uploaded_at).getTime();
  const inFlight =
    (doc.ai_status === "processing" || doc.ai_status === "pending") && age < 90_000;
  return (
    <li className="px-5 py-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-text-primary truncate">{doc.filename}</span>
            <StatusPill status={doc.ai_status} />
            {doc.ai_status === "complete" && (
              <span
                className={cn(
                  "text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                  doc.ai_edited ? "bg-violet-100 text-violet-800" : "bg-cyan-100 text-cyan-800",
                )}
                title={doc.ai_edited ? "Edited by a human after AI generation" : "Generated by Claude — untouched"}
              >
                {doc.ai_edited ? "AI-assisted" : "AI-generated"}
              </span>
            )}
            <MomExtractionPill doc={doc} />
          </div>
          <div className="text-[11px] text-text-muted mt-0.5">
            {formatBytes(doc.size_bytes)} · uploaded {new Date(doc.uploaded_at).toLocaleString()}
          </div>
          {doc.ai_summary_text && (
            <button
              onClick={() => setOpen((v) => !v)}
              className="mt-1 text-xs text-beroe-blue font-semibold"
            >
              {open ? "Hide summary" : "Show summary"}
            </button>
          )}
          {open && doc.ai_summary_text && (
            <div className="mt-2 text-sm text-text-primary whitespace-pre-wrap bg-beroe-bg/60 rounded-lg px-3 py-2 border border-beroe-card-border/60">
              {doc.ai_summary_text}
            </div>
          )}
        </div>
        <div className="flex gap-3 shrink-0">
          <button
            onClick={onRerun}
            disabled={inFlight}
            className="text-xs text-beroe-blue hover:underline font-semibold disabled:opacity-40"
            title={inFlight ? "Already in progress…" : "Re-run AI summary + re-extract fields"}
          >
            Rerun
          </button>
          <button
            onClick={onDelete}
            className="text-xs text-red-700 hover:underline font-semibold"
          >
            Delete
          </button>
        </div>
      </div>
    </li>
  );
}

function StatusPill({ status }: { status: AiStatus }) {
  const tone =
    status === "complete" ? "bg-green-100 text-green-800"
      : status === "failed" ? "bg-red-100 text-red-800"
        : status === "processing" ? "bg-blue-100 text-blue-800 animate-pulse"
          : "bg-amber-100 text-amber-800";
  return (
    <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-full", tone)}>
      {AI_STATUS_LABELS[status]}
    </span>
  );
}

/** MoM-only extraction state.
 *
 *  Hidden for non-MoM docs and while AI summary is still running. Once
 *  ai_status flips to "complete":
 *    - mom_extracted_at set     → "Fields populated" (violet, success)
 *    - within 2 min of upload   → "Extracting fields…" (blue, animated)
 *    - >2 min and still no data → silent (something blocked extraction;
 *                                  the Rerun button is the fix)
 *  The 2-min window matches the polling-loop liveCount logic above so the
 *  card keeps refetching exactly as long as this pill is "Extracting…". */
function MomExtractionPill({ doc }: { doc: Document }) {
  if (doc.kind !== "mom") return null;
  if (doc.ai_status !== "complete") return null;
  if (doc.mom_extracted_at) {
    return (
      <span
        className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-800"
        title={`Fields auto-populated on ${new Date(doc.mom_extracted_at).toLocaleString()} — review and Save on Pre-Sales + Brief`}
      >
        Fields populated
      </span>
    );
  }
  const age = Date.now() - new Date(doc.uploaded_at).getTime();
  if (age > 120_000) return null;
  return (
    <span
      className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-800 animate-pulse"
      title="Claude is extracting structured fields from this MoM — Pre-Sales + Brief will pre-fill in a moment."
    >
      Extracting fields…
    </span>
  );
}

function formatBytes(b: number | null): string {
  if (!b) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------- Extraction helpers ----------

function appliedKey(docId: string): string {
  return `awb:extraction-applied:${docId}`;
}

function hasAnyEngagement(e: MomExtractionResult["engagement"] | undefined): boolean {
  if (!e) return false;
  return Boolean(
    e.engagement_objective || e.spoc_text || e.sponsor_text || e.procurement_maturity ||
    e.meeting_type || (e.target_categories?.length ?? 0) > 0 || (e.geographies?.length ?? 0) > 0,
  );
}

function hasAnyBrief(b: MomExtractionResult["brief"] | undefined): boolean {
  if (!b) return false;
  return Boolean(
    b.call_date || b.call_type || b.call_duration_minutes || b.win_condition ||
    (b.company_snapshot?.length ?? 0) > 0 || (b.attendees?.length ?? 0) > 0 ||
    (b.news?.length ?? 0) > 0 || (b.value_anchors?.length ?? 0) > 0 ||
    (b.email_insights?.length ?? 0) > 0 || (b.cheat_sheet_never_say?.length ?? 0) > 0 ||
    (b.cheat_sheet_opening_asks?.length ?? 0) > 0,
  );
}

async function createExtractedContacts(
  accountId: string,
  contacts: ExtractedContact[],
): Promise<{ created: number; skipped: number; failed: number }> {
  let created = 0;
  let skipped = 0;
  let failed = 0;
  await Promise.all(
    contacts
      .filter((c) => !c.is_internal_beroe && c.name)
      .map(async (c) => {
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
          if (e instanceof ApiError && e.status === 409) skipped += 1;
          else failed += 1;
        }
      }),
  );
  return { created, skipped, failed };
}
