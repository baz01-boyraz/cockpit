# Swarm Board — UX Clarity Roadmap

> Goal: make the swarm board legible without opening a terminal, and clear up the
> editor + review controls that confused first use. Built phase by phase; each
> phase is self-contained and ships green.

## Context (what was confusing)

1. **Two dropdowns (Role + domain)** in the pipeline editor read as one mandatory
   two-part choice. Role = *what the agent does*; Spec/domain = *which area*, and
   it's **optional**. The named-agent picker is a separate advanced override.
2. **"IN REVIEW"** was undefined in the UI — it means *the agent paused a turn and
   wants eyes*, not "finished + closed". The terminal stays open.
3. **No board-level visibility** — a running/finished card only showed a liveness
   heartbeat ("output 3s ago"); you had to open the terminal to see what happened.
4. **"Council"** was a 3-lens reviewer, NOT the installed Karpathy LLM-Council
   skill, despite the shared name.

## Phases

### Faz 1 — Board talks: in-review diff-stat badge ✅ decided
- New read-only IPC `review.diffStat(projectId, {dir})` → `{ files, insertions, deletions }`
  from the worktree (staged + unstaged + untracked), pure git, no LLM.
- Badge on **in_review** and resumable **parked** cards: `+N −M · K files`.
- Files: `shared/review.ts` (DiffStat type), `ReviewService.ts` (diffStat),
  `shared/ipc.ts`, `shared/schemas.ts`, `registerIpc.ts`, `preload`, `mock.ts`,
  `SwarmCard.tsx` (+ store), CSS.

### Faz 2 — Editor light touch ✅ decided (light)
- Spec option → `— domain (optional) —`, dimmed when empty.
- One-line legend: `Role = what it does · Domain = which area (optional)`.
- Clarify the named-agent override separation.
- Files: `SwarmCardEditor.tsx`, CSS.

### Faz 3 — "In review" means something
- Caption on in_review cards: *"Agent paused — review the diff or drag to Done."*
- Files: `SwarmCard.tsx`, CSS.

### Faz 4 — Real Karpathy LLM-Council ✅ decided (wire the real thing)
- Replace the 3-lens "Council" with the real method: **5 independent advisors**
  (Contrarian, First Principles, Expansionist, Outsider, Executor) over the card's
  sanitized worktree diff → **anonymous peer review** → **chairman verdict**.
- New IPC `council.run(projectId, {dir})` → structured `CouncilResult`.
- New `shared/council.ts` (advisor catalog + prompts + types, pure),
  new `CouncilService.ts` (orchestration, injectable runner),
  new `CouncilVerdict.tsx` (renders advisors + peer review + verdict).
- Wire: `shared/ipc.ts` (3 spots), `shared/schemas.ts`, `registerIpc.ts`,
  `preload`, `Services.ts`, `mock.ts`, `SwarmPanel.tsx`.
- Tests: `shared/council.ts` pure-logic unit test.

## Verify + ship

- `npm run typecheck && npm run lint && npm test && npm run build` green.
- Localhost screenshot review (≥2 rounds) of the board + council surface.
- Commit on `main`, **do not push** (batch release per project convention).
