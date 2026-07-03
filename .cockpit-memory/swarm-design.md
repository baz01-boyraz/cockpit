# Swarm Design

Phase 6. The deliberately-unresolved link from [[memory-hub]] finally resolves —
fitting, because the hub's first real consumer lives here (5.6: workers get
read-only hub context at spawn).

Architecture is **hybrid** (decided in VISION, held in `docs/plans/swarm-plan.md`):
a TS `SwarmService` in main is the conductor — board state, lifecycle, worktrees,
crash-resume, usage checks. Claude is always a *worker*, never self-driving; the
planner is invoked through the same injectable-runner seam [[diff-review]] built.

Load-bearing choices:
- One implicit board per project — a single `kanban_cards` table (V5); the empty
  V1 `agent_sessions` table is dropped, the card row IS the instance registry.
- Only the service moves cards into/out of `in_progress` — spawn and exit are
  facts it owns. Humans own every other transition. Statuses include `parked`
  for graceful usage-limit stops.
- Parallel cards run in `<project>/.cockpit-worktrees/<slug>/` on `swarm/<slug>`
  branches, cap 3 to start; dirty worktrees are refused, never force-deleted
  (the [[security-enforcement]] delete-file spirit).
- Roles (builder/reviewer/scout/planner) × personas (lenses) are one authored
  system prompt; the reviewer-council — N personas, same diff — reuses the
  Phase 4 runner and is the highest-payoff pattern.
- Worker status derives from exit codes + git state, never from parsing model
  prose (the Phase 4 prose-degrade lesson).

Resume rests on Phase 3.3 substrate: `terminal_sessions.command` +
`reconciled_at` + the UUID-checked `claude --resume` path ([[ipc-contract]]
keeps all four bridge legs honest as the `swarm.*` namespace lands).
