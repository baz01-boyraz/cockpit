---
schema: 2
name: signal-memory-capture-stopped-after-repeated-failures
title: Memory capture stopped after repeated failures
class: gotcha
gate: manual
updatedAt: 2026-07-14T17:30:25.516Z
status: archived
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-13T05:20:43.982Z
reviewAfter: 2026-07-13T05:20:43.982Z
---

# Memory capture stopped after repeated failures

Symptom (verbatim):
Memory capture stopped after repeated failures
137 capture jobs exhausted automatic retries.

Recurred 8× as a `memory-lifecycle` sentinel signal — a repeat-offender pattern worth remembering.

captured from recurring sentinel signal sig_1940c661df484cdb

This signal remains archived: the 137 rows are migration-era failures from
July 4–5 and later captures succeeded. They are durable history, not a current
capture outage.
