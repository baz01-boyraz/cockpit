# Memory Charter

> The single source of truth for what goes into a project's memory hub
> (`.cockpit-memory/*.md`) and the global Baz brain. Written **for every engine
> that writes memory** — Claude Code, Codex, Hermes, the auto-capture distiller.
> Second person, imperative. Memory is the cornerstone of this cockpit: treat a
> junk write as a defect, not a convenience.

Memory is **per-project** and durable. A note you write today is read by a
different engine, on a different day, with none of today's context. Write for
that stranger, or do not write.

## Automatic read contract

Memory is load-bearing only when it reaches work automatically. Every task the
cockpit owns must call the central `MemoryContextService` before invoking an
engine. Delivery is capability-aware, retrieval-first, and never a full-body
prompt dump:

- File-capable Claude/Codex/Swarm agents receive one compact contract to search
  `.cockpit-memory/` and read only task-relevant notes themselves.
- Hermes receives the equivalent instruction to call `read_memory_recent` with
  the current task as `query`; whole-hub reads are reserved for deliberate
  dedup/curation work.
- Tool-less Council/review engines may receive at most two short, redacted hooks
  with source paths, and only when they positively match the task.
- Zero-overlap means no injected memory block. Never pad context with recent but
  unrelated notes.

- Covered surfaces: Claude chat, Hermes chat, Council spec/diff, Swarm workers,
  and reviews.
- The receipt's `delivery` is `lookup`, `inline`, or `none`. `ready` means the
  lookup contract or matched hooks reached the prompt; `empty` means the hub was
  checked but nothing applied; `unavailable` must be surfaced and must never be
  described as a successful read.
- A receipt is not proof of model cognition. A source citation in the engine
  answer or work log is the evidence that a note materially affected the work.
- Compact and legacy injected context is stripped from Claude transcripts before
  auto-capture so the brain cannot re-ingest its own protocol or old note dumps.

## Memory-first contract (MUST) — interactive terminals

Interactive Claude/Codex terminal sessions are covered by a **standing
contract**, not per-prompt injection. The user's typed prompt is never
modified — not one prepended character. `shared/memory-contract.ts` is the
single source of the contract text; `MemoryContractService` provisions it
before every agent terminal launch or resume, and a launch may not proceed
when the contract cannot be guaranteed:

- **Claude Code**: a managed `UserPromptSubmit` hook in the project's
  `.claude/settings.local.json`. Its stdout delivers the contract as context on
  every prompt, alongside — never inside — the user's message.
- **Codex**: a managed marker block (`<!-- COCKPIT-MEMORY:BEGIN/END -->`) in the
  project's `AGENTS.md`, which the Codex CLI loads at session start.

The contract requires the engine to search `.cockpit-memory/`, read only
task-relevant notes, and open its reply with exactly one status line —
`MEMORY: read <note files>` or `MEMORY: no relevant notes`. That visible line,
plus the TUI's own tool-call rows, is the per-task evidence of compliance.
Provisioning is idempotent, preserves all user-owned settings and hooks, and is
audit-logged as `memory.contract_provisioned`. A corrupt settings file blocks
the launch with an explicit error instead of being overwritten.

## The 7-day test (the core rule)

Before **any** write, answer one question out loud:

> *In what concrete situation, within the next ~7+ days, will someone need this
> exact fact?*

- If you can name the situation ("when someone hits `posix_spawnp failed` after
  `npm install`"), write it.
- If you cannot name a concrete situation — if the honest answer is "might be
  useful" — **do not write.** An empty write is better than a junk write.

Quality over quantity, always. The brain's value is precision, not volume. One
junk note poisons every future search that has to wade past it.

## What belongs

Each note is **one fact**. Keep them small and single-purpose.

- **Decisions — with their WHY.** "The router lives in `shared/` so both bridges
  classify identically." The reasoning is the durable part; the *what* is in the
  code, the *why* is not.
- **Gotchas — with the VERBATIM symptom.** Paste the real error text, log line,
  or UI message. **Grep-ability rule:** a memory that cannot be found by the
  error message that sends someone looking for it is dead on arrival. Then: root
  cause, and the fix that actually worked.
- **Architecture invariants.** "X is single-use." "Y must run before Z." The
  load-bearing constraints that are outages waiting to happen if they live in one
  head.
- **Owner preferences & standing directives.** Baz's stable working style and
  decisions that travel across sessions ("Fable plans, Opus builds").
- **Incident lessons.** A mistake-then-correction: what was tried, why it failed,
  what worked instead.

## What does NOT belong

- Anything **derivable** from the code, `git log`, or `CLAUDE.md`/`AGENTS.md`. If
  a reader can recover it in ten seconds from the repo, it is not memory.
- **One-off task narration** — status logs, "I did X then Y", progress updates.
- **Duplicate restatements.** Do not add a sibling note that says what an
  existing note already says. Update the existing one (see Dedup-first).
- **Secrets — NEVER.** API keys, tokens, private keys, `.env` values, connection
  strings with credentials. The write gate rejects secret-shaped content; do not
  test it. See the redaction rule (`shared/redaction.ts`).
- **Praise, filler, meta-commentary.** "Great progress!" is not a fact.
- Anything that **fails the 7-day test.**

## Dedup-first

The brain must never grow twins. Before you write:

1. **Search the existing notes** (`read_memory_recent`, or list the hub). Read
   what is already known.
2. If a note **already covers this topic, UPDATE it** — refine the fact, add the
   new detail — rather than creating a near-duplicate sibling.
3. Only create a new note when there is genuinely **no overlap**.
4. Connect related notes with **wikilinks**: `[[note-name]]`. A fact is worth
   more when it is reachable from the notes around it.

When you write through a tool, you declare which of these you did
(`dedupChecked: 'updates-existing' | 'no-overlap'`). Declaring "no-overlap" for a
name that already exists routes the write to human review — because it is
probably a twin.

## Format

Follow the conventions already in `.cockpit-memory/`:

- **File name:** `kebab-case`, descriptive, grep-friendly
  (`hermes-cli-hang-transcript-leak.md`, not `note1.md`).
- **Body head:** open with a **one-line hook** that states the fact in a sentence
  — the thing a reader scanning a list needs to see first.
- Then the detail: the **why**, and **how to apply it** (the concrete situation
  from the 7-day test). For a gotcha, include the verbatim symptom text.
- Brain-written notes carry a small frontmatter block (`class`, `gate`,
  `updatedAt`); human notes need none and stay valid without it.

## Lifecycle

Notes **decay**. A fact that was load-bearing in June can be dead by August.

- A **weekly curation sweep** proposes archive / merge / delete for stale,
  superseded, or duplicate notes. (The sweep itself ships in a later phase; this
  charter declares the policy now.)
- Curation proposals are **batched for owner approval** — the owner approves the
  sweep; the engines never silently delete a human's note.
- Soft-delete only: notes move to `.trash/`, never hard-removed.

## Enforcement

Agent-initiated writes pass through a **write gate** (`shared/memory-gate.ts`)
before they touch disk:

- **accept** — a justified, non-duplicate, secret-free write lands directly.
- **review** — missing/weak justification, a vague or filler 7-day scenario, an
  oversized note, or a suspected twin routes into the existing review queue for a
  human (or Hermes) to accept / edit / discard.
- **reject** — secret-shaped content is refused outright, citing this charter.

Direct writes a **human** makes from the Memory UI are never gated — owner
sovereignty. The gate exists to hold the *engines* to this charter, not the
owner.
