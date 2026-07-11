---
schema: 1
name: app-replace-quit-loop-gotcha
title: Quit+replace+relaunch detached script triggered crash loop requiring reboot
class: gotcha
capturedAt: 2026-07-06T02:31:02.542Z
gate: save
updatedAt: 2026-07-06T02:31:02.542Z
---

A detached script that quit cockpiT, replaced /Applications/cockpiT.app with a DMG copy, then relaunched triggered an infinite open/close cycle. The root cause could not be confirmed (logs cleared by reboot, macOS unified log unreachable without sudo) — likely the app's own process/relaunch mechanism conflicted with the external script. Recovery required a full system restart, not just killall. Mitigation: if repeating this operation, try `killall cockpiT` first before the full DMG replace, and ask the user to watch the app for ~1 minute after relaunch before declaring success.
