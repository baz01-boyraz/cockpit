---
schema: 1
name: install-release-terminal-death
title: app:install-release cannot run from inside cockpiT's own terminal
class: gotcha
capturedAt: 2026-07-08T01:24:19.372Z
gate: save
updatedAt: 2026-07-08T01:24:19.372Z
---

`npm run app:install-release` must kill the running app to replace it, which terminates the terminal session that's executing the script. The script never reaches its 'reopen app' step. Any deploy/swap script that kills the host app must run detached from outside the app (bare macOS terminal, launchd one-shot, cron). Running it from the app's embedded terminal (node-pty) or an AI session hosted inside the app guarantees silent failure.

Related: [[app-replace-quit-loop-gotcha]], [[darwin-no-setsid-use-launchctl]], [[launchd-submit-persistent-gotcha]]
