---
schema: 2
name: memory-gate-metrics-audit-log
title: Gate metrics stored in AuditLog, not MemoryHealth shape
class: decision
capturedAt: 2026-07-08T05:48:33.832Z
gate: save
updatedAt: 2026-07-12T06:02:00.000Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-08T05:48:33.832Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

Gate outcomes (accept/review/reject counts) are logged via AuditLogService with actionType 'memory_write_gate' — never the content, only the decision and reasons. The MemoryHealth renderer shape remains intentionally unchanged. Since 2026-07-12, the content-free `memory-lifecycle` sensor reads this audit stream and raises a deduplicated Sentinel notice only when rejects reach the configured spike threshold; routine single gate decisions stay quiet.

Related: [[sentinel-backbone-first-sequencing]], [[memory-write-gate-asymmetric]]
