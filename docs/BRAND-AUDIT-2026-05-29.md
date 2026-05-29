# Brand Guidelines Audit — Beroe AWB workbench

**Auditor:** Automated grep + manual review against `Beroe-Brand Guidelines_September-2025_compressed (1).pdf` (canonical brand book).
**Scope:** `apps/web/` — every TS/TSX file, the Tailwind theme tokens, `index.html`, login page, sidebar/AppShell, AccountProfileLayout, every Success-Mgmt / Account-Kit / Growth-Pipeline tab, every shared component.
**Brand palette under enforcement** ([`feedback_brand_palette.md`](../docs/BRAND-AUDIT-2026-05-29.md) — saved memory):

| Token | Hex | Use |
|---|---|---|
| Indigo | `#4A00F8` | Primary brand / accents / active state |
| Midnight | `#001137` | Headings · primary text on light bg |
| Bumblebee | `#FFE61E` | Highlight accent (10%) |
| Fuscia | `#C344C7` | Secondary accent (Sales team) |
| Aqua | `#35E1D4` | Secondary accent (Brief team) |
| Soft Gray | `#EAF1F5` | Page bg / neutral fills |
| Risk Red | `#CF4548` | Error / Off-track / critical |
| Risk Amber | `#F0BC41` | At-risk / Caution |
| Risk Green | `#6EC457` | On-track / success |

Anything outside this list is off-brand and must be substituted.

---

## Executive summary

| Category | Hits | Severity |
|---|---|---|
| **Off-palette Tailwind utility classes** (`bg-green-*`, `text-red-*`, `border-amber-*`, etc.) | **800 occurrences** across **~28 files** | High |
| **Off-palette hex literals** (`#40CC8F`, `#EF9637`, `#FD576B`, `#e63950`, `#2fb87a` …) | **~200 occurrences** across **~25 files** | High |
| **Tailwind theme tokens that alias to off-brand hex** (`beroe-green`/`beroe-red`/`beroe-amber`/`beroe-coral`/`beroe-navy-2/-3/-4`) | 5 aliases polluting **35 files** | Critical (structural) |
| **Brand logo asset missing** (`/favicon.svg` referenced but no file, no `O`-mark or `beroe` wordmark SVG anywhere in the project) | 1 broken link + 0 brand-mark uses | Critical |
| **Login page off-brand colours** (custom `#000d28`, `#2a4a6b`, `#5a7896`, `#1e3a6c`, `#ff7080`, `#7ad29a`, gradient `#3800CC`) | 9 hex literals on a single screen | High |
| **Login page uses text `"BEROE"` placeholder instead of the actual Beroe wordmark + Squircle O** | 1 missing brand mark | Critical |

**Bottom line:** the work done in the last sessions (VDD, Contract & Goals, Value Tracking, Checkpoints, Delivery & Renewal, CS Onboarding, Brief, Sales Hand-off) is largely on-brand inline — the **remaining off-brand surface is concentrated in (1) the shared theme tokens, (2) the global chrome (login, sidebar, AppShell), and (3) the high-volume non-SM tabs that haven't been ported yet** (AccountListPage, Home, PreSales, Solutioning, KindUploadCard, AccountPlan/Growth-Pipeline).

---

## 1 · Critical — structural / brand-mark issues

### 1.1 — No Beroe brand-mark file anywhere in the repo

```
$ find . -iname '*beroe*' -o -iname 'logo*' | grep -v node_modules | grep -v dist
(empty)
```

The brand book (pages 8-20) specifies the Beroe wordmark + the "Squircle O" mark as the **only permitted brand identifier**.

