---
schema: 1
name: multiagent-isolated-worktree
title: Uncommitted changes leak across parallel agents on same worktree
class: gotcha
capturedAt: 2026-07-06T06:19:04.523Z
gate: save
updatedAt: 2026-07-06T06:19:04.523Z
---

When multiple Swarm agents share the same git working tree (not isolated worktrees), one agent's uncommitted changes are swept into another agent's commit if that second agent runs git add/commit before the first agent commits. Happened in v0.1.43: Agent A (copy button) committed, and its git add+commit picked up Agent B's uncommitted hermes.css changes from the working directory, merging both features into a single commit without Agent B's involvement. The git-bootstrap-flow (worktree isolation) is the fix — without it, cross-contamination is silent and merges unrelated changes into the wrong author's commit.

Related: [[git-bootstrap-flow]], [[hermes-cockpit-decoupled-architecture]]
