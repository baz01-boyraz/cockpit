# Plan — Outcome Tracking: measure the judgment systems (Roadmap Track G)

> Status: DRAFT · Created 2026-07-08 · system-roadmap.md Track G (G1–G4), Gate G
> Prereq (0.1 rule): this doc lands before any Track G code.
> Read first: system-roadmap.md §Track G; CLAUDE.md §"LLM Council & engines".

## What we're building

Every judgment system in cockpiT emits a verdict and forgets it. The council spec-gate
approves/blocks a spec, diff review flags findings, sentinel triage judges a signal, the
memory recall ranker picks the top notes for a prompt — and nothing records whether any of
those calls was *right*. Track G closes that loop with the cheapest honest instrumentation
and one read-only scorecard. No new judgment, just measurement.

**Design principle — derive before you store.** Prefer deriving outcomes from the
append-only `audit_log` + existing rows (`council_sessions.card_id`, `kanban_cards
.council_session_id`, `sentinel_signals.triage`) over new tables. A new table is justified
only where the fact is genuinely absent AND deleted rows would lose it (recalls; signal
outcomes). Read-model aggregation is pure and lives in `shared/`.

## Non-goals (binding)

- **No ML, no auto-tuning.** We never adjust seat rosters, gate thresholds, or triage
  prompts from these numbers. Humans read the scorecard; the machine changes nothing.
- **No cross-project aggregation in v1.** Every number is per-project. A global roll-up is
  a later question.
- **No post-merge git archaeology in v1.** Roadmap G1's second half ("review 'ship it' →
  post-merge reverts/fix-commits") requires walking git history for fix-commits touching
  reviewed files — expensive and noisy. **Deferred to G1.5**; v1 G1 covers the
  council-gate → card-fate half only.
- **No writes back into memory** from metrics (the curation sweep already owns that).

---

## G1 — Card / council outcome events (no new table)

**Where the link already lives:** `council_sessions` rows carry `card_id`, `mode`,
`verdict_kind` (V11). `kanban_cards` carries `council_session_id` (V12). The spec-gate →
card association is already in the schema. What is missing is the **card's terminal fate**,
durable past card-row deletion.

**The gap:** a card reaches `done` only via a user drag (`SwarmService.moveCard` →
`moveCardInList`), which is **not audit-logged**; `removeCard` (abandon) is **not
audit-logged**; a rework (In review → back to todo/in_progress) is **not audit-logged**.
And a removed card's row is gone, so a join to `kanban_cards` loses abandoned cards.
`audit_log` survives card deletion (no card FK; `project_id` is `ON DELETE SET NULL`), so
terminal events belong there.

**Event vocabulary (new `action_type` values, actor `system`):**

| action_type | Emitted from | Fires when | payload |
|---|---|---|---|
| `swarm.card_shipped` | `SwarmService.moveCard` | card enters `done` | `{cardId, councilSessionId, wasCouncilGated, specVerdictKind}` |
| `swarm.card_abandoned` | `SwarmService.removeCard` | a not-shipped card is removed | `{cardId, councilSessionId, wasCouncilGated, priorStatus}` |
| `swarm.card_reworked` | `SwarmService.moveCard` | card leaves `in_review` toward an earlier column | `{cardId, councilSessionId}` |

Existing events already usable as-is: `swarm.start_card`, `swarm.card_done_signal`
(→ In review), `swarm.card_exited`, `swarm.park_card`. `specVerdictKind` is read from the
linked `council_sessions` row at emit time. **Content-free** payloads (ids + enums only),
per the audit charter.

**Files:**
- `electron/main/services/SwarmService.ts` — emit the three events in `moveCard`
  (detect entering `done` and the backward In-review transition, comparing the pre/post
  `moveCardInList` status) and in `removeCard`. Additive; each is one `this.audit.record`.
- `electron/main/services/OutcomeService.ts` **(new, ~150 ln)** — read model.
  `cardOutcomes(projectId, sinceIso)` scans `audit_log` for the terminal events, left-joins
  `CouncilSessionStore.listRecent` by `cardId`, returns `CardOutcome[]`
  (`{cardId, fate: 'shipped'|'reworked'|'abandoned', gated: boolean, verdictKind}`). Pure
  aggregation delegated to `shared/outcomes.ts`.
- `shared/outcomes.ts` **(new, pure, dep-free)** — `computeCardOutcomeStats(rows)` →
  shipped-rate gated vs ungated, gate-calibration, fate mix. Unit-testable, mock-safe.

**No schema change for G1.**

---

## G2 — Memory recall telemetry (new table, V15)

**Today:** `memory_ledger` records *writes* only (action/gate/hashes, V7). Recalls are
invisible. But recall already happens at two hooks that select the notes that reach a prompt
— *that selection is the recall event*:
- `SwarmService.hubNoteNames` (`:573`) → `rankNotes(...)` for the worker prompt.
- `CouncilService.memoryPointerBlock` (`:200`) → `composeMemoryPointerBlock` for spec seats.

