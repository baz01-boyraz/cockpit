---
schema: 2
name: swarm-completion-notification-gap
title: Swarm completion publishes deterministic evidence
class: architecture
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

A successful Swarm done signal or clean worker exit stages one structured swarm-completion Sentinel signal from bounded card and session evidence. Production publication uses deterministic summary fallback, persists before delivery, resumes staged rows after restart, and keeps nonzero worker exits as separate failure signals. Completion handling does not open new cards or invoke an orchestrator persona.
