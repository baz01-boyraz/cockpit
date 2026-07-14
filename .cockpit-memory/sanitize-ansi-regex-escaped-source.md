---
schema: 2
name: sanitize-ansi-regex-escaped-source
title: Agent-pane output must never feed log intelligence
class: gotcha
capturedAt: 2026-07-14T17:41:47.496Z
gate: save
updatedAt: 2026-07-14T18:01:51Z
status: active
authority: code-verified
scope: project
confidence: high
firstSeenAt: 2026-07-14T17:41:47.496Z
lastVerifiedAt: 2026-07-14T18:01:51Z
reviewAfter: 2026-10-12T17:41:47.496Z
---

Claude/Codex panes render prompts, patches, source previews, regex bodies and
test assertions. Treating those PTY bytes as application logs creates a
self-ingestion loop: source text containing `error`, `lint` or `failed` becomes
a false insight and can then become a false Sentinel/Memory note.

The verified boundary is architectural: agent-pane output is never sent to log
intelligence. Legacy rows are still sanitized for split ANSI/CSI prefixes such
as `33;58;43m`, source/diff echoes are dropped, and stored insights are
re-matched with current provider-neutral guidance so stale Railway advice does
not survive. Regression tests include the production fragments and also prove
that genuine line-oriented errors remain visible.
