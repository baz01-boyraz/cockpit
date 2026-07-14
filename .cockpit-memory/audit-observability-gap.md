---
schema: 2
name: audit-observability-gap
title: Audit is not agent/LLM observability
class: decision
capturedAt: 2026-07-14T05:05:05.657Z
gate: save
updatedAt: 2026-07-14T05:28:14.740Z
status: active
authority: observed
scope: project
confidence: medium
firstSeenAt: 2026-07-14T05:05:05.657Z
reviewAfter: 2026-10-12T05:05:05.657Z
---

The Audit system is a security-focused log of important controlled actions (lifecycle, approval, git, zombie, etc.), not a comprehensive observability layer. It categorizes actors as 'User', 'Agent' (generic 'ai' tag, no named agent identity), or 'System'. It does not track individual LLM calls, prompts, responses, tool calls, tokens, costs, or subagent invocations. Council audit records only seat/result statistics, not model responses. Agent/model identity is fragmented across Terminal, Resume, Usage, and Council. The audit screen shows only the last 100 records per project and is not live-streamed. To achieve full observability, a separate Execution Ledger with runId, agent, provider, model, parent, surface, duration, token/cost, tool count, and card/session linkage would be required.

Related: [[memory-gate-metrics-audit-log]]
- (2026-07-14) Previously Audit screen read records only on mount, missing new entries. Fixed by connecting to a live event bus push, ensuring real-time visibility of new audit events.
