---
schema: 2
name: memory-systematic-fix-gotcha
title: Partial UI-only fixes insufficient for memory health issues; require root cause across queue, lifecycle, archive
class: gotcha
capturedAt: 2026-07-14T18:11:13.393Z
gate: save
updatedAt: 2026-07-14T18:12:40Z
status: active
authority: code-verified
scope: project
confidence: high
firstSeenAt: 2026-07-14T18:11:13.393Z
lastVerifiedAt: 2026-07-14T18:12:40Z
reviewAfter: 2026-10-12T18:11:13.393Z
---

Previous approach of hiding old failures in UI only failed because the root problems spanned queue read-model, lifecycle alarm logic, and archive integrity. The correct approach was to address all four root causes (historical failure exclusion, provider queue isolation, archived note resurrection prevention, and agent output filtering) together with a combined regression test suite. Partial fixes allow symptoms to resurface.

Related: [[memory-archived-notes-leak]], [[agent-pane-log-exclusion]], [[memory-historical-failure-exclusion]]
