---
schema: 1
name: passive-tab-background-leak-gotcha
title: Shared `.tab` lacks background — native buttonface leaks on passive tab
class: gotcha
capturedAt: 2026-07-09T05:11:04.835Z
gate: save
updatedAt: 2026-07-09T05:11:04.835Z
---

When adding a panel with tabs (like E2 Audit panel), the shared `.tab` CSS class does NOT set a background property. The global `button` reset also omits background. This means the native buttonface color (#efefef on macOS) leaks through on the non-active tab. The fix was adding explicit `background: transparent` on the tab container (`.audit__tabs`) in the panel's own CSS file. Active/hover surface colors must also be re-asserted at the panel level. Any future panel author using `.tab` will hit this same leak unless they explicitly set background on their tab container.

Related: [[hermes-docked-shell-layout]], [[dashboard-hero-declutter]]
