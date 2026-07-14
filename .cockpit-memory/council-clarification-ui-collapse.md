---
schema: 2
name: council-clarification-ui-collapse
title: Council clarification questions previously rendered as three massive vertical cards, making them unreadable for user
class: gotcha
capturedAt: 2026-07-14T05:04:41.621Z
gate: save
updatedAt: 2026-07-14T05:04:41.621Z
status: active
authority: observed
scope: project
confidence: medium
firstSeenAt: 2026-07-14T05:04:41.621Z
reviewAfter: 2026-10-12T05:04:41.621Z
---

Before fix, each clarification question was a huge card (title + description + recommendations + textarea). Three questions filled multiple screens. The fix collapsed them into a single-question stepper with compact answer options. This was a pure UX mistake, not a data problem.

Related: [[council-verdict-unreadable]], [[council-run-preload-param-drop]]
