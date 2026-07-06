---
schema: 1
name: v0127-release-verification
title: git push --follow-tags silently skips lightweight tags
class: gotcha
capturedAt: 2026-07-05T19:31:14.214Z
gate: save
updatedAt: 2026-07-05T19:31:14.214Z
---

During the v0.1.31 release, `git push --follow-tags` did NOT send the release tag because it was a lightweight tag — --follow-tags only pushes annotated tags, so the CI release workflow never triggered until the tag was pushed explicitly (`git push origin vX.Y.Z`). Companion pitfall to the existing 'tag only after the version-bump commit' lesson: even a correctly-ordered tag can silently fail to reach GitHub. Fix: either create annotated tags (`git tag -a`) or always push the tag explicitly after bumping, and verify the CI run actually started before assuming the release is in flight.

Related: [[migration-number-collision]]
