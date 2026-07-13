---
schema: 2
name: council-spec-gate-optional-not-forced
title: Council spec-gate optional, not forced — Start redirects
class: architecture
capturedAt: 2026-07-10T00:58:28.230Z
gate: save
updatedAt: 2026-07-10T00:58:28.230Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-10T00:58:28.230Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

startCard NEVER forces council gate. If an approved council session (councilSessionId) exists, its refined spec + briefing are injected into the builder's opening prompt as enriched context. If none exists, Start redirects to 'collect council first' flow instead of launching the builder. A deliberate 'Start anyway' escape hatch exists (audit-logged) to avoid forcing API costs on every card — the user explicitly bypasses the gate. This is the agreed production behavior: council is OPTIONAL enrichment, not a mandatory pre-build gate, matching the principle that no card should be forced to pay council API cost unless the user wants spec refinement.

Related: [[swarm-card-council-orchestration-gap]], [[agenda-council-optionality]]
