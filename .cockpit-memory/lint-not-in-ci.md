---
schema: 2
name: lint-not-in-ci
title: npm run lint is NOT in CI — 0-warnings ESLint rule is unenforced
class: decision
capturedAt: 2026-07-09T04:01:35.583Z
gate: save
updatedAt: 2026-07-09T04:01:35.583Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-09T04:01:35.583Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

The release workflow (.github/workflows/release.yml) runs typecheck and test as pre-publish gates, but does NOT run npm run lint. The project's '0 warnings' ESLint policy exists only as a local convention. Any commit that passes typecheck+test but introduces lint warnings ships silently.
