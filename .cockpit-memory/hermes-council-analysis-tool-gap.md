---
schema: 2
name: hermes-council-analysis-tool-gap
title: Missing read-only council analysis tool for Hermes
class: architecture
capturedAt: 2026-07-14T04:58:43.787Z
gate: save
updatedAt: 2026-07-14T04:58:43.787Z
status: archived
authority: observed
scope: project
confidence: medium
firstSeenAt: 2026-07-14T04:58:43.787Z
reviewAfter: 2026-10-12T04:58:43.787Z
---

Hermes only exposes `council_refine_spec` (a build pre-gate tool) to Council, but not a read-only `council_analyze` mode that exists on the Council service. This forces any request for analysis into a spec-gate flow, which may produce inappropriate NEEDS_CLARIFICATION and loses the ability to just get advice. The AI recommends adding a separate `council_analyze` tool for Hermes, making Council calls async with session ID, automatically delivering results even if Hermes dies, using heartbeat-based timeout, and enforcing memory contract deterministically (not relying on model compliance).

Related: [[council-multi-engine-architecture]], [[council-spec-gate-optional-not-forced]], [[hermes-suspended]]
