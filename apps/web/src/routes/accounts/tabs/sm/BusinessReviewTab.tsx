// Business Review — thin consumer of the backend /business-reviews
// surface. Replaces the prior 946-line client-side deck builder; the
// 12-slide deck (HTML/PDF/PPTX) is now rendered server-side from live
// Analytics data and persisted per Generate click.
//
// User flow:
//   1. Pick cadence (Monthly / Quarterly / Renewal / Custom) — Custom
//      enables a date-range picker; the others derive their window
//      server-side from today + contract dates.
//   2. Click Generate → POST creates one row, returns metadata, we
//      preview the HTML in an iframe.
//   3. Past Cycles list below shows every prior generation with
//      View / PDF / PPTX buttons per row.

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, ApiError } from "@/lib/api";
import { useNotify, useConfirm } from "@/components/DialogProvider";
import { useAuth } from "@/components/AuthProvider";
import { useAccountFromLayout } from "../../AccountProfileLayout";
import {
  type BRCadence,
  type BRListResponse,
  type BROut,
  type GenerateBRRequest,
  CADENCE_LABEL,
} from "@/types/business_review";

const BRAND = {
  indigo: "#4A00F8",
  midnight: "#001137",
  bumblebee: "#FFE61E",
  fuscia: "#C344C7",
  aqua: "#35E1D4",
  cardBorder: "#e4eaf6",
  t1: "#0d1b2e",
  t2: "#5a7896",
  t3: "#8496b0",
  bgSoft: "#f7f9fd",
};

// ─────────────────────────────────────────────────────────────
// Cadence selector card
// ─────────────────────────────────────────────────────────────

function CadenceCard({
  cadence,
  selected,
  onPick,
}: {
  cadence: BRCadence;
  selected: boolean;
  onPick: (c: BRCadence) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(cadence)}
      style={{
        padding: "12px 16px",
        borderRadius: 10,
        border: `1.5px solid ${selected ? BRAND.indigo : BRAND.cardBorder}`,
        background: selected ? `${BRAND.indigo}10` : "#fff",
        color: selected ? BRAND.indigo : BRAND.t1,
        fontWeight: 700,
        fontSize: 13,
        cursor: "pointer",
        flex: 1,
        minWidth: 120,
      }}
    >
      {CADENCE_LABEL[cadence]}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// Iframe preview (auth'd HTML fetch → srcDoc)
// ─────────────────────────────────────────────────────────────

function BRPreview({ brId }: { brId: string }) {
  const { data: html, isLoading, isError } = useQuery<string>({
    queryKey: ["br-html", brId],
    queryFn: () => api.getText(`/api/v1/business-reviews/${brId}/download?format=html`),
    staleTime: Infinity, // BRs are immutable once generated
  });

  if (isLoading) {
    return (
      <div className="text-sm text-text-muted" style={{ padding: 24 }}>
        Loading preview…
      </div>
    );
  }
  if (isError || !html) {
    return (
      <div
        className="text-sm"
        style={{
          padding: 24,
          color: "#8B1F1F",
          border: "1px solid #fee2e2",
          background: "#fff5f5",
          borderRadius: 10,
        }}
      >
        Couldn't load the BR preview. Try regenerating.
      </div>
    );
  }
  return (
    <iframe
      title="Business Review preview"
      srcDoc={html}
      style={{
        width: "100%",
        height: 720,
        border: `1px solid ${BRAND.cardBorder}`,
        borderRadius: 12,
        background: "#fff",
      }}
    />
  );
}

// ─────────────────────────────────────────────────────────────
// Past Cycles — list of prior generations
// ─────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function CadencePill({ cadence }: { cadence: BRCadence }) {
  const tones: Record<BRCadence, { bg: string; fg: string }> = {
    monthly: { bg: "#dbeafe", fg: "#1e40af" },
    quarterly: { bg: "#ede6ff", fg: BRAND.indigo },
    renewal: { bg: "#fef3c7", fg: "#854F0B" },
    custom: { bg: "#f3f0ff", fg: BRAND.fuscia },
  };
  const t = tones[cadence];
  return (
    <span
      style={{
        background: t.bg,
        color: t.fg,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 0.5,
        padding: "3px 8px",
        borderRadius: 6,
        textTransform: "uppercase",
      }}
    >
      {CADENCE_LABEL[cadence]}
    </span>
  );
}

