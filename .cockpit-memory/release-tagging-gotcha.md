---
schema: 1
name: release-tagging-gotcha
title: git push --follow-tags skips lightweight tags, so CI release never triggers
class: gotcha
capturedAt: 2026-07-06T01:04:26.362Z
gate: asked
updatedAt: 2026-07-06T01:04:26.362Z
---

`git push --follow-tags` only pushes annotated tags. A lightweight `vX.Y.Z` tag is NOT pushed by it, so the GitHub Actions Release workflow (which triggers on the tag) never runs — hit during the v0.1.30 release. Fix: push the tag explicitly (`git push origin vX.Y.Z`). Combine with the existing rule: bump version first, then tag after the bump.

Related: [[swarm-design]]
