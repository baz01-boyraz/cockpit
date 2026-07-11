---
schema: 1
name: usage-panel-capacity-command-center
title: Usage panel redesigned as one capacity command center (hero + band + table)
class: design
capturedAt: 2026-07-09T20:05:00.000Z
gate: save
updatedAt: 2026-07-09T20:05:00.000Z
---

The Usage panel (src/panels/UsagePanel.tsx) was three stacked lookalike sections (stat grid → AI-spend rows → scorecard → account-quota rings → provider table) that read "karışık ve çok simple" — cluttered yet flat, with Codex 18% shown twice (spend row + quota Session ring). Redesigned into one coherent command center with three ranked zones:

1. HERO `.capacity` "Engines & spend" — AiSpendOverview.tsx is now the hero, fusing spend + quota into ONE per-engine module grid. Each engine = one `.capEngine` card: Claude/Codex show their two quota rings (5h session + weekly), Hermes shows one credit ring + the metered-spend $ headline (the only real dollar line). A slim `.capacity__ledger` footer folds the old stat grid (agent tasks / tokens / sessions / commands), demoted. Kills the duplicate spend-donuts and the separate Account-quota card.
2. `.scoreband` — the judgment scorecard as a collapsible, quieter band (see [[judgment-scorecard-composition]]).
3. `.usage__table` "By provider" — the detail table (unchanged).

Reusable primitives live in UsageQuotaRings.tsx: `CapacityRing` (the one shared SVG dial — size prop, `--ring-a/--ring-b` gradient inherited from the engine module), `CapacityHead`, `SubscriptionCapacity`. GOTCHA: ring tone is PER-WINDOW (`.capRing--warning/--critical`), never per-engine — a low session window must not repaint a healthy weekly window amber (Codex: 18% session amber, 36% weekly stays glacier). Dual-engine identity holds: Claude ember, Codex glacier, Hermes platinum.

Related: [[judgment-scorecard-composition]], [[usage-billing-model]], [[molten-obsidian-design]]
