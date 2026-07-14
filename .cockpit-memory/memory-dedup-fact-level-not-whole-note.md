---
schema: 2
name: memory-dedup-fact-level-not-whole-note
title: Memory deduplication now operates at atomic fact/fingerprint level, not whole-note Jaccard
class: decision
capturedAt: 2026-07-14T05:04:41.658Z
gate: save
updatedAt: 2026-07-14T05:04:41.658Z
status: archived
authority: observed
scope: project
confidence: medium
firstSeenAt: 2026-07-14T05:04:41.658Z
reviewAfter: 2026-10-12T05:04:41.658Z
---

The previous whole-note Jaccard dedup was failing on growing notes because edits caused the overall similarity to drop below threshold, allowing duplicate facts to be appended as new bullets. The fix changed the dedup pipeline to compare individual facts by fingerprint (LLM-extracted atomic claims). This is a permanent architectural change to the dedup system.

Related: [[memory-reconcile-dedup-gotcha]], [[memory-hub]], [[memory-charter-quality-gate]]
