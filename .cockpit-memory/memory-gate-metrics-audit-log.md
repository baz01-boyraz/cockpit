---
schema: 1
name: memory-gate-metrics-audit-log
title: Gate metrics stored in AuditLog, not MemoryHealth shape
class: decision
capturedAt: 2026-07-08T05:48:33.832Z
gate: save
updatedAt: 2026-07-08T05:48:33.832Z
---

Gate outcomes (accept/review/reject counts) are logged via AuditLogService with actionType 'memory_write_gate' — never the content, only the decision and reasons. The MemoryHealth shape (carried to the renderer) was intentionally NOT extended with gate counters. Rationale: payload modification would require touching src/** (renderer), which was out of scope for the memory gate phase. AuditLog was chosen as the sink because it's pure backend and already structured. A future phase could surface these counters by reading audit log.

Related: [[sentinel-backbone-first-sequencing]], [[memory-write-gate-asymmetric]]
