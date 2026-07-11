---
schema: 1
name: coding-fallback-order
title: Coding fallback chain: Claude Code → Codex → Hermes-only-if-asked
class: decision
capturedAt: 2026-07-06T02:31:37.293Z
gate: save
updatedAt: 2026-07-06T02:31:37.293Z
---

Hermes never codes on its own. Coding fallback: Claude Code (primary), Codex (only if Claude quota exhausted), Hermes/DeepSeek (only if explicitly asked and human agreed). Hermes never switches silently — always reports quota state and lets the human choose. Coding is always dispatched through Swarm cards (not raw terminal `claude -p`), preserving audit trail, quota checks, and lifecycle management.

Related: [[hermes-mcp-architecture]], [[self-initiated-card-protocol]]
