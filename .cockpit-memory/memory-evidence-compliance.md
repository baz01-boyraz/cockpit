---
schema: 1
name: memory-evidence-compliance
title: Memory evidence layer: parser + badge + audit for contract compliance
class: architecture
capturedAt: 2026-07-11T04:25:57.890Z
gate: save
updatedAt: 2026-07-11T04:25:57.890Z
---

Added `shared/memory-evidence.ts` that parses agent responses for the canonical `MEMORY: read <notes>` / `MEMORY: no relevant notes` / `MEMORY unavailable` lines and classifies them into `read` | `none` | `missing`. The `missing` label means the agent received the contract but did not honour it — a quantifiable compliance failure. Chat UIs render a MemoryBadge chip (lime=read, muted=none, amber=missing/unavailable). When `missing`, a `memory.compliance_missing` event is emitted to the audit log. This makes memory contract enforcement both visible and measurable.

Related: [[memory-contract-invisible-channel]], [[memory-charter-quality-gate]], [[memory-write-gate-asymmetric]]
