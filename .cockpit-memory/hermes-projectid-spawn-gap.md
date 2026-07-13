---
schema: 2
name: hermes-projectid-spawn-gap
title: Hermes spawn discards projectId after cwd resolution
class: gotcha
capturedAt: 2026-07-06T06:27:41.595Z
gate: save
updatedAt: 2026-07-06T06:27:41.595Z
status: archived
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-06T06:27:41.595Z
reviewAfter: 2026-07-13T05:20:43.982Z
---

HermesChatService.ask() resolves the correct projectId from ProjectService.get() to set Hermes' cwd, then discards the id. The spawned Hermes process has no channel to learn the real projectId, so the model guesses/invents one for create_swarm_card etc. — which hits the SQLite FK constraint (kanban_cards.project_id REFERENCES projects(id) ON DELETE CASCADE). Fix: pass the real projectId as COCKPIT_PROJECT_ID env var at spawn time. The same gap affected all project-scoped Hermes tools because HermesToolContext has no ProjectService reference and no auto-register path exists.

Related: [[hermes-cockpit-decoupled-architecture]]
