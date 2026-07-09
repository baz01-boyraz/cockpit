# System Roadmap — cockpiT, A'dan Z'ye

> Written 2026-07-08 from four file:line-verified surveys of the whole system:
> test inventory, crash/lifecycle resilience, renderer/UX/performance, and
> security/release/product-pillars. Supersedes the narrower quality-roadmap draft.
>
> Scope: **everything** — trust layer, security posture, UX completion,
> performance, measurement, product deepening. Feature ideas only where a survey
> showed a built backend with no surface, or a pillar promised by CLAUDE.md that
> is thin in code.
>
> Status legend (as cockpit-VISION.md): `[ ]` todo · `[~]` in progress ·
> `[x]` done · `[!]` blocked (say why). Effort: S (<½ day) · M (1–2 days) · L (3+).

---

## The state of the system in ten lines (survey synthesis)

**Stronger than feared:** 82 test suites cover the core services (Swarm, Council,
Sentinel, Hermes tools, Git, Memory, Terminal); the IPC contract test exists; boot
never lies (terminal rows + orphaned cards reconciled, migrations atomic); swarm
cards resume in-place after a crash; secret handling is clean (no `secretGet` IPC
by design); webPreferences/CSP match the contract; a11y + motion rules are
effectively fully respected; the mock is comprehensive and current; CI gates
publish on typecheck + tests.

**The real debt:** resource leakage on the unhappy path (worktrees, orphan CLI
children); the mock is the contract's only unscanned leg; zero E2E; no outcome
measurement on any judgment system; Hermes chat leaves the redaction boundary;
usage/spend is fragmented across three services with no single view; approvals/
audit have data but no history UI; the router is advisory-only; lint isn't in CI;
Electron is a major behind.

---

## Track 0 — Release intake + council dogfood (first, S–M total)

### 0.1 [x] Review the incoming release range — done 2026-07-08
v0.1.47 shipped clean (all pushed). Two post-survey commits reviewed: `4d9fdd3`
(relevance-ranked recall + weekly curation sweep — recall ranking into worker/
council prompts, weekly DeepSeek curation proposing ≤8 non-destructive actions
into the review queue) and `2c4dc2d` (argos hardening — sequential boot sweeps,
**central redaction in `SentinelService.report`** which closes D2, memory-pointer
hooks redacted + pinned as never-instructions, Hermes signal block framed as
data). Both landed WITH tests (`memory-curation.test.ts`,
`memory-curation-service.test.ts`, `memory-recall.test.ts`).

### 0.2 [~] Tests for the new memory modules — mostly closed by the release
Curation/recall suites shipped with 4d9fdd3/2c4dc2d. Remaining sliver: the
name-collision gap — `shared/memory-pipeline.ts` still has no direct suite
(`test/memory-pipeline.test.ts` covers the *service*). Fold into B2.
**Effort:** S (residual)

### 0.3 [~] Council review of THIS roadmap — dogfood drill (Baz's idea)
Two birds: (1) the roadmap gets adversarial review from independent engines before
we commit weeks to it; (2) the council itself gets a real end-to-end live run —
multi-engine seats, per-seat fallback, `council_sessions` persistence, the
question-redaction fix (76aee03), scorecard rendering. Feed this doc in spec mode
with the same question: "what is missing in cockpit; is this the right cure at the
right priorities?" Record which seats responded/fell back, wall-clock per seat,
whether the session row survives an app restart. Verdict deltas are resolved
explicitly (accept/reject in the progress log); any council malfunction becomes a
Track A/B finding.
**Effort:** S

---

## Track A — Resilience: stop leaking on the unhappy path (~2–3 days)

> Survey verdict: the app never boots into a corrupt state, but crashed/quit runs
> leak resources with no cleanup owner. Highest net-risk track; mostly independent
> S/M tasks — good parallel swarm cards.

