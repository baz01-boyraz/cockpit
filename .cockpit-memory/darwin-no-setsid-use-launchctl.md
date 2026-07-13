---
schema: 2
name: darwin-no-setsid-use-launchctl
title: macOS: setsid does not exist, use launchctl submit
class: gotcha
capturedAt: 2026-07-06T02:31:02.537Z
gate: save
updatedAt: 2026-07-06T02:31:02.537Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-06T02:31:02.537Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

macOS has no `setsid` command (Linux-only). To spawn a process that survives the parent session's death (e.g. when the app that hosts the embedded terminal is killed during a self-update), use `launchctl submit` which registers the job with launchd. Passing `background=true` in terminal() is insufficient — it ties the job to the session's process tree; if cockpiT itself dies, the background job dies with it. launchctl submit creates a genuine fully detached process.
