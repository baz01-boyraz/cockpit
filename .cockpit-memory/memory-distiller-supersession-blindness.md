---
schema: 2
name: memory-distiller-supersession-blindness
title: Memory distiller cannot detect semantic supersession from architectural decisions
class: gotcha
capturedAt: 2026-07-14T05:08:29.780Z
gate: save
updatedAt: 2026-07-14T05:08:29.780Z
status: active
authority: observed
scope: project
confidence: medium
firstSeenAt: 2026-07-14T05:08:29.780Z
reviewAfter: 2026-10-12T05:08:29.780Z
---

When an architectural decision removes a component (e.g., Hermes), the memory distiller may still process old Codex transcripts that mention that component and save notes about it as if it's current. The distiller only matches slugs/text, not the superseding architectural fact. This leads to stale notes being re-saved after the removal was already recorded. The reconciliation step lacks semantic understanding of 'active vs historical'. To fix, the distiller should check architectural decision notes (e.g., runtime-architecture-no-hermes) before saving a candidate note that is semantically superseded.

Related: [[runtime-architecture-no-hermes]], [[hermes-suspended]], [[memory-reconcile-dedup-gotcha]]