**Why a table, not `memory_ledger` action='recall':** the ledger is write-provenance
(before/after hashes, revertible history); mixing high-frequency recalls in pollutes its
semantics and its `list()`. A dedicated slim table keeps both clean and makes the 7-day test
a one-line query.

**Schema V15:**
```sql
CREATE TABLE IF NOT EXISTS memory_recalls (
  id         TEXT PRIMARY KEY,
  brain      TEXT NOT NULL,          -- projectBrain(id) | baz-global (no FK: files, not rows)
  note_slug  TEXT NOT NULL,
  surface    TEXT NOT NULL,          -- 'swarm_worker' | 'council_spec'
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_recalls_note ON memory_recalls(brain, note_slug, created_at);
CREATE INDEX IF NOT EXISTS idx_memory_recalls_brain ON memory_recalls(brain, created_at);
```

**Files:**
- `electron/main/db/schema.ts` — append `SCHEMA_V15` block + version bump (see Migration).
- `electron/main/services/MemoryRecallService.ts` **(new, ~80 ln)** —
  `record(brain, slugs, surface)` (one bounded batch INSERT, ≤ HUB_POINTER_CAP rows, never
  throws — recording must not endanger a spawn); `recalledSince(brain, sinceIso): Map<slug,count>`.
- `SwarmService.ts` — in `hubNoteNames`, after `rankNotes`, `void
  this.recalls.record(projectBrain(projectId), names, 'swarm_worker')` (best-effort, wrapped).
- `CouncilService.ts` — in `memoryPointerBlock`, compute the top-N via `rankNotes` (the
  selection), record `'council_spec'`, then compose the block from the same set.

**7-day test, queryable:** `recalledSince(brain, now-7d)` vs the hub's note list →
never-recalled notes = curation candidates; written-and-recalled = "earns its keep." Feeds
the curation sweep and G4.

---

## G3 — Sentinel triage accuracy (columns on the signal, V16)

**Today:** `sentinel_signals.triage` (V14) holds the verdict blob (`reportWorthy`,
`gotchaCandidate`, `action`). The **user's response** is not recorded: `markSeen` is passive
("badge cleared"), which is not the same as "dismissed as noise" vs "acted on." Signals are
`ON DELETE CASCADE`, so the outcome must sit **on the signal row**, co-located with triage.

**Schema V16 (ALTER, this version only):**
```sql
ALTER TABLE sentinel_signals ADD COLUMN outcome    TEXT;  -- 'dismissed' | 'acted' | 'card_created' | NULL
ALTER TABLE sentinel_signals ADD COLUMN outcome_at TEXT;
```

**Vocabulary:** `dismissed` (explicit "not useful" from the bell), `card_created`
(Track H1 signal→card sets this), `acted` (reserved — a linked card ships). NULL = no
response yet.

**Files:**
- `electron/main/services/SentinelService.ts` — `recordOutcome(projectId, id, outcome)`
  (project-scoped WHERE, single-set, never throws); extend `toSignal`/`SignalRow` to carry
  the two columns.
- `shared/sentinel.ts` — add `outcome`/`outcomeAt` to `SentinelSignal`; `SentinelOutcome`
  union.
- `shared/ipc.ts` + `shared/schemas.ts` + `registerIpc.ts` + `src/lib/mock.ts` — one new
  channel `sentinelRecordOutcome` (Zod: `{projectId, id, outcome: enum}`); wire an explicit
  "dismiss as noise" action into `SentinelBell.tsx`. (Track H1 will call it for cards.)
- `shared/outcomes.ts` — `computeTriageAccuracy(signals)`: among `reportWorthy===true`,
  precision = `(card_created+acted)/(card_created+acted+dismissed)`; count `reportWorthy===
  false` signals that nonetheless became cards (misses).

---

## G4 — Judgment scorecard (read-only surface)

**Where it lives:** a new read-only **section inside the Usage panel** (`UsagePanel.tsx`),
not a new nav entry — "how the machines are judging" sits naturally beside "how the quota is
spent," and it keeps the surface small. No knobs, no actions.

**IPC additions (one channel):**
- `shared/ipc.ts` `CockpitApi`: `outcomes: { scorecard(projectId: string):
  Promise<OutcomeScorecard> }`.
- `shared/ipc.ts` CHANNELS: `outcomesScorecard: 'outcomes:scorecard'`.
- `shared/schemas.ts`: `outcomesScorecardSchema = z.object({ projectId: z.string().min(1) })`.
- `shared/outcomes.ts`: `OutcomeScorecard` type + the three pure `compute*` helpers.
- `electron/main/services/OutcomeService.ts`: `scorecard(projectId)` — pulls card outcomes
  (audit + council_sessions), `MemoryRecallService.recalledSince`, `SentinelService` signals,
  and `CouncilService.scorecard` (existing `computeScorecard`), feeds the pure helpers.
