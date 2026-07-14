---
schema: 2
name: memory-analysis-fallback-chain
title: Memory analysis fallback chain: OpenRouter -> codex CLI -> claude haiku
class: decision
capturedAt: 2026-07-14T19:39:05.382Z
gate: save
updatedAt: 2026-07-14T19:39:05.382Z
status: active
authority: observed
scope: project
confidence: medium
firstSeenAt: 2026-07-14T19:39:05.382Z
reviewAfter: 2026-10-12T19:39:05.382Z
---

When OpenRouter fails (key exhausted/credit empty), memory analysis falls back to codex CLI (subscription, no marginal cost) then to claude haiku CLI (last resort, shares code quota). Each fallback hop logs a content-free audit. Worst-case latency: 540s for distill (3×180s timeouts), 180s for curation. Designed to keep 'living brain' running without operator intervention.

Related: [[memory-model-policy-openrouter-lock-in]]
