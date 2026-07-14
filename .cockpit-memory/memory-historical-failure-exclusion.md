---
schema: 2
name: memory-historical-failure-exclusion
title: Historical failures excluded from active health count if subsequent captures succeeded
class: decision
capturedAt: 2026-07-14T18:11:13.381Z
gate: save
updatedAt: 2026-07-14T18:12:40Z
status: active
authority: code-verified
scope: project
confidence: high
firstSeenAt: 2026-07-14T18:11:13.381Z
lastVerifiedAt: 2026-07-14T18:12:40Z
reviewAfter: 2026-10-12T18:11:13.381Z
---

Old failure records (e.g., 137 failures from July 5) are not counted as active health issues if later captures (Claude/Codex) completed successfully. The lifecycle and Sentinel systems treat them as historical, not current, preventing re-alerting on resolved issues. Also, a single-provider failure blocks only its own queue, not all queues.

Related: [[memory-health-lifecycle-sensor]]
