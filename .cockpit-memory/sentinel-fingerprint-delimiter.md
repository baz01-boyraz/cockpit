---
schema: 2
name: sentinel-fingerprint-delimiter
title: Sentinel fingerprint uses delimited format
class: architecture
capturedAt: 2026-07-08T05:34:06.185Z
gate: save
updatedAt: 2026-07-08T05:34:06.185Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-08T05:34:06.185Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

signalFingerprint uses `projectId::source::normalizedTitle` (double-colon delimited) to prevent substring collision — 'ab'+'c' vs 'a'+'bc' produce different fingerprints. No crypto hash; collision only suppresses one toast, so plain concatenation with an unambiguous delimiter is correct.

Related: [[sentinel-backbone-first-sequencing]], [[sentinel-notification-tiering]]
