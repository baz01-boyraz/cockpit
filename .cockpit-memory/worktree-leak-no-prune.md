---
schema: 2
name: worktree-leak-no-prune
title: .cockpit-worktrees/ never pruned — every crash/park leaks a worktree unbounded
class: architecture
capturedAt: 2026-07-09T04:01:35.553Z
gate: save
updatedAt: 2026-07-09T04:01:35.553Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-09T04:01:35.553Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

SwarmWorktrees has only create and removeIfClean — no list/prune mechanism. Neither the SwarmService constructor nor Services enumerates .cockpit-worktrees/. Every crashed/parked/abandoned Swarm card leaves a git worktree + swarm/<slug> branch behind forever. removeIfClean refuses dirty ones and only fires on explicit removeCard. Over time this accumulates disk and degrades git worktree list/status. Fix: boot-time SwarmWorktrees.prune(projectPath) cross-checking live card rows against on-disk worktrees, run right after orphan-parking loop in SwarmService constructor.

Related: [[swarm-design]], [[multiagent-isolated-worktree]]
