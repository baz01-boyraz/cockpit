---
schema: 2
name: hermes-suspended
title: Hermes suspended fully but code retained
class: decision
capturedAt: 2026-07-14T04:58:04.237Z
gate: save
updatedAt: 2026-07-14T04:58:04.237Z
status: archived
authority: observed
scope: project
confidence: medium
firstSeenAt: 2026-07-14T04:58:04.237Z
reviewAfter: 2026-10-12T04:58:04.237Z
---

Hermes is completely deactivated: UI hidden, chat IPC, MCP server, approval executor, triage, automations, background jobs stopped. A central kill-switch prevents any spawn. Code not deleted; reversible via feature flag. Planned to be replaced with higher-quality system later.

Related: [[council-multi-engine-architecture]], [[openrouter-secret-ref-gotcha]]
