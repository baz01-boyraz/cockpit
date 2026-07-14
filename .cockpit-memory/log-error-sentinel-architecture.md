---
schema: 2
name: log-error-sentinel-architecture
title: Logs, Errors, and Sentinel Bell: Two-Layer Architecture and Gaps
class: architecture
capturedAt: 2026-07-14T19:05:17.860Z
gate: save
updatedAt: 2026-07-14T19:05:17.860Z
status: active
authority: observed
scope: project
confidence: medium
firstSeenAt: 2026-07-14T19:05:17.860Z
reviewAfter: 2026-10-12T19:05:17.860Z
---

The system has two separate layers: (1) Error Insights from log patterns (8 statically defined patterns) shown in the Errors panel with dismiss that hides the pattern until it occurs again, and (2) Sentinel signals from multiple sources (logs, memory, council, etc.) shown in the bell and Signal Center. They are connected only one-way: when a log pattern matches, a Sentinel signal is also generated. Key gaps: Error dismiss does not affect Sentinel dismiss; when multiple distinct errors are found in a single ingest call, all are recorded in Errors but only the last match is sent to Sentinel; the red 'N errors' chip in the top bar (max 5 patterns) is independent from the bell count; dashboard live update is not always guaranteed on new log events; main-process crashes go to a separate main-crash.log file and are not connected to logs or bell. Sentinel importance for log sources is deterministic: notice 65 + log source 8 = 73, not AI-based. The bell count shows all unseen Sentinel signals (currently 28 in baz-cockpit, but UI shows 9+).

Related: [[sentinel-notification-tiering]], [[audit-observability-gap]], [[live-notification-requirement]], [[operational-notification-card-design]]
