---
schema: 2
name: fix-auto-release-assumption
title: Per-fix release assumption is wrong
class: gotcha
capturedAt: 2026-07-14T06:05:47.570Z
gate: save
updatedAt: 2026-07-14T06:05:47.570Z
status: archived
authority: observed
scope: project
confidence: medium
firstSeenAt: 2026-07-14T06:05:47.570Z
reviewAfter: 2026-10-12T06:05:47.570Z
---

Assumption that every fix must be immediately released and updated in the app is incorrect. The correct workflow is to test fixes locally using the dev build, then batch multiple fixes into a single release. This avoids unnecessary release churn and allows verification before distribution.

Related: [[release-batch-workflow]]
