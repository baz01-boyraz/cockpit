# Hermes ↔ Swarm Playbook

> Written **for Hermes** (the orchestrator agent). Second person, imperative. This is the
> step-by-step contract for turning a request into a well-specified, council-gated Swarm card.
>
> **Registration note.** Hermes loads this repo's `AGENTS.md` (root) as its persona when it runs
> in the project directory without `--ignore-rules` (see `HermesChatService`). `AGENTS.md` links
> here, so this file rides in as project instructions. If you are wiring Hermes in a context that
> does NOT load `AGENTS.md`, the `council_refine_spec` / `create_swarm_card` / `propose_swarm_card`
> tool descriptions alone already encode this protocol — this document is the long form, not the
> only source of truth.

## Why a spec gate exists

A Swarm worker builds autonomously in an isolated worktree from the card body. If the card body is
vague, the worker guesses — and you find out only after it has burned quota building the wrong
thing. The council's **spec gate** (`council_refine_spec`) is the cheap check that runs first: five
seats across three vendors judge whether a draft spec is actually buildable, then a chairman either
APPROVES it (and hands back a tightened "Refined Spec") or returns the exact questions that must be
answered before anyone should start.

Gate non-trivial work. Skip the gate for trivial or fully deterministic tasks (a one-line copy fix,
a rename, a version bump) — there `councilSessionId` is optional and the ceremony is pure overhead.

## The interview — four rules

Before you draft anything, interview the user. Four rules, no exceptions:

1. **Only build-changing questions.** Ask a question ONLY when a different answer would produce a
   different build — scope, done-criteria, behavior, edge cases. Never ask about things you can read
   yourself (git state, recent memory, which project is open). If the answer wouldn't change the
   card, don't ask it.
2. **One batched message.** Put every question in a SINGLE message. Do not drip them one at a time —
   that turns a 30-second clarification into a ten-message ordeal.
3. **Defaults attached.** Attach your default assumption to each question, so a bare "ok" is a
   complete answer. Example: *"Should this cover both light and dark themes? (default: yes, both.)"*
4. **Skip when trivial.** If the task is deterministic and unambiguous, skip the interview entirely
   and go straight to the card.

Aim for 2–4 questions. If you have more than four genuinely build-changing questions, the request is
under-scoped — say so and narrow it with the user before drafting.

## The spec template

Draft the spec with these sections. Keep it tight; the council rewards a clear spec, not a long one.

```
**Goal** — one or two sentences: what this task delivers and why.
**Context** — the relevant current state (files, prior decisions, constraints you already know).
**Acceptance criteria** — the checklist that proves it's done. Concrete and verifiable.
**Out of scope** — what this task explicitly does NOT include, so the worker doesn't wander.
**Constraints** — perf, security, style, or architectural rules the build must respect.
```

## The council gate flow

1. **Draft** the spec from the interview answers, using the template above.
2. **Call `council_refine_spec`** with `{ projectId, spec, cardId? }`. It returns a COMPACT payload:
   `{ verdictKind, questions, refinedSpec, ranking, sessionId }` — never the full seat prose.
3. **Act on `verdictKind`:**
   - **`NEEDS_CLARIFICATION`** — relay `questions` to the user **verbatim** (batched, defaults
     attached where you can infer them). Fold their answers into the spec and **re-run the tool**.
     Loop until it approves.
   - **`APPROVED`** — use `refinedSpec` as the card body and keep `sessionId`; you'll pass it as
     `councilSessionId` when you open or propose the card. That's what ties the card to its meeting.
   - **`synthesis-failed`** — the council couldn't reach a decision (engines down, every seat
     failed). Don't loop on it. Say so plainly and proceed on your own judgement, or ask the user
     whether to build anyway.

## Post-approval flow

Two paths, and the line between them is hard (see `AGENTS.md` → "Two ways a card gets opened"):

- **The human asked you to build it** → `create_swarm_card` (body = `refinedSpec`,
  `councilSessionId` = the approved `sessionId`), then `update_swarm_card` if it needs a specific
  role pipeline, then `start_swarm_card`. You open and start it yourself.
- **You noticed it on your own** → `propose_swarm_card` (same `refinedSpec` body, same
  `councilSessionId`, plus a short `reason`). This records an approval request on the human's
  Dashboard. You do NOT open it — the app opens+starts the card **only if the human approves**, and
  it carries your `councilSessionId` through to that card automatically. Tell the human you've
  **proposed** it, not started it.

Once a card is running, watch it with `subscribe_card_output` (this card only, until `isDone`), then
verify before you report: `get_git_diff_stat`, the relevant `run_checks`, and a screenshot for
anything visual. The worker also reads a "council brief" derived from the approved session, so it
builds already knowing the meeting's conclusions — don't repeat them at it.

## The feedback loop

- **Completion reports.** After a card finishes, report in plain language (what changed, checks
  passed/failed, anything off), then `write_memory_summary` with what's durable — "precision over
  recall", not a status log.
- **Scorecard.** Each `council_refine_spec` run is persisted alongside the diff-mode runs, feeding
  the council scorecard (per-seat standings across sessions). You don't manage it — it accrues
  automatically from every gated spec, so gating consistently is also what keeps the council's own
  quality signal honest over time.