- `registerIpc.ts`: `handle('outcomesScorecard', (p) =>
  services.outcomes.scorecard(outcomesScorecardSchema.parse(p).projectId))`.
- `src/lib/mock.ts`: `outcomes.scorecard` returns a static `OutcomeScorecard` (parity test).
- `src/…/ScorecardSection.tsx` **(new renderer, read-only)**, rendered by `UsagePanel.tsx`.

**The 5–8 numbers (last 30 days unless noted):**
1. **Spec-gate leverage** — ship-rate of council-gated cards vs ungated (one delta).
2. **Gate calibration** — of `APPROVED` specs, % shipped; of `NEEDS_CLARIFICATION`, %
   eventually shipped.
3. **Card fate mix** — shipped / reworked / abandoned counts.
4. **Memory earned-keep** — % of hub notes recalled in the last 7 days; count never-recalled.
5. **Top-3 most-recalled notes** (names).
6. **Triage precision** — reportWorthy signals acted-on vs dismissed (%).
7. **Best council seat** — reuse `computeScorecard` (already shipped), top seat by avg rank.

---

## Migration plan (append-only)

Latest shipped version is **V14**. Two new blocks, each in its own version so parallel cards
don't collide (the V7→V10 renumber lesson):
- **V15** — `memory_recalls` table (G2 owns it).
- **V16** — `sentinel_signals.outcome` + `outcome_at` ALTER (G3 owns it).

G1 and G4 add **no** schema (audit action_types + read models only). If G2/G3 land out of
numeric order across parallel agents, renumber on integration — same rule as the memory-brain
batch. Bump the migration runner's target in `electron/main/db/Database.ts` accordingly.

## Test plan (fake-db unit tests per seam)

- `test/outcomes.test.ts` — `shared/outcomes.ts` pure helpers, table-driven (gated/ungated
  ship-rate, calibration, triage precision, empty-set floors).
- `test/outcome-service.test.ts` — seed a fake DB with council_sessions + the three audit
  terminal events (incl. a removed card's orphan event) → assert `cardOutcomes` join + stats.
- `test/memory-recalls.test.ts` — `MemoryRecallService.record` batch + `recalledSince`
  window boundary (a recall exactly at the cutoff), never-throws on bad slug.
- `test/sentinel-outcome.test.ts` — `recordOutcome` writes the column project-scoped;
  accuracy read reflects it.
- `test/swarm-outcome-events.test.ts` — `moveCard`→done emits `swarm.card_shipped`;
  `removeCard` emits `swarm.card_abandoned`; In-review→todo emits `swarm.card_reworked`.
- `test/ipc-contract.test.ts` + mock parity — `outcomes.scorecard` present in main, preload,
  mock; mock return parses under `OutcomeScorecard`.

## Phasing (dependency-ordered) & parallelism

| Phase | Effort | Depends on | Parallel-safe? |
|---|---|---|---|
| **G1** card events + `OutcomeService.cardOutcomes` | M | — | Touches `SwarmService` → serialize with any other SwarmService card |
| **G2** V15 + `MemoryRecallService` + 2 hooks | S–M | — | Mostly isolated; small additive edits to Swarm/Council. Own card |
| **G3** V16 + sentinel outcome + IPC | S | — | Fully isolated (sentinel files + own channel). Own card. Ties to Track H1 for `card_created`, but the dismiss path is independent |
| **G4** `shared/outcomes.ts` + service aggregation + IPC + mock + Usage section | M | G1+G2+G3 read models | **Last.** `shared/outcomes.ts` (types + pure math) can be built in parallel against fixtures |

**Guidance:** G2 and G3 are the two clean parallel cards. G1 owns `SwarmService`. Build
`shared/outcomes.ts` early (pure, no deps) so G4 is just wiring. Every phase lands with its
tests in the same commit; release-blocker suites stay green.

## Risks

- **Card fate is re-openable.** A card can leave `done` after a `swarm.card_shipped` event.
  v1 treats the *latest* terminal event as truth; a re-opened-then-reshipped card double-
  counts unless we dedup by `cardId` keeping the last event. `OutcomeService` must fold by
  `cardId`, last-wins. Covered by a test.
- **Council link is nullable/dangling by design** (V12 has no FK). `wasCouncilGated` must
  tolerate a `council_session_id` pointing at a vanished session → treat as "gated,
  verdictKind null," not a crash.
- **Recall volume.** Every worker spawn + spec council writes ≤5 recall rows; over months
  this grows unbounded. v1 accepts it (bounded per event, indexed); note a future retention
  prune if the table gets large.
- **`moveCard` transition detection.** The backward-from-in_review rule must not mis-fire on
  In review → done (that's shipped, not reworked). Assert both directions in the test.
- **Mock drift.** `outcomes.scorecard` is a new mock leg; the parity test (Track B1) is the
  guard — land them together.
- **Honesty ceiling.** These numbers measure *correlation* (gated cards ship more), not
  *causation*. The scorecard copy must not overclaim; it is a dashboard, not a proof.
