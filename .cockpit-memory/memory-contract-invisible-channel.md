---
schema: 1
name: memory-contract-invisible-channel
title: Memory-first contract preserves user text across native and trusted channels
class: architecture
capturedAt: 2026-07-11T03:28:40.195Z
gate: save
updatedAt: 2026-07-12T05:17:51.000Z
---

# Memory-first delivery

Interactive user text is never wrapped or modified. Claude terminals receive the standing contract through a managed `UserPromptSubmit` hook; Codex terminals receive the managed `AGENTS.md` block. `MemoryContractService` provisions these channels before launch/resume and refuses a corrupt configuration rather than opening a bypass.

Non-terminal surfaces use their trusted, app-owned context:

- Claude chat: `--append-system-prompt`, while the positional user message remains verbatim.
- Hermes chat: trusted runtime preamble requiring `read_memory_recent(query=task)`; user transcript turns remain untouched.
- Council, Swarm, and review: app-composed work documents may carry the compact contract or bounded positive-match hooks because they are not the user's interactive prompt.

Lookup-capable surfaces receive the contract even when the hub is empty, so `MEMORY: no relevant notes` remains measurable instead of silently dropping the rule. File-capable wording comes from `shared/memory-contract.ts`; Hermes's tool-aware equivalent lives in `shared/memory-context.ts`.

Compliance evidence is the first response line: `MEMORY: read <files>` or `MEMORY: no relevant notes`. Missing evidence is classified and audited rather than being presented as a successful lookup.

Related: [[terminal-memory-contract]], [[hermes-cockpit-decoupled-architecture]]
