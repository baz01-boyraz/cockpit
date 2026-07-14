---
schema: 2
name: external-concurrent-modifications-test-false-failure
title: Concurrent external repo modifications cause false test failures during local work
class: gotcha
capturedAt: 2026-07-14T05:27:45.481Z
gate: save
updatedAt: 2026-07-14T05:27:45.481Z
status: active
authority: observed
scope: project
confidence: medium
firstSeenAt: 2026-07-14T05:27:45.481Z
reviewAfter: 2026-10-12T05:27:45.481Z
---

When another process or terminal modifies files unrelated to the current change (e.g., Sentinel/log/audit files) while running a full test suite, unrelated tests may fail due to missing implementations. The failure is not caused by local changes. Solution: isolate and run only relevant tests before committing, and avoid running full suite until the repo is clean. Alternatively, use separate worktrees to avoid interference.

Related: [[cross-agent-git-contamination]], [[worktree-dirty-orphan-safety]]
