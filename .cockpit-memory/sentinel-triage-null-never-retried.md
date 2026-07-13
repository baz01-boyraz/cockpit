---
schema: 2
name: sentinel-triage-null-never-retried
title: Sentinel triage enrichment is fire-and-forget — NULL-triage rows never retried
class: architecture
capturedAt: 2026-07-09T04:01:35.576Z
gate: save
updatedAt: 2026-07-09T04:01:35.576Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-09T04:01:35.576Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

Sentinel signals are persisted synchronously inside report() before any notification, so signals survive crash. But triage enrichment (enrich()) runs fire-and-forget via void this.enrich(signal). If the app quits mid-enrichment, the row stays with triage=NULL forever — nothing re-triages recent severity='notice'|'alert' AND triage IS NULL rows at boot. Fix: a boot sweep in SentinelService constructor that re-enriches un-triaged recent signals, throttled by MAX_IN_FLIGHT.

Related: [[sentinel-3-layer-architecture]]
