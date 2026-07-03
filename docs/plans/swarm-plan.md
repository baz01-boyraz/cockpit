# Plan — Multi-agent Swarm + Kanban (VISION Phase 6)

> Status: ACTIVE · Created 2026-07-03 · VISION 6.1–6.6, Gate 6
> Progress: ALL DONE 2026-07-03 — 6.1…6.6 shipped, **Gate 6 PASSED** (2 parallel real
> workers in worktrees, kill mid-run, orphan rescue → resume in same worktree, real
> worktree Diff Review, done, dirty-remove refused). Deviations from this plan, recorded:
> 6.4 resume = park-orphans + worktree-reuse (no claude --resume — worker commands carry
> no session id; relaunch-from-card is the path); worktree cleanup on removeCard only
> (done keeps it for review); queue = cap refusal message (no auto-queue); 6.5 custom
> user-authored personas parked for Phase 7.
> Blueprint: design notes in `docs/BRIDGESPACE-ROADMAP.md` §4 (roles vs instances vs
> personas, two parallelism models, orchestrator question). Read those first.

## Goal

A Kanban board drives real agent execution: pick a card → an orchestrator service
spawns a `claude` worker into its own terminal (worktree-isolated when parallel) →
status streams onto the card → human reviews with Diff Review → card completes.
The loop survives an app restart mid-run. **This is the 10x product moment.**

## Non-goals (this phase)

- No autonomous card creation without a human in the loop (planner *proposes*, user confirms).
- No hidden agents: every instance is a visible terminal session; kill is always one click.
- No cross-machine/remote workers; no account switching automation (usage *awareness* only).
- No new mutation powers for agents: workers inherit the same boundary as any terminal —
  destructive ops still route through the approval gate ([[security-enforcement]]).

## Decisions (settle now, cheap to hold)

- **D1 — Hybrid orchestrator (confirmed in VISION).** A TS `SwarmService` in main owns
  board state, lifecycle, worktrees, resume, usage checks. A planner-Claude is invoked
  as a *worker* (via the injectable-runner pattern from `ReviewService`) only for task
  decomposition. Kanban state and crash-resume cannot durably live in a chat session.
- **D2 — Cards, not boards.** One implicit board per project: a single `kanban_cards`
  table keyed by `project_id`. A `boards` table would be a join with one row per
  project — add it only if multi-board demand ever materializes.
- **D3 — Claim `agent_sessions`? No — drop it.** The V1-reserved `agent_sessions` table
  is written by nothing; the card row itself carries `terminal_session_id`. Keeping two
  registries of the same fact violates the single-rule principle. V5 drops it
  (verify zero references at build time first).
- **D4 — Worktrees live in `<project>/.cockpit-worktrees/<card-slug>/`,** created and
  removed by SwarmService (never by the renderer), ignored via `.git/info/exclude`
  (no repo mutation). Branch naming: `swarm/<card-slug>`. Parallelism model **A**
  (N cards × N isolated tasks); model B (roles collaborating on one card) arrives via
  the reviewer-council in 6.5, wired to [[diff-review]]'s runner.
- **D5 — Kernel in shared/.** Card state machine, transition rules, board assembly:
  `shared/kanban.ts`, TDD-first, consumed by BOTH SwarmService and the mock
  (the [[ipc-contract]] single-rule principle). The mock ships a fully working board.
- **D6 — Concurrency cap 3**, configurable 1–4 to start. The 3.4 event pipeline is the
  pressure-tested substrate; raise the ceiling only after Gate 6 passes at 4.
- **D7 — Statuses:** `todo → in_progress → in_review → done`, plus `parked` (usage
  limit / user pause). Only SwarmService moves a card into/out of `in_progress`
  (spawn/exit are facts it owns); the user moves everything else.

## Storage map (V5 migration)

```
kanban_cards
  id TEXT PK                      -- newId('card')
  project_id TEXT FK→projects ON DELETE CASCADE
  title TEXT NOT NULL
  body TEXT NOT NULL DEFAULT ''   -- task description handed to the worker
  status TEXT NOT NULL            -- D7 values
  position REAL NOT NULL          -- ordering within a column
  role TEXT                       -- 6.5: builder/reviewer/scout/planner
  persona TEXT                    -- 6.5: persona slug or NULL
  terminal_session_id TEXT FK→terminal_sessions ON DELETE SET NULL
  worktree_path TEXT              -- NULL = runs in project root
  branch TEXT                     -- swarm/<card-slug>
  created_at TEXT NOT NULL
  updated_at TEXT NOT NULL
+ DROP TABLE agent_sessions (D3)
+ idx_kanban_cards_project
```

Resume substrate already exists (Phase 3.3): `terminal_sessions.command` +
`reconciled_at`, `resumeClaudeSchema` UUID pattern, `TerminalManager.resumeClaude()`.

