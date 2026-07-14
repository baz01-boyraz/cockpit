---
schema: 2
name: agents-md-dual-persona-gotcha
title: AGENTS.md dual persona caused Codex to wrongly use Hermes/Swarm instructions despite a block at the top
class: gotcha
capturedAt: 2026-07-14T05:07:35.171Z
gate: save
updatedAt: 2026-07-14T05:07:35.171Z
status: active
authority: observed
scope: project
confidence: medium
firstSeenAt: 2026-07-14T05:07:35.171Z
reviewAfter: 2026-10-12T05:07:35.171Z
---

AGENTS.md began with "Codex: work in the repo, do not use Swarm" but the remaining ~150 lines repeated "you are Hermes, code, open Swarm cards, use COCKPIT_PROJECT_ID". The existing test only checked that the Codex warning appeared before the Hermes section, NOT that Hermes/Swarm instructions were absent from the Codex context. This caused Codex to sometimes behave as Hermes: trying to use Swarm, complaining about missing projectId. The fixed architecture removes all Hermes, projectId, create_swarm_card, coding fallback chain, quota control, and background orchestration from active instructions. Codex now receives only direct-agent instructions.

Related: [[agent-constitution-v1]], [[direct-agent-contract]], [[runtime-architecture-no-hermes]]
