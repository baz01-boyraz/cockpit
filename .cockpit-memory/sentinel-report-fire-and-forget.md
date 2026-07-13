---
schema: 2
name: sentinel-report-fire-and-forget
title: Sentinel report() is fire-and-forget, never throws
class: decision
capturedAt: 2026-07-08T05:34:06.203Z
gate: save
updatedAt: 2026-07-08T05:34:06.203Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-08T05:34:06.203Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

Every internal error in sentinel's report() is logged via logFatal and returns null — the hot path (log insert, worker exit, approval request) must never be blocked by a sentinel failure. context field capped at 2000 chars with C0 control-character stripping (local copy of swarm-worker.ts stripPtyControls). Added to shared/sentinel.ts.

Related: [[sentinel-anti-noise-gotcha]], [[sentinel-backbone-first-sequencing]]
