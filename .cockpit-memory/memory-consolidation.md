---
schema: 2
name: memory-consolidation
title: Uzun notlarda madde bazlı duplicate tespiti
class: architecture
capturedAt: 2026-07-14T05:04:16.529Z
gate: save
updatedAt: 2026-07-14T05:04:16.529Z
status: archived
authority: observed
scope: project
confidence: medium
firstSeenAt: 2026-07-14T05:04:16.529Z
reviewAfter: 2026-10-12T05:04:16.529Z
---

reconcile ve merge artık atomik madde bazında benzerlik kontrolü yapar. Eşik 0.82 üzeri duplicate. Merge de byte-level idempotent. Notların içindeki tekrarlar artık append edilmez.

Related: [[memory-reconcile-dedup-gotcha]], [[hermes-memory-stewardship-roadmap]]
