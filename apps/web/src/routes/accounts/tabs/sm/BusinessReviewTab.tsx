// 05-Jun · Pass-2 Business Review tab — faithful port of
// beroe_br_generator_proto.html.
//
// Differences vs the proto (intentional):
//   • Brand-locked palette (no #FD576B/#EF9637/#40CC8F/#FFD100 — replaced
//     with #CF4548/#F0BC41/#6EC457/#FFE61E) per Beroe brand book.
//   • Account-header strip lives in AccountProfileLayout already, so the
//     header inside the tab body is omitted here (would double-render).
//   • Cycles list reads from the live `checkpoints` (M21) endpoint —
//     the prototype's `bvd_cycles` array is the same shape conceptually,
//     just static.
//
// Everything else is 1:1: lastGenerated success banner with Dismiss,
// custom tree-cb with check / partial states, collapse-expand groups
// with arrow rotation, per-cycle Generate-now buttons, real HTML / PDF /
// PPT exports via br_deck.ts.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { useAccountFromLayout } from "../../AccountProfileLayout";
import type {
  Checkpoint,
  CheckpointListResponse,
} from "@/types/checkpoint";
import {
  type Cadence,
  CADENCE_PRESETS,
  DECK_STRUCTURE,
  TOTAL_SLIDES,
  ALL_SLIDE_IDS,
  totalReadTime,
  generateBrHtml,
  exportBrPpt,
} from "@/lib/br_deck";

const BRAND = {
  indigo: "#4A00F8",
  midnight: "#001137",
  bumblebee: "#FFE61E",
  fuscia: "#C344C7",
  aqua: "#35E1D4",
  red: "#CF4548",
  amber: "#F0BC41",
  green: "#6EC457",
  cardBorder: "#e4eaf6",
  t1: "#0d1b2e",
  t2: "#5a7896",
  t3: "#8496b0",
};

// ---------------------------------------------------------------------------
// Tab
// ---------------------------------------------------------------------------
interface LastGenerated {
  format: "HTML" | "PDF" | "PPT";
  slideCount: number;
  when: string;
  cadence: string;
  note: string;
}

interface ModalState {
  open: boolean;
  step: 1 | 2;
  cadence: Cadence | null;
  selectedSlides: Set<string>;
  expandedGroups: Set<string>;
}

