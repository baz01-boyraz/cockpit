---
schema: 2
name: bug-card-restart-indicator
title: Bug card restart indicator design
class: architecture
capturedAt: 2026-07-14T06:10:43.911Z
gate: save
updatedAt: 2026-07-14T06:10:43.911Z
status: active
authority: observed
scope: project
confidence: medium
firstSeenAt: 2026-07-14T06:10:43.911Z
reviewAfter: 2026-10-12T06:10:43.911Z
---

Bug card shows severity percentage (e.g. Önem %86), restart requirement with three states: red 'Gerekir', green 'Gerekmez', amber 'Belirsiz', a short problem description, and action buttons 'Ask Claude', 'Ask Codex', 'Dismiss'. Restart state clarifies whether fixing the bug requires restarting the application, refreshing the renderer, or is unknown before diagnosis.
