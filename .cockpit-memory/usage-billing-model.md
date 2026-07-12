---
schema: 1
name: usage-billing-model
title: Model usage is split between local subscriptions and OpenRouter credit
class: architecture
capturedAt: 2026-07-05T19:04:42.191Z
gate: save
updatedAt: 2026-07-12T05:17:51.000Z
---

# Usage and billing

cockpiT has no customer payment/Stripe layer, but it is not “zero per-token billing.” Coding workers use the user's authenticated Claude Code or Codex account/quota. Hermes calls use the owner's OpenRouter credential and consume OpenRouter credit per token.

Hermes model routing is explicit in `shared/hermes-model-policy.ts`: conversation/orchestration uses DeepSeek V4 Pro; bounded tool-less triage, memory distillation, and curation use DeepSeek V4 Flash. The background calls are event/cadence driven rather than continuous raw-log polling.

`AgentUsageService` reads provider quota windows for display and dispatch decisions; those read-only quota requests do not themselves consume model tokens. Automatic consumers include idle/exit memory capture, due weekly curation, Sentinel triage only after a deterministic signal, and Swarm pipeline advancement when another worker step is actually needed.

Related: [[memory-hub]], [[swarm-design]], [[hermes-memory-stewardship-roadmap]], [[openrouter-credit-ring]]
