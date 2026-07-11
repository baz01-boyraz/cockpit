---
schema: 1
name: council-crash-silent-data-loss
title: Council mid-run crash silently loses the entire session
class: architecture
capturedAt: 2026-07-09T04:01:35.561Z
gate: save
updatedAt: 2026-07-09T04:01:35.561Z
---

CouncilService.run() writes nothing to SQLite until the very last line (persistAndRecord). If the app dies mid-run, there is no council_sessions row at all — the half-finished session is undetectable, not resumable, and not markable as failed. There is no 'started/running' council state anywhere. Fix: write a pending row at the top of run() and update/delete it at persistAndRecord.

Related: [[council-multi-engine-architecture]]