### A1 [x] Prune stale `.cockpit-worktrees/` at boot — top-ranked gap
`SwarmWorktrees` has only `create`/`removeIfClean`; nothing enumerates or prunes.
Every crash/park/abandon leaks a git worktree + `swarm/<slug>` branch, unbounded.
**Do:** `SwarmWorktrees.prune(projectPath)` (`git worktree prune` + enumerate,
cross-check live card rows, `removeIfClean` orphans, log dirty ones — never
force-delete dirty work). Invoke from the `SwarmService` constructor after the
orphan-parking loop (`SwarmService.ts:162`).
**Verify:** unit test; live drill: crash mid-card, relaunch → orphan pruned, dirty
worktree preserved + reported. **Effort:** M

### A2 [x] Kill orphaned CLI children on quit
Council seats (`EngineRunner.ts:48-52`, 360s timeout) and Hermes chat (5 min) spawn
`execFile` children that `Services.shutdown()` never tracks — on quit they reparent
and burn CPU/API spend until self-timeout.
**Do:** `EngineRunner` retains handles + `killAll()`; same for Hermes in-flight
children; call from `Services.shutdown()` (`Services.ts:409`) before `db.close()`.
**Verify:** quit during a council run → `pgrep` finds no `claude`/`codex`. **Effort:** M

### A3 [x] Guard resumed cards against a missing worktree
`startCard` reuses persisted `worktree_path` (`SwarmService.ts:284`) without
`existsSync`. On miss: recreate or park with a sentinel notice. **Effort:** S

### A4 [x] Boot-time process-liveness audit (zombie PIDs)
Reconciliation is DB-row-only; stored `terminal_sessions.pid`s are never
liveness-checked. `reconcileZombies()` step in the `Services` constructor.
**Effort:** M · after A1/A2.

### A5 [x] PTY `killAll`: process-group kill + SIGKILL escalation
`TerminalManager.killAll` (`:284-296`) sends SIGTERM and doesn't wait; a child
ignoring SIGTERM survives quit. **Effort:** S

### A6 [x] Council run: durable "in-progress" marker
`CouncilService.run()` persists nothing until the last line (`:94-183`); a mid-run
crash is silently lost. Insert a `pending` row at start (`:95`), finalize or mark
`failed`; boot sweep flips stale `pending` → `failed`. **Effort:** S–M · low damage,
do last in track.

### A7 [x] Hermes quick wins
- [ ] **Apply the measured `-t memory,skills` flag** — live-tested ~20–25% per-turn
  latency cut, validated, never applied. Zero design work; do day one. (S)
- [ ] Persist `HermesChatService.histories` (in-memory Map, `:43`) per-project so
  chat survives restart. (S–M, convenience tier.)

**Gate A:** kill the app mid-swarm-run and mid-council-run, relaunch → no orphan
worktrees, no zombie CLI processes, card resumes, nothing phantom-live. Proven by
tests + one scripted live drill.

---

## Track B — Contract, tests & CI (~1 week, parallelizable)

### B1 [x] Mock parity test — close the contract's weak leg
`test/ipc-contract.test.ts` scans main + preload but **not** `src/lib/mock.ts`
(1251 ln). The mock is only compile-bound to `CockpitApi` (method shape) — behavior
drifts silently, and the whole localhost screenshot workflow rides on it.
**Do:** structurally match `createMockApi()`'s method tree against the
`handle(...)` set in `registerIpc.ts`; where cheap, assert mock returns parse under
the same Zod schemas as real handlers. **Effort:** M

### B2 [~] Suites for untested side-effecting services (ranked)
1. `Services.ts` (418 ln) — DI-root wiring smoke test: construct on fake DB, assert
   every service exists, `shutdown()` runs clean.
2. `AppUpdateService.ts` (278) — update state machine (mock electron-updater; the
   "unsupported local build" path has bitten before).
3. `AgentUsageService.ts` (285) + `LogIntelligenceService.ts` (265).
4. `hermes/HermesMcpServer.ts` (214) + `hermes/AppScreenshotService.ts` (226).
5. `RailwayService.ts` + `railwayCli.ts` (236) — spawn seams behind a fake exec.
**Effort:** L total (each item S–M, independent — good swarm cards)

### B3 [x] Enforce coverage + lint in CI
- vitest coverage is configured but `npm test` never runs it — add `test:coverage`
  with thresholds (start from the first measured floor, ratchet up; don't invent
  80% on day one).
