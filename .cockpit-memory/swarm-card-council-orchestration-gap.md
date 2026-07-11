---
schema: 1
name: swarm-card-council-orchestration-gap
title: Swarm cards from Council skip the council phase on first start
class: architecture
capturedAt: 2026-07-10T00:36:14.717Z
gate: save
updatedAt: 2026-07-10T00:36:14.717Z
---

When a card is created from a Council session result and started, it goes directly to the builder phase instead of running the council phase first. Expected: council spec/context should feed forward into the card lifecycle — the card should start with, or at minimum surface, the council phase before builder. Actual: council output (title, body, sessionId) is ignored by the card lifecycle.

Related: [[council-multi-engine-architecture]], [[swarm-design]]
