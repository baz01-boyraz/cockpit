---
schema: 2
name: multiagent-isolated-worktree
title: Concurrent Swarm workers require isolated worktrees
class: gotcha
gate: manual
updatedAt: 2026-07-13T05:54:22.765Z
status: active
authority: code-verified
authorityRef: owner-approved agent-memory-system-v2 migration
scope: project
confidence: high
firstSeenAt: 2026-07-13T05:54:22.765Z
lastVerifiedAt: 2026-07-13T05:54:22.765Z
reviewAfter: 2027-01-09T05:54:22.766Z
tags: runtime, memory-v2
---

When concurrent workers share one git working tree, one workers git add or commit can silently sweep another workers uncommitted files into the wrong change. Every Swarm worker therefore needs its own isolated worktree and scoped branch. Never use broad staging from a shared dirty tree; inspect the explicit file set before commit.
