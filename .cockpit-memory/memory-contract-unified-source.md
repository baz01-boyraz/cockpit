---
schema: 1
name: memory-contract-unified-source
title: Memory contract unified into shared module across all surfaces
class: architecture
capturedAt: 2026-07-11T04:25:57.900Z
gate: save
updatedAt: 2026-07-11T04:25:57.900Z
---

All agent-facing surfaces (terminal, chat, swarm) now source their memory lookup contract from a single canonical module `shared/memory-contract.ts`. The architectural rule: no surface may embed contract text inside user message content — all contract text flows through the system (or trusted prefix) channel, never polluting the user's actual input. Before this, each surface had its own copy or inline version.

Related: [[memory-contract-invisible-channel]], [[terminal-memory-contract]]
