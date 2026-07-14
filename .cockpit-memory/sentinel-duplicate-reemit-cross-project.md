---
schema: 2
name: sentinel-duplicate-reemit-cross-project
title: Sentinel triage re-emit causes duplicate badge and cross-project contamination
class: gotcha
capturedAt: 2026-07-14T05:28:14.755Z
gate: save
updatedAt: 2026-07-14T05:28:14.755Z
status: active
authority: observed
scope: project
confidence: medium
firstSeenAt: 2026-07-14T05:28:14.755Z
reviewAfter: 2026-10-12T05:28:14.755Z
---

Same signal's triage re-emit could increment the badge multiple times, and signals from other projects could affect the active project's badge/toast. Fixed by adding project-scope filtering and idempotent live updates in Sentinel.

Related: [[sentinel-notification-tiering]]
