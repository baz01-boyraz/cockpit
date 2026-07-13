---
schema: 2
name: memory-analysis-provider-neutral
title: Memory analysis is provider-neutral
class: architecture
gate: manual
updatedAt: 2026-07-13T05:20:43.982Z
status: active
authority: code-verified
authorityRef: owner-approved agent-memory-system-v2 migration
scope: project
confidence: high
firstSeenAt: 2026-07-13T05:20:43.982Z
lastVerifiedAt: 2026-07-13T05:20:43.982Z
reviewAfter: 2027-01-09T05:20:43.983Z
supersedes: memory-distiller-cli-only
tags: runtime, memory-v2
---

Memory capture reads both Claude Code and Codex native transcripts through one durable provider-aware queue. Bounded distillation and curation use the dedicated low-cost analysis policy through EngineRunner; capture does not depend on an orchestrator persona or inherit coding permissions.
