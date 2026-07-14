---
schema: 2
name: capture-archived-note-reactivation-misdiagnosis
title: Capture 'poison pill' bug misdiagnosed in Fable 5: archived notes are explicitly included in reconciliation
class: gotcha
capturedAt: 2026-07-14T19:04:56.146Z
gate: manual
updatedAt: 2026-07-14T20:30:00.000Z
status: archived
authority: observed
scope: project
confidence: low
firstSeenAt: 2026-07-14T19:04:56.146Z
reviewAfter: 2026-10-12T19:04:56.146Z
---

Fable 5 claims a 'capture poison pill' bug exists where archived notes cause reconcile to silently ignore them. Actually, MemoryPipeline.ts explicitly includes archived notes in reconciliation, a regression test (memory-pipeline.test.ts:181) passes, and 34 targeted tests all pass. The real risk is expected but unexceptional exception isolation per observation, not the stated trigger. A per-observation failing test would be needed before any fix.

- (2026-07-14) Archived by owner request: this counter-claim was disproven by exactly the failing test it asked for. A merge (`isNew: false`, non-duplicate content) onto an archived slug threw at the write boundary's reactivation guard and rejected the whole `capture()` batch; the :181 regression test only covered the exact-duplicate path. Fixed the same day (archived-target skip + per-observation isolation in `MemoryPipeline.ts`, regression tests in `memory-pipeline.test.ts`).
