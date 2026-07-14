---
schema: 2
name: council-analysis-not-spec
title: Council 'Analyze repository' never produces a buildable spec; it is a research-only mode
class: gotcha
capturedAt: 2026-07-14T05:04:41.609Z
gate: save
updatedAt: 2026-07-14T05:04:41.609Z
status: active
authority: observed
scope: project
confidence: medium
firstSeenAt: 2026-07-14T05:04:41.609Z
reviewAfter: 2026-10-12T05:04:41.609Z
---

The Council's 'Analyze repository' intent is strictly for exploring the repository and grounding claims in source evidence. It does NOT produce a build-ready implementation plan, does NOT gate Swarm work, and cannot be used to start coding. To get a spec, 'Refine request' mode must be used separately. This was a source of confusion during testing.

Related: [[council-spec-gate-optional-not-forced]], [[council-run-preload-param-drop]]
