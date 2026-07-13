---
schema: 2
name: swarmcard-editor-simplification
title: SwarmCardEditor: pipeline collapsed under Advanced by default
class: architecture
capturedAt: 2026-07-08T05:21:54.422Z
gate: save
updatedAt: 2026-07-08T05:21:54.426Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-08T05:21:54.422Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

The SwarmCardEditor was simplified to show only title + description + Council + Save/Cancel/Delete by default. The entire role/pipeline builder (role dropdowns, domain selection, step management, named-agent picker) is collapsed under a single "Advanced · who builds this (auto-assigned by default)" toggle section. If a card already carries an explicit pipeline or named agent, Advanced opens automatically. This keeps the editor council-focused and clean while preserving full pipeline control for advanced cases. The key design rule: roles (who builds) and Council (spec gate) are orthogonal concepts, not alternatives — Council does not replace the pipeline, just gates its spec before execution.

Related: [[swarm-design]], [[council-multi-engine-architecture]]
- (2026-07-08) When Baz complained the swarm card editor was too cluttered, the initial reflex was to consider removing role/pipeline selection entirely. The correct approach: roles are necessary for swarm to know which agent to use, but they belong in an Advanced section, not the default view. The fix was collapsing, not deleting. Pattern: when a feature is architecturally required but visually noisy, hide it under a toggle — don't amputate it.
