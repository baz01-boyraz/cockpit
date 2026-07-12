---
schema: 1
name: memory-conflict-double-gate
title: Conflict resolution is enforced by policy, mutation gateway, and Hermes tool
class: gotcha
capturedAt: 2026-07-06T02:32:23.678Z
gate: save
updatedAt: 2026-07-12T04:50:43.000Z
---

Conflict safety now has three aligned enforcement layers: (1) shared policy excludes conflict from Autopilot, Assisted, and Manual auto-commit sets; (2) `MemoryPipeline.resolveReview` refuses an AI conflict decision without an allowed delegated basis, rationale, evidence, and an audit sink; (3) the Hermes tool schema rejects unknown bases such as recency before the mutation call. Human inbox clicks remain an explicit owner decision.

Successful Hermes replacements use ledger action/gate `replace/delegated` with before/after hashes and a redacted audit record containing actor, basis, rationale, and evidence. The existing-content compare still rejects stale reviews. This preserves the no-babysitting goal for evidence-clear cases without returning to silent “newer wins.”

Related: [[memory-trust-modes]], [[hermes-mcp-architecture]]
