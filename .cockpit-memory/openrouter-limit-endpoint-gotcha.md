---
schema: 2
name: openrouter-limit-endpoint-gotcha
title: OpenRouter routing-key must use /api/v1/key not /credits
class: gotcha
capturedAt: 2026-07-14T04:58:04.247Z
gate: save
updatedAt: 2026-07-14T04:58:04.247Z
status: active
authority: observed
scope: project
confidence: medium
firstSeenAt: 2026-07-14T04:58:04.247Z
reviewAfter: 2026-10-12T04:58:04.247Z
---

OpenRouter limit display failed because app used /api/v1/credits endpoint (requires management key) with a normal routing key (sk-or-v1). The correct endpoint for routing-key limits is /api/v1/key. Fix: changed endpoint to return remaining percentage for capped keys, infinity for unlimited keys. Test coverage added.

Related: [[openrouter-secret-ref-gotcha]], [[openrouter-credit-ring]]
