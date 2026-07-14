---
schema: 2
name: test-coverage-ansi-variant-blindspot
title: Test coverage blind spot on ANSI sanitization variants
class: gotcha
capturedAt: 2026-07-14T17:41:47.535Z
gate: save
updatedAt: 2026-07-14T18:01:51Z
status: archived
authority: observed
scope: project
confidence: medium
firstSeenAt: 2026-07-14T17:41:47.535Z
reviewAfter: 2026-10-12T17:41:47.535Z
---

Regression tests for ANSI sanitization only covered the `;244;...m` variant but not the `33;58;43m` and `44;48;...m` variants that appear in real production logs. This allowed a release to appear fixed while the actual bug persisted. Going forward, tests must include a representative sample of all ANSI escape sequence patterns observed in real logs.

Archived after the missing variants were added to regression coverage; the
consolidated gotcha is [[sanitize-ansi-regex-escaped-source]].