async function downloadBlob(
  brId: string,
  format: "pdf" | "pptx",
  filename: string,
): Promise<void> {
  const blob = await api.getBlob(
    `/api/v1/business-reviews/${brId}/download?format=${format}`,
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function PastCyclesRow({
  row,
  selected,
  onSelect,
  onDelete,
  canDelete,
}: {
  row: BROut;
  selected: boolean;
  onSelect: () => void;
  onDelete: (id: string) => void;
  canDelete: boolean;
}) {
  const notify = useNotify();
  const fileBase = `BR_${row.period_label.replace(/[^A-Za-z0-9._-]/g, "_")}_${row.cadence}`;

  async function pull(format: "pdf" | "pptx") {
    try {
      await downloadBlob(row.id, format, `${fileBase}.${format}`);
    } catch (e) {
      const err = e as ApiError;
      notify({
        title: `Couldn't download ${format.toUpperCase()}`,
        body: err.message,
        tone: "error",
      });
    }
  }

  return (
    <tr style={{ background: selected ? `${BRAND.indigo}08` : undefined }}>
      <td style={{ padding: 10 }}>
        <CadencePill cadence={row.cadence} />
      </td>
      <td style={{ padding: 10, fontWeight: 700, color: BRAND.t1 }}>
        {row.period_label}
      </td>
      <td style={{ padding: 10, color: BRAND.t2, fontSize: 12 }}>
        {row.generated_by_name ?? "—"} · {fmtDate(row.generated_at)}
      </td>
      <td style={{ padding: 10, textAlign: "right" }}>
        <button
          type="button"
          onClick={onSelect}
          style={{
            border: `1px solid ${BRAND.cardBorder}`,
            background: "#fff",
            padding: "5px 10px",
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 700,
            color: BRAND.indigo,
            marginRight: 6,
            cursor: "pointer",
          }}
        >
          View
        </button>
        <button
          type="button"
          onClick={() => pull("pdf")}
          style={{
            border: `1px solid ${BRAND.cardBorder}`,
            background: "#fff",
            padding: "5px 10px",
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 700,
            color: BRAND.t1,
            marginRight: 6,
            cursor: "pointer",
          }}
        >
          PDF
        </button>
        <button
          type="button"
          onClick={() => pull("pptx")}
          style={{
            border: `1px solid ${BRAND.cardBorder}`,
            background: "#fff",
            padding: "5px 10px",
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 700,
            color: BRAND.t1,
            marginRight: 6,
            cursor: "pointer",
          }}
        >
          PPTX
        </button>
        {canDelete && (
          <button
            type="button"
            onClick={() => onDelete(row.id)}
            title="Admin-only delete"
            style={{
              border: "1px solid #fee2e2",
              background: "#fff",
              padding: "5px 10px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 700,
              color: "#8B1F1F",
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        )}
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────
// Tab default export
// ─────────────────────────────────────────────────────────────

export default function BusinessReviewTab() {
  const account = useAccountFromLayout();
  const qc = useQueryClient();
  const notify = useNotify();
  const confirmDlg = useConfirm();
  const { me } = useAuth();
  const isAdmin = me?.user.role === "admin";

  const [cadence, setCadence] = useState<BRCadence>("monthly");
  const [periodStart, setPeriodStart] = useState<string>("");
  const [periodEnd, setPeriodEnd] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const cyclesQ = useQuery<BRListResponse>({
    queryKey: ["br-cycles", account.id],
    queryFn: () => api.get(`/api/v1/accounts/${account.id}/business-reviews`),
    staleTime: 30_000,
  });

  const generate = useMutation({
    mutationFn: (body: GenerateBRRequest) =>
      api.post<BROut>(
        `/api/v1/accounts/${account.id}/business-reviews/generate`,
        body,
      ),
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["br-cycles", account.id] });
      setSelectedId(row.id);
      notify({
        title: "Business Review generated",
        body: `${CADENCE_LABEL[row.cadence]} · ${row.period_label}`,
        tone: "success",
      });
    },
    onError: (e: ApiError) =>
      notify({ title: "Couldn't generate BR", body: e.message, tone: "error" }),
  });

  const delMut = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/v1/business-reviews/${id}`),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ["br-cycles", account.id] });
      if (selectedId === id) setSelectedId(null);
    },
    onError: (e: ApiError) =>
      notify({ title: "Delete failed", body: e.message, tone: "error" }),
  });

  // Auto-select the newest cycle on first load.
  const items = useMemo(() => cyclesQ.data?.items ?? [], [cyclesQ.data]);
  useEffect(() => {
    if (!selectedId && items.length > 0) setSelectedId(items[0].id);
  }, [items, selectedId]);

  const customValid =
    cadence !== "custom" ||
    (periodStart !== "" && periodEnd !== "" && periodStart <= periodEnd);

  function onGenerate() {
    if (!customValid) {
      notify({
        title: "Pick a date range",
        body: "Custom cadence requires both a start and end date.",
        tone: "warning",
      });
      return;
    }
    const body: GenerateBRRequest = { cadence };
    if (cadence === "custom") {
      body.period_start = periodStart;
      body.period_end = periodEnd;
    }
    generate.mutate(body);
  }

  async function onDelete(id: string) {
    const ok = await confirmDlg({
      title: "Delete this Business Review?",
      body: "Permanent delete. The audit log keeps the record of who generated it.",
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok) delMut.mutate(id);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Generator panel */}
      <div
        style={{
          padding: 20,
          borderRadius: 12,
          border: `1.5px solid ${BRAND.cardBorder}`,
          background: BRAND.bgSoft,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 1.5,
            color: BRAND.t2,
            textTransform: "uppercase",
            marginBottom: 12,
          }}
        >
          Generate Business Review
        </div>

        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            marginBottom: 16,
          }}
        >
          {(["monthly", "quarterly", "renewal", "custom"] as BRCadence[]).map(
            (c) => (
              <CadenceCard
                key={c}
                cadence={c}
                selected={cadence === c}
                onPick={setCadence}
              />
            ),
          )}
        </div>

        {cadence === "custom" && (
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "flex-end",
              marginBottom: 16,
              flexWrap: "wrap",
            }}
          >
            <label style={{ fontSize: 11, color: BRAND.t2, fontWeight: 700 }}>
              <div style={{ marginBottom: 4 }}>Period start</div>
              <input
                type="date"
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                style={{
                  padding: "8px 10px",
                  border: `1px solid ${BRAND.cardBorder}`,
                  borderRadius: 8,
                  fontSize: 13,
                }}
              />
            </label>
            <label style={{ fontSize: 11, color: BRAND.t2, fontWeight: 700 }}>
              <div style={{ marginBottom: 4 }}>Period end</div>
              <input
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                style={{
                  padding: "8px 10px",
                  border: `1px solid ${BRAND.cardBorder}`,
                  borderRadius: 8,
                  fontSize: 13,
                }}
              />
            </label>
          </div>
        )}

        <button
          type="button"
          onClick={onGenerate}
          disabled={generate.isPending || !customValid}
          style={{
            background: BRAND.indigo,
            color: "#fff",
            padding: "10px 20px",
            border: "none",
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 700,
            cursor:
              generate.isPending || !customValid ? "not-allowed" : "pointer",
            opacity: generate.isPending || !customValid ? 0.6 : 1,
          }}
        >
          {generate.isPending ? "Generating…" : "Generate Business Review →"}
        </button>
        <div style={{ marginTop: 10, fontSize: 11, color: BRAND.t3 }}>
          Live data from this account's Analytics — usage, modules, scores,
          signals, plays, goals, contract, stakeholders. Every Generate
          creates a new version in the Business Review Cycles list below.
        </div>
      </div>

      {/* Preview */}
      {selectedId ? (
        <BRPreview brId={selectedId} />
      ) : (
        <div
          style={{
            padding: 32,
            textAlign: "center",
            color: BRAND.t3,
            border: `1px dashed ${BRAND.cardBorder}`,
            borderRadius: 12,
            fontSize: 12,
          }}
        >
          No Business Review generated yet. Pick a cadence above and click
          Generate.
        </div>
      )}

      {/* Past Cycles */}
      <div
        style={{
          padding: 20,
          borderRadius: 12,
          border: `1.5px solid ${BRAND.cardBorder}`,
          background: "#fff",
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 1.5,
            color: BRAND.t2,
            textTransform: "uppercase",
            marginBottom: 12,
          }}
        >
          Business Review Cycles ({items.length})
        </div>

        {cyclesQ.isLoading ? (
          <div style={{ color: BRAND.t3, fontSize: 12 }}>Loading cycles…</div>
        ) : items.length === 0 ? (
          <div style={{ color: BRAND.t3, fontSize: 12 }}>
            No cycles yet — generate the first one above.
          </div>
        ) : (
          <table
            style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}
          >
            <thead>
              <tr
                style={{
                  background: BRAND.bgSoft,
                  textAlign: "left",
                  fontSize: 10,
                  fontWeight: 700,
                  color: BRAND.t2,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                }}
              >
                <th style={{ padding: 10 }}>Cadence</th>
                <th style={{ padding: 10 }}>Period</th>
                <th style={{ padding: 10 }}>Generated</th>
                <th style={{ padding: 10, textAlign: "right" }}>Download</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <PastCyclesRow
                  key={row.id}
                  row={row}
                  selected={row.id === selectedId}
                  onSelect={() => setSelectedId(row.id)}
                  onDelete={onDelete}
                  canDelete={isAdmin}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
