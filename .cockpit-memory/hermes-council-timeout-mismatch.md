---
schema: 2
name: hermes-council-timeout-mismatch
title: Hermes-Council timeout mismatch kills valid result
class: gotcha
capturedAt: 2026-07-14T04:58:43.776Z
gate: save
updatedAt: 2026-07-14T04:58:43.776Z
status: archived
authority: observed
scope: project
confidence: medium
firstSeenAt: 2026-07-14T04:58:43.776Z
reviewAfter: 2026-10-12T04:58:43.776Z
---

Hermes chat timeout (300s) is shorter than Council's per-stage timeout (360s) multiplied by three stages (seats, sequential, president). This causes a race: Council can complete successfully and write result to DB, then Hermes is killed ~1s later before the result can be delivered to the user. This is not a one-off slowness but a design flaw, as Council's timeout is defined per-call, not per-tour. Fix requires aligning timeouts or making Council calls async with heartbeat-based timeout.

Related: [[council-multi-engine-architecture]], [[hermes-suspended]]
