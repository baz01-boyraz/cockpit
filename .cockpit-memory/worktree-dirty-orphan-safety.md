---
schema: 2
name: worktree-dirty-orphan-safety
title: Dirty orphan worktrees are NEVER force-deleted on prune
class: decision
capturedAt: 2026-07-09T05:11:04.811Z
gate: save
updatedAt: 2026-07-09T05:11:04.811Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-09T05:11:04.811Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

SwarmWorktrees.prune() classifies orphans: clean orphans are removed (branch deleted via conservative `git branch -d` — merged-only, unmerged branches preserved). Dirty orphans are recorded as `keptDirty` and REPORTED but NEVER force-deleted. The design philosophy: a dirty orphan represents in-flight manual work that must be inspected and resolved by hand, not destroyed automatically. Only 'done' terminal status is prunable; parked/in-review/todo/in-progress stays live. macOS symlink gotcha: `git worktree list` returns canonical (/private/var) paths while resolve() uses symbolic (/var) — solved with realpathSync before branch matching.

Related: [[worktree-leak-no-prune]], [[multiagent-isolated-worktree]]