- **`npm run lint` is not in CI** — release.yml gates on typecheck + test only
  (`:133,:137`); the "0 warnings" rule is an honor system. Add it before the
  build/publish step. **Effort:** S

**Gate B:** contract test covers all three legs (main/preload/mock); no untested
service above 150 lines; coverage + lint measured on every release.

---

## Track C — E2E smoke layer (~1 week)

### C1 [x] Localhost E2E against the mock build (Playwright)
3–5 journeys, no more: boot → dashboard · terminal renders + blocks fold · swarm
card create → editor round-trip · memory note open/edit · sentinel toast + bell.
Headless off `npm run build && node serve.mjs`. **Effort:** M

### C2 [!] Packaged-app smoke — the real gap
One scripted drill against the built `.app`: launches, window appears, a real pty
spawns. Closes the **Command Blocks live verification** rider carried since Gate 3
(bash + packaged-app OSC 133). **Effort:** M · manual-scripted first.

**Gate C:** a red E2E blocks release; BRIDGESPACE-ROADMAP rider closed.

---

## Track D — Security hardening (~3–4 days)

> Survey verdict: the architecture holds (gate is sound, secrets clean, no
> renderer/MCP path to arbitrary exec). These are the ranked residual findings.

### D1 [x] Redact Hermes chat outbound — highest security finding (low-med)
`HermesChatService.ask()` sends the user message + full accumulated transcript to
the `hermes` CLI (→ OpenRouter) with **no `redactText`** (`HermesChatService.ts:83-104`).
A pasted secret goes out verbatim. Run message + history through `redactText`
before spawn. Note the residual: the CLI itself reads project files outside our
boundary — document that limit in CLAUDE.md's security section. **Effort:** S

### D2 [x] Redact Sentinel triage payloads — closed by 2c4dc2d (v0.1.47)
`SentinelService.report` now redacts title/summary/context centrally, covering
every sensor before a signal persists, reaches the renderer, or leaves via triage.

### D3 [x] Auth token for the loopback MCP server (low)
`HermesMcpServer` is loopback-only + DNS-rebinding-protected but **unauthenticated**
— any local process can drive the (no-shell) tool set. Add a per-session bearer
token generated in main, passed to the hermes CLI env. **Effort:** S–M

### D4 [x] `guarded()` rule as executable policy (informational, load-bearing)
The gate has exactly one live call site (`git_force_push`, `registerIpc.ts:185`)
— safe today only because deploy/env/db handlers don't exist. Add a test that
fails when a handler whose channel name matches gated-action patterns is
registered without `guarded()` — so the CLAUDE.md rule survives the day Railway
mutations land. **Effort:** S

### D5 [!] Electron major upgrade
`electron ^33` is a full major behind — trailing Chromium/V8 security patches.
Upgrade + `npm run rebuild` (better-sqlite3 ABI) + a full app:refresh live pass.
**Effort:** M (mostly re-verification) · schedule after Track C exists to catch
regressions.

### D6 [x] CSP polish (minor)
`img-src … https:` allows arbitrary remote images; tighten if nothing depends on
it. **Effort:** S

**Gate D:** no outbound-to-AI path without redaction (or an explicit documented
exception); MCP server authenticated; gate-bypass regression impossible by test.

---

## Track E — UX completion: surface what's already built (~1–1.5 weeks)

> Survey verdict: backend >> UI. These have data + IPC + mock already; they are
> mostly renderer-only work (safe to swarm in parallel with A/B).

### E1 [x] Unified AI-spend view — highest user-visible impact
Usage panel shows only Claude/Codex quota rings; **OpenRouter/Hermes spend is
absent** (`UsagePanel.tsx` has zero openRouter references; it lives only in the
rail footer `UsageStrip.tsx:120-122`). `AgentUsageService.getReport()` returns
only `[claude, codex]` (`:59`). One screen: claude + codex + openrouter, per
project and total. Data + mock (`openRouterUsageSnapshot`) already exist.
**Effort:** M

### E2 [x] Approvals history + a real Audit view
`api.approvals.list` returns all statuses but the UI renders only `pending`
(`DashboardPanel.tsx:140,249-263`); the audit log is a capped dashboard strip
(`:126-131,342-372`). One panel: filterable audit trail + past approval decisions
(`ApprovalCard.tsx:42-58` already renders approved/denied states). **Effort:** M

