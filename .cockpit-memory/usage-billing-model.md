---
schema: 2
name: usage-billing-model
title: Usage and billing follow provider boundaries
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

Claude Code and Codex workers use the owners authenticated provider accounts and quotas. Council remote seats and bounded Memory analysis use the encrypted OpenRouter credential and can consume OpenRouter credit. Deterministic Sentinel delivery and capture queue mechanics do not spend model tokens; analysis calls are explicit, bounded, and provider-neutral.
