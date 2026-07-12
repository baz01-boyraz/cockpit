---
schema: 1
name: named-agents-team
title: Swarm identity uses Role × Domain with named-agent override
class: architecture
capturedAt: 2026-07-04T20:38:28.342Z
gate: save
updatedAt: 2026-07-12T05:03:45.000Z
---

# Swarm agent identity

The current default is a systematic **Role × Domain** pipeline, not a personality roster. Roles are planner, builder, reviewer, fixer, scout, and tester; optional domains are frontend, backend, security, types, performance, and database. Starting an unassigned card runs `classifyRoles()` and executes the resulting assignments sequentially in one worktree. `assignments` and `pipeline_step` persist that state (V7; commit `a40c9d7`).

Named agents remain an advanced override, not an extra pipeline layer. Choosing one clears explicit assignments because the agent definition supplies its own identity, model, and tool permissions. The shared `named-agents.ts` kernel remains available to cards, terminal subagents, and worker sub-spawns.

Only files with a `cockpit:` metadata block may appear in the board picker. This keeps the visible roster to Apollo, Argos, Atlas, Calliope, Huginn, Vulcan, plus Unassigned; the roughly 36 general Claude subagents in `~/.claude/agents/` remain usable as tools but cannot pollute the board. Shipped in v0.1.30 (`bc63f98`).

Historical context: v0.1.29 initially made the mythic six the primary card identity. Baz found that model insufficiently useful, so Role × Domain superseded it as the default while retaining named agents as an optional override.

Related: [[swarm-auto-assign]], [[model-routing-preference]], [[swarm-agent-boundaries]], [[swarm-design]]