### E3 [x] Sentinel full feed view
Only a 20-item bell popover exists (`SentinelBell.tsx:35`); `sentinel:list`
supports full filterable history. Small panel or a Logs-tab section. **Effort:** S–M

### E4 [x] Council standalone surface
Council is reachable only as a swarm-card gate. Add a minimal "convene council"
entry point outside cards (project-level question mode) — this also makes the
Track 0.3 dogfood repeatable. **Effort:** M

### E5 [x] Chat-path decision: revive or excise
`CHAT_ENABLED=false` keeps 600+ lines dormant (`RightPanel.tsx` 562,
launcher, Logs "Send to AI"). The router "local" recommendation is a dead-end
even when enabled (`RightPanel.tsx:230-251` has no `local`/`chat` case — silently
falls to Logs). `RouteCard.tsx` (56 ln) is imported nowhere. **Decide:** Hermes is
now the chat — either fold the router surface into Hermes and delete the dormant
path, or fix and re-enable. Don't carry both. **Effort:** S (decision) + M (either
branch)

### E6 [x] Micro-polish batch (S total)
- `RailwayPanel` `EnvTable` empty state (renders a bare `<table>`, `:124-161`).
- `:active` rules for `sentinelRow` / `sentinelPopover__markAll` (DESIGN.md
  requires all three states).
- Dashboard audit refetch fires on every approvals change
  (`DashboardPanel.tsx:130-131`) — narrow the dependency.

**Gate E:** every built subsystem has an honest surface; total AI spend answerable
in one glance; no dormant/dead UI code paths left undecided.

---

## Track F — Performance & code health (background track, fill slack)

- [x] **F1** Split `MemoryGraph.tsx` — 930 ln, the only file over the 800 cap;
  also hoist per-frame `Map` rebuilds (`:488,696,707`) out of the rAF loop. (M)
- [x] **F2** Split `src/styles/components.css` — **7035 lines**, a catch-all
  monolith; carve per-feature files (swarm.css already models this). (M, mechanical)
- [ ] **F3** Watch-list: `GitPanel.tsx` 784 · `HermesWidget.tsx` 649 ·
  `TerminalsPanel.tsx` 617 — split at next substantive touch, not before. (—)
- [x] **F4** Virtualize the two lists that will actually grow: log stream
  (`LogsPanel.tsx:161`) and memory notes (`MemoryNoteList.tsx:70`). Kanban/blocks
  are naturally bounded — skip. (M)
- [x] **F5** Delete dead code found by survey: `RouteCard.tsx` (folds into E5). (S)

---

## Track G — Outcome tracking: measure the judgment systems (~1–2 weeks)

> The strategic layer. Council spec-gate, diff review, sentinel triage and the
> memory distiller all *emit judgments*; nothing records whether they were right.
> Requires `docs/plans/outcome-tracking-plan.md` first (0.1 rule).

- [x] **G1** Outcome events on card + council lifecycle: spec-gate verdict → card
  fate (shipped / reworked / abandoned); review "ship it" → post-merge
  reverts/fix-commits touching the same files.
- [x] **G2** Memory recall telemetry: ledger logs writes; log *reads/recalls* so
  the 7-day test becomes measurable per note. Feeds the curation feature landing
  in this release.
- [x] **G3** Sentinel triage accuracy: verdict vs. what the user did (dismissed /
  acted / became a card).
- [x] **G4** A read-only "judgment scorecard" surface (Usage-style, no knobs).

**Gate G:** after ~2 weeks of dogfood we answer with numbers: do spec-gated cards
fail less? does review catch real bugs? which memory notes earn their keep?

---

## Track H — Close the Sentinel fix loop (~1 week, after G1 events exist)

- [x] **H1** Signal → one-click Swarm card (Hermes can already create cards; put
  the affordance on the signal, carrying its context into the spec).
- [x] **H2** Fix verification: when a signal-linked card ships and the signal's
  dedup key goes quiet, mark it `resolved` (vs. merely `seen`).
- [x] **H3** Recurring signal → memory gotcha through the write-gate (verbatim
  symptom text, per charter).
