---
schema: 2
name: memory-ux-overhaul
title: Memory automation must reconcile the backlog, not only fresh captures
class: gotcha
capturedAt: 2026-07-05T04:40:55.944Z
gate: save
updatedAt: 2026-07-12T05:03:45.000Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-05T04:40:55.944Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

# Backlog reconciliation

Historical bug: Autopilot claimed it would save routine new/merge items and ask only about conflicts, but the renderer applied that rule only to the current manual Capture result. Roughly 20 older technical cards stayed in the queue, so the user still had to babysit them.

Commit `527b146` added queue-wide reconciliation in `MemoryBrainBar`: whenever the applicable trust mode changes, eligible routine items across the backlog are handled consistently while conflicts remain protected by the effective policy. The durable lesson is broader than the old mode names: automation that handles only fresh arrivals is incomplete if an existing backlog remains visible and actionable.

The same UX pass fixed the graph's poor resting posture with cursor-centered wheel zoom, empty-space pan, node pinning, fit-on-open/settle, and compact +/−/fit controls. Motion remains limited to transform/opacity. Reducing queue noise also lets the graph sit higher instead of being pushed below the fold.

**Gotcha (fixed 2026-07-12):** symptom "memory graph lag yapıyor, bilgiler sürekli dönüyor" — MemoryGraph's engine effect depended on the `onOpen` prop, an inline arrow recreated on every MemoryPanel render, so any panel state change tore the whole canvas down and re-seeded/re-simulated the layout: permanent swirling + CPU burn. Fix: hold callbacks in a ref, effect deps `[data]` only. Same pass: node click opens a quick-view overlay on the graph (never yanks to list), unlit edges draw solid strokes (no per-frame gradient allocation), and labels below 0.75× zoom draw only for the focused neighbourhood.

Related: [[memory-trust-modes]], [[memory-conflict-double-gate]]
