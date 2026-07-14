---
schema: 2
name: operational-notification-card-design
title: Error notification card includes short summary, severity %, and action buttons
class: decision
capturedAt: 2026-07-14T06:04:09.169Z
gate: save
updatedAt: 2026-07-14T06:04:09.169Z
status: active
authority: observed
scope: project
confidence: medium
firstSeenAt: 2026-07-14T06:04:09.169Z
reviewAfter: 2026-10-12T06:04:09.169Z
---

Error/issue notifications in the bell widget are compact cards showing: a brief problem description, a deterministic severity percentage (based on severity, recurrence, source), and three action buttons: 'Ask Claude', 'Ask Codex', 'Dismiss'. Dismiss is recorded as a noise decision. Ask actions pass safe short context to the chosen terminal stream.

Related: [[sentinel-anti-noise-gotcha]], [[live-notification-requirement]], [[sentinel-3-layer-architecture]]
