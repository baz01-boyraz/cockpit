---
schema: 2
name: council-pending-crash-marker
title: Council crash-resilient pending/final/failed lifecycle with boot sweep
class: architecture
capturedAt: 2026-07-09T08:40:42.873Z
gate: save
updatedAt: 2026-07-13T00:56:15.113Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-09T08:40:42.873Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

A6 added V18 migration (council_session_status) and CouncilSessionStore lifecycle: insertPending() creates a pending row with valid placeholder CouncilResult (aggregate: [] — computeScorecard never crashes on it); finalize() UPDATEs to real verdict + status='final'; sweepStalePending() marks any pending row as 'failed' and returns count. DEFAULT 'final' chosen so pre-V18 rows need zero migration. CouncilService.run() reserves a pending row AFTER early-exit guards (clean worktree / dead spec do NOT create pending rows). If reserve fails, pendingId=null → fallback to legacy insert(). CouncilService constructor calls sweepStalePending() — any pending row at construction is from a crashed previous process, unconditionally marked 'failed'. council.pending_swept audit event written. Fake store missing the method is try/catch-safe.

Related: [[council-multi-engine-architecture]], [[council-crash-silent-data-loss]]

<!-- merged from council-crash-silent-data-loss on 2026-07-13 -->
CouncilService.run() writes nothing to SQLite until the very last line (persistAndRecord). If the app dies mid-run, there is no council_sessions row at all — the half-finished session is undetectable, not resumable, and not markable as failed. There is no 'started/running' council state anywhere. Fix: write a pending row at the top of run() and update/delete it at persistAndRecord.

Related: [[council-multi-engine-architecture]]
