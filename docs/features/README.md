# Features Index

Every feature has its own folder with two markdown files:
- **`FUNCTIONAL.md`** — for stakeholders. Plain English, user flows, business rules.
- **`TECHNICAL.md`** — for engineers. File paths, schema, contracts, tests.

## Status

| ID | Name | Sprint | Status |
|---|---|---|---|
| M1 | Repo skeleton + dev loop | Sprint 1 | ✅ Built |
| F01 | Login & Authentication | Sprint 1 | ✅ Built (M2) |
| F02 | Roles & Access Control | Sprint 1 | ✅ Built (M2) |
| AK01 | Account List | Sprint 1 | ✅ Built (M3) |
| AK02 | Account Profile shell | Sprint 1 | ✅ Built (M4) |
| AK03.a | Engagement Info | Sprint 1 | ✅ Built (M5) |
| AK03.b | Client Contacts | Sprint 1 | ✅ Built (M6) — schema realigned to BRD table 12 (M6.5) |
| AK03.c | Documents (text-only) | Sprint 1 | ✅ Built (M7) — drag-drop, AI-tag lifecycle, risks rollup (M7.1) |
| AK03.d | Solutioning / VPD | Sprint 1 | ✅ Built (M7.5) — auto-extract + Handover action |
| AK02.x | Value Definition + Goals & Initiatives | Sprint 1 | 🟡 Placeholder tabs (full impl in v1.1) |
| F01.x  | F01 lockout (5/15min) + forgot-password | Sprint 1 | ✅ Built (M2.5) |
| AK01.x | AK01 page-size, renewal-window, CSV export, bulk reassign, extended search | Sprint 1 | ✅ Built (M3.5) |
| M9 | Admin: Account creation + User management | Sprint 1 | ✅ Built (M9) |

## Definition of Done

A feature is not "done" until:
1. Code shipped + CI green
2. `FUNCTIONAL.md` written and reviewable by a non-engineer
3. `TECHNICAL.md` written with file paths, data model, contracts
4. OWASP checklist (`docs/security/owasp-checklist.md`) checked off
5. `CLAUDE.md` updated
6. Vercel preview URL shared with stakeholders
