---
schema: 2
name: terminal-composer-editor-like-input
title: Terminal composer: editor-like input mode for all terminals
class: decision
capturedAt: 2026-07-14T05:03:31.808Z
gate: save
updatedAt: 2026-07-14T05:03:31.808Z
status: active
authority: observed
scope: project
confidence: medium
firstSeenAt: 2026-07-14T05:03:31.808Z
reviewAfter: 2026-10-12T05:03:31.808Z
---

Terminal text input area will be upgraded to a full editor-like composer: click-to-position cursor, mouse select/delete, undo/redo, multiline via Shift+Enter, command history with Ctrl+R search, and safe paste. Shell and Claude/Codex terminals share the same composer. Enter sends, Shift+Enter inserts newline. History search included in first version. Implementation uses xterm bracketed-paste state, native textarea editing, and a composer layer that does not break TUI apps. Verified via Playwright E2E, React best-practices review, and visual validation.

Related: [[terminal-memory-contract]], [[command-blocks-architecture]], [[prompt-dock-text-modification-rejected]]
