---
schema: 2
name: council-recent-deliberation-click-no-op
title: Recent deliberation list entries had no visible open/select state
class: gotcha
capturedAt: 2026-07-14T05:04:41.640Z
gate: save
updatedAt: 2026-07-14T05:04:41.640Z
status: active
authority: observed
scope: project
confidence: medium
firstSeenAt: 2026-07-14T05:04:41.640Z
reviewAfter: 2026-10-12T05:04:41.640Z
---

Before fix, clicking a recent entry (from prior Council sessions) appeared to do nothing: no loading state, no highlight, no content scroll. The fix added a 'Opening...' state, visible selected indicator, and auto-scroll to the opened verdict. This was a pure feedback-failure bug.

Related: [[council-panel-session-eviction]], [[council-verdict-unreadable]]
