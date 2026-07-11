---
schema: 1
name: openrouter-secret-ref-gotcha
title: OpenRouter secret ref string mismatch
class: gotcha
capturedAt: 2026-07-06T05:45:22.428Z
gate: save
updatedAt: 2026-07-07T01:41:08.921Z
---

Settings IPC (registerIpc.ts) stores the OpenRouter API key to the secret store under the ref 'hermes.openrouter', but OpenRouterUsageService.ts reads from disk under the ref 'openrouter'. These were two independent hardcoded strings that silently diverged, causing any key saved via Settings to be invisible to the usage service — the engine ring always showed offline regardless of whether a key was stored. Fixed by extracting OPENROUTER_SECRET_REF as a shared constant both files import from.

Related: [[security-enforcement]]
- (2026-07-07) `electron/main/ipc/registerIpc.ts` saves OpenRouter key as `hermes.openrouter` but `electron/main/services/OpenRouterUsageService.ts` reads `openrouter` — the two files used different string literals for the same secret ref, so no key was ever found regardless of what was saved in Settings. Fixed by extracting both to import from a shared constant `OPENROUTER_SECRET_REF`. This is a repeat of the same class of bug that openrouter-secret-ref-gotcha already documents; new specific files involved are `registerIpc.ts` and `OpenRouterUsageService.ts`.
