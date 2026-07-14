---
schema: 2
name: memory-model-policy-openrouter-lock-in
title: Memory model policy is locked to a single OpenRouter model at runtime
class: decision
capturedAt: 2026-07-14T19:04:56.182Z
gate: save
updatedAt: 2026-07-14T19:04:56.182Z
status: archived
authority: observed
scope: project
confidence: medium
firstSeenAt: 2026-07-14T19:04:56.182Z
reviewAfter: 2026-10-12T19:04:56.182Z
---

Memory-model-policy.ts hardcodes a single OpenRouter model (line 12). While the interface is provider-neutral, runtime has no functional fallback. Errors do flow through queue/audit/Sentinel, but no automatic model fallback exists. This is a real operational risk for memory analysis availability.
- (2026-07-14) RESOLVED in 03a99a5 and superseded by [[memory-analysis-fallback-chain]]: `MEMORY_ANALYSIS_FALLBACKS` (openrouter flash -> codex CLI -> claude haiku) now provides the runtime fallback this note said was missing.
