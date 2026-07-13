---
schema: 2
name: hermes-docked-shell-layout
title: Hermes panel docked as shell grid column (not floating)
class: architecture
capturedAt: 2026-07-06T04:58:56.335Z
gate: save
updatedAt: 2026-07-06T04:58:56.335Z
status: archived
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-06T04:58:56.335Z
reviewAfter: 2026-07-13T05:20:43.982Z
---

Hermes chat panel uses the same grid-column docking technique as the AI Cockpit chat in RightPanel. When open, it shrinks the terminal grid width instead of overlapping terminals. Toggled via `hermesOpen`/`toggleHermes` store state. Fits in AppShell's shell grid alongside `.floatingCorner` (toast only). This replaced the earlier floating-corner position:fixed approach which blocked terminal panels across multiple iterations.

Related: [[shell-grid-architecture]]
