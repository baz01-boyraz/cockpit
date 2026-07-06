---
schema: 1
name: tsconfig-node-window-gotcha
title: Testable libs touching window break node typecheck
class: gotcha
capturedAt: 2026-07-04T23:07:44.475Z
gate: save
updatedAt: 2026-07-04T23:07:44.475Z
---

Any `src/lib/*.ts` that touches `window` (e.g. localStorage) AND has a test in `test/` will fail `npm run typecheck` on the node project: `test/` compiles under `tsconfig.node.json`, which has no DOM lib, so bare `window` is an unknown global (release blocker). Fix pattern (used for `memoryTrust.ts`): access `window` via a typed `globalThis` accessor instead of the bare global name, and add the lib file to `tsconfig.node.json`'s include list alongside `council.ts`. In the test, avoid a bare `window` reference too.

Related: [[release-tagging-gotcha]], [[memory-trust-modes]]
