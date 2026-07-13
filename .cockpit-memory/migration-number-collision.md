---
schema: 2
name: migration-number-collision
title: migration number collision
class: reference
gate: manual
updatedAt: 2026-07-13T05:20:43.982Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-13T05:20:43.982Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

Migrations in electron/main/db/schema.ts are append-only SCHEMA_Vn blocks registered by version
in Database.ts. When multiple agents/worktree branches each add a DB migration independently,
they both grab the next free SCHEMA_V number and collide — this is a NUMBER collision, not a
code conflict.

Real incident (v0.1.33): the memory brain branch added SCHEMA_V7-V9 (memory_ledger/review/
capture_queue) while the swarm auto-assign branch independently added its own SCHEMA_V7
(kanban_card_assignments/pipeline_step columns). Resolved by keeping one side's numbers and
renumbering the other's to the next free slot (swarm's V7 -> V10).

Resolution when merging: renumber the colliding side so the merged migration chain V1->N is
unique and sequential. Always smoke-test against a real SQLite engine before release. Watch for
this whenever multiple agents touch the schema before a batched release.

Related: [[swarm-design]], [[release-tagging-gotcha]], [[multiagent-isolated-worktree]], [[named-agents-team]]