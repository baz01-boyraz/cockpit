---
schema: 2
name: hermes-copy-hover-reveal
title: Copy button hover-reveal pattern
class: decision
capturedAt: 2026-07-06T05:55:04.436Z
gate: save
updatedAt: 2026-07-06T05:55:04.436Z
status: archived
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-06T05:55:04.436Z
reviewAfter: 2026-07-13T05:20:43.982Z
---

Hermes reply copy button is revealed on hover/focus within the message bubble (.hermes__msg--hermes:hover / :focus-within), with a 1.6s "Copied" feedback state (check icon + green tint). Uses navigator.clipboard.writeText with a fallback to hidden textarea + execCommand for denied/unavailable Clipboard API. The hover-reveal was chosen over always-visible to keep the message bubble clean.

Related: [[hermes-composer-hint-row]]
