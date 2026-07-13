---
schema: 2
name: openrouter-credit-ring
title: Live OpenRouter credit displayed via premium white conic ring
class: architecture
capturedAt: 2026-07-06T04:58:56.341Z
gate: save
updatedAt: 2026-07-06T04:58:56.341Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-06T04:58:56.341Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

OpenRouterUsageService fetches live credits from openrouter.ai/api/v1/credits using the stored API key from SecretStore (main-process-only, never exposed via IPC). 60s cache with stale-fallback on error. Rendered as a premium platinum/white conic ring (--provider:#dde1e8, --provider-hi:#ffffff) in the engine rail, same ring pattern as Claude/Codex. Missing/invalid key shows offline state gracefully.

Related: [[engine-core-ring]], [[usage-billing-model]]