- [x] **H4** Boot re-triage sweep for `triage IS NULL` rows (in-flight triage is
  volatile — `SentinelService.ts:159` fire-and-forget; nothing retries). Attach in
  the constructor (`:68`), throttled by `MAX_IN_FLIGHT`.

**Gate H:** a real bug travels signal → card → fix → auto-resolved; a
repeat-offender signal produces a charter-compliant gotcha note.

---

## Track I — Product deepening (sequenced last; each needs a plan doc)

### I1 [ ] Router: make it real or demote it honestly
The "AI agent router" pillar is advisory-only — `router.route` paints a badge but
the chat call uses the UI's model pick (`RightPanel.tsx:196`); it also drives swarm
role auto-assign. Either wire routing into actual engine selection (Hermes/Swarm
launch paths), or officially reposition it as "assignment advisor" in CLAUDE.md.
Ties into E5's chat decision.

### I2 [ ] Railway mutations behind the gate — when we're ready
Thinnest pillar by design (read-only, `RailwayService.ts:75`). When lifted:
restart/redeploy/env_write handlers **must** be born inside `guarded()` (D4's test
makes that structural). Not before Tracks A–D are done.

### I3 [ ] Distribution maturity
Path B self-signed works (stable designated requirement, in-app updates OK).
Path A (Apple Developer ID + notarization) awaits certificates — revisit when
distribution beyond Baz's machine matters. Keep: CI-only publishing, same-run
metadata+assets rule.

### I4 [ ] Revenue/positioning checkpoint
After G's scorecard exists, the "is this a product others use" question gets its
first data-backed pass. Placeholder — not designed here.

---

## Sequencing — how the tracks interleave

```
Release lands
  └─ Track 0 (intake + council dogfood)            ← same session
       ├─ Track A (resilience)                     ← first build work
       ├─ Track E (UX surfacing)  ∥ A              ← renderer-only, safe in parallel
       ├─ Track B (tests/CI)      ∥ A/E            ← independent files
       ├─ Track C (E2E)           after B1         
       ├─ Track D (security)      after A          ← D5 (Electron) after C exists
       ├─ Track G (measurement)   after A–C        ← needs plan doc first
       ├─ Track H (sentinel loop) after G1
       ├─ Track F (perf/health)   fills slack throughout
       └─ Track I (product)       last, each item gated on a plan doc
```

Parallel-swarm guidance: A1+A3 share `SwarmService` (one card); A2, A5, A7, B1,
B3, D1, D2, E1, E2, E3, E6, F2, F5 are each isolated enough to be their own card.

**Standing rules for every track:** new code lands with its tests in the same
commit; release-blocker suites stay green (redaction, force-push gate, IPC
contract); anything spawning processes or mutating state gets either a test or an
entry here; plan doc before any Track G/I feature (0.1 rule).

## Progress log

| Date | Item | Note |
|---|---|---|
| 2026-07-09 | Tracks A–H executed | 22 commits in one multi-agent session (5 waves, 15 subagents). Tests 974→1110 (+136) + 5 Playwright E2E journeys (~4s, 0 flakes). All gates green: typecheck 0, lint 0 warnings, unit 1110/1110, e2e 5/5. Coverage floor enforced (70/80 ratchet, baseline 73.75%); lint added to CI. Migrations V15–V18 appended (hermes_chat_turns, memory_recalls, sentinel outcome, council status). |
| 2026-07-09 | Deliberately open | **B2 residual**: AgentUsage, LogIntelligence, AppScreenshotService, Railway pair + shared/memory-pipeline sliver still untested. **C2** packaged-app smoke: needs app:refresh consent (Baz). **D5** Electron major upgrade: needs live verification + consent. **0.3** in-app council live run: needs the running app (an argos panel review of the batch stood in). **Gate A live drill** (kill mid-run, relaunch): needs the real app. **Track I**: untouched by design (each item needs a plan doc + Baz decision). E4's cross-session council browser renderer (channel exists, UI pending). |
| 2026-07-08 | doc | Written from 4 surveys (tests, resilience, UI/UX, security/release/product). Supersedes quality-roadmap draft. Awaiting release intake (Track 0). |
