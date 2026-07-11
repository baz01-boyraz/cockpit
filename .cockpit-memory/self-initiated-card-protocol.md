---
schema: 1
name: self-initiated-card-protocol
title: Hermes proposes cards for self-found issues, never opens them
class: decision
capturedAt: 2026-07-06T02:31:37.288Z
gate: save
updatedAt: 2026-07-06T02:31:37.288Z
---

There is a hard line: human-requested tasks → create_swarm_card + start_swarm_card directly. Self-initiated findings (from git/log review, error patterns) → propose_swarm_card only (creates an approval request on the Dashboard). The card is only opened and started if the human approves it from there. Enforced in AGENTS.md and backed by HermesApprovalExecutor service.

Related: [[hermes-mcp-architecture]], [[coding-fallback-order]]
