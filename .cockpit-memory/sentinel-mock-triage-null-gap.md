---
schema: 1
name: sentinel-mock-triage-null-gap
title: Sentinel mock seeds triage:null — E3 triage block never visually verifiable
class: gotcha
capturedAt: 2026-07-09T09:44:09.178Z
gate: save
updatedAt: 2026-07-09T09:44:09.178Z
---

E3 sentinel feed panel's .sigtriage enrichment block was designed and styled for real SentinelTriage data, but mock.ts (not modifiable per task scope) seeds all signals with triage: null. Result: the styled triage block (headline + → action + reportWorthy/Lesson badges) was never visually confirmable during development. Only discovered in final report.

Related: [[sentinel-3-layer-architecture]]
