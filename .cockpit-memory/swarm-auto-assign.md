---
schema: 1
name: swarm-auto-assign
title: Auto-assign: classifyRoles builds a sequential role pipeline at Start
class: architecture
capturedAt: 2026-07-05T03:41:08.235Z
gate: save
updatedAt: 2026-07-05T03:41:08.235Z
---

Pressing Start on an UNASSIGNED Swarm card runs classifyRoles(title, body) — heuristic weighted-regex following the existing shared/router.ts classifyRoute pattern (instant, free, no PTY) — returning a sequential Assignment[] pipeline (role + optional spec) plus rationale + confidence. A task can get multiple agents as an ordered chain. Runs only when the card is fully empty (no role/persona/agent/assignments); legacy role/persona cards keep the old path. The pipeline runs in ONE worktree and advances via the done-signal path from commit 539ea21: when a worker finishes a turn (Stop hook touches .cockpit-done, reconcileDoneSignals reads it), the next role's worker starts in the SAME worktree with pipeline_step++, card stays Running; last step or error → in_review. This keeps RUNNING_CAP/quota intact (sequential, not fan-out). Fan-out to parallel sub-cards was deferred to phase 2. Data model: SCHEMA_V7 adds assignments (JSON) + pipeline_step (int) to kanban_cards. Editor shows a live auto-preview ('auto-assign at Start: Builder·Frontend').

Related: [[named-agents-team]], [[swarm-design]], [[migration-number-collision]]
