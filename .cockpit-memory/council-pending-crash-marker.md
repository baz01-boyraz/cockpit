---
schema: 1
name: council-pending-crash-marker
title: Council crash-resilient pending/final/failed lifecycle with boot sweep
class: architecture
capturedAt: 2026-07-09T08:40:42.873Z
gate: save
updatedAt: 2026-07-09T08:40:42.873Z
---

A6 added V18 migration (council_session_status) and CouncilSessionStore lifecycle: insertPending() creates a pending row with valid placeholder CouncilResult (aggregate: [] — computeScorecard never crashes on it); finalize() UPDATEs to real verdict + status='final'; sweepStalePending() marks any pending row as 'failed' and returns count. DEFAULT 'final' chosen so pre-V18 rows need zero migration. CouncilService.run() reserves a pending row AFTER early-exit guards (clean worktree / dead spec do NOT create pending rows). If reserve fails, pendingId=null → fallback to legacy insert(). CouncilService constructor calls sweepStalePending() — any pending row at construction is from a crashed previous process, unconditionally marked 'failed'. council.pending_swept audit event written. Fake store missing the method is try/catch-safe.

Related: [[council-multi-engine-architecture]], [[council-crash-silent-data-loss]]
