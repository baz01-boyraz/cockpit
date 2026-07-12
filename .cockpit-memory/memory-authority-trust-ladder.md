---
schema: 1
name: memory-authority-trust-ladder
title: Memory authority trust ladder — proposal-based start, autonomy after 90% accuracy
class: decision
capturedAt: 2026-07-08T05:16:57.427Z
gate: save
updatedAt: 2026-07-12T04:50:43.000Z
---

Hermes starts as a proposal-based curator: it suggests archive/merge/delete actions, human batch-approves them. Only after a measurable accuracy track record (≥90% proposal hit rate) is autonomy discussed. This is not a nice-to-have delay — it solves the pre-trust risk of silent memory corruption before the system has proven its judgment. The accuracy metric must be observable (not self-reported) and surfaced when the threshold is approached.

This ladder governs broad curation and cleanup autonomy. It does not prohibit the narrower controlled conflict resolver: Hermes may settle one evidence-clear conflict only through policy v2's closed basis+rationale+evidence contract, with stale-write protection, `replace/delegated` ledger provenance, and audit. Ambiguous conflicts and all bulk cleanup remain pending for the owner.

Related: [[memory-trust-modes]], [[council-question-redact-gap]]
