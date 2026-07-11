---
schema: 1
name: terminal-memory-contract
title: Terminal prompt dock removed — standing memory-first contract instead
class: architecture
gate: save
updatedAt: 2026-07-10T22:06:00.000Z
---

# Terminal memory contract (prompt dock removed)

SYMPTOM lookup: "prompt dock nerede / where did the prompt dock go" — removed
deliberately in v0.2.5+ (2026-07-10), not a regression.

Interactive Claude/Codex terminals no longer prepend `COCKPIT MEMORY … USER
TASK:` to user prompts. Baz's rule: **nothing may be written on top of the
user's prompt, ever** — the memory-first rule is a system-wide MUST delivered
through each engine's native standing channel instead:

- Claude Code: managed `UserPromptSubmit` hook in `.claude/settings.local.json`
  (stdout = per-prompt context, user text untouched).
- Codex: managed `<!-- COCKPIT-MEMORY:BEGIN/END -->` block in `AGENTS.md`.
- Single source of contract text: `shared/memory-contract.ts`;
  `MemoryContractService.ensureForAgent()` provisions idempotently on every
  agent launch/resume and THROWS on corrupt settings (launch may not proceed
  without the contract — `guarded()`-style MUST semantics).

Evidence of compliance = the engine's opening `MEMORY: read <files>` /
`MEMORY: no relevant notes` status line + TUI tool-call rows. Phase 2 (pending):
same standing/system-prompt delivery for Council/Swarm/Hermes + a violation
badge when the status line is missing. See [[memory-hub]] and
`docs/MEMORY-CHARTER.md` "Memory-first contract".
