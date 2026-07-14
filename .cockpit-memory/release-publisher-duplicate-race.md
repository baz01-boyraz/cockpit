---
schema: 2
name: release-publisher-duplicate-race
title: Parallel electron-builder publishers can split one tag across duplicate releases
class: gotcha
capturedAt: 2026-07-14T16:50:21.000Z
gate: save
updatedAt: 2026-07-14T16:50:21.000Z
status: active
authority: code-verified
authorityRef: v0.3.2 release run 29350475775
scope: project
confidence: high
firstSeenAt: 2026-07-14T16:42:08.000Z
lastVerifiedAt: 2026-07-14T16:50:21.000Z
reviewAfter: 2027-01-10T16:50:21.000Z
---

electron-builder publishes the ZIP and DMG concurrently. When neither publisher
can see an existing GitHub release, both may create one for the same tag,
splitting artifacts across duplicate release records while the workflow still
reports success. The release workflow now pre-creates one tagged release and
fails unless exactly one record contains the ZIP, ZIP blockmap, DMG, DMG
blockmap, and `latest-mac.yml`.

Related: [[release-tagging-gotcha]], [[app-refresh-autoupdate-revert]]
