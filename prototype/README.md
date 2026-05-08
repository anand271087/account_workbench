# Prototype — `beroe_awb_v20.html`

Single-file HTML demonstrating the Account Workbench vision. Source of visual
fidelity (CSS tokens, component patterns) and demo data for the React port.

**Read-only.** Don't modify in this repo. The canonical copy lives at
`/Users/anandkaliappan/Desktop/Beroe_Account_WB/Sales workbench/beroe_awb_v20.html`.
This copy is checked in for offline reference + audit replay.

## How to use

```bash
open prototype/beroe_awb_v20.html
```

## Notable functions to lift styling/UX from

| HTML reference | Use as model for |
|---|---|
| `:root` CSS variables | Tailwind theme tokens |
| `bKit()` (presales sub-tab) | AK03 layout |
| `extractPreSalesAI()`, `extractSolAI()` | VPD auto-extract prompts (AK03.d) |
| `addKitStakeholder()`, `updKitStk()` | Contact CRUD UX |
| `buildLogin()` | F01 login styling |
| `buildHub()` cards | AK01 list rows |
| `buildAIPanel()` | AI assistant side panel (v1.1) |
| `handoffToSolutioning()` | Pre-Sales → Solutioning handover (AK03.c) |

## Status

- Last synced: 2026-05-08 (M7.5 audit pass)
- React port progress: see `../docs/features/README.md`
