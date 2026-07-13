---
schema: 2
name: sentinel-toast-reemit-idempotency
title: Sentinel re-emit + toast dedup: enriched signals silently dropped from toast UI
class: gotcha
capturedAt: 2026-07-09T04:07:52.352Z
gate: save
updatedAt: 2026-07-09T04:07:52.352Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-09T04:07:52.352Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

Signals enriched by triage (notice/alert only) are re-emitted with the same signal.id, but SentinelToasts deduplicates by signal.id and drops re-emits instead of updating the existing toast in-place. Both sides follow their contracts correctly (enrich re-emits same id, toast dedup prevents duplicates) — but the mismatch means enriched triage fields (title, summary, action) are never reflected in the toast. Enrichment data is only visible via the sentinel:list feed or after app restart. If toast-side update-on-reemit is ever needed, the component needs active replacement by id, not drop-by-id. src was off-limits during sentinel build; this was a known deferral, not an oversight.

Related: [[sentinel-notification-tiering]], [[sentinel-triage-null-never-retried]]
