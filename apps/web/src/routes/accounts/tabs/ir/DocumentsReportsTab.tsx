// M31 — Intelligence & Reports · Documents & Reports section.
//
// Three blocks (faithful port of prototype bDocs):
//   1. Report generation cards — QBR · MBR · Utilization. HTML preview
//      lands in an iframe; "Download HTML" saves the file locally.
//      PPT / PDF buttons are placeholders (v1.1).
//   2. Solutioning & Proposal documents — link to the existing
//      account-level Documents tab where the file pipeline lives.
//   3. Available Materials library — static catalog (DOC_MATERIALS)
//      ported from the prototype. Click View → modal with summary.

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAccountFromLayout } from "../../AccountProfileLayout";
import { DOC_MATERIALS, type MaterialItem } from "@/types/doc_materials";

type ReportType = "qbr" | "mbr" | "utilization";

interface ReportResponse {
  html: string;
  filename: string;
  type: ReportType;
}

const REPORT_CARDS: Array<{
  type: ReportType;
  title: string;
  desc: string;
  icon: string;
  color: string;
}> = [
  {
    type: "qbr",
    title: "Quarterly Business Review (QBR)",
    desc: "Comprehensive 8-section QBR: engagement scope, usage, category trends, Abi, success metrics, checkpoints, industry benchmark, expansion pipeline.",
    icon: "🏆",
    color: "#4A00F8",
  },
  {
    type: "mbr",
    title: "Monthly Business Review (MBR)",
    desc: "Shorter monthly snapshot: usage highlights, open checkpoints, metrics, and action items.",
    icon: "📅",
    color: "#EF9637",
  },
  {
    type: "utilization",
    title: "Utilization Report",
    desc: "User adoption overview, module-wise usage, and top platform power-users (Super Users).",
    icon: "📊",
    color: "#40CC8F",
  },
];

