---
schema: 1
name: memory-contract-invisible-channel
title: Memory-first contract via engine-native invisible channels, not prompt modification
class: architecture
capturedAt: 2026-07-11T03:28:40.195Z
gate: save
updatedAt: 2026-07-11T03:28:40.195Z
---

The memory-first contract (search .cockpit-memory/ before acting, cite notes, start response with MEMORY: read <files>) is provisioned through each engine's native invisible channel — never by wrapping or modifying the user's input text. Claude: .claude/settings.local.json UserPromptSubmit hook. Codex: AGENTS.md managed block. Hermes/GPT/DeepSeek: system-prompt role. The old prompt dock and prepareAgentPrompt chain (which prepended memory instructions to user text) were removed. If contract provisioning fails (e.g. broken settings), the terminal refuses to open — zero bypass paths. Contract source of truth: shared/memory-contract.ts. Verification signal: agent's first output line reads MEMORY: read x.md, y.md or MEMORY: no relevant notes.

Related: [[terminal-memory-contract]], [[hermes-cockpit-decoupled-architecture]]
