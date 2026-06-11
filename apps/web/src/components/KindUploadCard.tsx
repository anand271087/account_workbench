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
import { useConfirm } from "@/components/DialogProvider";
import { HelpTooltip } from "@/components/HelpTooltip";
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
import type { ExtractedVpd } from "@/types/vpd_extraction";
import type { HandoffExtractionResult } from "@/types/handoff_extraction";
import type { CsGoalsExtractionResult, ExtractedGoal } from "@/types/cs_goals_extraction";
import type {
  VpdMetricsExtractionResult,
  ExtractedMetric,
} from "@/types/vpd_metrics_extraction";
import { VpdExtractionReview } from "@/components/VpdExtractionReview";

// Bug 6 — added .csv / .md / .markdown so MoM and VPD zones accept the
// formats listed in the sprint-1 bug tracker.
const ALLOWED_EXT =
  ".docx,.doc,.pptx,.ppt,.xlsx,.xls,.pdf,.txt,.vtt,.eml,.csv,.md,.markdown";
const MAX_MB = 100;

export function KindUploadCard({
  accountId,
  kind,
  title,
  description,
  emptyHint,
  headerAction,
  contractSubtypes,
}: {
  accountId: string;
  kind: DocKind;
  title: string;
  description: string;
  emptyHint: string;
  // 03-Jun bug 8 — slot for a button rendered to the right of the
  // card title (used by Pre-Sales to surface the Pre-Meeting Brief
  // overlay next to the MoM upload, per the prototype).
  headerAction?: React.ReactNode;
  // 11-Jun · Optional list of contract subtypes (matches migration
  // 0059's CHECK constraint). When provided AND kind='contract',
  // the card renders a "Document Type" dropdown above the upload
  // dropzone and passes the selected value to the upload endpoint
  // as `contract_subtype` (multipart form field). Existing call
  // sites that don't pass this prop keep behaving exactly as before.
  contractSubtypes?: readonly string[];
}) {
  const [pendingSubtype, setPendingSubtype] = useState<string>(
    contractSubtypes?.[0] ?? "",
  );
  const qc = useQueryClient();
  const confirm = useConfirm();
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
  // polling for ~3 min after AI summary completes on an MoM/VPD until the
  // worker writes every structured-extraction result, so the "Extracting
  // fields…" chip eventually flips to "Fields populated" without a manual
  // refresh.
  //
  // For VPD specifically the worker writes TWO commits sequentially:
  //   1) vpd_extracted_at      → Solutioning candidate fields
  //   2) cs_goals_extracted_at → candidate Goals (M15.1)
  // We MUST keep polling until BOTH are set; otherwise the "Review N
  // candidate goals" CTA never appears (bug: new accounts where the
  // second commit lands after the first 1.5s refetch).
  const EXTRACTION_WINDOW_MS = 180_000;
  const liveCount =
    data?.items.filter((d) => {
      if (d.deleted_at) return false;
      if (d.ai_status === "pending" || d.ai_status === "processing") return true;
      const recent = Date.now() - new Date(d.uploaded_at).getTime() < EXTRACTION_WINDOW_MS;
      if (kind === "mom" && d.ai_status === "complete" && !d.mom_extracted_at && recent) return true;
      if (
        kind === "vpd" &&
        d.ai_status === "complete" &&
        (!d.vpd_extracted_at || !d.cs_goals_extracted_at) &&
        recent
      )
        return true;
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
        !sessionStorage.getItem(appliedKey(d.id, d.mom_extracted_at)) &&
        !localStorage.getItem(appliedKey(d.id, d.mom_extracted_at)),
    );
    if (pending.length === 0) return;
    // Mark synchronously to prevent re-entry while the async work runs.
    pending.forEach((d) =>
      sessionStorage.setItem(appliedKey(d.id, d.mom_extracted_at), "1"),
    );
    void Promise.all(pending.map(async (d) => {
      const r = d.mom_extracted_fields as unknown as MomExtractionResult;
      saveExtractionDraft(accountId, {
        filename: d.filename,
        appliedAt: new Date().toISOString(),
        engagement: hasAnyEngagement(r.engagement) ? r.engagement : undefined,
        brief: hasAnyBrief(r.brief) ? r.brief : undefined,
      });
      const stats = await createExtractedContacts(accountId, r.contacts || []);
      // M16.1 — also land account-header chips. Fill-blank-only semantics
      // (same pattern as VPD candidate writes) so CSM edits aren't clobbered
      // by a re-extracted MoM.
      const accountUpdated = await applyExtractedAccountFields(
        accountId,
        r.account_fields,
      );
      // 05-Jun — auto-PATCH the brief to the server so the Presentation
      // mode shows populated data immediately (no "click Generate" step).
      // Fill-blank-only so manual edits aren't trampled by re-uploads.
      const briefApplied = hasAnyBrief(r.brief)
        ? await autoApplyExtractedBrief(accountId, r.brief)
        : 0;
      // Persist the applied marker so reloads don't re-create contacts.
      localStorage.setItem(
        appliedKey(d.id, d.mom_extracted_at),
        new Date().toISOString(),
      );
      const parts: string[] = [];
      if (hasAnyEngagement(r.engagement)) parts.push("engagement");
      if (briefApplied > 0)
        parts.push(`${briefApplied} brief field${briefApplied === 1 ? "" : "s"}`);
      if (accountUpdated > 0) {
        parts.push(`${accountUpdated} account field${accountUpdated === 1 ? "" : "s"}`);
      }
      if (stats.created > 0) parts.push(`${stats.created} contact${stats.created === 1 ? "" : "s"}`);
      const skipped = stats.skipped > 0 ? ` · ${stats.skipped} duplicate contact skipped` : "";
      setExtractionToast(
        parts.length
          ? `Populated ${parts.join(", ")} from "${d.filename}". Brief is ready to view; review engagement on Pre-Sales and click Save.${skipped}`
          : `Extraction from "${d.filename}" found no new fields to apply.${skipped}`,
      );
      qc.invalidateQueries({ queryKey: ["engagement", accountId] });
      qc.invalidateQueries({ queryKey: ["meeting-brief", accountId] });
      qc.invalidateQueries({ queryKey: ["contacts", accountId] });
      if (accountUpdated > 0) {
        qc.invalidateQueries({ queryKey: ["account", accountId] });
      }
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.items, kind, accountId]);

  // Auto-apply VPD extraction — same shape as the MoM block above. Writes
  // the structured Solutioning candidate values as a dirty draft on the
  // Solutioning form. User reviews + clicks Save to persist.
  useEffect(() => {
    if (kind !== "vpd" || !data?.items) return;
    const pending = data.items.filter(
      (d) =>
        !d.deleted_at &&
        d.vpd_extracted_fields &&
        !sessionStorage.getItem(appliedKey(d.id, d.vpd_extracted_at)) &&
        !localStorage.getItem(appliedKey(d.id, d.vpd_extracted_at)),
    );
    if (pending.length === 0) return;
    pending.forEach((d) =>
      sessionStorage.setItem(appliedKey(d.id, d.vpd_extracted_at), "1"),
    );
    pending.forEach((d) => {
      const v = d.vpd_extracted_fields as unknown as ExtractedVpd;
      if (!hasAnyVpd(v)) {
        localStorage.setItem(
          appliedKey(d.id, d.vpd_extracted_at),
          new Date().toISOString(),
        );
        return;
      }
      saveExtractionDraft(accountId, {
        filename: d.filename,
        appliedAt: new Date().toISOString(),
        solutioning: v,
      });
      localStorage.setItem(
        appliedKey(d.id, d.vpd_extracted_at),
        new Date().toISOString(),
      );
      setExtractionToast(
        `Populated Solutioning fields from "${d.filename}". Review on the Solutioning tab and click Save.`,
      );
      qc.invalidateQueries({ queryKey: ["solutioning", accountId] });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.items, kind, accountId]);

  // Auto-apply Handoff extraction (kind='contract'): when the worker
  // lands handoff_extracted_fields on a contract upload, stash the
  // structured fields as the "handoff" slice. SalesHandoffTab consumes
  // it on mount (or via EXTRACTION_APPLIED_EVENT) and merges into
  // signForm — the sticky save bar pulses, the CSM reviews + signs.
  useEffect(() => {
    if (kind !== "contract" || !data?.items) return;
    const pending = data.items.filter(
      (d) =>
        !d.deleted_at &&
        d.handoff_extracted_fields &&
        !sessionStorage.getItem(appliedKey(d.id, d.handoff_extracted_at)) &&
        !localStorage.getItem(appliedKey(d.id, d.handoff_extracted_at)),
    );
    if (pending.length === 0) return;
    pending.forEach((d) =>
      sessionStorage.setItem(appliedKey(d.id, d.handoff_extracted_at), "1"),
    );
    pending.forEach((d) => {
      const h = d.handoff_extracted_fields as unknown as HandoffExtractionResult;
      if (!hasAnyHandoff(h)) {
        // 09-Jun bug (Bug Tracker · Jun-8 #3) — previously silent.
        // Tester uploaded a contract PDF and saw nothing happen because
        // either (a) PDF was image-only and markitdown returned nothing,
        // or (b) Claude couldn't pull fields from the text. Now we
        // surface a clear toast so the CSM knows to fill manually
        // instead of waiting for an auto-fill that won't arrive.
        setExtractionToast(
          `AI couldn't pull contract terms from "${d.filename}" — open Sales Hand-off and fill the fields manually.`,
        );
        localStorage.setItem(
          appliedKey(d.id, d.handoff_extracted_at),
          new Date().toISOString(),
        );
        return;
      }
      saveExtractionDraft(accountId, {
        filename: d.filename,
        appliedAt: new Date().toISOString(),
        handoff: h,
      });
      localStorage.setItem(
        appliedKey(d.id, d.handoff_extracted_at),
        new Date().toISOString(),
      );
      setExtractionToast(
        `Populated Client Signed fields from "${d.filename}". Review on Sales Hand-off and click Save.`,
      );
      qc.invalidateQueries({ queryKey: ["signing-gate", accountId] });
    });
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
    onSuccess: (job, docId) => {
      setActiveJobIds((s) => [...s, job.id]);
      // Clear the "already applied" flags for this doc so the auto-apply
      // useEffect will pick up the fresh extracted fields when the worker
      // finishes. Without this, a doc that was applied once (possibly
      // with stub data) is locked out from re-apply on subsequent reruns.
      wipeAppliedFlags(docId);
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
    // 11-Jun · Pass contract_subtype when the caller surfaced a
    // dropdown (kind='contract' only — backend ignores subtype on
    // other kinds). Migration 0059 enforces the canonical set via
    // CHECK constraint.
    if (
      kind === "contract" &&
      contractSubtypes &&
      pendingSubtype &&
      contractSubtypes.includes(pendingSubtype)
    ) {
      fd.append("contract_subtype", pendingSubtype);
    }
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
      setUploadStatus(`✓ ${ok} uploaded${dup ? ` · ${dup} duplicate` : ""}. AI is processing — watch the pill below.`);
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

  // Bug 1 — upload availability follows the documents endpoint's
  // is_editable, which reflects can_write_documents(role, kind, ...).
  // Roles that can't write the kind (e.g. a CSM viewing a VPD they can't
  // upload) get a disabled file input + paste button + read-only badge.
  const canUpload = data?.is_editable ?? false;

  return (
    <div className="space-y-3">
      {/* Drag-drop card */}
      <div
        onDragOver={(e) => {
          if (!canUpload) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          if (!canUpload) return;
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          "bg-white rounded-card border-2 border-dashed p-5 transition-colors",
          !canUpload && "opacity-70",
          dragOver ? "border-beroe-blue bg-beroe-blue/5" : "border-beroe-card-border",
        )}
      >
        <div className="flex items-start gap-3 mb-3">
          <div className="text-2xl shrink-0">📄</div>
          <div className="flex-1">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1.5">
                <h2 className="text-sm font-bold text-text-primary">{title}</h2>
                {/* 03-Jun bug 6 — long description is now a hover-tooltip
                    on the (i) icon next to the title, not inline text. */}
                <HelpTooltip text={description} />
              </div>
              {headerAction}
            </div>
            {/* Hidden — kept around so removing description doesn't break
                downstream consumers; replaced by the tooltip above. */}
            <p className="sr-only">{description}</p>
            {!isLoading && !canUpload && (
              <p className="text-[11px] mt-1 text-beroe-amber bg-beroe-amber/15 border border-beroe-amber/40 rounded px-2 py-1 inline-block">
                Read-only — your role can't upload {kind === "vpd" ? "VPDs" : kind === "mom" ? "MoMs" : "this"} on this account.
              </p>
            )}
          </div>
        </div>
        {/* 11-Jun · Contract subtype dropdown. Shown only when the
            caller passes a contractSubtypes list AND kind='contract'.
            The selection rides on the next upload as form field
            `contract_subtype`. */}
        {kind === "contract" && contractSubtypes && contractSubtypes.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
              Document Type
            </label>
            <select
              value={pendingSubtype}
              onChange={(e) => setPendingSubtype(e.target.value)}
              disabled={!!uploadStatus || !canUpload}
              className="text-[12px] px-2 py-1.5 rounded-md border border-beroe-card-border bg-white focus:border-beroe-blue outline-none"
            >
              {contractSubtypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <span className="text-[10px] text-text-muted">
              · pick the type before uploading
            </span>
          </div>
        )}
        <div className="flex items-center gap-3 flex-wrap">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ALLOWED_EXT}
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
            disabled={!!uploadStatus || !canUpload}
            className="text-sm flex-1 min-w-[260px]"
          />
          {/* Bug 6 — paste-text option. Opens a textarea modal; pasted
              content uploads as a synthetic .txt file so it flows through
              the same Celery → AI → extraction pipeline as a real upload. */}
          <PasteTextButton
            kind={kind}
            disabled={!!uploadStatus || !canUpload}
            onPaste={async (text) => {
              const stamp = new Date().toISOString().replace(/[:.]/g, "-");
              const blob = new Blob([text], { type: "text/plain" });
              const file = new File(
                [blob],
                `pasted-${kind}-${stamp}.txt`,
                { type: "text/plain" },
              );
              await handleFiles([file]);
            }}
          />
          <span className="text-[10px] text-text-muted inline-flex items-center gap-1">
            Drag files anywhere on this card · max {MAX_MB} MB
            <span className="relative inline-flex group">
              <span
                tabIndex={0}
                role="button"
                aria-label="Show supported file types"
                className="cursor-help w-3.5 h-3.5 inline-flex items-center justify-center rounded-full border border-beroe-card-border text-[9px] leading-none text-text-muted hover:text-beroe-blue hover:border-beroe-blue/40 focus:outline-none focus:ring-1 focus:ring-beroe-blue/40"
              >
                ?
              </span>
              <span
                role="tooltip"
                className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-[140%] z-20 whitespace-nowrap rounded-md bg-beroe-navy text-white text-[10px] leading-tight px-2 py-1.5 shadow-lg opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
              >
                Supported: {ALLOWED_EXT.replaceAll(",", " · ")}
                <span className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-beroe-navy" />
              </span>
            </span>
          </span>
        </div>
        {uploadStatus && (
          <div
            className={cn(
              "mt-3 px-3 py-2 rounded-lg text-sm border flex items-center gap-2",
              uploadStatus.startsWith("✓")
                ? "bg-beroe-green/15 border-beroe-green/30 text-beroe-green"
                : "bg-beroe-blue/10 border-beroe-blue/30 text-beroe-blue animate-pulse",
            )}
          >
            {!uploadStatus.startsWith("✓") && (
              <span className="inline-block w-3 h-3 rounded-full bg-beroe-blue/100 animate-pulse" />
            )}
            {uploadStatus}
          </div>
        )}
        {uploadError && (
          <div className="mt-2 text-xs text-beroe-red bg-beroe-red/10 border border-beroe-red/30 rounded-lg px-3 py-2">
            {uploadError}
          </div>
        )}
      </div>

      {/* Live processing banner */}
      {liveCount > 0 && (
        <div className="bg-beroe-blue/10 border border-beroe-blue/30 rounded-card px-4 py-2.5 flex items-center gap-2 text-xs text-beroe-blue">
          <span className="inline-block w-2 h-2 rounded-full bg-beroe-blue/100 animate-pulse" />
          <b>{liveCount}</b>
          <span>{DOC_KIND_LABELS[kind]}{liveCount === 1 ? "" : "s"} processing — AI is reading them now.</span>
        </div>
      )}

      {/* List */}
      <div className="bg-white rounded-card border border-beroe-card-border overflow-hidden">
        <div className="px-5 py-3 border-b border-beroe-card-border/60 flex items-center justify-between">
          <h3 className="text-sm font-bold text-text-primary">
            {DOC_KIND_LABELS[kind]} ({visible.length})
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
                accountId={accountId}
                onDelete={async () => {
                  const ok = await confirm({
                    title: "Delete this document?",
                    body: `Soft-delete "${d.filename}". Admins can restore within 30 days.`,
                    confirmLabel: "Delete",
                    danger: true,
                  });
                  if (ok) deleteMutation.mutate(d.id);
                }}
                onRerun={async () => {
                  const ok = await confirm({
                    title: "Re-run AI summary?",
                    body: `Existing summary for "${d.filename}" will be replaced.`,
                    confirmLabel: "Re-run AI",
                    tone: "info",
                  });
                  if (ok) rerunMutation.mutate(d.id);
                }}
              />
            ))}
          </ul>
        )}
      </div>

      {extractionToast && (
        <div className="bg-beroe-green/15 border border-beroe-green/30 text-beroe-green rounded-card px-4 py-2.5 text-xs flex items-start gap-2">
          <span className="font-bold mt-0.5">✓</span>
          <span className="flex-1">{extractionToast}</span>
          <button
            onClick={() => setExtractionToast(null)}
            className="text-beroe-green/60 hover:text-beroe-green leading-none px-1"
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
  accountId,
  onDelete,
  onRerun,
}: {
  doc: Document;
  accountId: string;
  onDelete: () => void;
  onRerun: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [goalsModalOpen, setGoalsModalOpen] = useState(false);
  const age = Date.now() - new Date(doc.uploaded_at).getTime();
  const inFlight =
    (doc.ai_status === "processing" || doc.ai_status === "pending") && age < 90_000;
  return (
    <li className="px-5 py-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-text-primary truncate">{doc.filename}</span>
            {/* 11-Jun · Contract subtype pill (only when set) — gives
                Audit a quick visual category for each contract upload. */}
            {doc.contract_subtype && (
              <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-beroe-blue/10 text-beroe-blue border border-beroe-blue/20">
                {doc.contract_subtype}
              </span>
            )}
            <StatusPill status={doc.ai_status} />
            {doc.ai_status === "complete" && (
              <span
                className={cn(
                  "text-[10px] font-bold px-1.5 py-0.5 rounded-full",
                  doc.ai_edited ? "bg-beroe-purple/15 text-beroe-purple" : "bg-beroe-teal/15 text-beroe-teal",
                )}
                title={doc.ai_edited ? "Edited by a human after AI generation" : "Generated by AI — untouched"}
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
          {/* Bug 3 — per-document notes (prototype parity) */}
          <NotesEditor docId={doc.id} initial={doc.notes} accountId={accountId} />
          {/* M15.1 — VPD candidate-goals review CTA */}
          {/* M15.1 + 09-Jun G3 — VPD candidate-goals CTA.
              The auto-extract runs server-side on every VPD upload
              (workers/tasks.py · extract_cs_goals_from_vpd) and
              persists candidates to cs_goals_extracted. Spec gap-pill
              "Auto-extraction confirmVDDGoals() exists in v21 but
              proto skips the step" was diagnosed as a visibility
              problem — the previous CTA was a 12px purple text link
              tucked under the row, easy to miss. Promoted to a
              full-width pulsing pill so the candidate-goals queue is
              impossible to overlook. */}
          {doc.kind === "vpd" &&
            (() => {
              // 10-Jun · Goals = Success Metrics — Metrics tab was removed
              // from the VPD review modal. The CTA now shows only the
              // goal count (the same row IS the success metric) and
              // skips the metric count entirely.
              const goalsExtracted = doc.cs_goals_extracted as unknown as CsGoalsExtractionResult | null;
              const goalCount = goalsExtracted?.goals?.length ?? 0;
              if (goalCount === 0) return null;
              return (
                <button
                  onClick={() => setGoalsModalOpen(true)}
                  className="mt-2 w-full flex items-center gap-2 rounded-lg border px-3 py-1.5 text-left hover:brightness-105 transition"
                  style={{
                    background: "#fdf0fd",
                    borderColor: "#C344C7",
                    color: "#7a1a90",
                  }}
                  title="AI extracted candidate Success Metrics (Goals) from this VPD — review and create"
                >
                  <span className="relative flex h-2 w-2 flex-shrink-0">
                    <span
                      className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60"
                      style={{ background: "#C344C7" }}
                    />
                    <span
                      className="relative inline-flex rounded-full h-2 w-2"
                      style={{ background: "#C344C7" }}
                    />
                  </span>
                  <span className="text-[12px] font-bold">
                    🎯 {goalCount} Success Metric{goalCount === 1 ? "" : "s"} extracted
                  </span>
                  <span className="text-[11px] opacity-80 hidden sm:inline">
                    — review and create
                  </span>
                  <span className="ml-auto text-[12px] font-bold">→</span>
                </button>
              );
            })()}
        </div>
        <div className="flex gap-3 shrink-0">
          {/* 04-Jun bug — Download the source file via a signed 5-min URL
              from /api/v1/documents/:id/download-url. Click triggers a
              fresh fetch each time (URLs expire). */}
          <button
            onClick={async () => {
              try {
                const r = await api.get<{ url: string }>(
                  `/api/v1/documents/${doc.id}/download-url`,
                );
                window.open(r.url, "_blank");
              } catch (e) {
                alert(
                  "Couldn't fetch the download link: " +
                    (e instanceof Error ? e.message : String(e)),
                );
              }
            }}
            className="text-xs text-beroe-blue hover:underline font-semibold"
            title="Download the original file"
          >
            Download
          </button>
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
            className="text-xs text-beroe-red hover:underline font-semibold"
          >
            Delete
          </button>
        </div>
      </div>
      {goalsModalOpen && (doc.cs_goals_extracted || doc.metrics_extracted) && (
        <VpdExtractionReview
          accountId={accountId}
          documentName={doc.filename}
          goals={
            doc.cs_goals_extracted
              ? ({
                  ...(doc.cs_goals_extracted as unknown as CsGoalsExtractionResult),
                  goals: ((doc.cs_goals_extracted as unknown as CsGoalsExtractionResult).goals ??
                    []) as ExtractedGoal[],
                } satisfies CsGoalsExtractionResult)
              : null
          }
          metrics={
            doc.metrics_extracted
              ? ({
                  ...(doc.metrics_extracted as unknown as VpdMetricsExtractionResult),
                  metrics: ((doc.metrics_extracted as unknown as VpdMetricsExtractionResult)
                    .metrics ?? []) as ExtractedMetric[],
                } satisfies VpdMetricsExtractionResult)
              : null
          }
          onClose={() => setGoalsModalOpen(false)}
        />
      )}
    </li>
  );
}

function StatusPill({ status }: { status: AiStatus }) {
  const tone =
    status === "complete" ? "bg-beroe-green/20 text-beroe-green"
      : status === "failed" ? "bg-beroe-red/15 text-beroe-red"
        : status === "processing" ? "bg-beroe-blue/15 text-beroe-blue animate-pulse"
          : "bg-beroe-amber/20 text-beroe-amber";
  return (
    <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-full", tone)}>
      {AI_STATUS_LABELS[status]}
    </span>
  );
}

/** Extraction state for MoM (kind='mom') and VPD (kind='vpd') docs.
 *
 *  Hidden for other kinds and while AI summary is still running. Once
 *  ai_status flips to "complete":
 *    - <kind>_extracted_at set  → "Fields populated" (violet, success)
 *    - within 2 min of upload   → "Extracting fields…" (blue, animated)
 *    - >2 min and still no data → silent (the Rerun button is the fix)
 *  The 2-min window matches the polling-loop liveCount logic above so the
 *  card keeps refetching exactly as long as this pill is "Extracting…". */
/** Bug 6 — "Paste text" upload affordance.
 *  Some MoM bodies live in the inbox without a file attached. This button
 *  opens a textarea modal; on save the text is wrapped in a synthetic
 *  pasted-{kind}-{ts}.txt File and pushed through the regular upload
 *  flow — Celery picks it up just like a dropped file. */
function PasteTextButton({
  kind,
  disabled,
  onPaste,
}: {
  kind: DocKind;
  disabled: boolean;
  onPaste: (text: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="text-[12px] px-2.5 py-1.5 rounded-md border border-beroe-card-border bg-white hover:bg-beroe-bg/60 font-semibold disabled:opacity-40"
        title="Paste text content directly (e.g. an MoM body from email)"
      >
        Paste text
      </button>
    );
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-[min(640px,95vw)] p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[13px] font-bold">
            Paste {kind === "mom" ? "MoM" : kind === "vpd" ? "VPD" : "document"} text
          </div>
          <button
            onClick={() => setOpen(false)}
            className="text-text-muted hover:text-text-primary text-lg leading-none"
          >
            ×
          </button>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={14}
          placeholder="Paste the body content here — markdown, plain text, or copied email."
          className="w-full text-[12px] border border-beroe-card-border rounded-md px-2 py-1.5 font-mono"
          autoFocus
        />
        <div className="flex justify-end gap-2 mt-3">
          <button
            onClick={() => setOpen(false)}
            className="text-[12px] px-3 py-1.5 rounded-md border border-beroe-card-border hover:bg-beroe-bg/60"
          >
            Cancel
          </button>
          <button
            disabled={busy || text.trim().length < 10}
            onClick={async () => {
              setBusy(true);
              try {
                await onPaste(text);
                setOpen(false);
                setText("");
              } finally {
                setBusy(false);
              }
            }}
            className="text-[12px] px-3 py-1.5 rounded-md bg-beroe-blue text-white font-semibold disabled:opacity-50"
          >
            {busy ? "Uploading…" : "Upload as text"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Bug 3 — per-document free-text notes (prototype parity).
 *  Save-on-blur or Cmd/Ctrl+Enter. Editable for anyone with documents-
 *  write access (backend enforces); the field itself stays visible
 *  read-only for non-writers so existing notes remain referenceable. */
function NotesEditor({
  docId,
  initial,
  accountId,
}: {
  docId: string;
  initial: string | null;
  accountId: string;
}) {
  const qc = useQueryClient();
  const [val, setVal] = useState(initial ?? "");
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setVal(initial ?? "");
    setDirty(false);
  }, [initial]);

  const save = useMutation({
    mutationFn: () =>
      api.patch<Document>(`/api/v1/documents/${docId}/notes`, { notes: val }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["documents", accountId] });
      setDirty(false);
      setErr(null);
      setEditing(false);
    },
    onError: (e: ApiError) => setErr(e.message),
  });

  // Compact: not editing + empty + no value → tiny "Add note" link.
  if (!editing && !val) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="mt-1 text-[11px] text-text-muted hover:text-beroe-blue font-medium"
      >
        + Add note
      </button>
    );
  }

  return (
    <div className="mt-2">
      <div className="text-[10px] uppercase tracking-wider font-bold text-text-muted mb-0.5">
        Notes
      </div>
      <textarea
        value={val}
        onChange={(e) => {
          setVal(e.target.value);
          setDirty(true);
          if (!editing) setEditing(true);
        }}
        onFocus={() => setEditing(true)}
        onBlur={() => {
          if (dirty) save.mutate();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && dirty) {
            save.mutate();
          }
        }}
        rows={2}
        maxLength={4000}
        placeholder="Add remarks about this document (Cmd/Ctrl+Enter to save)"
        className="w-full text-[12px] border border-beroe-card-border rounded-md px-2 py-1.5 bg-white focus:border-beroe-blue focus:outline-none"
      />
      {dirty && (
        <div className="text-[10px] text-beroe-amber mt-0.5">
          Unsaved — click outside or press Cmd/Ctrl+Enter to save
        </div>
      )}
      {err && (
        <div className="text-[10px] text-beroe-red mt-0.5">{err}</div>
      )}
    </div>
  );
}

function MomExtractionPill({ doc }: { doc: Document }) {
  if (doc.kind !== "mom" && doc.kind !== "vpd") return null;
  if (doc.ai_status !== "complete") return null;
  const extractedAt = doc.kind === "mom" ? doc.mom_extracted_at : doc.vpd_extracted_at;
  const targetCopy = doc.kind === "mom"
    ? "Pre-Sales + Brief"
    : "the Solutioning tab";
  if (extractedAt) {
    return (
      <span
        className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-beroe-purple/15 text-beroe-purple"
        title={`Fields auto-populated on ${new Date(extractedAt).toLocaleString()} — review and Save on ${targetCopy}`}
      >
        Fields populated
      </span>
    );
  }
  const age = Date.now() - new Date(doc.uploaded_at).getTime();
  if (age > 120_000) return null;
  return (
    <span
      className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-beroe-blue/15 text-beroe-blue animate-pulse"
      title={`AI is extracting structured fields from this ${doc.kind === "mom" ? "MoM" : "VPD"} — ${targetCopy} will pre-fill in a moment.`}
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

/** Per-doc applied marker.
 *
 * 05-Jun — keyed by `(docId, extractedAt)` so a re-extraction (worker
 * ran again, new mom_extracted_at / vpd_extracted_at / handoff_extracted_at)
 * invalidates the marker and the auto-apply re-fires with the fresh
 * payload. Without the timestamp, the first run wins forever — even if
 * the first run came back empty because of a transient Claude error. */
function appliedKey(docId: string, stamp?: string | null): string {
  const base = `awb:extraction-applied:${docId}`;
  return stamp ? `${base}:${stamp}` : base;
}

/** Scan localStorage / sessionStorage and wipe every applied marker for
 *  this doc — regardless of which extraction stamp was used. Called when
 *  the doc is soft-deleted so a re-upload with the same id starts fresh. */
function wipeAppliedFlags(docId: string): void {
  const prefix = `awb:extraction-applied:${docId}`;
  for (const store of [localStorage, sessionStorage]) {
    for (let i = store.length - 1; i >= 0; i--) {
      const k = store.key(i);
      if (k && k.startsWith(prefix)) store.removeItem(k);
    }
  }
}

function hasAnyEngagement(e: MomExtractionResult["engagement"] | undefined): boolean {
  if (!e) return false;
  return Boolean(
    e.engagement_objective || e.spoc_text || e.sponsor_text || e.procurement_maturity ||
    e.meeting_type || (e.target_categories?.length ?? 0) > 0 || (e.geographies?.length ?? 0) > 0,
  );
}

function hasAnyVpd(v: ExtractedVpd | undefined): boolean {
  if (!v) return false;
  return Boolean(
    v.proposed_solution || v.engagement_type || v.engagement_duration_months ||
    v.value_definition || v.estimated_value_musd !== null ||
    (v.value_themes?.length ?? 0) > 0,
  );
}

function hasAnyHandoff(h: HandoffExtractionResult | undefined): boolean {
  if (!h) return false;
  return Boolean(
    // Direct gate columns
    h.gate_signed_date ||
      h.gate_renewal_date ||
      h.gate_contract_acv_usd ||
      h.gate_contract_term ||
      h.gate_platform_tier ||
      h.gate_account_segment ||
      h.gate_subscribers ||
      (h.gate_contract_modules?.length ?? 0) > 0 ||
      // 05-Jun — Contract Audit "extras"
      h.tcv ||
      h.billing_freq ||
      h.payment_terms ||
      h.discount ||
      h.discount_reason ||
      h.geography ||
      h.module_caveats ||
      h.audit_notes ||
      h.other_terms,
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

// M16.1 — apply MoM-extracted account-header chips to the account header.
// Returns how many fields actually got written. Fill-blank-only: if a field
// is already set on the account (e.g. CSM edited it after handoff), the
// extraction won't overwrite it. Maps tier_band → tier.
async function applyExtractedAccountFields(
  accountId: string,
  fields: {
    industry: string | null;
    country: string | null;
    headquarters: string | null;
    annual_revenue_text: string | null;
    tier_band: string | null;
    sf_link: string | null;
  } | null | undefined,
): Promise<number> {
  if (!fields) return 0;
  let current: {
    industry: string | null;
    country: string | null;
    headquarters: string | null;
    annual_revenue_text: string | null;
    tier: string | null;
    sf_link: string | null;
  };
  try {
    current = await api.get(`/api/v1/accounts/${accountId}`);
  } catch {
    return 0;
  }
  const patch: Record<string, string> = {};
  const setIfBlank = (
    key: "industry" | "country" | "headquarters" | "annual_revenue_text" | "tier" | "sf_link",
    incoming: string | null | undefined,
  ) => {
    if (!incoming) return;
    const existing = (current as Record<string, string | null>)[key];
    if (existing && existing.trim()) return;
    patch[key] = incoming;
  };
  setIfBlank("industry", fields.industry);
  setIfBlank("country", fields.country);
  setIfBlank("headquarters", fields.headquarters);
  setIfBlank("annual_revenue_text", fields.annual_revenue_text);
  setIfBlank("tier", fields.tier_band);
  setIfBlank("sf_link", fields.sf_link);
  if (Object.keys(patch).length === 0) return 0;
  try {
    await api.patch(`/api/v1/accounts/${accountId}`, patch);
    return Object.keys(patch).length;
  } catch {
    return 0;
  }
}

// 05-Jun — auto-apply the MoM-extracted brief slice to the server so
// the Pre-Meeting Brief popup (Presentation mode) shows populated data
// immediately. Fill-blank-only semantics — if a field is already set
// (manual edit OR previous extraction), leave it alone. Returns the
// count of fields actually patched so the toast can mention it.
async function autoApplyExtractedBrief(
  accountId: string,
  brief: MomExtractionResult["brief"] | undefined,
): Promise<number> {
  if (!brief) return 0;

  type AnyRec = Record<string, unknown>;
  let current: AnyRec;
  try {
    current = (await api.get(
      `/api/v1/accounts/${accountId}/meeting-brief`,
    )) as AnyRec;
  } catch {
    return 0;
  }

  const patch: AnyRec = {};
  const briefRec = brief as unknown as AnyRec;

  // Scalars — set only when current is blank/null.
  const scalarKeys = [
    "call_date",
    "call_type",
    "call_duration_minutes",
    "call_time",
    "call_platform",
    "win_condition",
    "cheat_sheet_win_condition_short",
  ] as const;
  for (const k of scalarKeys) {
    const incoming = briefRec[k];
    const existing = current[k];
    if (incoming != null && incoming !== "" && (existing == null || existing === "")) {
      patch[k] = incoming;
    }
  }

  // List fields — replace when current list is empty.
  const listKeys = [
    "company_snapshot",
    "attendees",
    "objectives",
    "minefields",
    "closing_scenarios",
    "news",
    "public_signals",
    "value_anchors",
    "email_insights",
    "cheat_sheet_never_say",
    "cheat_sheet_opening_asks",
    "categories",
  ] as const;
  for (const k of listKeys) {
    const incoming = briefRec[k] as unknown[] | undefined;
    const existing = current[k] as unknown[] | undefined;
    if (
      incoming &&
      incoming.length > 0 &&
      (!existing || existing.length === 0)
    ) {
      patch[k] = incoming;
    }
  }

  if (Object.keys(patch).length === 0) return 0;
  try {
    await api.patch(`/api/v1/accounts/${accountId}/meeting-brief`, patch);
    return Object.keys(patch).length;
  } catch {
    return 0;
  }
}

async function createExtractedContacts(
  accountId: string,
  contacts: ExtractedContact[],
): Promise<{ created: number; skipped: number; failed: number }> {
  let created = 0;
  let skipped = 0;
  let failed = 0;

  // LIVE-008 — pre-filter against existing contacts so duplicates don't
  // generate noisy 409 errors in the browser console. The dedup rule
  // (name OR email, case-insensitive) is mirrored client-side. Server-side
  // unique index is still the source of truth on the rare race.
  type ExistingContact = { name: string | null; email: string | null };
  let existing: ExistingContact[] = [];
  try {
    const r = await api.get<{ items: ExistingContact[] }>(
      `/api/v1/accounts/${accountId}/contacts`,
    );
    existing = r.items ?? [];
  } catch {
    /* fall through; server-side dedup will catch dupes */
  }
  const existingNames = new Set(
    existing.map((c) => (c.name ?? "").trim().toLowerCase()).filter(Boolean),
  );
  const existingEmails = new Set(
    existing.map((c) => (c.email ?? "").trim().toLowerCase()).filter(Boolean),
  );

  // ExtractedContact has no email field, so we dedup on name only here.
  // existingEmails is kept for future MoM schemas that include email.
  void existingEmails;
  await Promise.all(
    contacts
      .filter((c) => !c.is_internal_beroe && c.name)
      .map(async (c) => {
        const nm = (c.name ?? "").trim().toLowerCase();
        if (existingNames.has(nm)) {
          skipped += 1;
          return;
        }
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

// 03-Jun bug 6 — HeaderHelpTooltip extracted to @/components/HelpTooltip
// so every Section/Card helper across the app can reach the same atom.
