---
schema: 2
name: ledger-atomicity-gotcha
title: MemoryPipeline.commit() non-atomic file write and ledger record leads to silent data loss
class: gotcha
capturedAt: 2026-07-14T19:39:05.365Z
gate: save
updatedAt: 2026-07-14T19:39:05.365Z
status: active
authority: observed
scope: project
confidence: medium
firstSeenAt: 2026-07-14T19:39:05.365Z
reviewAfter: 2026-10-12T19:39:05.365Z
---

memory.write (file system) and this.ledger.record (SQLite) are separate calls. If ledger.record fails after successful file write, commit() was marked as 'skipped' and the written note became invisible to reconcile() — allowing a sibling observation to silently overwrite it. Fix: treat commit as successful on file write, log ledger failure as memory.ledger_failed audit, and make each observation isolated in its own try/catch. Verified by red-green test cycle and passing suite.

Related: [[memory-reconcile-dedup-gotcha]]
