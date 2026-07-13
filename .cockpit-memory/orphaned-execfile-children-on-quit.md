---
schema: 2
name: orphaned-execfile-children-on-quit
title: EngineRunner children must be tracked through shutdown
class: gotcha
gate: manual
updatedAt: 2026-07-13T05:53:28.280Z
status: active
authority: code-verified
authorityRef: owner-approved agent-memory-system-v2 migration
scope: project
confidence: high
firstSeenAt: 2026-07-13T05:53:28.280Z
lastVerifiedAt: 2026-07-13T05:53:28.280Z
reviewAfter: 2027-01-09T05:53:28.281Z
tags: runtime, memory-v2
---

Council and bounded Memory analysis can spawn Claude, Codex, or remote engine calls through EngineRunner. Every local child handle is tracked and EngineRunner.killAll runs before database close, otherwise a timed-out analysis can survive app shutdown and consume resources. Removed chat-orchestrator children are historical and no longer part of this invariant.
