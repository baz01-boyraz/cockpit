---
schema: 2
name: judgment-scorecard-composition
title: Judgment scorecard: 7 metrics, first-data-safe, service-level isolation
class: architecture
capturedAt: 2026-07-09T09:44:09.162Z
gate: save
updatedAt: 2026-07-09T09:44:09.162Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-09T09:44:09.162Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

G4 scorecard in Usage panel (7 metrics: spec-gate leverage, gate calibration, card fate mix, triage precision, memory earned-keep, best council seat, most-recalled notes). Each metric guard-isolated (one section error falls to honest empty-base, never kills the whole card). OutcomeService folds cardOutcomes oldest-first with last-wins overwrite (re-opened card counted once). rate() helper returns null (not 0%) on zero-division. "Correlation, not causation" disclaimer shown. Sources: OutcomeService, CouncilService, MemoryRecallService.

Related: [[council-multi-engine-architecture]], [[memory-hub]], [[sentinel-3-layer-architecture]], [[usage-panel-capacity-command-center]]
- (2026-07-09) Presentation demoted to a collapsible `<details>` "reflective band" (`.scoreband`) below the capacity hero, collapsed by default so its honest "No data yet" tiles never shout over live numbers. Body/data logic unchanged.
