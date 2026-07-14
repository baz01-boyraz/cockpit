---
schema: 2
name: council-waiting-room-blank-screen
title: Council showed a blank, static waiting screen for 3-6+ minutes during execution
class: gotcha
capturedAt: 2026-07-14T05:04:41.631Z
gate: save
updatedAt: 2026-07-14T05:04:41.631Z
status: active
authority: observed
scope: project
confidence: medium
firstSeenAt: 2026-07-14T05:04:41.631Z
reviewAfter: 2026-10-12T05:04:41.631Z
---

Before fix, the Council panel displayed a single static message ('Council is deliberating...') with no progress indicator. This was deeply unsatisfying and felt like a hang. The fix added a live 'Council room' that shows each seat's completed stage, safe public findings, and the current phase (preparing, seats, peer review, chairman). Hidden chain-of-thought and raw model logs are never shown.

Related: [[council-multi-engine-architecture]], [[council-persistent-store-slice]]
