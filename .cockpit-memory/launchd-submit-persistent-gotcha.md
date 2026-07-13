---
schema: 2
name: launchd-submit-persistent-gotcha
title: launchctl submit creates persistent LaunchAgent, not one-shot
class: gotcha
capturedAt: 2026-07-08T01:24:19.350Z
gate: save
updatedAt: 2026-07-08T01:24:19.350Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-08T01:24:19.350Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

`launchctl submit` registers a persistent LaunchAgent that launchd restarts indefinitely after exit. It is NOT a one-shot detached job. When used to swap an app, launchd re-launches the job ~every 16s, producing an infinite restart loop. The fix: use `launchctl bootout` (or `launchctl remove`) to unload the label after the job's side-effect is done. This mechanism explains TWO previously-unresolved cockpiT mysteries: (1) 'app periodically self-closes' (July 4) and (2) hard-reboot-needed close/reopen loop (July 6) — likely leftover detached/launchd jobs from prior app:install-release attempts. Symptom: `launchctl list | grep -i cockpit` shows stale jobs.

Related: [[app-replace-quit-loop-gotcha]], [[app-refresh-autoupdate-revert]]
