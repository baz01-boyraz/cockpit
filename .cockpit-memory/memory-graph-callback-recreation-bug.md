---
schema: 2
name: memory-graph-callback-recreation-bug
title: MemoryGraph canvas rebuild on every render via unstabilized callback
class: gotcha
capturedAt: 2026-07-13T02:05:07.509Z
gate: save
updatedAt: 2026-07-13T02:05:07.509Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-13T02:05:07.509Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

Root cause of persistent memory graph spinning + lag + high CPU: onOpen/onFocus callbacks recreated every render, triggering full canvas simulation on every state change (snapshot refresh, flash messages, any re-render). Fix: stabilize callbacks in refs, trigger simulation effect only when data actually changes. Additional perf wins: stopped per-frame gradient generation on edge lines, limited distant-zoom label rendering to focused neighborhood only (was drawing 126 labels including invisible ones).