## Tasks

### 6.1 Kanban model + board UI (no execution) — M
1. `shared/kanban.ts` kernel, TDD: status union, `canMove(from,to,actor)` rules (D7),
   `assembleBoard(cards)` (columns, ordering), position math (midpoint insert, renorm).
2. V5 migration (above). FakeDb tests for the service layer.
3. `SwarmService` CRUD: `list/create/update/move/archive` — thin over the kernel.
4. IPC namespace `swarm.*` on all four legs (IPC const + CockpitApi + IpcResultMap +
   registerIpc handlers + mock). Zod schemas in `shared/schemas.ts`. All writes are
   non-destructive; no `guarded()` needed until a future delete-worktree-with-changes.
5. `swarmSlice` + `View 'swarm'` + LeftRail item + `SwarmPanel` (columns, drag/move,
   card editor). Mock board seeded in `mockData.ts`. Screenshot rounds ×2.

### 6.2 Single agent from a card — L
1. `SwarmService.startCard(cardId)`: builds the worker command — project path, card
   title+body, memory-hub pointers (**5.6 lands here**: read-only `list/read` of
   `.cockpit-memory/` injected as context, never `.env`, redaction untouched).
2. Spawn via existing `TerminalManager.create({ command })` (`launchAgent` pattern);
   link session↔card; card → `in_progress`.
3. Status streaming: subscribe to `terminal:exit` → card falls back to `in_review`
   (exit 0) or flagged (non-zero). Live "running" indicator from session status.
4. Review tools are Phase 4's: per-card "Review diff" button reuses `review.run`
   (worktree cwd) — findings render with the existing `ReviewFindings`.
5. Gate check: one real card, real `claude`, real diff, human moves to done.

### 6.3 Parallel swarm — L
1. Worktree lifecycle in SwarmService (D4): `git worktree add/remove` via simple-git
   `raw()`; branch create; `.git/info/exclude` entry; cleanup on archive/done
   (worktree with uncommitted changes → refuse + surface, never force-delete).
2. Concurrency cap (D6) enforced at `startCard`; queue state visible on the card.
3. Kill/park controls per card (kill = `terminals.kill`, park = D7 status).
4. Validate the 3.4 coalescer under 3–4 live agents before calling it done.

### 6.4 Crash/quit resume — M
1. On boot, after reconciliation: cards `in_progress` whose session has
   `reconciled_at IS NOT NULL` → "resume?" offer (UI list, one click per card).
2. Resume = `TerminalManager.resumeClaude` when a claude session id is recoverable
   from `command`, else relaunch from the card body in the same worktree.
3. Gate rehearsal: kill the app mid-run, relaunch, resume, complete the card.

### 6.5 Roles & personas — M
1. `shared/agent-roles.ts`: definition = role + persona lens + model + tool notes,
   compiled defaults (builder / reviewer / scout / planner + 2–3 reviewer personas).
2. Card picks role/persona; startCard folds the system-prompt text into the command.
3. **Reviewer council** (parallelism model B, highest payoff): N reviewer personas ×
   same diff through `ReviewService.runText`/`run` → merged findings panel.
4. User-authorable custom personas: parked unless time permits (`.claude/agents` model).

### 6.6 Usage-limit awareness — S–M
1. Board header shows `AgentUsageService.getReport()` windows (hook exists).
2. `startCard` warns ≥80% used; blocks + parks new spawns at 100% (existing cards
   keep running; parking is graceful, never a kill).

## Gate 6

A real multi-card day-loop on this repo: plan → cards → ≥2 parallel agents in
worktrees → Diff Review on each → done — **surviving one deliberate app restart
mid-run.** Dogfood on cockpiT itself; write what breaks into [[swarm-design]].

## Test plan

- Kernel: `test/kanban.test.ts` (transitions, ordering, assembly — TDD RED first).
- Service: FakeDb CRUD + startCard state changes with a stubbed TerminalManager +
  injectable runner for the planner path.
- Contract: the four-leg wiring is enforced by `IPC_RESULT_MAP_COMPLETE` +
  `test/ipc-contract.test.ts` automatically.
- Worktree ops: integration-tested against a scratch git repo (pattern from the
  Phase 1 E2E: temp dir + local origin), never against this repo.

## Risks

- **pty pressure at N=4**: coalescer validated at 1 real session; watch CPU/mem (6.3.4).
- **Worker context bloat**: card body + hub pointers must stay small; hub notes are
  pointers, not inlined dumps (budget like [[diff-review]]'s sanitizer).
- **Worktree cleanup edge cases**: dirty worktrees, deleted branches — always refuse
  and surface rather than force-delete (delete_file approval rule spirit).
- **Sonnet prose-degrade** (Phase 4 watch item) now matters more: workers run long;
  status inference must not depend on parsing model output — exit codes + git state only.