export default function BusinessReviewTab() {
  const account = useAccountFromLayout();

  const [modal, setModal] = useState<ModalState>({
    open: false,
    step: 1,
    cadence: null,
    selectedSlides: new Set(),
    expandedGroups: new Set(["context", "wins", "health", "modules", "wrap"]),
  });
  const [lastGen, setLastGen] = useState<LastGenerated | null>(null);

  const cpQ = useQuery<CheckpointListResponse>({
    queryKey: ["checkpoints", account.id],
    queryFn: () =>
      api.get<CheckpointListResponse>(
        `/api/v1/accounts/${account.id}/checkpoints`,
      ),
  });
  const cycles = useMemo(() => {
    const items = cpQ.data?.items ?? [];
    return items
      .filter((c) =>
        ["MBR", "QBR", "Renewal", "Kickoff"].includes(c.type),
      )
      .sort((a, b) => {
        const ad = new Date(a.scheduled_date ?? a.created_at).getTime();
        const bd = new Date(b.scheduled_date ?? b.created_at).getTime();
        return ad - bd;
      });
  }, [cpQ.data]);

  function openModal(presetCadence?: Cadence) {
    setModal({
      open: true,
      step: presetCadence ? 2 : 1,
      cadence: presetCadence ?? null,
      selectedSlides: presetCadence
        ? new Set(CADENCE_PRESETS[presetCadence].slides)
        : new Set(),
      expandedGroups: new Set([
        "context",
        "wins",
        "health",
        "modules",
        "wrap",
      ]),
    });
  }
  function closeModal() {
    setModal((m) => ({ ...m, open: false }));
  }

  return (
    <div>
      {/* lastGenerated success banner */}
      {lastGen && (
        <div
          className="rounded-card px-4 py-3 mb-3 flex items-start gap-3"
          style={{
            background: `linear-gradient(135deg, #f0fdf4, #dcfce7)`,
            border: `1.5px solid ${BRAND.green}`,
          }}
        >
          <span className="text-[24px]">✅</span>
          <div className="flex-1">
            <div
              className="text-[13px] font-bold"
              style={{ color: "#146a45" }}
            >
              Business Review generated · {lastGen.cadence} · {lastGen.format}
            </div>
            <div
              className="text-[11px] mt-0.5"
              style={{ color: "#2fb87a" }}
            >
              {lastGen.slideCount} slides · {lastGen.when}
              {lastGen.note ? " · " + lastGen.note : ""}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setLastGen(null)}
            className="text-[11px] font-semibold px-2.5 py-1 rounded-card border"
            style={{
              background: "#fff",
              borderColor: BRAND.cardBorder,
              color: BRAND.t2,
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Hero CTA */}
      <button
        type="button"
        onClick={() => openModal()}
        className="w-full rounded-card flex items-center gap-3 px-4 py-3.5 text-white text-left mb-3"
        style={{
          background: `linear-gradient(135deg, ${BRAND.indigo}, #3800CC)`,
          boxShadow: `0 6px 20px ${BRAND.indigo}30`,
        }}
      >
        <span className="text-[24px]">📥</span>
        <div className="flex-1">
          <div className="text-[14px] font-bold">
            Generate Business Review
          </div>
          <div className="text-[11px] opacity-85">
            Pick cadence and sections, then export to HTML · PDF · PPT
          </div>
        </div>
        <span className="text-[18px]">→</span>
      </button>

      {/* How-it-works */}
      <div
        className="rounded-card px-3.5 py-3 text-[12px] mb-3"
        style={{
          background: "#f3f0ff",
          border: `1px solid #d0c5f5`,
          color: "#2d1870",
          lineHeight: 1.6,
        }}
      >
        <b>How it works:</b> Pick a cadence (Monthly / Quarterly / Renewal /
        Custom) to pre-select sections. Fine-tune the section tree if needed.
        Then export — view live in HTML, save as PDF via browser print, or
        download an editable PPT.
      </div>

      {/* Cycles list */}
      <div
        className="rounded-card p-4 mb-3"
        style={{
          background: "#fff",
          border: `1px solid ${BRAND.cardBorder}`,
        }}
      >
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[14px]">📚</span>
          <div
            className="text-[13px] font-bold"
            style={{ color: BRAND.t1 }}
          >
            Business Review Cycles
          </div>
          <span
            className="ml-auto px-2 py-0.5 rounded-full text-[10px] font-bold"
            style={{ background: "#f1f5f9", color: "#64748b" }}
          >
            {cycles.length} cycle{cycles.length !== 1 ? "s" : ""}
          </span>
        </div>
        {cycles.length === 0 ? (
          <div
            className="text-center py-6 text-[11.5px]"
            style={{ color: BRAND.t3 }}
          >
            📭 No business review cycles scheduled yet. Click{" "}
            <b>Generate</b> above to author a one-off cycle, or schedule
            checkpoints in <b>Goal Validation and Alignment</b>.
          </div>
        ) : (
          cycles.map((c, idx) => (
            <CycleRow
              key={c.id}
              cycle={c}
              num={idx + 1}
              onGenerate={() =>
                openModal(checkpointToCadence(c.type))
              }
            />
          ))
        )}
      </div>

      {/* Data sources */}
      <div
        className="rounded-card p-4"
        style={{
          background: "#fff",
          border: `1px solid ${BRAND.cardBorder}`,
        }}
      >
        <div
          className="text-[12px] font-bold mb-2.5 uppercase tracking-wider"
          style={{ color: "#6b7fa0" }}
        >
          Data Sources (read-only)
        </div>
        <div
          className="grid grid-cols-3 gap-2.5 text-[11px]"
          style={{ color: BRAND.t2, lineHeight: 1.6 }}
        >
          <div>
            <b style={{ color: BRAND.t1 }}>Context</b>
            <br />
            Contract Audit · Sales Handoff
          </div>
          <div>
            <b style={{ color: BRAND.t1 }}>Wins</b>
            <br />
            Goals activity log · Plan plays
          </div>
          <div>
            <b style={{ color: BRAND.t1 }}>Health</b>
            <br />
            calcHealth() · churn risk · NPS
          </div>
          <div>
            <b style={{ color: BRAND.t1 }}>Modules</b>
            <br />
            platform_intel × Redshift
          </div>
          <div>
            <b style={{ color: BRAND.t1 }}>Risks</b>
            <br />
            soft_signals · re-alignment flags
          </div>
          <div>
            <b style={{ color: BRAND.t1 }}>Closing</b>
            <br />
            checkpoints next-cycle date · renewal date
          </div>
        </div>
      </div>

      {modal.open && (
        <BRModal
          modal={modal}
          setModal={setModal}
          close={closeModal}
          accountName={account.name}
          onGenerated={(v) => {
            setLastGen(v);
            closeModal();
          }}
        />
      )}
    </div>
  );
}

function checkpointToCadence(t: Checkpoint["type"]): Cadence {
  if (t === "MBR") return "monthly";
  if (t === "Renewal") return "renewal";
  return "quarterly"; // QBR, Kickoff
}

// ---------------------------------------------------------------------------
// Cycle row
// ---------------------------------------------------------------------------
function CycleRow({
  cycle,
  num,
  onGenerate,
}: {
  cycle: Checkpoint;
  num: number;
  onGenerate: () => void;
}) {
  const delivered = cycle.status === "signed_off";
  const dueText = cycle.scheduled_date
    ? new Date(cycle.scheduled_date).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "—";
  const cadenceLabel =
    cycle.type === "MBR"
      ? "Monthly"
      : cycle.type === "QBR"
        ? "Quarterly"
        : cycle.type === "Renewal"
          ? "Renewal"
          : cycle.type;

  return (
    <div
      className="grid items-center gap-3.5 px-3.5 py-2.5 rounded-card mb-1.5"
      style={{
        gridTemplateColumns: "90px 1fr 140px auto",
        background: delivered ? "#fff" : "#fffbf2",
        border: `1px solid ${BRAND.cardBorder}`,
        borderLeft: `3px solid ${delivered ? BRAND.green : BRAND.amber}`,
      }}
    >
      <span
        className="text-center px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider"
        style={{
          background: delivered ? "#d4f5e5" : "#fff3e0",
          color: delivered ? "#146a45" : "#b85b00",
        }}
      >
        CYCLE {num}
      </span>
      <div>
        <div
          className="text-[13px] font-bold"
          style={{ color: BRAND.t1 }}
        >
          {cycle.type} · {dueText}
        </div>
        <div
          className="text-[11px] mt-0.5"
          style={{ color: BRAND.t3 }}
        >
          {cadenceLabel}
          {delivered
            ? cycle.held_date
              ? ` · delivered ${new Date(cycle.held_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
              : ""
            : ` · due ${dueText}`}
        </div>
      </div>
      <div
        className="text-[11px] font-semibold"
        style={{ color: delivered ? BRAND.t2 : BRAND.amber }}
      >
        {delivered ? "Delivered" : "Upcoming"}
      </div>
      {delivered ? (
        <button
          type="button"
          className="text-[11px] font-semibold px-2.5 py-1.5 rounded-card border"
          style={{
            background: "#ede6ff",
            borderColor: "#c9b5ff",
            color: BRAND.indigo,
          }}
        >
          View archive ↗
        </button>
      ) : (
        <button
          type="button"
          onClick={onGenerate}
          className="text-[11px] font-semibold px-2.5 py-1.5 rounded-card text-white"
          style={{ background: BRAND.indigo }}
        >
          Generate now →
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// BR Modal (2-step)
// ---------------------------------------------------------------------------
function BRModal({
  modal,
  setModal,
  close,
  accountName,
  onGenerated,
}: {
  modal: ModalState;
  setModal: React.Dispatch<React.SetStateAction<ModalState>>;
  close: () => void;
  accountName: string;
  onGenerated: (v: LastGenerated) => void;
}) {
  const [busy, setBusy] = useState<null | "html" | "pdf" | "ppt">(null);

  const cnt = modal.selectedSlides.size;
  const time = totalReadTime(modal.selectedSlides).toFixed(1);

  function pickCadence(c: Cadence) {
    setModal({
      ...modal,
      cadence: c,
      selectedSlides: new Set(CADENCE_PRESETS[c].slides),
      step: 2,
    });
  }
  function toggleGroup(gid: string) {
    setModal((m) => {
      const next = new Set(m.expandedGroups);
      if (next.has(gid)) next.delete(gid);
      else next.add(gid);
      return { ...m, expandedGroups: next };
    });
  }
  function toggleSlide(sid: string) {
    setModal((m) => {
      const next = new Set(m.selectedSlides);
      if (next.has(sid)) next.delete(sid);
      else next.add(sid);
      return { ...m, selectedSlides: next };
    });
  }
  function toggleGroupAll(gid: string) {
    setModal((m) => {
      const grp = DECK_STRUCTURE.find((g) => g.id === gid);
      if (!grp) return m;
      const allChecked = grp.slides.every((s) => m.selectedSlides.has(s.id));
      const next = new Set(m.selectedSlides);
      for (const s of grp.slides) {
        if (allChecked) next.delete(s.id);
        else next.add(s.id);
      }
      return { ...m, selectedSlides: next };
    });
  }
  function resetToCadence() {
    if (!modal.cadence) return;
    setModal({
      ...modal,
      selectedSlides: new Set(CADENCE_PRESETS[modal.cadence].slides),
    });
  }

  async function doHTML() {
    if (!modal.cadence) return;
    setBusy("html");
    try {
      const ids = ALL_SLIDE_IDS.filter((id) => modal.selectedSlides.has(id));
      const html = generateBrHtml(ids, modal.cadence, accountName);
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      onGenerated({
        format: "HTML",
        slideCount: ids.length,
        when: new Date().toLocaleString("en-US"),
        cadence: CADENCE_PRESETS[modal.cadence].label,
        note: "Opened in new tab",
      });
    } finally {
      setBusy(null);
    }
  }
  async function doPDF() {
    if (!modal.cadence) return;
    setBusy("pdf");
    try {
      const ids = ALL_SLIDE_IDS.filter((id) => modal.selectedSlides.has(id));
      const html = generateBrHtml(ids, modal.cadence, accountName);
      const w = window.open("", "_blank");
      if (w) {
        w.document.write(html);
        w.document.close();
        setTimeout(() => w.print(), 400);
      }
      onGenerated({
        format: "PDF",
        slideCount: ids.length,
        when: new Date().toLocaleString("en-US"),
        cadence: CADENCE_PRESETS[modal.cadence].label,
        note: "Browser print dialog",
      });
    } finally {
      setBusy(null);
    }
  }
  async function doPPT() {
    if (!modal.cadence) return;
    setBusy("ppt");
    try {
      const ids = ALL_SLIDE_IDS.filter((id) => modal.selectedSlides.has(id));
      const fileName = await exportBrPpt(ids, modal.cadence, accountName);
      onGenerated({
        format: "PPT",
        slideCount: ids.length,
        when: new Date().toLocaleString("en-US"),
        cadence: CADENCE_PRESETS[modal.cadence].label,
        note: fileName,
      });
    } catch (e) {
      alert(
        "PPT generation failed: " +
          (e instanceof Error ? e.message : String(e)),
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,.5)", backdropFilter: "blur(3px)" }}
      onClick={close}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-[16px] flex flex-col w-full"
        style={{
          maxWidth: 680,
          maxHeight: "92vh",
          boxShadow: "0 30px 80px rgba(0,0,0,.3)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-2.5 px-5 pt-4 pb-3.5"
          style={{ borderBottom: `1px solid ${BRAND.cardBorder}` }}
        >
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[11px] font-extrabold"
            style={{ background: BRAND.indigo }}
          >
            {modal.step}
          </div>
          <div
            className="text-[15px] font-bold"
            style={{ color: BRAND.t1 }}
          >
            {modal.step === 1 ? "Pick cadence" : "Pick sections"}
          </div>
          <div
            className="text-[11px] flex-1 ml-1.5"
            style={{ color: BRAND.t3 }}
          >
            {modal.step === 1
              ? "Pre-fills the section tree on the next step"
              : `${modal.cadence ? CADENCE_PRESETS[modal.cadence].emoji + " " + CADENCE_PRESETS[modal.cadence].label : ""}${modal.cadence && modal.cadence !== "custom" ? " (pre-filled · you can adjust)" : ""}`}
          </div>
          <button
            type="button"
            onClick={close}
            className="text-[22px] leading-none px-1"
            style={{ color: BRAND.t3 }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-4">
          {modal.step === 1 ? (
            <div className="grid grid-cols-2 gap-2.5">
              {(["monthly", "quarterly", "renewal", "custom"] as Cadence[]).map(
                (k) => {
                  const p = CADENCE_PRESETS[k];
                  const selected = modal.cadence === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() => pickCadence(k)}
                      className="text-left p-3.5 rounded-[11px] border-2 transition flex flex-col gap-1.5"
                      style={{
                        borderColor: selected ? BRAND.indigo : BRAND.cardBorder,
                        background: selected ? "#f3f0ff" : "#fff",
                        boxShadow: selected
                          ? `0 4px 16px ${BRAND.indigo}1F`
                          : undefined,
                      }}
                    >
                      <div
                        className="text-[13px] font-bold flex items-center gap-2"
                        style={{ color: BRAND.t1 }}
                      >
                        <span className="text-[18px]">{p.emoji}</span>
                        {p.label}
                      </div>
                      <div
                        className="text-[11px]"
                        style={{ color: BRAND.t2, lineHeight: 1.55 }}
                      >
                        {p.desc}
                      </div>
                      <div
                        className="text-[10px] font-bold mt-auto pt-1"
                        style={{
                          color: BRAND.indigo,
                          borderTop: `1px dashed ${BRAND.cardBorder}`,
                        }}
                      >
                        {p.slides.length === 0
                          ? "You pick everything"
                          : `${p.slides.length} / ${TOTAL_SLIDES} slides pre-selected`}
                      </div>
                    </button>
                  );
                },
              )}
            </div>
          ) : (
            <div>
              {DECK_STRUCTURE.map((g) => (
                <TreeGroup
                  key={g.id}
                  group={g}
                  modal={modal}
                  onToggleGroupAll={() => toggleGroupAll(g.id)}
                  onToggleGroup={() => toggleGroup(g.id)}
                  onToggleSlide={(id) => toggleSlide(id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-5 py-3.5 flex flex-col gap-2.5"
          style={{
            borderTop: `1px solid ${BRAND.cardBorder}`,
            background: "#fafbfd",
          }}
        >
          {modal.step === 1 ? (
            <div className="flex items-center gap-2">
              <span
                className="flex-1 text-[12px]"
                style={{ color: BRAND.t2 }}
              >
                Step 1 of 2
              </span>
              <button
                type="button"
                onClick={close}
                className="text-[12px] font-semibold px-3 py-1.5 rounded-card border"
                style={{
                  background: "#fff",
                  borderColor: BRAND.cardBorder,
                  color: BRAND.t2,
                }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2.5 flex-wrap">
                <span
                  className="flex-1 text-[12px]"
                  style={{ color: BRAND.t2 }}
                >
                  <b style={{ color: BRAND.indigo }}>{cnt}</b> of{" "}
                  {TOTAL_SLIDES} slides selected · ~
                  <b style={{ color: BRAND.indigo }}>{time}</b> min read time
                </span>
                {modal.cadence !== "custom" && (
                  <button
                    type="button"
                    onClick={resetToCadence}
                    className="text-[11px] font-semibold px-2.5 py-1 rounded-card border"
                    style={{
                      background: "#fff",
                      borderColor: BRAND.cardBorder,
                      color: BRAND.t2,
                    }}
                  >
                    ↺ Reset to cadence defaults
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setModal((m) => ({ ...m, step: 1 }))}
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-card border"
                  style={{
                    background: "#fff",
                    borderColor: BRAND.cardBorder,
                    color: BRAND.t2,
                  }}
                >
                  ← Back
                </button>
              </div>
              <div className="flex gap-2 items-center justify-end">
                <span
                  className="text-[11px] mr-auto"
                  style={{ color: BRAND.t3 }}
                >
                  Export as:
                </span>
                <button
                  type="button"
                  disabled={cnt === 0 || busy !== null}
                  onClick={doHTML}
                  className="text-[12px] font-semibold px-3.5 py-2.5 rounded-card border inline-flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    background: "#fff",
                    borderColor: BRAND.cardBorder,
                    color: BRAND.t2,
                  }}
                >
                  <span className="text-[15px]">🌐</span>
                  {busy === "html" ? "Opening…" : "View HTML"}
                </button>
                <button
                  type="button"
                  disabled={cnt === 0 || busy !== null}
                  onClick={doPDF}
                  className="text-[12px] font-semibold px-3.5 py-2.5 rounded-card border inline-flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    background: "#fff",
                    borderColor: BRAND.cardBorder,
                    color: BRAND.t2,
                  }}
                >
                  <span className="text-[15px]">📄</span>
                  {busy === "pdf" ? "Opening…" : "Save as PDF"}
                </button>
                <button
                  type="button"
                  disabled={cnt === 0 || busy !== null}
                  onClick={doPPT}
                  className="text-[12px] font-semibold px-3.5 py-2.5 rounded-card text-white inline-flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{
                    background: BRAND.indigo,
                    borderColor: BRAND.indigo,
                  }}
                >
                  <span className="text-[15px]">📊</span>
                  {busy === "ppt" ? "Building…" : "Download PPT"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tree group
// ---------------------------------------------------------------------------
function TreeGroup({
  group,
  modal,
  onToggleGroupAll,
  onToggleGroup,
  onToggleSlide,
}: {
  group: (typeof DECK_STRUCTURE)[number];
  modal: ModalState;
  onToggleGroupAll: () => void;
  onToggleGroup: () => void;
  onToggleSlide: (id: string) => void;
}) {
  const expanded = modal.expandedGroups.has(group.id);
  const checkedCount = group.slides.filter((s) =>
    modal.selectedSlides.has(s.id),
  ).length;
  const allChecked = checkedCount === group.slides.length;
  const partial = checkedCount > 0 && !allChecked;
  const state: "all" | "partial" | "none" = allChecked
    ? "all"
    : partial
      ? "partial"
      : "none";
  const isModules = group.id === "modules";

  return (
    <div
      className="rounded-card mb-2 overflow-hidden"
      style={{
        border: `1px solid ${BRAND.cardBorder}`,
        background: "#fff",
      }}
    >
      <div
        className="flex items-center gap-2 px-3 py-2.5"
        style={{
          background: isModules ? "#ede6ff" : "#fafbfd",
          cursor: "default",
        }}
      >
        <TreeCb state={state} onClick={onToggleGroupAll} />
        <span className="text-[14px]">{group.emoji}</span>
        <span
          className="text-[12px] font-bold flex-1 cursor-pointer select-none"
          style={{ color: BRAND.t1 }}
          onClick={onToggleGroup}
        >
          {group.name}
        </span>
        <span
          className="text-[10px] font-semibold"
          style={{ color: BRAND.t3 }}
        >
          {checkedCount} / {group.slides.length}
        </span>
        <span
          onClick={onToggleGroup}
          className="text-[10px] cursor-pointer"
          style={{
            color: BRAND.t3,
            transform: expanded ? "rotate(90deg)" : undefined,
            transition: "transform .15s",
          }}
        >
          ▶
        </span>
      </div>
      {expanded && (
        <div className="py-1 pl-9 pr-3 pb-2">
          {group.slides.map((s) => {
            const on = modal.selectedSlides.has(s.id);
            return (
              <div
                key={s.id}
                className="flex items-center gap-2 py-1 cursor-pointer hover:text-beroe-blue"
                style={{ color: BRAND.t2 }}
                onClick={() => onToggleSlide(s.id)}
              >
                <TreeCb
                  state={on ? "all" : "none"}
                  size="sm"
                  onClick={(e) => {
                    e?.stopPropagation();
                    onToggleSlide(s.id);
                  }}
                />
                <span className="text-[12px] flex-1">{s.name}</span>
                {s.hero && (
                  <span
                    className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                    style={{
                      background: "#ede6ff",
                      color: "#3800CC",
                    }}
                  >
                    HERO
                  </span>
                )}
                <span
                  className="text-[10px] font-semibold"
                  style={{ color: BRAND.t3 }}
                >
                  ~{s.readTime}m
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TreeCb({
  state,
  size = "md",
  onClick,
}: {
  state: "all" | "partial" | "none";
  size?: "sm" | "md";
  onClick?: (e?: React.MouseEvent) => void;
}) {
  const dim = size === "sm" ? 14 : 16;
  const fontSize = size === "sm" ? 10 : 11;
  const bg =
    state === "all" ? BRAND.indigo : state === "partial" ? "#a78bfa" : "#fff";
  const border =
    state === "all" || state === "partial" ? bg : BRAND.cardBorder;
  return (
    <span
      onClick={(e) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      className="inline-flex items-center justify-center rounded-[4px] cursor-pointer font-extrabold text-white shrink-0"
      style={{
        width: dim,
        height: dim,
        fontSize,
        background: bg,
        border: `1.5px solid ${border}`,
      }}
    >
      {state === "all" ? "✓" : state === "partial" ? "–" : ""}
    </span>
  );
}