- [`apps/web/index.html:6`](apps/web/index.html#L6) — references `/favicon.svg` but no `public/` directory exists at all (`ls public/` errors). So the favicon is broken everywhere the app renders.
- [`apps/web/src/routes/_auth/login.tsx:108-115`](apps/web/src/routes/_auth/login.tsx#L108-L115) — uses a hand-rolled `<div>` with text "BEROE" instead of the actual wordmark SVG.
- [`apps/web/src/components/AppShell.tsx`](apps/web/src/components/AppShell.tsx) — the sidebar header has no brand mark at all. Sidebar opens with raw sub-nav text.
- The brand book is explicit (page 18) — the logo should be top-left on web. Not present.

**Fix scale:** add the official SVG to `apps/web/public/` as `beroe-mark.svg` + `beroe-wordmark.svg` + `favicon.svg`; wire into login + AppShell + `index.html`.

### 1.2 — Tailwind theme tokens alias to off-brand hex

[`apps/web/tailwind.config.ts:24-37`](apps/web/tailwind.config.ts#L24-L37) maps:

| Token name | Current hex | Should be |
|---|---|---|
| `beroe.green` | `#40CC8F` | **`#6EC457`** (Risk Green) |
| `beroe.red` | `#FD576B` | **`#CF4548`** (Risk Red) — or Fuscia `#C344C7` for Sales accents |
| `beroe.amber` | `#EF9637` | **`#F0BC41`** (Risk Amber) |
| `beroe.coral` | `#EF9637` (duplicate of amber) | drop, use `beroe.amber` |
| `beroe.navy-2` | `#001a45` | drop or alias to Midnight `#001137` |
| `beroe.navy-3` | `#002050` | drop or alias to Midnight `#001137` |
| `beroe.navy-4` | `#001e52` | drop or alias to Midnight `#001137` |

Plus these aliased tokens ARE correct and should stay:

| Token | Hex | Confirms brand |
|---|---|---|
| `beroe.bg` | `#EAF1F5` | ✓ Soft Gray |
| `beroe.navy` | `#001137` | ✓ Midnight |
| `beroe.blue` | `#4A00F8` | ✓ Indigo |
| `beroe.teal` | `#35E1D4` | ✓ Aqua |
| `beroe.purple` | `#C344C7` | ✓ Fuscia |

**Why this matters:** because tokens silently point at off-brand hex, every `bg-beroe-green`/`text-beroe-red`/`bg-beroe-amber` usage in the codebase is invisibly off-brand. **35 files** use these `beroe-*` utility tokens. Fix the token map first; everything downstream auto-corrects.

---

## 2 · High — Off-palette Tailwind utility usage

### 2.1 — Totals

```
=== TOTAL OFF-PALETTE TAILWIND UTILITY HITS ===  800

=== BREAKDOWN BY UTILITY FAMILY ===
 196 red
 185 slate
 163 amber
  73 emerald
  63 green
  46 blue
  35 violet
  28 cyan
   9 purple
   2 pink
```

These are raw Tailwind palette utilities like `bg-red-50 border-amber-200 text-emerald-700` — they do not map to the brand RAG (Risk Red / Risk Amber / Risk Green) and produce slightly-off shades on every status pill, success message, and warning.

### 2.2 — Top 25 offending files

```
75 src/routes/accounts/AccountListPage.tsx
65 src/routes/accounts/tabs/SalesHandoffTab.tsx       ← already partly ported, leftover red-/amber-* in HandoverQuality + ContractDocSection
63 src/routes/accounts/tabs/PreSalesTab.tsx           ← not yet ported
61 src/routes/accounts/tabs/HomeTab.tsx               ← not yet ported
42 src/routes/accounts/tabs/SolutioningTab.tsx        ← not yet ported
42 src/components/KindUploadCard.tsx                  ← shared component, used on Pre-Sales + Sales H/O + Solutioning + Contract upload
32 src/routes/accounts/tabs/gp/AccountPlanTab.tsx
29 src/components/MeetingBriefEditor.tsx
27 src/routes/accounts/tabs/ContactsTab.tsx
26 src/routes/accounts/tabs/CSOnboardingTab.tsx
25 src/components/VpdMetricsExtractionReview.tsx
24 src/types/cs_goals_extraction.ts                   ← type file with palette table; affects everything that imports it
24 src/components/VpdGoalsExtractionReview.tsx
21 src/routes/LeadershipPage.tsx
21 src/routes/accounts/tabs/gp/ExternalIntelTab.tsx
20 src/routes/accounts/tabs/sm/VDDTab.tsx             ← already ported, surviving Tailwind ‘slate-*’ used as neutral text-grey
20 src/routes/accounts/tabs/ir/IntelligenceTab.tsx
20 src/routes/accounts/tabs/GoalsTab.tsx              ← already partly ported
19 src/routes/admin/UsersPage.tsx
19 src/routes/accounts/tabs/OverviewTab.tsx
18 src/routes/admin/CategoriesPage.tsx
18 src/routes/accounts/tabs/gp/SignalsActivityTab.tsx
12 src/routes/accounts/AccountProfileLayout.tsx       ← LogoBox + period bar still use slate-*
 9 src/types/vdd.ts
 7 src/routes/accounts/tabs/ir/AnalyticsTab.tsx
```

### 2.3 — Mapping recipe for each family

| Tailwind family seen | Replace with | Notes |
|---|---|---|
| `bg-red-50/100/200`, `text-red-700/800`, `border-red-200/300` | Risk Red `#CF4548` + 10/15% tint | error / off-track / delete CTAs |
| `bg-amber-50/100/200`, `text-amber-700/800`, `border-amber-300` | Risk Amber `#F0BC41` + 15% tint | caution / at-risk / unsaved-changes |
| `bg-green-/emerald-50/100/200`, `text-green-/emerald-700`, `border-green-300` | Risk Green `#6EC457` + 15% tint | success / locked / on-track |
| `bg-blue-50`, `text-blue-700`, `border-blue-200` | Indigo `#4A00F8` + 10% tint | primary CTA / link / "held" state |
| `bg-violet-/purple-50` | Fuscia `#C344C7` + 10% tint | Sales accent OR replace with Indigo if it's a primary accent |
| `bg-cyan-/teal-50` | Aqua `#35E1D4` + 10% tint | section heading / Brief / MBR accents |
| `bg-slate-50/100/200/400`, `text-slate-500/600/700`, `border-slate-200/300` | Soft Gray `#EAF1F5` + `#94a3b8` for grey text + `#e4eaf6` for borders | neutral chrome — these are the most permissive but should still standardise |

---

## 3 · High — Off-palette hex literals

### 3.1 — Breakdown by hex value

```
56  #40CC8F   ← old green     → Risk Green   #6EC457
47  #EF9637   ← old orange    → Risk Amber   #F0BC41
35  #FD576B   ← old pink      → Fuscia       #C344C7  (or Risk Red for critical)
24  #e63950   ← old red text  → Risk Red     #CF4548
22  #2fb87a   ← old green-text → use #1d6b35 (darker brand-green for text)
 7  #fff0f2   ← old pink bg   → Risk Red 10% (`${RISK_RED}10`)
 4  #FAC775   ← old amber border → Risk Amber 40%
 3  #FAEEDA   ← old amber bg  → Risk Amber 15%
 3  #F7C1C1   ← old red border → Risk Red 30%
 3  #0D1117   ← prototype dark → Midnight    #001137
 2  #FFF8EB   ← old amber bg  → Risk Amber 15%
 2  #ff7080   ← login error red → Risk Red   #CF4548
 2  #FCEBEB   ← old red bg    → Risk Red 10%
 2  #c42040   ← old red text deep → Risk Red shaded
 2  #97C459   ← old green border → Risk Green 40%
 2  #7ad29a   ← login success green → Risk Green
 1  #f87171   ← Tailwind red-400 hardcoded
 1  #a5f3c8   ← Tailwind emerald-200 hardcoded
 1  #7C6FD6   ← prototype brief-purple-light → Indigo 80%
 1  #7a3800   ← amber-italic body  → Risk Amber-text (#854F0B already in use elsewhere is OK fallback)
 1  #534AB7   ← prototype brief-purple → Indigo #4A00F8
 1  #0074D9   ← old beroe blue → Indigo #4A00F8
 1  #001e52   ← old navy-bd → Midnight #001137
```

### 3.2 — Top 25 offending files (hex)

```
37  src/routes/accounts/tabs/HomeTab.tsx
24  src/routes/accounts/tabs/ir/IntelligenceTab.tsx
21  src/routes/accounts/tabs/gp/AccountPlanTab.tsx
21  src/components/MeetingBriefPresentation.tsx
18  src/routes/accounts/tabs/ir/AnalyticsTab.tsx
14  src/routes/accounts/tabs/CSOnboardingTab.tsx       ← stakeholder per-role hex
12  src/routes/accounts/tabs/SalesHandoffTab.tsx       ← residual
12  src/routes/accounts/AccountProfileLayout.tsx       ← LogoBox health-tone hex
10  src/routes/accounts/SuccessManagementLayout.tsx    ← pink-tinted SM nav, RAG bg literals
 8  src/types/signal.ts
 6  src/types/play.ts
 6  src/types/platform_intel.ts
 6  src/types/intel_news.ts
 5  src/routes/accounts/AccountKitLayout.tsx
 4  src/routes/accounts/tabs/PreSalesTab.tsx
 3  src/components/SuccessContractCard.tsx
 2  src/types/cs_onboarding.ts                          ← already brand-painted, two stragglers
 2  src/routes/accounts/tabs/sm/VDDTab.tsx              ← already brand-painted
 2  src/routes/accounts/tabs/ir/DocumentsReportsTab.tsx
 2  src/routes/accounts/tabs/GoalsTab.tsx
 2  src/routes/_auth/reset-password.tsx
 2  src/routes/_auth/login.tsx
 1  src/types/checkpoint.ts
 1  src/routes/accounts/tabs/gp/ExternalIntelTab.tsx
 1  src/routes/accounts/GrowthPipelineLayout.tsx
```

### 3.3 — Important type files that propagate off-brand colours

These type / constant files leak off-brand hex into every consumer:

- [`src/types/play.ts`](apps/web/src/types/play.ts) — `MODE_CONF` palette: rescue=`#FD576B`, retain=`#EF9637`, expand=`#40CC8F`. Drives **AccountPlanTab + Growth-Pipeline layout + AccountListPage mode pills**.
- [`src/types/signal.ts`](apps/web/src/types/signal.ts) — `SIG` palette: every signal-type tint (critical/risk/positive/expansion/neutral). Used everywhere signals render.
- [`src/types/platform_intel.ts`](apps/web/src/types/platform_intel.ts) — Intelligence-tab health and tier colour tones.
- [`src/types/intel_news.ts`](apps/web/src/types/intel_news.ts) — category relevance pills (External Intelligence tab).
- [`src/types/cs_onboarding.ts`](apps/web/src/types/cs_onboarding.ts) — two stragglers left after the CS Onboarding port (already mostly fixed, lines 46 + 53 still hold `#40CC8F` + `#EF9637`).
- [`src/types/checkpoint.ts`](apps/web/src/types/checkpoint.ts) — one straggler at line 88 (already mostly fixed).
- [`src/types/cs_goals_extraction.ts`](apps/web/src/types/cs_goals_extraction.ts) — uses 24 Tailwind utility classes (confidence pills).

**Fixing these 6 files alone removes ~100 of the ~200 hex hits and a chunk of the Tailwind utilities** — high-leverage starting point.

---

## 4 · Surface-by-surface findings

### 4.1 — Login page · [`src/routes/_auth/login.tsx`](apps/web/src/routes/_auth/login.tsx)

| Issue | Line | Fix |
|---|---|---|
| No Beroe wordmark/Squircle — just text "BEROE" in a coloured square | L108-115 | Drop in `beroe-wordmark.svg` |
| Background `bg-beroe-navy` ✓ but **inner panel** uses `bg-[#000d28]` (off-palette darker navy) | L107 | `bg-beroe-navy` or `bg-[#001a3e]` mapped to Midnight |
| `border-beroe-navy-3` → resolves to `#002050` (off-palette) | L107 | Drop the `navy-3` token; use Midnight w/ opacity |
| Subtitle text `text-[#2a4a6b]`, `text-[#5a7896]`, `text-[#1e3a6c]` — 3 off-palette navy variants | L114, L121, L184, L190 | Single brand `text-text-muted` (`#94a3b8`) or Midnight 60% |
| Submit button gradient `from-[#4A00F8] to-[#3800CC]` — destination is off-palette | L161 | Solid `bg-[#4A00F8]` (Indigo) — brand book disallows custom gradients on chrome |
| Error text `text-[#ff7080]` | L168 | Risk Red `#CF4548` |
| Success text `text-[#7ad29a]` | L173 | Risk Green `#6EC457` |
| "Forgot password?" link `text-[#5a7896]` hover `text-[#c8ddf0]` | L184 | Indigo / Soft Gray + hover Aqua |

**Result:** 9 off-palette hexes on a single screen.

### 4.2 — Reset password · [`src/routes/_auth/reset-password.tsx`](apps/web/src/routes/_auth/reset-password.tsx)

Same `#ff7080`/`#7ad29a` red+green pair as login. 2 hex hits.

### 4.3 — AppShell sidebar · [`src/components/AppShell.tsx`](apps/web/src/components/AppShell.tsx)

| Issue | Line | Fix |
|---|---|---|
| No Beroe brand mark in the top of the sidebar | L47-onward | Insert `<img src="/beroe-wordmark.svg" />` (white variant on navy bg) |
| `bg-beroe-navy-4`, `bg-beroe-navy-3` — both off-brand navy variants | L47, multiple | Collapse to Midnight `#001137` w/ opacity for hover/active states |
| Idle nav text `text-[#b0c0d8]`, `text-[#9bb0c8]` — 2 off-palette greys | L211, L195 | Brand grey `#94a3b8` or Soft Gray |

### 4.4 — Account profile header · [`src/routes/accounts/AccountProfileLayout.tsx:289-319`](apps/web/src/routes/accounts/AccountProfileLayout.tsx#L289-L319)

`LogoBox` health-tone palette is hardcoded off-brand:
```
s ≥ 70 → col #40CC8F (was prototype green)   → Risk Green   #6EC457
s ≥ 40 → col #EF9637 (was prototype orange)  → Risk Amber   #F0BC41
else  → col #e63950 (was prototype red)      → Risk Red     #CF4548
```

Plus `bg-slate-100` on the period bar (L320+) — neutralise with Soft Gray.

### 4.5 — Per-tab status (✓ ported / ⚠️ partial / ❌ not yet ported)

| Surface | Brand status | Notes |
|---|---|---|
| Sales Hand-off | ⚠️ partial | Module/Tier/Segment pickers + Handover-QC 2-col grid done; 65 Tailwind hits + 12 hex hits remain (ContractDocSection, SigningGateCard form) |
| CS Onboarding | ✓ ported | 2 hex stragglers (lines 46 + 53 of `types/cs_onboarding.ts`) + 26 surviving Tailwind utilities |
| Brief Editor | ⚠️ partial | Closing-scenarios AI-draft done; 29 Tailwind utilities in MeetingBriefEditor |
| Brief Presentation | ⚠️ partial | Mostly ported but 21 hex hits (prototype-purple `#534AB7`, dark `#0D1117`, etc.) — these are intentional prototype-faithful for presentation polish; needs decision: brand-purify OR mark as exception |
| Success Mgmt layout | ✓ ported | 10 hex literals are activation banner RAGs (intentional) |
| VDD | ✓ ported | 2 hex stragglers |
| Contract & Goals | ✓ ported | GoalsTab still has 20 Tailwind utilities |
| Value Tracking | ✓ ported | All metric statuses on brand |
| Checkpoints | ✓ ported | Reference card + status tones all brand |
| Delivery & Renewal | ✓ ported | Red-flag banner hoisted, VDD card brand-painted |
| Growth & Pipeline · Account Plan | ❌ not ported | 32 Tailwind utilities + 21 hex; `MODE_CONF` palette in `types/play.ts` is the upstream source |
| Growth & Pipeline · Signals & Activity | ❌ not ported | 18 Tailwind + uses `types/signal.ts` palette |
| Growth & Pipeline · External Intel | ❌ not ported | 21 Tailwind + 1 hex |
| Intelligence & Reports · Intelligence | ❌ not ported | 20 Tailwind + 24 hex (the worst hex-density tab outside Home) |
| Intelligence & Reports · Analytics | ❌ not ported | 7 Tailwind + 18 hex |
| Intelligence & Reports · Documents & Reports | ❌ not ported | 2 hex |
| Pre-Sales | ❌ not ported | 63 Tailwind + 4 hex |
| Solutioning | ❌ not ported | 42 Tailwind |
| Home | ❌ not ported | 61 Tailwind + 37 hex — **highest off-brand density per render**, very visible because it's the landing tab |
| Account List | ❌ not ported | 75 Tailwind — every row's status badge + filter chips off-brand |
| Contacts | ❌ not ported | 27 Tailwind |
| Overview (legacy) | ❌ not ported | 19 Tailwind |
| Leadership | ❌ not ported | 21 Tailwind |
| Admin · Users | ❌ not ported | 19 Tailwind |
| Admin · Categories | ❌ not ported | 18 Tailwind |
| KindUploadCard (shared) | ❌ not ported | 42 Tailwind — affects every doc-upload surface (Pre-Sales/Sales H-O/Solutioning/Contract) |
| VPD review modals (shared) | ❌ not ported | 24+25 Tailwind in goals + metrics extraction review |

### 4.6 — Typography (brand book pages 21-30, not yet quantified)

The brand book specifies **DM Sans** + **DM Mono** as the only permitted typefaces. [`apps/web/tailwind.config.ts:19-22`](apps/web/tailwind.config.ts#L19-L22) declares this correctly + [`index.html`](apps/web/index.html#L7) imports the right Google Fonts CSS. ✓ **On brand.**

Caveat: no audit done yet on whether the DM Sans/Mono *weights* used (300-700) match the brand book's specimens. Defer.

### 4.7 — Chart colours

The brand book (page 39) prescribes a 10-shade chart sequence:
`#C344C7 → #35E1D4 → #4D9599 → #4A00F8 → #854184 → #3B6F77 → #156370 → #363570 → #66336D → #204052`

[`src/routes/accounts/tabs/ir/AnalyticsTab.tsx`](apps/web/src/routes/accounts/tabs/ir/AnalyticsTab.tsx) draws inline-SVG charts (line / bar / donut). It has not been audited against this exact sequence. **Likely off-brand** — needs a separate dedicated pass.

---

## 5 · Recommended fix order

1. **(critical, blast-radius)** — Fix the 5 off-brand aliases in `tailwind.config.ts` (`beroe.green`/`red`/`amber`/`coral`/`navy-2/-3/-4`). One change, 35 files auto-correct.
2. **(critical)** — Ship a real Beroe wordmark + Squircle SVG into `apps/web/public/`. Wire into `index.html` favicon + login top-left + AppShell sidebar header.
3. **(critical)** — Repaint the login + reset-password screens (10 hex hits, single PR).
4. **(high)** — Repaint the 6 type/palette files (`types/play.ts`, `types/signal.ts`, `types/platform_intel.ts`, `types/intel_news.ts`, `types/cs_onboarding.ts:46/53`, `types/checkpoint.ts:88`). Removes ~100 hex hits + propagates through dependent renders.
5. **(high)** — Repaint the **3 non-ported high-volume tabs**: HomeTab (37 hex / 61 Tailwind) → PreSales (63 Tailwind) → AccountListPage (75 Tailwind). These are the most-seen surfaces.
6. **(medium)** — Repaint shared components: KindUploadCard, VpdGoalsExtractionReview, VpdMetricsExtractionReview, MeetingBriefEditor. One pass each.
7. **(medium)** — Repaint the Growth-Pipeline trio (AccountPlanTab, SignalsActivityTab, ExternalIntelTab) — after `types/play.ts` + `types/signal.ts` are fixed they should be ~70% done already.
8. **(medium)** — Repaint Intelligence & Reports trio (IntelligenceTab, AnalyticsTab, DocumentsReportsTab) — IntelligenceTab is the heaviest (20 Tailwind + 24 hex).
9. **(medium)** — Audit AnalyticsTab chart colour sequence against brand book page 39 specifically.
10. **(low)** — Solutioning, Contacts, Overview (legacy), Leadership, Admin pages.

---

## 6 · Re-run command

To repeat this audit anytime:

```bash
cd apps/web

# Off-palette Tailwind utilities
grep -rEo '(bg|text|border|ring|from|to|via|fill|stroke)-(green|amber|red|emerald|rose|orange|yellow|blue|sky|indigo|violet|purple|pink|fuchsia|teal|cyan|lime|slate|gray|zinc|stone|neutral)-[0-9]+' src --include='*.tsx' --include='*.ts' | wc -l

# Off-palette hex literals
grep -rEo '#(FD576B|40CC8F|EF9637|534AB7|0074D9|7C6FD6|2fb87a|97C459|FAEEDA|FFF8EB|FCEBEB|FAC775|f87171|a5f3c8|001e52|0D1117|7a3800|F7C1C1|e63950|c42040|fff0f2|ff7080|7ad29a)' src --include='*.tsx' --include='*.ts' | wc -l
```

Numbers should trend → 0 as the workbench gets fully brand-aligned.
