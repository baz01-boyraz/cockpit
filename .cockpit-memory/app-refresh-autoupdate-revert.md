---
schema: 2
name: app-refresh-autoupdate-revert
title: Local app:refresh build gets reverted by GitHub auto-update
class: gotcha
capturedAt: 2026-07-04T20:38:28.345Z
gate: asked
updatedAt: 2026-07-14T04:57:02.202Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-04T20:38:28.345Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

# Local build can be replaced by auto-update

When GitHub publishes a version newer than a local `app:refresh` build, `electron-updater` can replace the installed local build with that release. The observed symptom was: **“the new Named-Agents UI disappeared from Swarm.”** The feature had not vanished from source; an unreleased local build had been overwritten by v0.1.28.

Before debugging “my feature isn't showing up,” verify the version and commit represented by the installed app. To keep unreleased behavior visible, the local build must compare newer than the available release or the change must be shipped as a release.

Separate unresolved symptom from 2026-07-04: Baz reported that the installed app was closing itself at regular intervals. It was not investigated because the session returned to Command Blocks; `AppUpdateService` quit behavior or a crash were only hypotheses, not a diagnosis.

Related: [[app-refresh-consent-rule]], [[release-tagging-gotcha]]
- (2026-07-14) Running `app:refresh` or any local build/install command kills the currently running cockpiT application. This caused the app to close 5 times during the session, interrupting Baz's work. The AI must never run app:refresh, quit, kill, or any command that restarts the main application without explicit Baz approval. Use only read-only verification and remote release workflows.
