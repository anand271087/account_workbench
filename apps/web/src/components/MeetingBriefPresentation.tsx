// Pre-Meeting Brief — presentation view.
//
// Read-only one-page render of the brief that mirrors the prototype's
// `bMomBrief` (beroe_awb_v20.html line 8806+). Stakeholder feedback on
// 22-May Row 48 was that the editable BriefSection layout reads like a
// form; they wanted it as a printable one-pager.
//
// Companion to MeetingBriefEditor — the BriefTab swaps between the two
// via a small "Presentation / Edit" toggle.

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import {
  BRIEF_CALL_TYPE_LABELS,
  type MeetingBrief,
} from "@/types/meeting_brief";
import type { Engagement } from "@/types/engagement";

// Prototype palette — keep in sync with bMomBrief inline colours.
const MP = "#4A00F8"; // Beroe purple
const MN = "#001137"; // dark/self
const MA = "#B45309"; // amber accent (insights)
const MG = "#166534"; // success green
const MR = "#CF3030"; // red

export function MeetingBriefPresentation({
  accountId,
  accountName,
}: {
  accountId: string;
  accountName: string;
}) {
  const { data, isLoading } = useQuery<MeetingBrief>({
    queryKey: ["meeting-brief", accountId],
    queryFn: () =>
      api.get<MeetingBrief>(`/api/v1/accounts/${accountId}/meeting-brief`),
  });

  // Categories fallback — the brief has its own `categories` list, but
  // it's usually empty until a user explicitly fills it. The richer
  // source is `account_engagement.target_categories` from Pre-Sales.
  // We surface a "from Pre-Sales" label when sourced this way so the
  // user can see where the data came from.
  const { data: engagement } = useQuery<Engagement>({
    queryKey: ["engagement", accountId],
    queryFn: () =>
      api.get<Engagement>(`/api/v1/accounts/${accountId}/engagement`),
  });

  if (isLoading || !data) {
    return (
      <div className="bg-white rounded-card border border-beroe-card-border p-8 text-center text-sm text-text-muted">
        Loading brief…
      </div>
    );
  }

  const isEmpty =
    data.attendees.length === 0 &&
    data.objectives.length === 0 &&
    data.discovery_questions.length === 0 &&
    data.minefields.length === 0 &&
    !data.win_condition;

  if (isEmpty) {
    return (
      <div className="bg-beroe-blue/5 border border-beroe-blue/30 rounded-card p-8 text-center">
        <div className="text-[24px] mb-2">📝</div>
        <div className="text-sm font-bold text-beroe-blue mb-1">
          No brief generated yet
        </div>
        <div className="text-[12px] text-beroe-blue/80">
          Switch to <b>Edit</b> mode and click <b>✨ Generate full brief</b>
          {" "}to auto-fill from {accountName}'s context.
        </div>
      </div>
    );
  }

  return (
    <article
      className="bg-white border border-beroe-card-border rounded-card overflow-hidden font-sans text-[13px] text-text-primary"
      style={{ fontFamily: "DM Sans, system-ui, sans-serif" }}
    >
      {/* ============================================================
          1. HEADER — verbatim port of prototype line 8817-8828.
             "Beroe × ACCOUNT" inline + right-side call meta.
          ============================================================ */}
      <header
        className="px-8 pt-6 pb-3.5 flex items-start justify-between gap-4 flex-wrap"
        style={{ borderBottom: `2px solid ${MP}` }}
      >
        <div className="flex items-center gap-2.5">
          <span
            className="text-white text-[15px] font-extrabold px-2.5 py-1 rounded-md"
            style={{ background: MP }}
          >
            Beroe
          </span>
          <span className="text-[14px]" style={{ color: "#aaa" }}>
            ×
          </span>
          <span
            className="text-[15px] font-bold uppercase"
            style={{ color: "#CF4548", letterSpacing: "0.5px" }}
          >
            {accountName}
          </span>
        </div>
        <div className="text-right">
          <div className="text-[11px]" style={{ color: "#888" }}>
            {data.call_date
              ? new Date(data.call_date).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })
              : "Date TBD"}
            {data.call_time && <> · {data.call_time}</>}
            {data.call_duration_minutes && (
              <> · {data.call_duration_minutes} min</>
            )}
          </div>
          <div
            className="text-[11px] font-semibold mt-0.5"
            style={{ color: MP }}
          >
            {data.call_type
              ? BRIEF_CALL_TYPE_LABELS[data.call_type]
              : "Brief"}
            {data.call_platform && <> · {data.call_platform}</>}
          </div>
        </div>
      </header>

      <div className="px-8 py-5 space-y-5">
        {/* ============================================================
            2. WIN CONDITION — verbatim port of prototype line 8830-8833.
               Violet gradient banner with 🎯 emoji.
            ============================================================ */}
        {data.win_condition && (
          <div
            className="rounded-lg px-5 py-3.5 text-[13px] font-semibold text-white leading-relaxed"
            style={{
              background: `linear-gradient(135deg, ${MP}, #4A00F8)`,
            }}
          >
            🎯 {data.win_condition}
          </div>
        )}
        {/* ============================================================
            3. COMPANY SNAPSHOT — verbatim port of prototype line 8835-8842.
               Dark #001137 bar with vertical-divider columns.
            ============================================================ */}
        {data.company_snapshot.length > 0 && (
          <div
            className="rounded-lg flex"
            style={{ background: MN, padding: "16px 0" }}
          >
            {data.company_snapshot.map((s, i) => (
              <div
                key={i}
                className="flex-1 text-center"
                style={{
                  padding: "0 12px",
                  borderRight:
                    i < data.company_snapshot.length - 1
                      ? "1px solid rgba(255,255,255,0.15)"
                      : "none",
                }}
              >
                <div
                  className="text-[17px] font-extrabold leading-tight text-white"
                >
                  {s.num || "—"}
                </div>
                <div
                  className="text-[10px] mt-0.5"
                  style={{ color: "#8b8fa3" }}
                >
                  {s.label}
                </div>
                {s.sub && (
                  <div className="text-[9px]" style={{ color: "#555c6e" }}>
                    {s.sub}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ============================================================
            4. CALL TIMER — verbatim port of prototype line 8844-8851.
               Horizontal pill bar with alternating #f4f3fe / white columns.
            ============================================================ */}
        {data.call_timer.length > 0 && (
          <Section title="Call Timer">
            <div className="flex">
              {data.call_timer.map((t, i) => {
                const last = i === data.call_timer.length - 1;
                return (
                  <div
                    key={i}
                    className="flex-1 text-center"
                    style={{
                      padding: "6px 4px",
                      background: i % 2 === 0 ? "#f4f3fe" : "#fff",
                      borderTopLeftRadius: i === 0 ? 6 : 0,
                      borderBottomLeftRadius: i === 0 ? 6 : 0,
                      borderTopRightRadius: last ? 6 : 0,
                      borderBottomRightRadius: last ? 6 : 0,
                    }}
                  >
                    <div
                      className="text-[10px] font-bold"
                      style={{ color: MP }}
                    >
                      {t.time}
                    </div>
                    <div className="text-[10px]" style={{ color: "#555" }}>
                      {t.label}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* ============================================================
            4. THE ROOM — attendee cards
            ============================================================ */}
        {data.attendees.length > 0 && (
          <Section title="The Room">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {data.attendees.map((a, i) => {
                const isSelf = a.is_self;
                const border = isSelf
                  ? MN
                  : a.company === "client"
                    ? MP
                    : "#94a3b8";
                return (
                  <div
                    key={i}
                    className="rounded-md border overflow-hidden"
                    style={{
                      borderColor: isSelf ? MN + "40" : "#e8e8f0",
                      background: isSelf ? "#f8f9fc" : "#fff",
                    }}
                  >
                    <div
                      className="flex items-center gap-2 px-3 py-2"
                      style={{ background: isSelf ? MN : border + "10" }}
                    >
                      <div
                        className="w-7 h-7 rounded-full text-white text-[10px] font-extrabold flex items-center justify-center flex-shrink-0"
                        style={{ background: a.avatar_color || MP }}
                      >
                        {a.initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div
                          className="text-[12px] font-bold leading-tight truncate"
                          style={{ color: isSelf ? "#fff" : "#1a1a2e" }}
                        >
                          {a.name}
                        </div>
                        <div
                          className="text-[10px] font-semibold leading-tight"
                          style={{ color: isSelf ? "#8b8fa3" : MP }}
                        >
                          {a.role ?? "—"}
                        </div>
                      </div>
                    </div>
                    <div className="px-3 py-2">
                      {a.objectives.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-1.5">
                          {a.objectives.map((o, j) => {
                            const isPrimary = o === a.primary_objective;
                            return (
                              <span
                                key={j}
                                className="text-[9px] font-bold uppercase tracking-wider rounded-full px-1.5 py-0.5 border"
                                style={
                                  isPrimary
                                    ? {
                                        background: "#EAF3DE",
                                        color: "#27500A",
                                        borderColor: "#6EC457",
                                      }
                                    : {
                                        background: "#f4f3fe",
                                        color: MP,
                                        borderColor: "#e0deff",
                                      }
                                }
                              >
                                {o}
                              </span>
                            );
                          })}
                        </div>
                      )}
                      {a.background.length > 0 && (
                        <ul className="space-y-0.5 mb-1.5">
                          {a.background.map((b, j) => (
                            <li
                              key={j}
                              className="text-[11px] text-text-secondary leading-snug pl-3 relative"
                            >
                              <span
                                className="absolute left-0 text-[9px]"
                                style={{ color: MP }}
                              >
                                →
                              </span>
                              {b}
                            </li>
                          ))}
                        </ul>
                      )}
                      {a.opening_ask && (
                        <div
                          className="text-[10px] rounded px-2 py-1 leading-snug"
                          style={{ background: "#FAEEDA", color: "#854F0B" }}
                        >
                          💬 {a.opening_ask}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* ============================================================
            5. MINEFIELDS — verbatim port of prototype line 8873-8881.
               2-column grid, high-severity first.
            ============================================================ */}
        {data.minefields.length > 0 && (
          <SectionRed title="Minefields">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {[...data.minefields]
                .sort((a) => (a.severity === "high" ? -1 : 1))
                .map((m, i) => {
                  const isHigh = m.severity === "high";
                  return (
                    <div
                      key={i}
                      className="rounded-r-lg px-3 py-2.5"
                      style={{
                        background: isHigh ? "#FCEBEB" : "#FFF8EB",
                        border: `1px solid ${isHigh ? "#F7C1C1" : "#F0BC41"}`,
                        borderLeft: `3px solid ${isHigh ? MR : MA}`,
                      }}
                    >
                      <div
                        className="text-[10px] font-bold uppercase tracking-wider mb-1"
                        style={{ color: isHigh ? "#A32D2D" : "#854F0B" }}
                      >
                        {m.severity.toUpperCase()}
                        {m.type && <> — {m.type}</>}
                      </div>
                      <div
                        className="text-[12px] leading-snug mb-1"
                        style={{ color: isHigh ? "#501313" : "#633806" }}
                      >
                        {m.text}
                      </div>
                      {m.why && (
                        <div
                          className="text-[11px] pt-1 leading-snug"
                          style={{
                            color: isHigh ? "#791F1F" : "#854F0B",
                            borderTop: `0.5px solid ${isHigh ? "#F09595" : "#F0BC41"}`,
                          }}
                        >
                          {m.why}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </SectionRed>
        )}

        {/* ============================================================
            6. OBJECTIVES — verbatim port of prototype line 8883-8892.
               Grid by count, first highlighted with violet bg + border.
               Confidence shown as ●●●○○ dots.
            ============================================================ */}
        {data.objectives.length > 0 && (
          <Section title="Objectives">
            <div
              className="grid gap-3"
              style={{
                gridTemplateColumns: `repeat(${Math.min(data.objectives.length, 3)}, 1fr)`,
              }}
            >
              {data.objectives.map((o, i) => {
                const isPrimary = i === 0;
                return (
                  <div
                    key={i}
                    className="rounded-lg px-3.5 py-3"
                    style={{
                      border: `1px solid ${isPrimary ? MP : "#e8e8f0"}`,
                      background: isPrimary ? "#f4f3fe" : "#fff",
                    }}
                  >
                    <div
                      className="text-[10px] font-bold uppercase tracking-wider mb-1"
                      style={{ color: isPrimary ? MP : "#888" }}
                    >
                      #{o.rank} Objective ·{" "}
                      <span style={{ color: MP }}>
                        {"●".repeat(o.confidence)}
                      </span>
                      <span style={{ color: "#ddd" }}>
                        {"●".repeat(5 - o.confidence)}
                      </span>
                    </div>
                    <div className="text-[13px] font-bold leading-tight mb-1.5">
                      {o.name}
                    </div>
                    {o.bullets.length > 0 && (
                      <ul className="mb-1">
                        {o.bullets.map((b, j) => (
                          <li
                            key={j}
                            className="text-[11px] leading-snug pl-3 relative py-0.5"
                            style={{ color: "#555" }}
                          >
                            <span
                              className="absolute left-0 text-[9px]"
                              style={{ color: MP }}
                            >
                              →
                            </span>
                            {b}
                          </li>
                        ))}
                      </ul>
                    )}
                    {o.beroe && (
                      <div
                        className="text-[10px] italic pt-2 mt-1 leading-snug"
                        style={{
                          color: MP,
                          borderTop: "1px solid #e0deff",
                        }}
                      >
                        {o.beroe}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* ============================================================
            7. DISCOVERY QUESTIONS — verbatim port of prototype line
               8894-8906. Tabbed by objective (objective names from
               data.objectives, fallback to question.objective).
            ============================================================ */}
        {data.discovery_questions.length > 0 && (
          <Section title="Discovery Questions">
            <ObjectiveTabs
              objectiveNames={objectiveNamesFromBrief(data)}
              renderTab={(on) => {
                const qs = data.discovery_questions
                  .filter((q) => q.objective === on)
                  .sort((a, b) => a.rank - b.rank);
                if (qs.length === 0) {
                  return (
                    <div className="text-[11px] italic text-text-muted">
                      No questions tagged to this objective.
                    </div>
                  );
                }
                return (
                  <div className="space-y-1.5">
                    {qs.map((q, i) => (
                      <div
                        key={i}
                        className="rounded-r-md px-3 py-2 flex gap-2.5 items-start"
                        style={{
                          background: "#fff",
                          border: "1px solid #e8e8f0",
                          borderLeft: `3px solid ${q.from_email ? MA : MP}`,
                        }}
                      >
                        <span
                          className="text-[10px] font-bold"
                          style={{
                            color: q.from_email ? "#BA7517" : MP,
                            minWidth: 18,
                          }}
                        >
                          #{q.rank}
                        </span>
                        <div className="flex-1">
                          <div
                            className="text-[10px] font-bold uppercase mb-0.5"
                            style={{
                              color: q.from_email ? "#BA7517" : MP,
                            }}
                          >
                            {q.person || "open"}
                            {q.from_email && (
                              <span
                                className="text-[9px] rounded px-1.5 py-0.5 ml-1 font-bold"
                                style={{
                                  background: "#FAEEDA",
                                  color: "#854F0B",
                                }}
                              >
                                from email
                              </span>
                            )}
                          </div>
                          <div
                            className="text-[12px] leading-snug"
                            style={{ color: "#333" }}
                          >
                            {q.text}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              }}
            />
          </Section>
        )}

        {/* ============================================================
            8. VALUE ANCHORS — verbatim port of prototype line 8908-8917.
               Tabbed by objective (only objectives that have anchors).
            ============================================================ */}
        {data.value_anchors.length > 0 && (
          <Section title="Value Anchors">
            <ObjectiveTabs
              objectiveNames={data.value_anchors.map((v) => v.objective)}
              renderTab={(on) => {
                const va = data.value_anchors.find((v) => v.objective === on);
                if (!va || va.points.length === 0) {
                  return (
                    <div className="text-[11px] italic text-text-muted">
                      No anchors captured yet.
                    </div>
                  );
                }
                return (
                  <div>
                    {va.points.map((p, j) => (
                      <div
                        key={j}
                        className="text-[12px] leading-snug pl-4 relative py-1.5"
                        style={{
                          color: "#333",
                          borderBottom: "0.5px solid #f0f0fa",
                        }}
                      >
                        <span
                          className="absolute left-0 text-[9px]"
                          style={{ color: MP }}
                        >
                          ↗
                        </span>
                        {p.text}
                        {p.note && (
                          <div
                            className="text-[10px] italic mt-0.5"
                            style={{ color: "#888" }}
                          >
                            {p.note}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                );
              }}
            />
          </Section>
        )}

        {/* ============================================================
            9. INTELLIGENCE — email insights + public signals
            ============================================================ */}
        {(data.email_insights.length > 0 || data.public_signals.length > 0) && (
          <Section title="Intelligence">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-2">
                {data.email_insights.length > 0 ? (
                  data.email_insights.map((ei, i) => (
                    <div
                      key={i}
                      className="rounded-r-md border border-beroe-card-border px-3 py-2"
                      style={{ borderLeft: `3px solid ${MA}` }}
                    >
                      <div
                        className="text-[9px] font-bold uppercase tracking-wider mb-1"
                        style={{ color: "#BA7517" }}
                      >
                        {ei.meta}
                      </div>
                      <ul className="space-y-0.5">
                        {ei.bullets.map((b, j) => (
                          <li
                            key={j}
                            className="text-[12px] leading-snug pl-3 relative"
                          >
                            <span
                              className="absolute left-0 text-[9px]"
                              style={{ color: MA }}
                            >
                              →
                            </span>
                            {b}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))
                ) : (
                  <EmptyHint label="No email insights" />
                )}
              </div>
              <div className="space-y-2">
                {data.public_signals.length > 0 ? (
                  data.public_signals.map((ps, i) => (
                    <div
                      key={i}
                      className="rounded-r-md border border-beroe-card-border px-3 py-2"
                      style={{ borderLeft: `3px solid ${MP}` }}
                    >
                      {ps.person && (
                        <div
                          className="text-[9px] font-bold uppercase tracking-wider mb-0.5"
                          style={{ color: MP }}
                        >
                          {ps.person}
                        </div>
                      )}
                      {ps.url ? (
                        <a
                          href={ps.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[12px] font-bold block leading-snug hover:underline"
                          style={{ color: MP }}
                        >
                          {ps.headline}
                        </a>
                      ) : (
                        <div
                          className="text-[12px] font-bold leading-snug"
                          style={{ color: MP }}
                        >
                          {ps.headline}
                        </div>
                      )}
                      {ps.text && (
                        <div className="text-[11px] text-text-secondary mt-0.5 leading-snug">
                          {ps.text}
                        </div>
                      )}
                      {ps.tag && (
                        <span
                          className="text-[9px] font-bold uppercase tracking-wider rounded-full border px-1.5 py-0.5 mt-1 inline-block"
                          style={{
                            background: "#f4f3fe",
                            color: MP,
                            borderColor: "#e0deff",
                          }}
                        >
                          {ps.tag}
                        </span>
                      )}
                    </div>
                  ))
                ) : (
                  <EmptyHint label="No public signals" />
                )}
              </div>
            </div>
          </Section>
        )}

        {/* ============================================================
            10. NEWS
            ============================================================ */}
        {data.news.length > 0 && (
          <Section title="Recent News">
            <ul className="space-y-1.5">
              {data.news.map((n, i) => (
                <li
                  key={i}
                  className="rounded-md border border-beroe-card-border px-3 py-2 text-[12px] leading-snug"
                >
                  <div className="flex items-baseline gap-2 flex-wrap">
                    {n.days_ago !== null && (
                      <span
                        className="text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5"
                        style={{ background: MP + "15", color: MP }}
                      >
                        {n.days_ago}d ago
                      </span>
                    )}
                    {n.url ? (
                      <a
                        href={n.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold hover:underline flex-1"
                        style={{ color: MP }}
                      >
                        {n.headline}
                      </a>
                    ) : (
                      <span className="font-semibold flex-1">{n.headline}</span>
                    )}
                    {n.source && (
                      <span className="text-[10px] text-text-muted italic">
                        — {n.source}
                      </span>
                    )}
                  </div>
                  {n.signal && (
                    <div className="text-[11px] text-text-secondary mt-1 leading-snug">
                      {n.signal}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* ============================================================
            11. CLOSING SCENARIOS — verbatim port of prototype 8955-8962.
               Always rendered; if empty, an explicit hint tells the
               user where the data should come from (Edit mode).
            ============================================================ */}
        <Section title="Closing Scenarios">
          {data.closing_scenarios.length > 0 ? (
            <div
              className="grid gap-2.5"
              style={{
                gridTemplateColumns: `repeat(${Math.min(data.closing_scenarios.length, 3)}, 1fr)`,
              }}
            >
              {data.closing_scenarios.map((c, i) => {
                const isGood = c.type === "good";
                const isNeutral = c.type === "neutral";
                const bg = isGood ? "#EAF3DE" : isNeutral ? "#f4f3fe" : "#FAEEDA";
                const bc = isGood
                  ? "#6EC457"
                  : isNeutral
                    ? "#e0deff"
                    : "#F0BC41";
                const tc = isGood ? MG : isNeutral ? MP : MA;
                const tx = isGood
                  ? "#173404"
                  : isNeutral
                    ? "#1a1a2e"
                    : "#633806";
                return (
                  <div
                    key={i}
                    className="rounded-lg px-3.5 py-3"
                    style={{ background: bg, border: `1px solid ${bc}` }}
                  >
                    <div
                      className="text-[10px] font-bold uppercase tracking-wider mb-1.5"
                      style={{ color: tc }}
                    >
                      {c.label ?? c.type}
                    </div>
                    <div
                      className="text-[12px] italic leading-relaxed"
                      style={{ color: tx }}
                    >
                      {c.text}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyHint label="No closing scenarios captured yet — add good / neutral / poor scenarios in ✏️ Edit mode." />
          )}
        </Section>

        {/* ============================================================
            Categories — fallback chain:
              1. brief.categories (filled in Edit or by AI extraction)
              2. engagement.target_categories (Pre-Sales tab)
            We always render the section so it's clear where the data
            comes from. Source label flips between the two.
            ============================================================ */}
        {(() => {
          const fromBrief = data.categories ?? [];
          const fromEngagement = engagement?.target_categories ?? [];
          const list = fromBrief.length > 0 ? fromBrief : fromEngagement;
          const sourceLabel =
            fromBrief.length > 0
              ? "from Brief"
              : fromEngagement.length > 0
                ? "from Pre-Sales engagement"
                : null;
          return (
            <Section title="Categories in scope">
              {list.length > 0 ? (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {list.map((c, i) => (
                      <span
                        key={i}
                        className="text-[11px] font-semibold rounded-full px-2.5 py-1 border"
                        style={{
                          background: "#f4f3fe",
                          color: MP,
                          borderColor: "#e0deff",
                        }}
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                  {sourceLabel && (
                    <div className="text-[10px] text-text-muted italic mt-2">
                      {sourceLabel}
                    </div>
                  )}
                </>
              ) : (
                <EmptyHint label="No categories on the Brief or in Pre-Sales engagement. Add them on the Pre-Sales tab (target categories) or directly in ✏️ Edit mode." />
              )}
            </Section>
          );
        })()}

        {/* ============================================================
            12. CHEAT SHEET — verbatim port of prototype line 8964-8981.
               Dark #001137 bar at the bottom with 3 columns:
               Never Say (red) · Opening Asks (green) · Win Condition (white).
            ============================================================ */}
        {(data.cheat_sheet_never_say.length > 0 ||
          data.cheat_sheet_opening_asks.length > 0 ||
          data.cheat_sheet_win_condition_short ||
          data.win_condition) && (
          <div
            className="rounded-lg px-5 py-4"
            style={{ background: MN }}
          >
            <div
              className="text-[10px] font-bold uppercase tracking-wider mb-3"
              style={{ color: MP }}
            >
              Cheat Sheet
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <div
                  className="text-[9px] font-bold uppercase tracking-wider mb-1.5"
                  style={{ color: "#CF3030" }}
                >
                  ⛔ Never Say
                </div>
                {data.cheat_sheet_never_say.length > 0 ? (
                  data.cheat_sheet_never_say.map((s, i) => (
                    <div
                      key={i}
                      className="text-[11px] py-0.5"
                      style={{ color: "#CF4548" }}
                    >
                      • {s}
                    </div>
                  ))
                ) : (
                  <div
                    className="text-[11px] italic"
                    style={{ color: "#555c6e" }}
                  >
                    —
                  </div>
                )}
              </div>
              <div>
                <div
                  className="text-[9px] font-bold uppercase tracking-wider mb-1.5"
                  style={{ color: "#6EC457" }}
                >
                  💬 Opening Asks
                </div>
                {data.cheat_sheet_opening_asks.length > 0 ? (
                  data.cheat_sheet_opening_asks.map((s, i) => (
                    <div
                      key={i}
                      className="text-[11px] py-0.5"
                      style={{ color: "#6EC457" }}
                    >
                      • {s}
                    </div>
                  ))
                ) : (
                  <div
                    className="text-[11px] italic"
                    style={{ color: "#555c6e" }}
                  >
                    —
                  </div>
                )}
              </div>
              <div>
                <div
                  className="text-[9px] font-bold uppercase tracking-wider mb-1.5"
                  style={{ color: MP }}
                >
                  🎯 Win Condition
                </div>
                <div
                  className="text-[12px] font-semibold text-white leading-snug"
                >
                  {data.cheat_sheet_win_condition_short ||
                    data.win_condition ||
                    "—"}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

/** Extract objective names in the order the brief defines them.
 *  Fallback: any objective string referenced by discovery questions
 *  but absent from `objectives` gets appended last. */
function objectiveNamesFromBrief(b: MeetingBrief): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const o of b.objectives) {
    if (!seen.has(o.name)) {
      seen.add(o.name);
      out.push(o.name);
    }
  }
  for (const q of b.discovery_questions) {
    if (q.objective && !seen.has(q.objective)) {
      seen.add(q.objective);
      out.push(q.objective);
    }
  }
  return out;
}

/** Tabs-by-objective renderer — port of prototype's tab strip pattern
 *  used by Discovery Questions + Value Anchors (line 8897-8898, 8911-8912).
 *  Active tab: white bg + violet text + violet bottom-border.
 *  Inactive: #f4f3fe bg + grey text + #e0deff bottom-border. */
function ObjectiveTabs({
  objectiveNames,
  renderTab,
}: {
  objectiveNames: string[];
  renderTab: (objectiveName: string) => React.ReactNode;
}) {
  const names = objectiveNames.filter(Boolean);
  const [active, setActive] = useState(0);
  if (names.length === 0) {
    return (
      <div className="text-[11px] italic text-text-muted">
        No objectives defined.
      </div>
    );
  }
  const safeActive = Math.min(active, names.length - 1);
  return (
    <div>
      <div
        className="flex overflow-hidden"
        style={{
          border: "1px solid #e0deff",
          borderBottom: "none",
          borderRadius: "8px 8px 0 0",
        }}
      >
        {names.map((on, i) => {
          const isActive = i === safeActive;
          return (
            <button
              key={i}
              type="button"
              onClick={() => setActive(i)}
              className="flex-1 text-center text-[10px] font-bold uppercase cursor-pointer"
              style={{
                padding: "8px 10px",
                background: isActive ? "#fff" : "#f4f3fe",
                color: isActive ? MP : "#888",
                borderBottom: `2px solid ${isActive ? MP : "#e0deff"}`,
                letterSpacing: "0.06em",
              }}
            >
              {on.length > 20 ? on.slice(0, 20) + "…" : on}
            </button>
          );
        })}
      </div>
      <div
        style={{
          border: "1px solid #e0deff",
          borderTop: "none",
          borderRadius: "0 0 8px 8px",
          padding: "12px 14px",
        }}
      >
        {renderTab(names[safeActive])}
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div
        className="text-[10px] font-bold uppercase tracking-wider mb-2 flex items-center gap-2"
        style={{ color: MP, letterSpacing: "0.09em" }}
      >
        {title}
        <span
          className="flex-1 h-px"
          style={{ background: "#e0deff" }}
        />
      </div>
      {children}
    </section>
  );
}

/** Red variant — used by Minefields (prototype line 8874). */
function SectionRed({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div
        className="text-[10px] font-bold uppercase tracking-wider mb-2 flex items-center gap-2"
        style={{ color: MR, letterSpacing: "0.09em" }}
      >
        {title}
        <span
          className="flex-1 h-px"
          style={{ background: "#F7C1C1" }}
        />
      </div>
      {children}
    </section>
  );
}

function EmptyHint({ label }: { label: string }) {
  return (
    <div
      className="rounded-md border border-dashed px-3 py-3 text-[11px] italic text-text-muted text-center"
      style={{ background: "#faf9ff", borderColor: "#e0deff" }}
    >
      {label}
    </div>
  );
}
