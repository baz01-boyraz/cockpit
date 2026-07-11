---
schema: 1
name: hermes-mouse-select-user-select-none
title: Hermes chat text area cannot be mouse-selected — app-wide user-select:none blocks it
class: gotcha
capturedAt: 2026-07-06T06:07:21.023Z
gate: save
updatedAt: 2026-07-06T06:07:21.023Z
---

cockpiT has `user-select: none` on `<body>`, then selectively re-enables `user-select: text` per-chat component. AI Cockpit's `components.css` already overrides for its message text, but Hermes's `.hermes__msgText` (`hermes.css`) was missing the override, making mouse-select (and Cmd+C) silently impossible. Fix: add `user-select: text; cursor: text` to `.hermes__msgText`. Same pattern applies to any new text-display container: check the global override and add your own override if you want text selectable.
