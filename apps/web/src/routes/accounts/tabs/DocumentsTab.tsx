import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { authProvider } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { useAccountFromLayout } from "../AccountProfileLayout";
import {
  AI_STATUS_LABELS,
  DOC_KIND_LABELS,
  type AiStatus,
  type DiscoverySummary,
  type DocKind,
  type Document,
  type DocumentListResponse,
  type DocumentUploadResponse,
  type Job,
} from "@/types/document";

const KIND_OPTIONS: DocKind[] = ["mom", "vpd", "transcript", "email", "other"];
const ALLOWED_EXT = ".docx,.pdf,.txt,.vtt";
const MAX_MB = 100;

export default function DocumentsTab() {
  const account = useAccountFromLayout();
  const qc = useQueryClient();
  const [kind, setKind] = useState<DocKind>("mom");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [activeJobIds, setActiveJobIds] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, isError } = useQuery<DocumentListResponse>({
    queryKey: ["documents", account.id],
    queryFn: () =>
      api.get<DocumentListResponse>(`/api/v1/accounts/${account.id}/documents`),
  });

  const { data: discovery } = useQuery<DiscoverySummary>({
    queryKey: ["discovery-summary", account.id],
    queryFn: () =>
      api.get<DiscoverySummary>(`/api/v1/accounts/${account.id}/discovery-summary`),
  });

  // Poll active jobs every 1.5s; drop terminal ones; refresh on every tick so
  // the row's status pill flips visibly even if no job left the active set.
  useEffect(() => {
    if (activeJobIds.length === 0) return;
    let cancelled = false;
    const tick = async () => {
      const stillActive: string[] = [];
      let anyTerminal = false;
      for (const jid of activeJobIds) {
        try {
          const job = await api.get<Job>(`/api/v1/jobs/${jid}`);
          if (job.status === "complete" || job.status === "failed") {
            anyTerminal = true;
          } else {
            stillActive.push(jid);
          }
        } catch { /* drop */ }
      }
      if (cancelled) return;
      // Always invalidate the documents list so the pill animation feels live.
      qc.invalidateQueries({ queryKey: ["documents", account.id] });
      if (anyTerminal) {
        qc.invalidateQueries({ queryKey: ["discovery-summary", account.id] });
        qc.invalidateQueries({ queryKey: ["solutioning", account.id] });
        qc.invalidateQueries({ queryKey: ["activity", account.id] });
      }
      setActiveJobIds(stillActive);
    };
    const id = window.setInterval(tick, 1_500);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [activeJobIds, account.id, qc]);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/v1/documents/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["documents", account.id] });
      qc.invalidateQueries({ queryKey: ["discovery-summary", account.id] });
      qc.invalidateQueries({ queryKey: ["activity", account.id] });
    },
  });

  const rerunMutation = useMutation({
    mutationFn: (id: string) => api.post<Job>(`/api/v1/documents/${id}/rerun-ai`),
    onSuccess: (job) => {
      setActiveJobIds((s) => [...s, job.id]);
      qc.invalidateQueries({ queryKey: ["documents", account.id] });
    },
  });

  const editSummaryMutation = useMutation({
    mutationFn: ({ id, ai_summary_text }: { id: string; ai_summary_text: string }) =>
      api.patch<Document>(`/api/v1/documents/${id}/summary`, { ai_summary_text }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["documents", account.id] });
      qc.invalidateQueries({ queryKey: ["activity", account.id] });
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
      `${import.meta.env.VITE_API_BASE_URL}/api/v1/accounts/${account.id}/documents`,
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
      setUploadStatus(
        arr.length === 1
          ? `Uploading ${f.name}…`
          : `Uploading ${i + 1} of ${arr.length}: ${f.name}`,
      );
      const res = await uploadOne(f);
      if (!res.ok) { errs.push(`${f.name}: ${res.error}`); continue; }
      if (res.duplicate) { dup += 1; continue; }
      ok += 1;
      if (res.jobId) newJobs.push(res.jobId);
    }
    if (newJobs.length) setActiveJobIds((s) => [...s, ...newJobs]);
    qc.invalidateQueries({ queryKey: ["documents", account.id] });
    if (errs.length) {
      setUploadStatus(null);
      setUploadError(errs.join(" · "));
    } else if (ok > 0) {
      // Show success toast briefly — banner takes over for the processing phase.
      setUploadStatus(
        `✓ ${ok} uploaded${dup ? ` · ${dup} duplicate` : ""}. Claude is processing — watch the status pill below.`,
      );
      window.setTimeout(() => setUploadStatus(null), 5000);
    } else if (dup) {
      setUploadStatus(`${dup} duplicate (already on this account)`);
      window.setTimeout(() => setUploadStatus(null), 4000);
    } else {
      setUploadStatus(null);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Live "currently processing" set — derived from list state, not just the
  // jobs we kicked off this session, so a refresh keeps showing them.
  const liveProcessingCount =
    data?.items.filter(
      (d) => !d.deleted_at && (d.ai_status === "pending" || d.ai_status === "processing"),
    ).length ?? 0;

  // Auto-refresh while any doc is non-terminal, even if no in-session job was
  // tracked (e.g. user hits the page after upload, or another user kicked it off).
  // MUST be before any early return so hook order stays stable across renders.
  useEffect(() => {
    if (liveProcessingCount === 0) return;
    const id = window.setInterval(() => {
      qc.invalidateQueries({ queryKey: ["documents", account.id] });
    }, 1_500);
    return () => window.clearInterval(id);
  }, [liveProcessingCount, account.id, qc]);

  if (isLoading) return <div className="text-sm text-text-muted">Loading documents…</div>;
  if (isError || !data) return <div className="text-sm text-red-700">Failed to load documents.</div>;

  const liveProcessing = data.items.filter(
    (d) => !d.deleted_at && (d.ai_status === "pending" || d.ai_status === "processing"),
  );

  return (
    <div className="space-y-4">
      {/* Live processing banner */}
      {liveProcessing.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-center gap-3">
          <span className="inline-block w-3 h-3 rounded-full bg-blue-500 animate-pulse" />
          <div className="text-sm text-blue-900 flex-1">
            <b>
              {liveProcessing.length} document{liveProcessing.length === 1 ? "" : "s"} processing
            </b>
            {" · "}
            Claude is reading {liveProcessing.length === 1 ? "the file" : "the files"} now;
            the row{liveProcessing.length === 1 ? "" : "s"} below will flip to <b>Ready</b> in
            a few seconds.
          </div>
          <span className="text-xs text-blue-700">
            {liveProcessing.map((d) => d.filename).slice(0, 3).join(" · ")}
          </span>
        </div>
      )}

      {/* Sales Discovery Summary card */}
      {discovery && (
        <div className="bg-white rounded-card border border-beroe-card-border p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-text-primary">Sales Discovery Summary</h2>
              <p className="text-xs text-text-muted">
                {discovery.generated_at
                  ? `AI rollup of ${discovery.source_document_ids.length} document${discovery.source_document_ids.length === 1 ? "" : "s"} · last regenerated ${new Date(discovery.generated_at).toLocaleString()}`
                  : "No documents processed yet — upload a MOM or VPD to generate."}
              </p>
            </div>
          </div>
          {discovery.summary_text && (
            <div className="mt-3 text-sm text-text-primary whitespace-pre-wrap leading-relaxed">
              {discovery.summary_text}
            </div>
          )}
        </div>
      )}

      {/* Upload + drag-drop */}
      {data.is_editable && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
          }}
          className={cn(
            "bg-white rounded-xl border-2 border-dashed p-5 transition-colors",
            dragOver ? "border-beroe-blue bg-beroe-blue/5" : "border-slate-200",
          )}
        >
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-xs font-bold uppercase tracking-wider text-text-muted">
              Document type
            </label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as DocKind)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:border-beroe-blue"
            >
              {KIND_OPTIONS.map((k) => (
                <option key={k} value={k}>{DOC_KIND_LABELS[k]}</option>
              ))}
            </select>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={ALLOWED_EXT}
              onChange={(e) => e.target.files && handleFiles(e.target.files)}
              disabled={!!uploadStatus}
              className="text-sm flex-1 min-w-[280px]"
            />
          </div>
          <div className="mt-2 text-[11px] text-text-muted">
            Drag files anywhere on this card · Allowed: {ALLOWED_EXT.replaceAll(",", " · ")} · max {MAX_MB} MB · audio/video lands in v1.1.
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
      )}

      {/* List */}
      <div className="bg-white rounded-card border border-beroe-card-border overflow-hidden">
        <div className="px-5 py-3 border-b border-beroe-card-border/60 flex items-center justify-between">
          <h3 className="text-sm font-bold text-text-primary">Documents</h3>
          <span className="text-xs text-text-muted">{data.total} total</span>
        </div>
        {data.items.length === 0 ? (
          <div className="p-10 text-center text-sm text-text-muted">
            No documents yet.{" "}
            {data.is_editable && "Upload a MOM, VPD, transcript, or email to start."}
          </div>
        ) : (
          <ul className="divide-y divide-beroe-card-border/60">
            {data.items.map((d) => (
              <DocumentRow
                key={d.id}
                doc={d}
                isEditable={data.is_editable}
                onDelete={() => {
                  if (confirm(`Soft-delete "${d.filename}"?`)) deleteMutation.mutate(d.id);
                }}
                onRerun={() => {
                  if (confirm(`Re-run AI on "${d.filename}"? Existing summary and any edits will be replaced.`)) {
                    rerunMutation.mutate(d.id);
                  }
                }}
                onSaveSummary={(text) => editSummaryMutation.mutateAsync({ id: d.id, ai_summary_text: text })}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function DocumentRow({
  doc,
  isEditable,
  onDelete,
  onRerun,
  onSaveSummary,
}: {
  doc: Document;
  isEditable: boolean;
  onDelete: () => void;
  onRerun: () => void;
  onSaveSummary: (text: string) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [editingText, setEditingText] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  return (
    <li className="px-5 py-3">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-text-primary truncate">{doc.filename}</span>
            <KindPill kind={doc.kind} />
            <StatusPill status={doc.ai_status} />
            {doc.ai_status === "complete" && <AiTagPill edited={doc.ai_edited} />}
            {doc.extracted_entities?.is_stub && (
              <span className="text-[10px] uppercase tracking-wider text-text-muted">stub AI</span>
            )}
          </div>
          <div className="text-xs text-text-muted mt-0.5">
            {formatBytes(doc.size_bytes)} · uploaded {new Date(doc.uploaded_at).toLocaleString()}
            {doc.ai_edited_at && (
              <> · edited {new Date(doc.ai_edited_at).toLocaleString()}</>
            )}
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
            <div className="mt-2">
              {editingText === null ? (
                <div className="text-sm text-text-primary whitespace-pre-wrap bg-slate-50 rounded-lg px-3 py-2 border border-slate-200">
                  {doc.ai_summary_text}
                  {doc.extracted_entities && <EntityChips entities={doc.extracted_entities} />}
                  {isEditable && (
                    <button
                      onClick={() => setEditingText(doc.ai_summary_text || "")}
                      className="mt-2 text-[11px] text-beroe-blue font-semibold underline"
                    >
                      Edit summary
                    </button>
                  )}
                </div>
              ) : (
                <div className="bg-slate-50 rounded-lg px-3 py-2 border border-slate-200">
                  <textarea
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    rows={6}
                    maxLength={4000}
                    className="w-full text-sm bg-white px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:border-beroe-blue resize-none"
                  />
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-[10px] text-text-muted">
                      Saving will mark this summary as <b>AI-assisted</b>.
                    </span>
                    <button
                      onClick={() => setEditingText(null)}
                      disabled={saving}
                      className="ml-auto px-2 py-1 rounded-md text-xs border border-slate-200 text-text-secondary"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={async () => {
                        if (!editingText || !editingText.trim()) return;
                        setSaving(true);
                        try {
                          await onSaveSummary(editingText.trim());
                          setEditingText(null);
                        } finally {
                          setSaving(false);
                        }
                      }}
                      disabled={saving || !editingText?.trim()}
                      className="px-3 py-1 rounded-md text-xs bg-beroe-blue text-white font-semibold disabled:opacity-50"
                    >
                      {saving ? "Saving…" : "Save"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        {isEditable && (
          <div className="flex gap-3 shrink-0">
            <button
              onClick={onRerun}
              disabled={doc.ai_status === "processing" || doc.ai_status === "pending"}
              className="text-xs text-beroe-blue hover:underline font-semibold disabled:opacity-40"
              title="Re-run AI summary"
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
        )}
      </div>
    </li>
  );
}

function KindPill({ kind }: { kind: DocKind }) {
  return (
    <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-slate-100 text-text-secondary">
      {DOC_KIND_LABELS[kind]}
    </span>
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

function AiTagPill({ edited }: { edited: boolean }) {
  return (
    <span
      className={cn(
        "text-[10px] font-bold px-1.5 py-0.5 rounded-full",
        edited ? "bg-violet-100 text-violet-800" : "bg-cyan-100 text-cyan-800",
      )}
      title={edited ? "Edited by a human after AI generation" : "Generated by Claude — untouched"}
    >
      {edited ? "AI-assisted" : "AI-generated"}
    </span>
  );
}

function EntityChips({ entities }: { entities: NonNullable<Document["extracted_entities"]> }) {
  const groups: { label: string; items: string[] }[] = [
    { label: "People", items: entities.people ?? [] },
    { label: "Decisions", items: entities.decisions ?? [] },
    { label: "Action items", items: entities.action_items ?? [] },
    { label: "Dates", items: entities.dates ?? [] },
  ].filter((g) => g.items.length > 0);
  if (groups.length === 0) return null;
  return (
    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
      {groups.map((g) => (
        <div key={g.label}>
          <div className="text-[11px] uppercase tracking-wider text-text-muted font-bold mb-1">
            {g.label}
          </div>
          <ul className="text-xs text-text-secondary list-disc list-inside space-y-0.5">
            {g.items.map((it, i) => <li key={i}>{it}</li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}

function formatBytes(b: number | null): string {
  if (!b) return "—";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}
