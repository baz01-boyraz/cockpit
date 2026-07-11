---
schema: 1
name: lint-not-in-ci
title: npm run lint is NOT in CI — 0-warnings ESLint rule is unenforced
class: decision
capturedAt: 2026-07-09T04:01:35.583Z
gate: save
updatedAt: 2026-07-09T04:01:35.583Z
---

The release workflow (.github/workflows/release.yml) runs typecheck and test as pre-publish gates, but does NOT run npm run lint. The project's '0 warnings' ESLint policy exists only as a local convention. Any commit that passes typecheck+test but introduces lint warnings ships silently.
