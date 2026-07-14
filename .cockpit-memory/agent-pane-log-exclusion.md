---
schema: 2
name: agent-pane-log-exclusion
title: Agent pane output excluded from log ingestion
class: architecture
capturedAt: 2026-07-14T18:11:13.361Z
gate: save
updatedAt: 2026-07-14T18:12:40Z
status: archived
authority: observed
scope: project
confidence: medium
firstSeenAt: 2026-07-14T18:11:13.361Z
reviewAfter: 2026-10-12T18:11:13.361Z
---

Claude, Codex, and other agent terminal output must be excluded from Logs/Insights ingestion at the data source level, not just regex filtering. This is enforced by not ingesting any output from agent panes and by legacy read queries joining terminal role to filter out agent-pane logs from view. Prevents false-positive error signals from test/diff output.

Related: [[sentinel-anti-noise-gotcha]], [[log-windowing-single-line-assumption]]

Archived as a duplicate; the verified implementation and legacy cleanup are
consolidated in [[sanitize-ansi-regex-escaped-source]].
