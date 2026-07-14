---
schema: 2
name: release-tagging-gotcha
title: git push --follow-tags skips lightweight tags, so CI release never triggers
class: gotcha
capturedAt: 2026-07-06T01:04:26.362Z
gate: asked
updatedAt: 2026-07-14T04:57:02.191Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-06T01:04:26.362Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

`git push --follow-tags` only pushes annotated tags. A lightweight `vX.Y.Z` tag is NOT pushed by it, so the GitHub Actions Release workflow (which triggers on the tag) never runs — hit during the v0.1.30 release. Fix: push the tag explicitly (`git push origin vX.Y.Z`). Combine with the existing rule: bump version first, then tag after the bump.

Related: [[swarm-design]]
- (2026-07-14) The AI prematurely tagged and released v0.2.9 before all parallel agent commits were finalized, despite Baz's explicit instruction to wait. This caused a revert cycle (delete tag, delete release, wait). The correct process is: all parallel agent work must commit first, then collective validation, then push, then release. The AI must not assume completion based on open processes or partial commits.
