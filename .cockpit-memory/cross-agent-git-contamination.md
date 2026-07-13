---
schema: 2
name: cross-agent-git-contamination
title: Parallel agents in same repo: git staging leaks across commits
class: gotcha
capturedAt: 2026-07-11T04:25:57.878Z
gate: save
updatedAt: 2026-07-11T04:25:57.878Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-11T04:25:57.878Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

When two agents work in the same repo (no worktree isolation), one agent's `git add` stages files in the shared index. If agent B commits without checking `git diff --cached` first, agent A's staged-but-uncommitted files silently leak into B's commit. Fix: always inspect `git diff --cached` before any commit in a multi-agent repo. Recovery: soft-reset the trailing HEAD to split the mixed commit back.

Related: [[multiagent-isolated-worktree]]
