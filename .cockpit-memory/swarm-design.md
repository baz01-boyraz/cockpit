---
schema: 2
name: swarm-design
title: Swarm lifecycle, isolation, and review architecture
class: architecture
gate: save
updatedAt: 2026-07-12T05:03:45.000Z
status: active
authority: legacy
scope: project
confidence: low
firstSeenAt: 2026-07-12T05:03:45.000Z
reviewAfter: 2026-10-11T05:20:43.983Z
---

# Swarm design

Swarm is a hybrid system: main-process `SwarmService` conducts board state, lifecycle, worktrees, resume, quota checks, and audit; model sessions are workers. The project memory hub supplies bounded read-only context when a worker starts. Full design history lives in `docs/plans/swarm-plan.md`.

## Load-bearing rules

- One implicit board exists per project. A `kanban_cards` row is both the card and worker-instance registry; the abandoned empty `agent_sessions` table was removed.
- Runtime facts own runtime states. Only the service moves a card into or out of `in_progress`; the human owns the remaining board transitions. `parked` represents a graceful quota stop.
- Parallel cards use `<project>/.cockpit-worktrees/<slug>/` on `swarm/<slug>` branches, initially capped at three. Dirty worktrees are refused and never force-deleted.
- Role × Domain assignments run sequentially in one worktree. A named agent is an alternative override, not additive; see [[named-agents-team]].
- Worker status comes from exit codes, git state, hooks, and persisted events—never from parsing model prose.
- Resume uses the persisted terminal command, `reconciled_at`, and UUID-checked resume path described by [[ipc-contract]].

## Completion and review

Workers are interactive sessions, so their PTY normally remains open after a turn. `SwarmDoneSignal.arm()` installs a Claude Code Stop hook in the worktree that touches `.cockpit-done`; hook settings and sentinel files are hidden in `.git/info/exclude`, and a foreign settings file is never overwritten. Board polling consumes the signal: a final pipeline step moves Running → In review while leaving the terminal alive for follow-up; late signals for non-running cards are ignored.

`In review` means “the worker paused; inspect the diff or continue the conversation,” not “finished.” Done remains a human decision. Running is drag-locked, while To Do, In review, Done, and Parked are human-draggable. A no-LLM diff-stat badge (`+X −Y · N files`) and the active Role/Domain step make review state legible.

Running cards expose coarse liveness (`output 3s ago`, `quiet 2m`) from timestamp-only `swarmActivityStore` data. One app-level listener and two-second coarsening answer “alive or stalled?” without storing or rendering TUI noise.

Raw worker output is still primarily a live terminal stream; it is not a complete replay archive after exit. Completion reports improve the handoff, but research-only details can still be lost unless the worker writes a durable findings artifact. Do not mistake a terminal close or summary for preserved full output.

When a card enters review, integrity ordering is strict: first persist the transition and audit synchronously; then fire report generation, outcome-event emission, and macOS notification independently. Each async side effect has its own failure boundary, so notification or reporting failures cannot corrupt the card transition. The audit intentionally does not claim `notified` before that asynchronous result exists.

## Visual contract

The board must communicate identity and depth at rest, not only on hover or on the running hero card. Since v0.1.32 every card keeps an always-visible gradient edge and identity plate; lanes retain distinct tones, Start/Resume is molten, and quota chips use restrained micro-gauges. This rule came from the rejected v0.1.31 pass, where an idle board looked unchanged despite richer hover/running states.

Related: [[memory-hub]], [[diff-review]], [[security-enforcement]], [[ipc-contract]], [[named-agents-team]]
