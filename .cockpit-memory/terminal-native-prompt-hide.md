---
schema: 2
name: terminal-native-prompt-hide
title: Terminal native prompt hide for all agent types
class: decision
capturedAt: 2026-07-14T04:57:02.170Z
gate: save
updatedAt: 2026-07-14T04:57:02.170Z
status: archived
authority: observed
scope: project
confidence: medium
firstSeenAt: 2026-07-14T04:57:02.170Z
reviewAfter: 2026-10-12T04:57:02.170Z
---

All terminal types (Codex, Claude, shell) in cockpiT now share a single input surface. The native prompt line (grey bar, ghost prompt with `›` and orange cursor) is hidden when the composer is focused, and restored on terminal click. Alternate-screen apps (vim, menus, approval) are never masked. The detection is content-agnostic: it targets the native prompt line by cursor position and ghost suggestion length, not by text matching. Implemented and released in v0.2.9 (later reverted).

Related: [[terminal-composer-single-input]], [[prompt-dock-text-modification-rejected]]
