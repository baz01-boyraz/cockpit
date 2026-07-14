---
schema: 2
name: memory-archived-notes-leak
title: Archived notes still counted and surfaced in active views
class: decision
capturedAt: 2026-07-14T05:12:41.864Z
gate: save
updatedAt: 2026-07-14T05:27:45.469Z
status: active
authority: observed
scope: project
confidence: medium
firstSeenAt: 2026-07-14T05:12:41.864Z
reviewAfter: 2026-10-12T05:12:41.864Z
---

About 30 of 156 notes are archived but still counted in health metrics, appear in main collection, and feed into graph analysis. The authority-before-recency principle is undermined because archived (superseded) notes are not separated from active views. Must isolate archived notes from active retrieval and health counters.

Related: [[memory-health-lifecycle-sensor]], [[memory-distiller-supersession-blindness]]
- (2026-07-14) Memory UI now separates active and archived/superseded notes into two tabs. Initial render only shows 24 lines (virtualized list). Search covers all active notes. 'Browse all' expands list on demand. Graph displays only active nodes; archived nodes are not shown as nodes or ghost placeholders. Baz Brain archive is similarly separated and capped. Scale tested with 99 active + 31 archived notes, list height 540px, 24 visible rows, no overflow. No memories are deleted; history remains readable.
