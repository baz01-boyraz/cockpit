---
schema: 2
name: log-windowing-single-line-assumption
title: Log windowing assumes single-line rows — multi-line wrap causes small scroll drift at 200+
class: gotcha
capturedAt: 2026-07-09T09:44:09.185Z
gate: save
updatedAt: 2026-07-09T09:44:09.185Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-09T09:44:09.185Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

The useWindowedList hook for logs uses fixed-height windowing (29px rows). If a log line wraps to 2 lines, the scroll offset drifts slightly. Agent noted this honestly: "pratikte sorun değil" because real log lines are nearly always single-line, and windowing only activates at 200+. But it's a documented gap, not a bug.

Related: [[windowed-list-hook]]
