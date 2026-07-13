---
schema: 2
name: council-panel-session-eviction
title: Council panel session lost on sidebar navigation
class: gotcha
capturedAt: 2026-07-10T00:36:14.708Z
gate: save
updatedAt: 2026-07-10T00:36:14.708Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-10T00:36:14.708Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

Council panel session state (in-progress or completed output) is lost when navigating away from the Council sidebar section and back. The panel remounts fresh without recovering its previous session. Bug pattern: tab switch triggers remount with no state persistence or lazy recovery.

Related: [[council-multi-engine-architecture]], [[council-pending-crash-marker]]
