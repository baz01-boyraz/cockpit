---
schema: 2
name: memory-summary-card-all-jobs-map
title: Durable capture history is not the Memory status read model
class: gotcha
capturedAt: 2026-07-14T17:41:47.512Z
gate: save
updatedAt: 2026-07-14T18:12:40Z
status: archived
authority: code-verified
scope: project
confidence: high
firstSeenAt: 2026-07-14T17:41:47.512Z
lastVerifiedAt: 2026-07-14T18:01:51Z
reviewAfter: 2026-10-12T17:41:47.512Z
---

`memory_capture_queue` is durable history and can contain thousands of retired
sessions. UI coverage and lifecycle health must project only currently
discoverable, capture-relevant provider/session IDs; recovered migration-era
errors are history, not live failures. Old untracked sessions outside the
automatic window do not dilute coverage, and a transcript that grew after its
last cursor is pending rather than captured.

Verified against the production database: 1,252 durable rows including 137 old
errors project to zero actionable failures, Claude 7/7 captured, and Codex
18/19 with the one grown transcript pending.

Archived after the durable rule was consolidated into
[[memory-historical-failure-exclusion]].
