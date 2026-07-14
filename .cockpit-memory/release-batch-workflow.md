---
schema: 2
name: release-batch-workflow
title: Fixes are batched into releases, not auto-released per fix
class: decision
capturedAt: 2026-07-14T06:05:47.556Z
gate: save
updatedAt: 2026-07-14T06:05:47.556Z
status: active
authority: observed
scope: project
confidence: medium
firstSeenAt: 2026-07-14T06:05:47.556Z
reviewAfter: 2026-10-12T06:05:47.556Z
---

Each fix does not trigger a separate GitHub release and app update. Instead, fixes are developed and tested locally using the dev build, then batched into a single release. The installed .app only updates via explicit GitHub releases. Ask Claude/Codex agents will not auto-commit, push, release, or restart the app. The notification system will track progress: investigating, fixed locally, verified, ready for next release.

Related: [[git-bootstrap-flow]], [[app-refresh-autoupdate-revert]]
