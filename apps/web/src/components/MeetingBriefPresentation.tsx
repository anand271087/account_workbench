// Pre-Meeting Brief — presentation view.
//
// Read-only one-page render of the brief that mirrors the prototype's
// `bMomBrief` (beroe_awb_v20.html line 8806+). Stakeholder feedback on
// 22-May Row 48 was that the editable BriefSection layout reads like a
// form; they wanted it as a printable one-pager.
//
// Companion to MeetingBriefEditor — the BriefTab swaps between the two
// via a small "Presentation / Edit" toggle.

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  BRIEF_CALL_TYPE_LABELS,
  type MeetingBrief,
} from "@/types/meeting_brief";

// Prototype palette — keep in sync with bMomBrief inline colours.
const MP = "#534AB7"; // Beroe purple
const MN = "#0D1117"; // dark/self
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
      <div className="bg-violet-50 border border-violet-200 rounded-card p-8 text-center">
        <div className="text-[24px] mb-2">📝</div>
        <div className="text-sm font-bold text-violet-900 mb-1">
          No brief generated yet
        </div>
        <div className="text-[12px] text-violet-800/80">
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
          1. HEADER — Beroe brand + title + call-type chip + win condition
          ============================================================ */}
      <header
        className="px-8 pt-7 pb-5"
        style={{ borderBottom: `2px solid ${MP}` }}
      >
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <span
              className="text-white text-[15px] font-extrabold px-3 py-1 rounded-md"
              style={{ background: MP }}
            >
              Beroe
            </span>
            <span className="text-text-muted text-[11px] uppercase tracking-wider font-bold">
              Pre-Meeting Brief
            </span>
          </div>
          <div className="text-right">
            {data.call_type && (
              <span
                className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded"
                style={{ background: MP + "15", color: MP }}
              >
                {BRIEF_CALL_TYPE_LABELS[data.call_type]}
              </span>
            )}
            <div className="text-[11px] text-text-muted mt-1">
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
              {data.call_platform && <> · {data.call_platform}</>}
            </div>
          </div>
        </div>
        <h1 className="text-[20px] font-bold mt-3 leading-tight">
          {accountName}
        </h1>
        {data.win_condition && (
          <div
            className="mt-3 rounded-md px-3 py-2 text-[12px] leading-relaxed"
            style={{ background: "#f4f3fe", borderLeft: `3px solid ${MP}`, color: "#333" }}
          >
            <span
              className="text-[9px] font-bold uppercase tracking-wider block mb-1"
              style={{ color: MP }}
            >
              Win condition
            </span>
            {data.win_condition}
          </div>
        )}
      </header>

      <div className="px-8 py-6 space-y-6">
        {/* ============================================================
            2. COMPANY SNAPSHOT — stat cards
            ============================================================ */}
        {data.company_snapshot.length > 0 && (
          <Section title="Company Snapshot">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
              {data.company_snapshot.map((s, i) => (
                <div
                  key={i}
                  className="rounded-md border px-3 py-2.5"
                  style={{ background: "#faf9ff", borderColor: "#e0deff" }}
                >
                  <div
                    className="text-[16px] font-extrabold leading-tight"
                    style={{ color: MP }}
                  >
                    {s.num || "—"}
                  </div>
                  <div className="text-[10px] font-bold text-text-secondary uppercase tracking-wider mt-1 leading-tight">
                    {s.label}
                  </div>
                  {s.sub && (
                    <div className="text-[10px] text-text-muted italic mt-0.5 leading-tight">
                      {s.sub}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ============================================================
            3. CALL TIMER — agenda
            ============================================================ */}
        {data.call_timer.length > 0 && (
          <Section title="Agenda · Call Timer">
            <ol className="border border-beroe-card-border rounded-md overflow-hidden">
              {data.call_timer.map((t, i) => (
                <li
                  key={i}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 text-[12px]",
                    i % 2 === 0 ? "bg-slate-50/40" : "bg-white",
                  )}
                >
                  <span
                    className="text-[10px] font-bold uppercase tracking-wider whitespace-nowrap"
                    style={{ color: MP }}
                  >
                    {t.time}
                  </span>
                  <span className="flex-1 leading-snug">{t.label}</span>
                </li>
              ))}
            </ol>
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
                                        borderColor: "#97C459",
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
            5. MINEFIELDS
            ============================================================ */}
        {data.minefields.length > 0 && (
          <Section title="Minefields — what NOT to do">
            <ul className="space-y-1.5">
              {data.minefields.map((m, i) => {
                const sevCol = m.severity === "high" ? MR : MA;
                return (
                  <li
                    key={i}
                    className="rounded-md px-3 py-2 border-l-2"
                    style={{
                      background: m.severity === "high" ? "#fff5f5" : "#fefce8",
                      borderLeftColor: sevCol,
                    }}
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className="text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 flex-shrink-0"
                        style={{
                          background: sevCol + "20",
                          color: sevCol,
                        }}
                      >
                        {m.type ?? m.severity}
                      </span>
                      <div className="flex-1 text-[12px] leading-snug">
                        <div className="font-semibold">{m.text}</div>
                        {m.why && (
                          <div className="text-[11px] text-text-muted italic mt-0.5">
                            Why: {m.why}
                          </div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Section>
        )}

        {/* ============================================================
            6. OBJECTIVES
            ============================================================ */}
        {data.objectives.length > 0 && (
          <Section title="Objectives">
            <div className="space-y-2">
              {data.objectives.map((o, i) => (
                <div
                  key={i}
                  className="rounded-md border border-beroe-card-border px-3 py-2"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center text-white"
                      style={{ background: MP }}
                    >
                      {o.rank}
                    </span>
                    <h4 className="text-[13px] font-bold leading-tight flex-1">
                      {o.name}
                    </h4>
                  </div>
                  {o.bullets.length > 0 && (
                    <ul className="space-y-0.5 ml-7 mb-1">
                      {o.bullets.map((b, j) => (
                        <li
                          key={j}
                          className="text-[12px] text-text-secondary leading-snug pl-3 relative"
                        >
                          <span
                            className="absolute left-0 text-[9px]"
                            style={{ color: MP }}
                          >
                            ●
                          </span>
                          {b}
                        </li>
                      ))}
                    </ul>
                  )}
                  {o.beroe && (
                    <div
                      className="ml-7 text-[11px] rounded px-2 py-1.5 mt-1"
                      style={{
                        background: "#f0fdf4",
                        color: MG,
                        borderLeft: `2px solid ${MG}`,
                      }}
                    >
                      <span className="font-bold uppercase tracking-wider text-[9px] block mb-0.5">
                        Beroe play
                      </span>
                      {o.beroe}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ============================================================
            7. DISCOVERY QUESTIONS
            ============================================================ */}
        {data.discovery_questions.length > 0 && (
          <Section title="Discovery Questions">
            <div className="space-y-1.5">
              {data.discovery_questions
                .slice()
                .sort((a, b) => a.rank - b.rank)
                .map((q, i) => (
                  <div
                    key={i}
                    className="rounded-md px-3 py-2 border border-beroe-card-border"
                  >
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span
                        className="text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5"
                        style={{ background: MP + "15", color: MP }}
                      >
                        #{q.rank}
                      </span>
                      {q.category && (
                        <span className="text-[9px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 bg-slate-100 text-text-secondary">
                          {q.category}
                        </span>
                      )}
                      <span className="text-[11px] text-text-muted">
                        → {q.person || "open"}
                      </span>
                      <span className="text-[10px] text-text-muted ml-auto italic">
                        {q.objective}
                      </span>
                    </div>
                    <div className="text-[12px] leading-snug font-medium">
                      {q.text}
                    </div>
                  </div>
                ))}
            </div>
          </Section>
        )}

        {/* ============================================================
            8. VALUE ANCHORS
            ============================================================ */}
        {data.value_anchors.length > 0 && (
          <Section title="Value Anchors">
            <div className="space-y-2">
              {data.value_anchors.map((v, i) => (
                <div
                  key={i}
                  className="rounded-md border border-beroe-card-border overflow-hidden"
                >
                  <div
                    className="text-[10px] font-bold uppercase tracking-wider px-3 py-1.5"
                    style={{ background: "#f4f3fe", color: MP }}
                  >
                    {v.objective}
                  </div>
                  <ul className="px-3 py-2 space-y-1">
                    {v.points.map((p, j) => (
                      <li
                        key={j}
                        className="text-[12px] leading-snug pl-4 relative"
                      >
                        <span
                          className="absolute left-0 text-[9px]"
                          style={{ color: MP }}
                        >
                          ↗
                        </span>
                        <span className="font-medium">{p.text}</span>
                        {p.note && (
                          <div className="text-[10px] text-text-muted italic mt-0.5">
                            {p.note}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
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
            11. CLOSING SCENARIOS
            ============================================================ */}
        {data.closing_scenarios.length > 0 && (
          <Section title="Closing Scenarios">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {data.closing_scenarios.map((c, i) => {
                const col =
                  c.type === "good" ? MG : c.type === "neutral" ? MA : MR;
                const bg =
                  c.type === "good"
                    ? "#f0fdf4"
                    : c.type === "neutral"
                      ? "#fefce8"
                      : "#fff5f5";
                return (
                  <div
                    key={i}
                    className="rounded-md px-3 py-2"
                    style={{ background: bg, borderLeft: `3px solid ${col}` }}
                  >
                    <div
                      className="text-[10px] font-bold uppercase tracking-wider mb-1"
                      style={{ color: col }}
                    >
                      {c.label ?? c.type}
                    </div>
                    <div className="text-[12px] leading-snug">{c.text}</div>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* ============================================================
            12. CHEAT SHEET — never say + opening asks
            ============================================================ */}
        {(data.cheat_sheet_never_say.length > 0 ||
          data.cheat_sheet_opening_asks.length > 0 ||
          data.cheat_sheet_win_condition_short) && (
          <Section title="Cheat Sheet">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {data.cheat_sheet_win_condition_short && (
                <div
                  className="md:col-span-2 rounded-md px-3 py-2.5"
                  style={{ background: "#f4f3fe", borderLeft: `3px solid ${MP}` }}
                >
                  <div
                    className="text-[9px] font-bold uppercase tracking-wider mb-1"
                    style={{ color: MP }}
                  >
                    Win condition · short
                  </div>
                  <div className="text-[13px] font-semibold leading-snug">
                    {data.cheat_sheet_win_condition_short}
                  </div>
                </div>
              )}
              {data.cheat_sheet_opening_asks.length > 0 && (
                <div className="rounded-md border border-beroe-card-border px-3 py-2">
                  <div
                    className="text-[9px] font-bold uppercase tracking-wider mb-1"
                    style={{ color: MG }}
                  >
                    Opening Asks
                  </div>
                  <ul className="space-y-0.5">
                    {data.cheat_sheet_opening_asks.map((a, i) => (
                      <li
                        key={i}
                        className="text-[12px] leading-snug pl-3 relative"
                      >
                        <span
                          className="absolute left-0 text-[9px]"
                          style={{ color: MG }}
                        >
                          ✓
                        </span>
                        {a}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {data.cheat_sheet_never_say.length > 0 && (
                <div className="rounded-md border border-beroe-card-border px-3 py-2">
                  <div
                    className="text-[9px] font-bold uppercase tracking-wider mb-1"
                    style={{ color: MR }}
                  >
                    Never Say
                  </div>
                  <ul className="space-y-0.5">
                    {data.cheat_sheet_never_say.map((n, i) => (
                      <li
                        key={i}
                        className="text-[12px] leading-snug pl-3 relative"
                      >
                        <span
                          className="absolute left-0 text-[9px]"
                          style={{ color: MR }}
                        >
                          ✕
                        </span>
                        {n}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* Categories tab (M46 — procurement categories in scope). */}
        {data.categories.length > 0 && (
          <Section title="Categories in scope">
            <div className="flex flex-wrap gap-1.5">
              {data.categories.map((c, i) => (
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
          </Section>
        )}
      </div>
    </article>
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
        style={{ color: MP }}
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
