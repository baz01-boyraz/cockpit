---
schema: 2
name: memory-evidence-compliance
title: Memory evidence layer: parser + badge + audit for contract compliance
class: architecture
capturedAt: 2026-07-11T04:25:57.890Z
gate: save
updatedAt: 2026-07-14T04:59:01.547Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-11T04:25:57.890Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

Added `shared/memory-evidence.ts` that parses agent responses for the canonical `MEMORY: read <notes>` / `MEMORY: no relevant notes` / `MEMORY unavailable` lines and classifies them into `read` | `none` | `missing`. The `missing` label means the agent received the contract but did not honour it — a quantifiable compliance failure. Chat UIs render a MemoryBadge chip (lime=read, muted=none, amber=missing/unavailable). When `missing`, a `memory.compliance_missing` event is emitted to the audit log. This makes memory contract enforcement both visible and measurable.

Related: [[memory-contract-invisible-channel]], [[memory-charter-quality-gate]], [[memory-write-gate-asymmetric]]
- (2026-07-14) Sentinel's memory compliance signal fires when an agent response lacks the required `MEMORY: read <notes>` or `MEMORY: no relevant notes` first line. This is NOT proof the agent ignored memory — it could have read memory but skipped the evidence line, or the contract prompt was followed but output formatting diverged. The signal should be interpreted as "verifiable evidence of memory check missing", not "memory check skipped". Audit logs (tool calls to `.cockpit-memory/` reads) are needed to distinguish between formatting omission vs genuine memory skip.
