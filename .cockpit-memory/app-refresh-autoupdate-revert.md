---
schema: 1
name: app-refresh-autoupdate-revert
title: Local app:refresh build gets reverted by GitHub auto-update
class: gotcha
capturedAt: 2026-07-04T20:38:28.345Z
gate: asked
updatedAt: 2026-07-06T01:05:49.164Z
---

When a newer GitHub release exists than the local app:refresh build, electron-updater auto-updates the installed cockpiT back to the released version, silently discarding the local build. This caused a 'the new Named-Agents UI disappeared from Swarm' confusion: a local build carrying unreleased commits was overwritten by the v0.1.28 release. Implication: to durably see unreleased code in the installed app, either keep app:refresh builds ahead of any release OR just ship the release. Verify which version the installed app is actually running before debugging 'my feature isn't showing up'.

Related: [[app-refresh-consent-rule]], [[release-tagging-gotcha]]
- (2026-07-04) Baz reported the installed cockpiT app started closing itself by itself at regular intervals (observed ~2026-07-04). Unresolved — not investigated this session (he said 'neyse'/never mind to focus on Command Blocks). Suspected: AppUpdateService auto-check/quit behavior or a crash; plan to inspect logs together. Flag for follow-up.
- (2026-07-05) Baz reported the installed cockpiT app started closing itself at regular intervals (observed ~2026-07-04). Not investigated this session (he said 'neyse' to keep focus on Command Blocks). Suspected: AppUpdateService auto-check/quit behavior or a crash — plan to inspect logs together. Flag for follow-up.
- (2026-07-05) Baz reported the installed cockpiT app started closing itself at regular intervals (observed ~2026-07-04). Not investigated this session (he said 'neyse' to keep focus on Command Blocks). Suspected: AppUpdateService auto-check/quit behavior or a crash — plan to inspect logs together. Flag for follow-up.
- (2026-07-06) Baz reported the installed cockpiT app started closing itself at regular intervals (observed ~2026-07-04). Not investigated this session (he said 'neyse' to keep focus on Command Blocks). Suspected: AppUpdateService auto-check/quit behavior or a crash — plan to inspect logs together. Flag for follow-up.
