---
schema: 2
name: chat-ui-interaction-patterns
title: Reusable chat UI interaction patterns
class: reference
gate: manual
updatedAt: 2026-07-13T05:20:43.982Z
status: active
authority: equivalent-content
authorityRef: owner-approved agent-memory-system-v2 migration
scope: project
confidence: high
firstSeenAt: 2026-07-13T05:20:43.982Z
lastVerifiedAt: 2026-07-13T05:20:43.982Z
reviewAfter: 2027-01-09T05:20:43.983Z
supersedes: hermes-composer-hint-row, hermes-copy-hover-reveal, hermes-copy-testing-hover-reveal, hermes-mouse-select-user-select-none, hermes-docked-shell-layout
tags: runtime, memory-v2
---

Reusable chat surfaces dock as a shell column instead of covering terminals, keep keyboard hints in a separate persistent row, reveal copy actions on hover/focus with accessible feedback, and explicitly restore user-select:text where the app-wide default disables selection. UI tests should hover before clicking transition-revealed controls.
