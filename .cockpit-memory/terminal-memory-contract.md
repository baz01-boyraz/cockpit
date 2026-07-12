---
schema: 1
name: terminal-memory-contract
title: Terminal prompt dock removed — standing memory-first contract instead
class: architecture
gate: save
updatedAt: 2026-07-12T05:17:51.000Z
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
`MEMORY: no relevant notes` status line + TUI tool-call rows.

Phase 2 (same day): Claude chat now rides the contract on
`--append-system-prompt` (user message stays the verbatim positional prompt);
Hermes carries a tool-aware equivalent in the trusted preamble; council/swarm/review prompts are
app-composed → compliant by construction. File-capable lookup wording reuses the
canonical text. `shared/memory-evidence.ts` parses the reply status line into
`receipt.evidence` (`read`/`none`/`missing`) — `missing` = engine ignored the
contract. See [[memory-hub]] and `docs/MEMORY-CHARTER.md` "Memory-first
contract".
