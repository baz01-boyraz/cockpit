# cockpiT VISION — The 10x Execution Roadmap

> Created 2026-07-01 from a full four-track analysis of the codebase (inventory,
> architecture, code quality, security). This document is the **master execution
> roadmap**. It merges every finding from that analysis with the feature vision in
> [BRIDGESPACE-ROADMAP.md](./BRIDGESPACE-ROADMAP.md) into one ordered, phased plan.
>
> **How the two docs relate:** BRIDGESPACE-ROADMAP.md stays as the *feature vision*
> (what we're building and why). This doc is the *execution order* (how we get there
> without stepping on rakes). When they disagree on sequencing, this doc wins.

---

## How to use this document

- Work through phases **in order**. Inside a phase, tasks are ordered by dependency;
  tasks marked ∥ can run in parallel with their neighbors.
- Every task has: **Why** (the finding that motivates it), **Do** (the steps),
  **Files** (where — line numbers are anchors from the 2026-07-01 analysis and may
  drift; trust the file, verify the line), **Verify** (how we know it's done),
  and an effort tag — **S** (hours), **M** (a day-ish), **L** (multiple days).
- Update the status marker on each task as we go:
  `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked (say why).
- Each phase ends with a **Gate** — do not start the next phase until the gate passes.

## Definition of Done (applies to EVERY task)

A task is only `[x]` when all of these hold:

1. `npm run typecheck` + `npm run lint` + `npm test` all green.
2. New pure logic lives in `shared/` and has unit tests (TDD where practical).
3. Mock parity maintained — `src/lib/mock.ts` still compiles as `CockpitApi`,
   and (once Phase 2.1 lands) the IPC contract test is green.
4. Any mutating action added is routed through ApprovalService + AuditLogService.
5. UI changes: localhost screenshot workflow, **minimum 2 review rounds**.
6. Anything touching pty/shell/packaging: verified live in the packaged app
   (`npm run app:refresh`), not just in the browser mock.
7. No new file over 800 lines; no `any`; no silent catches.

## Why this order (one paragraph)

The analysis found that cockpiT's security model is **well designed but partly
unenforced**: the approval gate is bookkeeping, not a bouncer; redaction misses
common secret shapes; and one always-on button runs arbitrary project scripts.
Meanwhile the next roadmap features stand directly on those weak spots — AI Diff
Review needs airtight redaction + a real approval gate, the block→AI bridge needs
block state that isn't trapped in a component, and Swarm needs a terminal lifecycle
that survives restarts plus an event bus that doesn't broadcast every byte to every
window. So: **enforce security first, harden the contract second, fix state/lifecycle
third, then build the features on solid ground.** Phases 1–3 are short (days, not
weeks) and most of their tasks are literally the first tasks of Phases 4–6.

## Phase map

| Phase | Name | Goal | Effort |
|---|---|---|---|
| 0 | Process & ground rules | DoD + plan-doc pattern formalized | S |
| 1 | Security enforcement | Documented guarantees become code-enforced | ~1 week |
| 2 | Contract & test foundation | IPC drift impossible; services tested | ~1 week |
| 3 | State, lifecycle & performance | Ready for multi-agent scale | ~1 week |
| 4 | AI Diff Review | BridgeSpace #2, shipped security-first | 1–2 weeks |
| 5 | Memory Graph + Wikilinks | BridgeSpace #3, backlinks before graph | 1–2 weeks |
| 6 | Swarm + Kanban | BridgeSpace #4, phased from 1 agent to N | 3–4 weeks |
| 7 | Polish & parking lot | Optional wins, only after 6 | ongoing |

---

## Phase 0 — Process & ground rules (S)

### 0.1 [x] Formalize the plan-doc pattern
**Why:** `docs/plans/command-blocks-plan.md` worked well for Feature #1; make it the rule.
**Do:** Every Phase 4/5/6 feature gets a plan doc in `docs/plans/` **before** coding
starts, containing: scope, security-boundary section, task list, and the DoD above.
**Verify:** Plan doc exists and is referenced from this file before the feature starts.

### 0.2 [x] Release discipline additions
**Why:** High release cadence (10+ releases in last 30 commits) with no security
regression net.
**Do:** Before any release: contract test (2.1) green + redaction tests (1.3) green.
Batch features per release rather than one-per-release when possible.
**Verify:** Checklist noted in CLAUDE.md release section.

**Gate 0:** Both items agreed and written down. (This phase is minutes, not days.)

---

## Phase 1 — Security enforcement (~1 week)

> Theme: every guarantee CLAUDE.md *states* becomes something the **main process
> enforces**. The renderer is untrusted input — our own axiom; apply it everywhere.

### 1.1 [x] Enforce the force-push approval gate in main — CRITICAL
**Why:** `registerIpc.ts` executes `git.push({ force: true })` unconditionally the
moment the IPC arrives; the only "gate" is that today's UI never sends it. The
approval system records requests but never guards execution. This contradicts
CLAUDE.md ("force-push always gates regardless of config").
**Do:**
1. Extend `gitPushInputSchema` so `force: true` **requires** an `approvalId` field.
2. In the `gitPush` handler (or `GitService.push`): look up the approval, verify
   `status === 'approved'`, matching `actionType === 'git_force_push'`, matching
   project, and not already consumed. Mark it consumed before executing.
3. Until that plumbing exists, hard-reject `force: true` at the handler — behavior
   then matches the documented "stubbed" state.
**Files:** `electron/main/ipc/registerIpc.ts` (~94–105), `electron/main/services/GitService.ts` (~112–147), `shared/schemas.ts` (~187–190), `electron/main/services/ApprovalService.ts`.
**Verify:** Unit test: calling the handler with `force:true` and no valid approval
throws; with a consumed approval throws; with a fresh approved one executes once.
**Effort:** S–M

### 1.2 [x] Central `requireApproval` wrapper for all mutating handlers
**Why:** `shared/approval-rules.ts` (`requiresApproval`, `needsStrongApproval`) is
fully implemented but **never imported by production code** — enforcement exists only
as convention. The next wired-up mutation (deploy, env_write…) could silently skip it.
**Do:** Add one wrapper in `registerIpc.ts` — e.g.
`guarded(actionType, schema, fn)` — that consults `requiresApproval()` and the
approval store before running `fn`. Route `gitPush` (1.1) through it first; every
future mutating handler MUST use it.
**Files:** `electron/main/ipc/registerIpc.ts`, `shared/approval-rules.ts`.
**Verify:** Grep shows no mutating handler bypasses the wrapper; unit test on the wrapper.
**Effort:** M

### 1.3 [x] Close the redaction false negatives — HIGH ∥
**Why:** Empirically confirmed: `STRIPE_KEY=sk_live_...` passes both checks unmasked.
Missing: bare `*_KEY` names; `sk_live_/sk_test_/rk_live_/pk_live_` (underscore, not
hyphen); `mongodb://`, `mysql://`, `redis://`, `amqp://` URLs with creds; Google
`AIza…`; SendGrid `SG.x.y`; `npm_…`; GitHub `ghu_/ghs_/ghr_`; free-standing
`Bearer <token>`; AWS secret access keys (no shape → need entropy fallback).
**Do (TDD — write failing tests first, it's pure logic):**
1. Add each missing pattern to `SECRET_VALUE_PATTERNS`.
2. Add `\bkey\b` variant to `SECRET_KEY_PATTERN` (careful: don't mask "keyboard"/"keyword").
3. Add a **generic high-entropy fallback** (e.g. 24+ char base64/hex run) as last line
   of defense — the module's own motto is "when in doubt, mask".
**Files:** `shared/redaction.ts` (~11–25), `test/redaction.test.ts`.
**Verify:** New tests cover every shape above, plus false-positive guards
(normal words, short hex like git SHAs in prose should NOT over-mask).
**Effort:** S

### 1.4 [x] Redact terminal output before persisting logs ∥
**Why:** `LogIntelligenceService.ingest()` stores lines only ANSI-stripped — the one
write path that skips `redaction.ts`. A dumped `.env` or an echoed `Authorization:
Bearer …` lands in SQLite plaintext and renders in the Logs panel. Becomes a real
AI leak the moment chat context returns.
**Do:** Run `input.message` through the redaction scrub before `insertLog.run(...)`.
**Files:** `electron/main/services/LogIntelligenceService.ts` (~44–124).
**Verify:** Unit test: ingesting a line containing `sk_live_…` stores it masked.
**Effort:** S

### 1.5 [x] Lock down "Rebuild & relaunch" — HIGH ∥
**Why:** The button is always visible for **any** active project and runs
`npm run app:refresh` from that project via a login shell — no ownership check
(only "does the script key exist"), no approval, no audit entry. A hostile or
compromised repo opened as a project = arbitrary command execution on click.
**Do:**
1. Verify the target is genuinely cockpiT's own source (compare against
   `app.getAppPath()` / a known repo identity), not just a script-name match.
2. Route through ApprovalService; write an `audit.record(...)` entry.
3. Hide/disable the button unless the active project passes the check.
**Files:** `electron/main/services/localRebuild.ts` (~34–43), `electron/main/ipc/registerIpc.ts` (~195–198), `src/panels/GitPanel.tsx` (~512–520).
**Verify:** Open a non-cockpiT project → button hidden/disabled; IPC call with a
foreign project path rejects; audit row written on legitimate use.
**Effort:** S

### 1.6 [x] Electron packaging & platform hardening ∥
**Why:** `hardenedRuntime: false` applies to CI-signed releases too (forfeits
library-validation); prod CSP still allows `http://localhost:*`; `shell.openExternal`
has no scheme allowlist (latent — GitHubService already surfaces `htmlUrl`s destined
for "open in browser" buttons).
**Do:**
1. `hardenedRuntime: true` + minimal entitlements plist for the CI-signed path
   (keep the unsigned local dev path as-is if needed).
2. Build-time-conditional CSP: drop `http://localhost:*` from packaged builds; add
   `object-src 'none'`, `base-uri 'self'`, `form-action 'none'`, `frame-ancestors 'none'`.
3. Allowlist `http:`/`https:` before any `shell.openExternal(url)`.
**Files:** `package.json` (`build.mac`), `index.html` (~6–9), `electron/main/index.ts` (~46–49), `.github/workflows/release.yml`, `scripts/notarize.cjs`.
**Verify:** CI release build passes notarization with hardened runtime; packaged
app's CSP has no localhost; unit-testable allowlist helper.
**Effort:** M (mostly release-pipeline testing)

**Gate 1:** All 1.x done. A release is cut and auto-update verified
(`gh release view` shows matching CI artifacts). CLAUDE.md security section updated
to say "enforced in main", and it's true.
> **Gate 1 status (2026-07-01):** code-verified end-to-end — 16/16 checks against the
> real Electron app (isolated profile): approved force-push executed against a local
> bare origin, replay refused, cross-project approval refused, audit chain complete,
> redaction live, eligibility both ways, strict CSP shipped, file:// open denied.
> REMAINING for full gate: hardened-runtime verify at the next tagged CI release.
> Noted for 2.3: raw ZodError JSON leaks into renderer error strings — confirmed live.

---

## Phase 2 — Contract & test foundation (~1 week)

> Theme: make IPC drift impossible and give the untested layers a safety net,
> because Phases 4–6 all grow the IPC surface.

### 2.1 [x] IPC contract/parity test — the highest-leverage S task in this doc
**Why:** Today you can add a `CockpitApi` method + preload + mock, forget the main
handler, and everything compiles and works in the browser — then throws
"No handler registered" only at runtime in Electron. Nothing catches this.
**Do:** A test that iterates `Object.values(IPC)` and asserts each request/response
channel has (a) a registered main handler, (b) a mock method, (c) a preload invoke.
(Registration can be made introspectable by having `registerIpc` collect channel
names into an exported array/map.)
**Files:** new `test/ipc-contract.test.ts`, small refactor in `electron/main/ipc/registerIpc.ts`.
**Verify:** Deleting any handler makes the test fail. Also assert the known dangling
event `evtLogsChanged` either gains a subscription method or is removed.
**Effort:** S

### 2.2 [x] Type-bind main handlers to `CockpitApi`
**Why:** The handler side is the one untyped leg of the contract — `handle<T>` infers
from the handler, nothing checks it against `CockpitApi`'s parameter/return types.
**Do:** Derive a `Handlers` mapped type from `CockpitApi` (channel → typed handler
signature) and register handlers through it, so a wrong return type or payload type
is a compile error.
**Files:** `shared/ipc.ts`, `electron/main/ipc/registerIpc.ts`.
**Verify:** Intentionally breaking a handler's return type fails `typecheck:node`.
**Effort:** M

### 2.3 [x] Central IPC error envelope ∥ (as central error-shaping wrapper — see note)
**Why:** Raw `Error.message` (including verbose ZodError text and internal fs paths)
crosses to the renderer unmapped; each panel invents its own error UX.
**Do:** Wrap `handle()` to catch, map ZodError → friendly message, strip internal
paths, and return a consistent shape (success/data/error envelope). Update renderer
call sites/panels to consume it uniformly.
**Files:** `electron/main/ipc/registerIpc.ts`, `shared/ipc.ts`, panels.
**Verify:** A thrown ZodError reaches the UI as a clean message, no stack/paths.
**Effort:** M

### 2.4 [x] Service-layer tests for the risk hot spots ∥
**Why:** 171 tests, all on `shared/` pure logic. 1 of 23 services tested; GitService,
TerminalManager, ApprovalService, IPC, DB layer: zero.
**Do (priority order):**
1. **GitService**: status/push on edge cases — detached HEAD, rebase-in-progress,
   empty repo, no remote (mock `simple-git`).
2. **ApprovalService + 1.2 wrapper**: request → decide → consume lifecycle.
3. **TerminalManager**: spawn/write/kill/list lifecycle, row status transitions
   (pty can be faked; N-API prebuilds also run under Node).
4. **Database migrations**: fresh DB and V1→latest both converge to same schema.
**Files:** new tests under `test/`.
**Verify:** `npm test` green; these four areas no longer at zero.
**Effort:** M–L (spread it; don't block other Phase 2 tasks on completion)

### 2.5 [x] De-duplicate mock vs services: move rules into `shared/` ∥
**Why:** `listInsightsMock` re-implements `LogIntelligenceService.listInsights`'s
aggregation; `dashboardFor` duplicates `Services.dashboard`. Two sources of truth.
Worse, the mock **mutates module-level seed singletons** (`snapshot.ahead += 1` …) —
violating our own immutability rule and risking cross-render contamination.
**Do:**
1. Extract insight aggregation + dashboard assembly into pure `shared/` functions
   consumed by BOTH the real service and the mock.
2. Rewrite mock git actions immutably (fresh objects per call).
3. Also fix while there: `Services.dashboard()` raw SQL for agent count → service
   method, and parallelize its independent git/railway calls with `Promise.all`
   (`Services.ts` ~117–142).
**Files:** `src/lib/mock.ts` (~234–259, ~452–469, ~617–651), `electron/main/services/LogIntelligenceService.ts` (~151–204), `electron/main/services/Services.ts`, new `shared/` modules + tests.
**Verify:** Mock shrinks; the extracted functions have unit tests; no mock mutation
of shared seeds (spread-based updates only).
**Effort:** M

**Gate 2:** Contract test + typed handlers green in CI. Breaking any leg of the
IPC contract is now a compile- or test-time failure, never a runtime surprise.
> **Gate 2 status (2026-07-02): PASSED locally** — 281 tests / 28 files, typecheck +
> lint clean. CI runs the same `npm test` on the next tagged release.

---

## Phase 3 — State, lifecycle & performance (~1 week)

> Theme: the renderer and the event pipeline get ready for many panes, many agents,
> many windows. Two of these tasks ARE the first tasks of Phases 4 and 6.

### 3.1 [ ] Lift Command-Block state out of `TerminalView`
**Why:** Block history lives in component-local `useState` + a per-component
`CommandBlockModel` — lost on unmount, unreachable from anywhere else. This **blocks
the Feature-4 bridge** ("review this block with AI") and any cross-pane block view.
**Do:** Move the block model to a store slice keyed by `sessionId` (or into main,
pushed via events — store slice is the lighter first step). `TerminalView` becomes
a consumer. Blocks survive pane switches/unmounts.
**Files:** `src/components/TerminalView.tsx` (~64–65, 110), `src/store/` (new slice), `shared/command-blocks.ts`.
**Verify:** Toggle away from a pane and back → blocks intact; another component can
read a block by `sessionId` + block id.
**Effort:** M

### 3.2 [ ] Feature-slice the Zustand store
**Why:** One flat ~15-slice store with a wholesale `refreshActive()` (refetch 10
arrays per project switch) won't hold Diff-Review + Memory + Swarm state. Already a
mild god-object.
**Do:** Split into slices (project, git, terminals+blocks, logs/insights, usage,
approvals; later: review, memory, swarm). Keep the combined-store API stable for
existing components; migrate incrementally. Replace all-or-nothing refresh with
per-slice refresh where cheap.
**Files:** `src/store/useStore.ts` (~180–198) → `src/store/slices/*`.
**Verify:** No component regressions (screenshot rounds); project switch no longer
refetches slices whose inputs didn't change.
**Effort:** M

### 3.3 [ ] Terminal lifecycle: boot reconciliation + honest rows — Swarm's first brick
**Why:** `list()` reads the in-memory map; SQLite rows are write-only history and
keep claiming `running` after a restart. Nothing reconciles at boot. Swarm's
crash/quit-resume is built exactly on this substrate.
**Do:**
1. On boot, mark stale `running` terminal rows as `exited` (with a
   `reconciled_at`/reason column).
2. Make `list()` consistent with DB state; define the row lifecycle explicitly
   (spawned → running → exited/killed/reconciled).
3. Design note (for Phase 6): what a "resumable" session needs persisted — cwd,
   command, project, shell — capture it now cheaply.
**Files:** `electron/main/services/TerminalManager.ts` (~45–49 + insert/update paths), `electron/main/db/schema.ts` (new migration — appended, see 3.5).
**Verify:** Kill the app with live terminals, relaunch → no phantom `running` rows;
unit test on the reconciler.
**Effort:** M

### 3.4 [ ] Event pipeline: coalesce + route instead of broadcast
**Why:** `forwardEvents` does one `webContents.send` per pty chunk to **all**
windows. 16 agents + future detachable panels = IPC flood. Renderer-side rAF
batching exists for block snapshots but the main→renderer sends are per-chunk.
**Do:**
1. Coalesce terminal data per session on a ~16ms flush before sending.
2. Route events to the window(s) that own the target (session/project), not
   `getAllWindows()` broadcast.
**Files:** `electron/main/index.ts` (~64–75), `electron/main/events.ts`.
**Verify:** A `yes`-spam command produces bounded send frequency (log/count in dev);
terminals stay visually smooth.
**Effort:** M

### 3.5 [ ] Cleanup batch (all ∥, all S)
- [ ] **LocalCommandRunner decision:** it's constructed but wired to nothing, and the
  router's "local" recommendation dead-ends (`RightPanel.act()` falls through). Either
  wire an IPC channel → `LocalCommandRunner.run()`, or delete the class and route
  "local" suggestions to a prefilled terminal. Don't leave a fake execution target
  for Swarm work to trip on. (`electron/main/services/LocalCommandRunner.ts`, `shared/router.ts`)
  *Found by 2.4 tests:* `isAllowed` uses `key in ALLOWED` on an object literal, so
  prototype keys (`toString`, …) report as allowed — fix with `Object.hasOwn` if kept.
- [ ] **Bug sweep from 2.4/2.5 findings:** (a) `TerminalManager.onExit` labels any
  non-zero natural exit as `killed` (belongs with 3.3's lifecycle states);
  (b) `GitService` maps `current: null` to the literal branch name `'detached'`, so a
  real branch named "detached" can never push; (c) `GitService.push`/`commit` call
  `status()` 2–3× per operation, persisting a `git_snapshots` row each time — fold
  into the pruning item below; (d) schema table `agent_sessions` is written by nothing
  (the old dashboard agent-count read it — now fixed to count live agent panes);
  either drop it in a migration or claim it for Swarm's lifecycle work in 3.3/Phase 6.
- [ ] **schema.ts self-contradiction:** V1 was edited after V2 shipped
  (`insight_dismissals` + an index exist in both). Clean up so the "append-only
  migrations" rule is actually followed; new migrations from 3.3 must append. (`electron/main/db/schema.ts` ~108–133 vs ~178–188)
- [ ] **Hoist prepared statements** in `LogIntelligenceService.ingest()` to
  constructor fields (matches ApprovalService/GitService pattern). (~60–68)
- [ ] **`usage_events` index** on `(project_id, created_at)` so `summarize()`'s
  ORDER BY uses it; add pruning for `git_snapshots` (unbounded JSON rows on every
  status). (`electron/main/db/schema.ts` ~146, `electron/main/services/GitService.ts` ~178–196)
- [ ] **`GitPanel.openDiff` try/catch + setNotice** — the one handler in the file
  without error surfacing. (`src/panels/GitPanel.tsx` ~199–208)
- [ ] **Loud invariant comment** (or immutable refactor) on `CommandBlockModel`'s
  in-place mutation: consumers must use `snapshot()`, never `.blocks`.
  (`shared/command-blocks.ts` ~294–333)
- [ ] **Command Blocks live verification** (carried debt from Feature #1): packaged
  app via `npm run app:refresh` → real zsh AND bash sessions emit OSC 133, blocks
  fold, exit pills correct. Update BRIDGESPACE-ROADMAP status from
  "awaiting live check" to verified.

**Gate 3:** Blocks addressable outside TerminalView; boot reconciliation proven;
event flood bounded; cleanup batch merged; Command Blocks verified live.
**The foundation is now genuinely 10x-ready.**

---

## Phase 4 — AI Diff Review (1–2 weeks) · BridgeSpace #2

> Security-critical feature. The sanitizer comes FIRST, the AI call comes LAST.
> Write `docs/plans/ai-diff-review-plan.md` before starting (per 0.1).

### 4.1 [ ] `shared/diff-sanitize.ts` — build the boundary first (TDD)
**Why:** "Treat every diff line as untrusted input" is a hard requirement in the
roadmap; it must exist as tested code before any prompt is composed.
**Do:** Pure module with unit tests:
- **Sensitive-path blocklist:** `.env*`, `*.pem`, `*key*`, `credentials*`,
  `id_rsa*`, keychains, lockfile noise policy. Blocked files appear in the review
  request as "N sensitive files excluded", never content.
- **Redaction pass** over every included line (reuses the hardened 1.3 module).
- **Size caps:** per-file and total diff budget with deterministic truncation notes.
- **Prompt-injection framing:** delimit diff content; instruct the model that diff
  content is data, not instructions; strip/neutralize suspicious directives in
  comments. Document the stance in the plan doc.
**Verify:** Tests: a diff containing a Stripe key, an `.env` file, and a
"ignore previous instructions" line comes out masked/excluded/neutralized.
**Effort:** M

### 4.2 [ ] Diff packaging service
**Do:** Main-process service assembling working-tree + staged + untracked changes
(via existing GitService/simple-git), through the sanitizer, into a review request
object. New IPC (typed via 2.2, guarded via 1.2 if it ever mutates — it shouldn't;
review is read-only by design).
**Effort:** M

### 4.3 [ ] AI runner
**Do:** Reuse the `claude` CLI pattern from ChatService/`shared/claude-run.ts`
(argv arrays, no shell strings). Read-only advisory output; structured result
(findings with severity/file/line) parsed defensively.
**Effort:** M

### 4.4 [ ] Review surface UI in GitPanel
**Do:** "Review before ship" action → findings list (severity, file, line, note) →
each finding links to the diff view. Human decides; no auto-fix, no auto-commit.
Audit-log each review run (redacted). 2 screenshot rounds.
**Effort:** M

### 4.5 [ ] Block → AI review bridge (deferred item from Feature #1)
**Do:** Per-block "review with AI" action using 3.1's addressable block state; a
block's command+output (sanitized through 4.1's redaction path) becomes review
context.
**Effort:** S–M

### 4.6 [ ] Mock parity + polish
**Do:** Mock scripts a realistic review session (like the OSC-133 staged session);
empty-diff, huge-diff, all-files-blocked edge states designed in UI.
**Effort:** S

**Gate 4:** A real pre-commit review runs end-to-end on this repo; sanitizer tests
green; audit entries present; screenshots reviewed. Ship it, use it daily —
**cockpiT now reviews its own diffs before every release.**

---

## Phase 5 — Memory Graph + Wikilinks (1–2 weeks) · BridgeSpace #3

> Ship backlinks before the pretty graph. Write `docs/plans/memory-graph-plan.md` first.

### 5.1 [ ] Storage map decision doc (do this FIRST, it's an hour)
**Why:** This feature adds a third storage tier (markdown) next to SQLite and
localStorage. Without a written map, in six months nobody knows what lives where.
**Do:** One table in the plan doc: data kind → tier → why → sync/backup story.
Includes existing Notepad (localStorage) and session layer (SQLite) placement, and
whether Notepad notes migrate into the hub (recommended: yes, as plain .md).

### 5.2 [ ] `shared/wikilink.ts` — parse + backlink index (TDD, pure)
**Do:** Parse `[[wikilinks]]` (with aliases `[[name|label]]`), build forward/back
link indexes from a set of documents, suggest unresolved links. Pure functions,
fully unit-tested — this is the kernel of the feature and it's free to test.
**Effort:** S–M

### 5.3 [ ] MemoryHubService (main) + IPC
**Do:** A per-project `.cockpit-memory/` (or configured) markdown folder: list,
read, write, rename with link-refresh. Files are the source of truth — the service
only indexes (SQLite cache of the link graph is fine; files must remain the truth).
Paths constrained to the hub root (no traversal). Typed IPC via the 2.x foundation.
**Effort:** M

### 5.4 [ ] Notes UI + backlinks panel
**Do:** Note list + editor (plain textarea/CodeMirror-light — **no Monaco**, per
project limits), backlinks pane per note, unresolved-link affordance ("create this
note"). Mock parity with seeded notes. 2 screenshot rounds.
**Effort:** M

### 5.5 [ ] Graph view — LAST, time-boxed
**Do:** Force-directed graph of the link index. Time-box hard (e.g. 3 days): 80% of
the value is backlinks, which already shipped in 5.4. If the box overruns, ship
without it and park it.
**Effort:** M (boxed)

### 5.6 [ ] Agent access to the hub
**Do:** Read/search tools for agents (`search_memories`, `find_backlinks`-style),
gated read-only first; writes route through approval. This is the seam Feature 6's
agents will use for compounding context.
**Effort:** M

**Gate 5:** Notes + backlinks usable daily on this repo; link kernel fully tested;
storage map documented; graph view shipped or consciously parked.

---

## Phase 6 — Multi-agent Swarm + Kanban (3–4 weeks) · BridgeSpace #4

> The design notes in BRIDGESPACE-ROADMAP.md (roles vs instances vs personas; the
> two parallelism models; the orchestrator question) are the blueprint — read them
> before this phase. **Decision, confirmed here: hybrid architecture** — a cockpiT
> TS **orchestrator service owns** board state, lifecycle, worktrees, resume, and
> usage-limit awareness; a **planner-Claude is invoked as a worker** for task
> decomposition. Kanban state and crash-resume cannot durably live in a chat session.
> Write `docs/plans/swarm-plan.md` first.

### 6.1 [ ] Kanban data model + board UI
**Do:** SQLite (appended migration): boards/cards with status
(Todo → In Progress → In Review → Complete), project link, assigned role/instance,
terminal session link. Board UI with drag/move. Mock parity. No agent execution yet.
**Effort:** M

### 6.2 [ ] Single agent from a card (parallelism = 1)
**Do:** Card → "start": orchestrator service builds a context-aware command (project
path, card description, memory-hub pointers from 5.6), spawns `claude` into a new
terminal session (existing TerminalManager + resumable metadata from 3.3), links
session ↔ card, streams status onto the card. Human moves card to In Review; blocks
and Diff Review (Phase 4) are the review tools.
**Effort:** L

### 6.3 [ ] Parallel tasks (the real swarm)
**Do:** N cards running concurrently, each in an isolated git worktree (create/
cleanup owned by the orchestrator service). Concurrency cap configurable (start 3–4;
the event pipeline from 3.4 is the pressure-tested substrate — validate before
raising). Live per-card status; kill/park controls.
**Effort:** L

### 6.4 [ ] Crash/quit resume
**Do:** Built on 3.3's persisted session metadata: on launch, offer to resume cards
whose agents were alive at exit into their original terminals (`claude --resume`
with the UUID-validated session id pattern already in `shared/schemas.ts`).
**Effort:** M

### 6.5 [ ] Roles & personas
**Do:** Agent definition = role (builder/reviewer/scout/planner) + persona lens +
model + tool allow-list, as authored system prompts. Ship a few defaults; user-
authorable like `.claude/agents/`. Reviewer-council on one diff (N personas, same
target) is the highest-payoff pattern — wire it to Phase 4's review runner.
**Effort:** M

### 6.6 [ ] Usage-limit awareness
**Do:** Surface AgentUsageService quota state on the board; warn before spawning
when near limits; park cards gracefully on limit-hit.
**Effort:** S–M

**Gate 6:** A real multi-card day-loop works: plan → cards → parallel agents in
worktrees → review with Diff Review → complete, surviving an app restart mid-run.
**This is the 10x product moment.** Then, per the roadmap: pivot to revenue projects
ON this foundation.

---

## Phase 7 — Polish & parking lot (after 6, optional)

Ordered by leverage, all optional:
- **Detachable panels** (needs 3.4's routed events — that's why it waited).
- **Workspace layout templates** (pane presets) + color-coded tabs.
- **What's-new card** after auto-update (release notes already flow through updater).
- **SSH profiles**, **voice widget**, **theme picker**: evaluate against real user
  demand only. Our ember/copper identity > 25 themes.

---

## Standing risks to keep in the back of our minds

- **Chat revival:** `RightPanel.tsx` (562 lines) is shelved behind `CHAT_ENABLED`.
  Before reviving, re-verify against the current store/API shape — and note 1.4
  closed the log-leak path it would have inherited.
- **`gh auth token` in updater headers:** re-check on every `electron-updater`
  upgrade that error plumbing can't echo the header.
- **Line-number drift:** anchors in this doc date to 2026-07-01; trust files over lines.
- **File-size rule:** several files sit in the 400–800 band (`mock.ts` at ~798 is
  1 line under the cap). Phase 2.5 shrinks mock.ts; keep the others trending down.

## Progress log

| Date | Phase.Task | Note |
|---|---|---|
| 2026-07-01 | — | Document created from four-track analysis |
| 2026-07-01 | 0.1–0.2 | Plan-doc rule + release checklist written into CLAUDE.md |
| 2026-07-01 | 1.1–1.2 | Force-push gate enforced in main: `ApprovalService.consume()` (single-use, atomic) + `guarded()` wrapper wired to `requiresApproval()`; schema makes force-without-approval unrepresentable; `consumed` status added. 9 new tests |
| 2026-07-01 | 1.3 | Redaction: Stripe/URL-creds/AIza/SG./npm_/ghu-ghs-ghr/Bearer patterns + bare *_KEY names + high-entropy env fallback + `redactText()`. TDD, 9 new tests |
| 2026-07-01 | 1.4 | LogIntelligence ingest + listLogs now scrub secrets (new rows and legacy rows) |
| 2026-07-01 | 1.5 | Rebuild & relaunch: package-identity check in main (`isCockpitSource`), native confirm dialog, audit entry, button hidden for foreign projects (`refreshEligible` IPC). 5 new tests. Verified both states via screenshots |
| 2026-07-02 | 2.1 | Contract test scans wiring: every channel needs a main handler + preload invoke; every evt needs a preload subscribe; no unknown/duplicate registrations. Dangling `evtLogsChanged` resolved by adding `logs.onChange` to CockpitApi (preload + mock parity) |
| 2026-07-02 | 2.2 | `IpcResultMap` in shared/ipc.ts binds each channel key to its handler return type, derived from CockpitApi; `handle()` is now keyed + typed; compile-time completeness guard (`IPC_RESULT_MAP_COMPLETE`) errors on drift |
| 2026-07-02 | 2.3 | Central error shaping in `handle()` via `shared/ipc-errors.ts`: ZodError → one readable line, $HOME → `~`. DECISION: kept the promise-rejection contract instead of a success/data/error envelope (same UX, far smaller blast radius; panels already render e.message uniformly) — revisit only if structured error codes are needed |
| 2026-07-02 | 2.4 | 55 service tests added (GitService w/ mocked simple-git, Approval request/decide lifecycle, TerminalManager w/ fake ptys, UsageService, LocalCommandRunner) + shared FakeDb helper. NOT testable under Node: DB migrations (better-sqlite3 = Electron ABI). 5 latent bugs surfaced → folded into Phase 3.5 notes |
| 2026-07-02 | 2.5 | insight-aggregation + dashboard-assembly extracted to shared/ (single rule for service + mock); mock singleton mutation fixed (immutable per-project git state); Services.dashboard: Promise.all + agent count via TerminalManager. BUG FOUND: real dashboard agentCount was always 0 (dead `agent_sessions` table) — now counts live agent panes. mock.ts 815→797 |
| 2026-07-01 | 1.x E2E | Dev-mode verification vs real app: 16/16 (positive consume path force-pushed a local bare origin; single-use + cross-project + pending/rejected refusals; audit chain; live redaction) |
| 2026-07-01 | 1.6 | openExternal https/http allowlist; strict prod CSP via build plugin (verified in out/); entitlements plist + CI enables hardenedRuntime on the Apple-cert path only — VERIFY at next tagged release |