export default function DocumentsReportsTab() {
  const account = useAccountFromLayout();
  const [active, setActive] = useState<ReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [materialOpen, setMaterialOpen] = useState<MaterialItem | null>(null);

  const genMutation = useMutation({
    mutationFn: async (type: ReportType) =>
      api.get<ReportResponse>(`/api/v1/accounts/${account.id}/reports/${type}`),
    onSuccess: (data) => {
      setActive(data);
      setError(null);
    },
    onError: (e: ApiError) => setError(e.message),
  });

  const downloadHtml = () => {
    if (!active) return;
    const blob = new Blob([active.html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = active.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="bg-white border border-beroe-card-border rounded-card p-4">
        <div className="text-[16px] font-bold">Documents & Reports</div>
        <div className="text-[12px] text-text-muted mt-0.5">
          Generate reports or browse Beroe materials for{" "}
          <b>{account.name}</b>.
        </div>
      </div>

      {/* Report generation */}
      <div className="grid grid-cols-3 gap-3">
        {REPORT_CARDS.map((r) => (
          <ReportCard
            key={r.type}
            r={r}
            pending={genMutation.isPending && genMutation.variables === r.type}
            active={active?.type === r.type}
            onGenerate={() => genMutation.mutate(r.type)}
          />
        ))}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-md px-3 py-2 text-[12px]">
          {error}
        </div>
      )}

      {/* Preview iframe */}
      {active && (
        <div className="bg-white border border-beroe-card-border rounded-card p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[13px] font-bold">
              Preview — {active.type.toUpperCase()}
            </div>
            <div className="flex gap-2">
              <button
                onClick={downloadHtml}
                className="text-[11px] px-2.5 py-1 rounded-md bg-beroe-blue text-white font-semibold"
              >
                ⬇ Download HTML
              </button>
              <button
                onClick={() => setActive(null)}
                className="text-[11px] px-2.5 py-1 rounded-md border border-beroe-card-border hover:bg-beroe-bg/60"
              >
                Close
              </button>
            </div>
          </div>
          <iframe
            srcDoc={active.html}
            className="w-full border border-beroe-card-border rounded"
            style={{ height: 600 }}
            title={`${active.type} preview`}
          />
        </div>
      )}

      {/* Solutioning proposals — link out to Documents tab */}
      <div className="bg-white border border-beroe-card-border rounded-card p-4">
        <div className="text-[13px] font-bold">Solutioning & Proposal Documents</div>
        <div className="text-[11px] text-text-muted mt-0.5 mb-2">
          Upload proposals, solution documents, and pitch decks. Lives in
          the Documents tab so they're searchable + AI-summarised + RBAC-gated
          alongside MoMs and VPDs.
        </div>
        <Link
          to={`/accounts/${account.id}/account-kit/solutioning`}
          className="inline-flex items-center gap-1 text-[12px] text-beroe-blue font-semibold hover:underline"
        >
          → Manage in Account Kit → Solutioning
        </Link>
      </div>

      {/* Available materials library */}
      <div>
        <div className="text-[14px] font-bold mb-2">Available Materials</div>
        <div className="grid grid-cols-2 gap-3">
          {DOC_MATERIALS.map((g) => (
            <div
              key={g.group}
              className="bg-white border border-beroe-card-border rounded-card p-3.5"
            >
              <div className="text-[12px] font-bold text-cyan-700 mb-2">
                {g.group}
              </div>
              <div className="space-y-1">
                {g.items.map((it) => (
                  <div
                    key={it.name}
                    className="flex items-center justify-between py-1 border-b border-beroe-card-border/60 last:border-b-0"
                  >
                    <span className="text-[11px] flex-1">{it.name}</span>
                    <button
                      onClick={() => setMaterialOpen(it)}
                      className="text-[10px] px-2 py-0.5 rounded border border-beroe-card-border text-text-secondary hover:bg-beroe-bg/60 font-semibold"
                    >
                      View
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Material detail modal */}
      {materialOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl w-[min(640px,95vw)] p-5">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[14px] font-bold">{materialOpen.name}</div>
              <button
                onClick={() => setMaterialOpen(null)}
                className="text-text-muted hover:text-text-primary text-lg leading-none"
              >
                ×
              </button>
            </div>
            <div className="text-[12px] text-text-secondary leading-relaxed">
              {materialOpen.summary}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setMaterialOpen(null)}
                className="text-[11px] px-3 py-1.5 rounded-md border border-beroe-card-border hover:bg-beroe-bg/60"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// Report card
// ============================================================

function ReportCard({
  r,
  pending,
  active,
  onGenerate,
}: {
  r: (typeof REPORT_CARDS)[number];
  pending: boolean;
  active: boolean;
  onGenerate: () => void;
}) {
  return (
    <div
      className={cn(
        "bg-white border rounded-card p-4 flex items-start gap-3",
        active ? "border-cyan-500/40 ring-1 ring-cyan-500/20" : "border-beroe-card-border",
      )}
    >
      <div className="text-[28px] flex-shrink-0">{r.icon}</div>
      <div className="flex-1 min-w-0">
        <div
          className="text-[13px] font-bold"
          style={{ color: r.color }}
        >
          {r.title}
        </div>
        <div className="text-[11px] text-text-secondary leading-snug mt-1 mb-2">
          {r.desc}
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={onGenerate}
            disabled={pending}
            className="text-[11px] px-2.5 py-1 rounded-md bg-beroe-navy text-white font-semibold disabled:opacity-50"
          >
            {pending ? "Generating…" : "HTML"}
          </button>
          <button
            disabled
            title="PPT export — v1.1 (needs python-pptx templates)"
            className="text-[11px] px-2.5 py-1 rounded-md border border-beroe-card-border text-text-muted cursor-not-allowed"
          >
            PPT
          </button>
          <button
            disabled
            title="PDF export — v1.1 (needs reportlab templates)"
            className="text-[11px] px-2.5 py-1 rounded-md border border-beroe-card-border text-text-muted cursor-not-allowed"
          >
            PDF
          </button>
        </div>
      </div>
    </div>
  );
}
