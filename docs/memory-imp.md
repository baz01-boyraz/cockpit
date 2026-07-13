# memory-imp — The Living Memory Brain

> **SUPERSEDED 2026-07-13.** This is a historical implementation journal and
> must not be used as current runtime or model-routing policy. The implemented
> provider-neutral design is documented in `docs/MEMORY-CHARTER.md` and
> `docs/plans/agent-memory-system-v2.md`. Historical names and routes below are
> retained only to explain earlier decisions.

> Created 2026-07-04. This is the **implementation roadmap** for turning cockpiT's
> per-project markdown hub into a *living brain*: it captures the important parts of
> the sessions we actually work in, classifies them, keeps itself organized, and
> never rots. It extends VISION Phase 5 (the markdown hub already shipped).
>
> **Read this first, before writing any code for memory.** Memory is the most
> important surface in the product. A broken note is worse than a missing one — a
> missing fact is silence, a broken fact is a lie the brain will repeat. Every
> decision in this doc is subordinate to one rule: **memory must never be corrupted.**

---

## The seven guarantees (why this doc exists)

Baz's requirements, restated as guarantees the system must *provably* hold. Every
phase below traces back to one or more of these. If a design choice weakens a
guarantee, the guarantee wins.

| # | Guarantee | The worry it kills |
|---|-----------|--------------------|
| G1 | **Capture what matters, automatically.** The brain reads the Claude sessions we live in and pulls out the important facts without being asked. | "Manuel yazmazsam hiçbir şey birikmiyor." |
| G2 | **Never miss important information.** Capture is durable and queued — a crash, quit, or reload never drops a pending session. | "Önemli bilgi kaçırmak." |
| G3 | **Never write a broken or partial note.** Every write is validated (schema, links, size, markdown) and atomic. A half-written note is unrepresentable. | "Eksik/bozuk not etmek." |
| G4 | **The model decides, and asks when unsure.** The model judges each fact's importance/value itself and either saves it or — if it isn't sure it's worth keeping — asks Baz "not edeyim mi?" No fixed threshold; judgment + ask-fallback. Conflicts always enter review; only the owner or an evidence-backed delegated Hermes resolver may settle them. | "Model kendisi karar vermeli; emin değilse sorsun." |
| G5 | **Never write-and-forget.** A maintenance ("sleep") pass revisits the whole brain on a schedule: merges duplicates, resolves dangling links, splits bloated notes, flags contradictions. | "Not ettikten sonra bir daha dönüp incelememek." |
| G6 | **Stay organized and concrete.** Every note has the same skeleton (frontmatter + body + `[[links]]`). The graph is the index. Health is visible, not hidden. | "Her şey çok düzenli ve somut çalışmalı." |
| G7 | **Never corrupt.** Append-only provenance ledger, pre-consolidation snapshots, soft-delete only, idempotent pipeline. Every note traceable to its source and revertible. | "Asla bozuk olmamalı." |

---

## Current state (grounded, 2026-07-04)

What already exists and is load-bearing — build **on** these, do not replace them:

- **The hub is markdown files.** `.cockpit-memory/*.md` per project, files are the
  single source of truth. `MemoryHubService` (`electron/main/services/MemoryHubService.ts`)
  is a thin, path-safe fs layer: `list / read / write / rename / trash`. Writes are
  already atomic (tmp + `rename`). Delete is already soft (`.trash/`). **Keep all of this.**
- **Pure assembly is shared.** `shared/memory-hub.ts` builds the snapshot, backlinks,
  and unresolved-link index from `[[wikilinks]]` (`shared/wikilink.ts`). The graph in
  `src/components/memory/MemoryGraph.tsx` is fed from this — real data, not mock.
- **The raw source is already readable.** Claude Code writes every session as a
  `.jsonl` transcript under `~/.claude/projects/<encoded-path>/<sessionId>.jsonl`.
  `ClaudeSessionsService` already lists them (it only reads the 128 KB head today —
  we will add a full, streaming reader). Path encoding: `path.replace(/[/.]/g, '-')`.
- **Redaction exists and is mandatory.** `shared/redaction.ts` → `redactText`,
  `redactPayload`, `maskEnvEntry`, `looksLikeSecret`. Per CLAUDE.md, **nothing**
  reaches an AI model without passing through this first.
- **IPC discipline exists.** Channels in `shared/ipc.ts`, Zod-validated handlers in
  `electron/main/ipc/registerIpc.ts`, and a mock in `src/lib/mock.ts` that **must**
  stay in sync with `CockpitApi`. Every new capability adds all three.
- **SQLite + migrations exist.** `electron/main/db/Database.ts`, migration array now
  at **version 6**. New tables land as versions 7+.
- **Global storage path exists.** `app.getPath('userData')` (see `electron/main/index.ts`)
  already hosts `cockpit.sqlite`. The cross-project "Baz brain" hub lives beside it.

**The gap:** the hub only grows when a human (or agent) explicitly writes a note.
There is no capture, no classification, no maintenance. The 6 notes you see are
byte-identical seeds copied into each worktree; nothing has been added since Jul 2.
This roadmap closes that gap.

---

## Architecture — the brain

### Two brains, one machine

The same `MemoryHubService` machinery runs two hubs with different roots:

- **Project brain** — `.cockpit-memory/` inside each project. Facts about *this project*:
  decisions, gotchas, architecture, "why we did it this way."
- **Baz brain (global)** — `<userData>/baz-memory/`. Facts about *you*: preferences,
  working style, model routing, recurring decisions. Portable across every project.

The distiller (below) routes each fact to the right brain. This split is why "master
about both me and the project" is achievable — user-facts cannot live in one project's
folder.

### The pipeline — five stages, each a guarantee

Raw session → durable fact. Every stage is a checkpoint; a crash resumes from the
queue, never mid-write.

```
 Claude .jsonl session
        │
        ▼
 (1) CAPTURE ──────────► memory_capture_queue (SQLite, durable)      [G2]
        │                 idempotency key = sessionId + contentHash
        ▼
 (2) DISTILL ──────────► redactText() → LLM → Observation[]          [G1, security]
        │                 {class, importance, confidence, target, body}
        ▼
 (3) RECONCILE ────────► vs existing notes: NEW | MERGE | DUP | CONFLICT   [G5, G6]
        │
        ▼
 (4) GATE ─────────────► the model's own call: SAVE or ASK-BAZ         [G4]
        │
        ▼
 (5) COMMIT ───────────► validate → MemoryHubService.write → ledger row [G3, G7]
                          atomic, wikilinked, provenance-stamped
```

1. **Capture** — a watcher (Phase 4) notices a session went idle (transcript `mtime`
   stable for N minutes) or ended, and enqueues a job in `memory_capture_queue`. The
   queue is durable: the job survives app quit/reload/crash. Nothing is processed
   in-memory-only. Idempotency key `= sessionId + last-processed-offset hash`, so a
   session is never double-distilled and never silently skipped. **This is G2.**
2. **Distill** — the full transcript is streamed, `redactText`'d line by line, and
   handed to a model that returns zero or more **Observations**. Each observation is a
   candidate fact with a class, an importance score (0–1), a confidence (0–1), a
   suggested target note (existing slug or a new slug), and the proposed body. The
   model never sees an unredacted byte. **This is G1.**
3. **Reconcile** — for each observation, compare against the current hub (slug match +
   content similarity). Decide one of: **NEW** (create), **MERGE** (append/update an
   existing note), **DUPLICATE** (skip — already known), **CONFLICT** (existing note
   asserts the opposite). Conflicts always enter review; they never auto-commit. The owner or
   an evidence-backed delegated Hermes resolver may settle them. This stage is pure
   logic in `shared/` and is where "organized like a brain" is enforced — dedup and
   contradiction detection happen here, before anything touches disk. **This is G5/G6.**
4. **Gate** — **the model decides, not a formula.** During Distill the model judges each
   observation by its own read of the fact's importance and value and emits a decision:
   - **SAVE** — the model is confident this matters and is unambiguous → commit it.
   - **ASK** — the model is *not sure* it's worth keeping, or is unsure how to classify /
     where to file it → it surfaces a one-tap "Not edeyim mi?" card ("Save / Edit /
     Discard"). Any reconcile **CONFLICT** always forces review regardless of the model's call.
     Delegated Hermes resolution requires a non-recency basis, rationale, and evidence.
   There is no fixed numeric threshold; the model's own judgment drives it, and "when in
   doubt, ask Baz" is the hard fallback. Nothing questionable is written silently. **This is G4.**
5. **Commit** — write through `MemoryHubService.write` (keeps atomic tmp+rename), with
   `[[links]]` wired to related notes, wrapped in a validated transaction. A row is
   appended to the provenance ledger: source session id, timestamp, before/after
   content hash, decision (NEW/MERGE), and gate path (auto/reviewed). Every note is now
   traceable and revertible. **This is G3/G7.**

### The maintenance loop — the "sleep" pass (G5)

Capture alone rots: notes go stale, duplicates accumulate, links dangle. A scheduled
consolidation pass (idle-triggered, or daily, or manual "Consolidate now") re-reads the
**whole** hub and produces a *maintenance diff*:

- **Merge** near-duplicate notes into one canonical note.
- **Resolve** `unresolved` `[[links]]` that now have a target (the index already
  computes these — `shared/memory-hub.ts`).
- **Split** notes that grew past a size/scope threshold into focused children.
- **Flag contradictions** between an older note and newer facts.
- **Prune** notes whose provenance is stale and never referenced (soft, to `.trash/`).

The diff goes to the same one-tap review surface. This is the single most important
loop for "gerçek beyin gibi" — memory that maintains itself is the difference between a
notebook and a brain. Before every consolidation pass, snapshot the hub (G7).

### Canonical note format (G6)

Every note the brain writes uses one skeleton — the same proven shape as the Claude
Code memory Baz already trusts (frontmatter index + one fact + links):

```markdown
---
schema: 1
name: <kebab-slug>            # == filename, by construction
title: <human title>
class: decision | gotcha | user | reference | architecture
source: { sessionId, capturedAt }
gate: save | asked        # auto-saved, owner-approved, or evidence-backed delegated resolution
updatedAt: <iso>
tags: [ ... ]
---

<the fact — concrete, self-contained, one idea per note>

Related: [[other-note]], [[another-note]]
```

Frontmatter is validated by a Zod schema (`shared/memory-note-schema.ts`) on **every**
write. A note that fails validation is refused, not truncated — G3. Human-authored
notes without frontmatter stay valid (the parser tolerates their absence); the brain's
own writes always include it.

### Integrity model (G7 — the non-negotiable section)

Memory must never be corrupt. The guarantees, concretely:

- **Atomic writes** — keep the existing tmp-write + `rename` in `MemoryHubService`.
- **Validate before write** — slug valid, size bounded, markdown parses, frontmatter
  schema passes, `[[link]]` targets are known-or-tracked. Fail closed.
- **Append-only provenance ledger** (SQLite) — every change recorded with before/after
  hash. Any note is traceable to the session that produced it, and revertible.
- **Soft-delete only** — never hard-delete; keep the `.trash/` move that already exists.
- **Snapshots before consolidation** — copy the hub dir (or a git-style snapshot) before
  any bulk maintenance pass, so a bad merge is one restore away.
- **Idempotent pipeline** — the capture queue's idempotency key guarantees a session is
  distilled exactly once; a crash mid-pipeline resumes without loss or duplication.
- **Schema-versioned notes** — `schema: N` in frontmatter lets future format changes
  migrate safely.
- **Renderer never sees raw secrets** — redaction happens in main, before the model call;
  the renderer only ever receives assembled, safe notes (existing architecture rule).

---

## Data model (new SQLite tables)

Two new migrations on top of version 6. Tables live in the existing `cockpit.sqlite`
(main-process only; the renderer reaches them through IPC).

> **Migration numbering (actual build order):** V7 = `memory_ledger` (Phase 0.2, **shipped**).
> `memory_capture_queue` and `memory_review` follow as V8/V9 when their phases land — the
> numbers below are illustrative; migrations are append-only and assigned in build order.

**`memory_capture_queue`** (G2, durability):

```sql
CREATE TABLE memory_capture_queue (
  id            TEXT PRIMARY KEY,           -- idempotency key: sessionId+offsetHash
  project_id    TEXT NOT NULL,
  session_id    TEXT NOT NULL,
  source_path   TEXT NOT NULL,              -- the .jsonl transcript
  status        TEXT NOT NULL,              -- queued|distilling|reconciling|awaiting_review|done|error
  last_offset   INTEGER NOT NULL DEFAULT 0, -- bytes consumed, for incremental capture
  attempts      INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  enqueued_at   TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX idx_mcq_status ON memory_capture_queue(status);
```

**`memory_ledger`** (G7, provenance — **shipped as V7**) **+ `memory_review`** (G4):

```sql
CREATE TABLE memory_ledger (
  id           TEXT PRIMARY KEY,
  brain        TEXT NOT NULL,               -- 'project:<id>' | 'baz-global'
  note_slug    TEXT NOT NULL,
  action       TEXT NOT NULL,               -- create|merge|split|rename|trash|restore
  gate         TEXT NOT NULL,               -- auto|reviewed|manual|consolidation
  source_id    TEXT,                        -- capture queue id, if any
  hash_before  TEXT,
  hash_after   TEXT,
  created_at   TEXT NOT NULL
);
CREATE TABLE memory_review (
  id           TEXT PRIMARY KEY,
  brain        TEXT NOT NULL,
  kind         TEXT NOT NULL,               -- new|merge|conflict|maintenance
  payload      TEXT NOT NULL,               -- JSON: the proposed change
  status       TEXT NOT NULL,               -- pending|accepted|edited|discarded
  created_at   TEXT NOT NULL,
  resolved_at  TEXT
);
```

---

## IPC surface additions

Every new capability adds a channel in `shared/ipc.ts`, a Zod-validated handler in
`registerIpc.ts`, **and** a matching mock in `src/lib/mock.ts` (CLAUDE.md rule — the
mock can never drift). New `memory.*` methods:

| Method | Purpose |
|--------|---------|
| `memory.captureSession(projectId, sessionId)` | Manually enqueue a session for distillation. |
| `memory.queue(projectId)` | List capture-queue state (for the health panel). |
| `memory.reviewQueue(brain)` | Pending review cards (G4). |
| `memory.resolveReview(id, decision, editedBody?)` | Accept / edit / discard a proposed change. |
| `memory.consolidate(brain)` | Run the maintenance pass, return the maintenance diff (G5). |
| `memory.health(brain)` | Note count, orphans, unresolved links, conflicts, last-consolidated (G6). |
| `memory.ledger(brain, noteSlug?)` | Provenance history for audit / revert (G7). |
| `memory.revert(ledgerId)` | Restore a note to a prior ledger state (G7). |

The Baz-global brain is addressed by passing `brain: 'baz-global'` where methods take a
brain; project methods keep taking `projectId`.

---

## Roadmap — phased, in dependency order

Work phases **in order**. Each phase is independently shippable and testable. A phase's
**Gate** must pass before the next begins. Status markers: `[ ]` todo · `[~]` wip ·
`[x]` done · `[!]` blocked. Effort: **S** hours · **M** a day · **L** multiple days.

> Build note (per Baz's model routing): this roadmap is authored in chat; the build is
> executed with **Opus** (subagents `atlas`/`vulcan`/`apollo`). Pure logic goes in
> `shared/` with tests first (TDD). Nothing ships that breaks `npm test` — the memory
> integrity suites are release blockers.

### Phase 0 — Foundations & integrity (no AI yet) `[x]`

De-risk correctness before any model is involved. All pure/testable.
**Done 2026-07-04** — typecheck + lint + 481 tests green (21 new memory tests).

- **0.1 `[x]` Note frontmatter schema + validator** — **S**
  - *Why:* G3/G6 — every brain-written note must be structurally valid.
  - *Do:* Zod schema for the frontmatter block; a `parseNote` / `serializeNote` pair
    that round-trips markdown ⇄ `{frontmatter, body}` without losing human content.
  - *Files:* new `shared/memory-note-schema.ts`; unit tests `shared/__tests__/`.
  - *Verify:* round-trip tests; a malformed note is rejected, a plain human note (no
    frontmatter) still parses.
- **0.2 `[x]` Provenance ledger + snapshot/restore** — **M**
  - *Why:* G7 — traceability and recoverability.
  - *Do:* Migration 8 (`memory_ledger`); a `MemoryLedger` writer; `snapshotHub()` /
    `restoreHub()` on `MemoryHubService` (copy `.cockpit-memory` → timestamped snapshot).
  - *Files:* `electron/main/db/Database.ts` (migration), new
    `electron/main/services/MemoryLedgerService.ts`, `MemoryHubService.ts` (snapshot).
  - *Verify:* write → ledger row with before/after hash; snapshot → mutate → restore
    returns exact bytes.
- **0.3 `[x]` Health metrics** — **S**
  - *Why:* G6 — memory health must be visible, never silently degrading.
  - *Do:* pure `assembleHealth(docs)` (note count, orphans, unresolved links,
    oversized notes, last-consolidated); `memory.health` channel + mock.
  - *Files:* `shared/memory-hub.ts` (or new `shared/memory-health.ts`), `shared/ipc.ts`,
    `registerIpc.ts`, `src/lib/mock.ts`.
  - *Verify:* unit tests on fixture hubs.
- **Gate 0 `[x]`:** integrity primitives green; `npm test` covers schema round-trip, ledger,
  snapshot/restore. No AI, no capture yet — but the safety net is in place.

### Phase 1 — Transcript reader + redaction pipe (still no AI writes) `[x]`

**Done 2026-07-04** — 10 tests: pure line parser + streaming reader with redaction + incremental offset.

Prove we can safely read and redact a full session.

- **1.1 `[x]` Streaming full-transcript reader** — **M**
  - *Why:* G1 — the distiller needs the whole conversation; transcripts run to tens of MB.
  - *Do:* new `TranscriptReader` that streams a `.jsonl` line by line, extracts
    human+assistant text (reuse `extractUserText`-style parsing from
    `ClaudeSessionsService`), and yields incremental content past `last_offset`.
  - *Files:* new `electron/main/services/TranscriptReader.ts`; fixtures in a test dir.
  - *Verify:* reads a large fixture without loading it whole; incremental read from an
    offset returns only new turns.
- **1.2 `[x]` Redaction pass over transcript text** — **S**
  - *Why:* security (CLAUDE.md) — no unredacted byte reaches a model.
  - *Do:* pipe every yielded chunk through `redactText`; add transcript-shaped fixtures
    (fake keys/tokens/.env dumps) proving masking.
  - *Files:* `TranscriptReader.ts`, `shared/redaction.ts` (extend patterns if fixtures
    reveal gaps), tests.
  - *Verify:* a fixture transcript containing secrets emerges fully masked.
- **Gate 1 `[x]`:** given a real session id, we can produce a safe, redacted, streamed text
  with zero secret leakage (test-proven). Still no writes.

### Phase 2 — Distiller: session → observations `[x]`

**Done 2026-07-04; routing superseded 2026-07-06/12** — observation schema + prompt + tolerant parser, injectable MemoryDistiller, one retry. The original local-Claude runner moved to the explicit Hermes mechanical-model route below.

- **2.1 `[x]` Observation schema** — **S**
  - *Do:* Zod schema for an Observation (`class, targetSlug, isNew, body, links[]`) plus
    the model's own gate call: `decision: 'save' | 'ask'` and a short `reason`. The model
    populates `decision` from its own read of the fact's importance/value — no numeric
    threshold field. Pure, in `shared/`.
  - *Files:* new `shared/memory-observation.ts` + tests.
- **2.2 `[x]` Distiller service (model call)** — **L**
  - *Why:* G1 — the actual "understand what matters" step.
  - *Do:* `MemoryDistiller` takes redacted transcript text and returns
    `Observation[]`. It invokes Hermes oneshot with `--ignore-rules` and the canonical
    mechanical model (`deepseek/deepseek-v4-flash`); no orchestrator persona or MCP tools.
    Structured output is enforced by the schema. The prompt is engineered to
    prefer *few high-signal* facts over many noisy ones, to classify project-fact vs
    user-fact, and to set each observation's `decision` (`save` when it's confident the
    fact matters, `ask` when it isn't sure).
  - *Files:* new `electron/main/services/MemoryDistiller.ts`; prompt in a sibling file.
  - *Verify:* on a fixture "we decided X because Y" transcript, yields one decision-class
    observation with a sensible target and confidence.
- **2.3 `[x]` Dry-run command** — **M**
  - *Why:* G4/trust — see what it *would* write before it writes anything.
  - *Do:* `memory.captureSession` runs stages 1–3 and returns the proposed changes
    **without committing**; surface them in a "Proposed memory" preview in `MemoryPanel`.
  - *Files:* `registerIpc.ts`, `shared/ipc.ts`, `src/lib/mock.ts`, `src/panels/MemoryPanel.tsx`.
  - *Verify:* run against a real recent session, eyeball the proposals. Nothing on disk changes.
- **Gate 2 `[x]`:** the brain can read a session and *propose* well-classified facts, shown to
  Baz, with zero writes. This is the trust checkpoint — Baz reviews quality here before
  any auto-write is enabled.

### Phase 3 — Reconcile + gate + commit `[x]`

**Done 2026-07-04** — reconcile (NEW/MERGE/DUP/CONFLICT), gate (model decides + conflict→ask), validated+ledgered commit, review queue, full IPC + mock parity, MemoryBrainBar UI (health chips, capture, review cards). 525 tests green.

- **3.1 `[x]` Reconciliation logic** — **L**
  - *Why:* G5/G6 — dedup, merge, conflict detection. The organization brain.
  - *Do:* pure `reconcile(observation, hub)` → `{decision: NEW|MERGE|DUP|CONFLICT, ...}`
    using slug match + content similarity. Deterministic and unit-tested.
  - *Files:* new `shared/memory-reconcile.ts` + extensive tests (this is the highest-risk
    logic — cover merge and conflict paths hard).
- **3.2 `[x]` Gate + review queue** — **M**
  - *Do:* route by the model's own `decision` (`save` → commit, `ask` → review queue;
    reconcile `CONFLICT` → always review); migration `memory_review`; `reviewQueue` /
    `resolveReview` channels + mock; one-tap "Not edeyim mi?" cards in `MemoryPanel`.
  - *Files:* `Database.ts`, new `MemoryReviewService.ts`, `shared/ipc.ts`, `registerIpc.ts`,
    `src/lib/mock.ts`, `src/panels/MemoryPanel.tsx`, new `src/components/memory/ReviewCard.tsx`.
- **3.3 `[x]` Validated commit + ledger** — **M**
  - *Why:* G3/G7.
  - *Do:* commit path: validate (0.1) → `MemoryHubService.write` with wired `[[links]]`
    → ledger row (0.2). Conflicts and low-confidence never auto-commit.
  - *Files:* new `MemoryPipeline.ts` orchestrator, `MemoryHubService.ts`, `MemoryLedgerService.ts`.
  - *Verify:* end-to-end on a session: high-confidence new fact auto-saves with a ledger
    row and valid frontmatter; a conflict lands in the review queue, not on disk.
- **Gate 3 `[x]`:** capture → classify → (auto | ask) → validated write works for one session,
  triggered manually. Memory grows correctly and every write is traceable. **G1–G4, G7
  demonstrated.**

### Phase 4 — Automatic capture triggers `[x]`

**Done 2026-07-04** — durable capture queue (migration 9, idempotent, crash-recover), MemoryAutoCapture watcher (idle+recent+grown, per-sweep cap), wired + started in Services. 12 tests.

Only after 0–3 are proven does capture become hands-off.

- **4.1 `[x]` Durable capture queue** — **M**
  - *Do:* migration 7 (`memory_capture_queue`); enqueue/claim/complete with the
    idempotency key; resume incomplete jobs on app start.
  - *Files:* `Database.ts`, new `MemoryCaptureQueue.ts`.
  - *Verify:* enqueue → kill app → relaunch → job resumes exactly once (G2 test).
- **4.2 `[x]` Session-idle watcher** — **M**
  - *Do:* watch active project transcript dirs; when a session's `mtime` is stable for N
    minutes (or a session ends), enqueue it. Debounced, incremental (uses `last_offset`).
  - *Files:* new `MemorySessionWatcher.ts`, wired in `Services.ts`.
  - *Verify:* finishing a real session auto-enqueues within N minutes; an ongoing session
    is not distilled mid-flight.
- **4.3 `[x]` Background processor** — **S**
  - *Do:* drain the queue through the Phase 3 pipeline on idle; surface progress in the
    health panel; back off and record `error` on failure (never crash, never lose).
  - *Files:* `MemoryPipeline.ts`, `MemoryPanel.tsx`.
- **Gate 4 `[x]`:** working in the terminal produces reviewed/auto-saved memory with no manual
  action, and a crash never drops or double-writes. **G1+G2 fully live.**

### Phase 5 — Maintenance / consolidation ("sleep") `[x]`

**Done 2026-07-04** — analyzeConsolidation (duplicates/oversized/dangling), MemoryConsolidator (snapshot-first, queues merges as review items with alsoTrash), memory.consolidate IPC + mock, Consolidate button. 8 tests. (Scheduled/daily auto-run + full health dashboard deferred; manual pass live.)

- **5.1 `[x]` Consolidation pass** — **L**
  - *Why:* G5 — the anti-rot loop.
  - *Do:* `consolidate(brain)` snapshots the hub (0.2), then computes a maintenance diff:
    merge duplicates, resolve now-satisfiable `[[links]]`, split oversized notes, flag
    contradictions, propose pruning stale unreferenced notes. Returns the diff for review.
  - *Files:* new `MemoryConsolidator.ts`, pure helpers in `shared/memory-reconcile.ts`.
  - *Verify:* on a fixture hub with 2 duplicates + 1 dangling link, proposes exactly the
    right merges/links; snapshot taken before any change.
- **5.2 `[~]` Schedule + health dashboard** — **M**
  - *Do:* idle/daily trigger + manual "Consolidate now"; a memory-health panel showing
    counts, orphans, unresolved links, conflicts, last-consolidated, and a ledger/audit
    view with revert.
  - *Files:* `MemoryPanel.tsx`, new `src/components/memory/MemoryHealth.tsx`,
    `MemoryGraph.tsx` (surface conflicts/orphans visually).
- **Gate 5 `[~]`:** memory maintains itself; Baz can see its health at a glance and revert any
  change. **G5+G6+G7 fully live.**

### Phase 6 — Baz global brain (cross-project mastery) `[x]`

**Done 2026-07-04** — MemoryHubService fixedRoot (global hub at `<userData>/baz-memory`), pipeline routes `scope:user` facts to the Baz brain (reconcile/commit/ledger/review under `baz-global`), unified review queue, memory.bazList/bazRead IPC + mock, "Baz brain" view toggle. Pipeline routing tested.

- **6.1 `[x]` Global hub root** — **M**
  - *Do:* run `MemoryHubService` against `<userData>/baz-memory/`; address it via
    `brain: 'baz-global'` across the memory channels.
  - *Files:* `MemoryHubService.ts` (root param), `Services.ts`, `shared/ipc.ts`,
    `registerIpc.ts`, `src/lib/mock.ts`.
- **6.2 `[x]` User-fact routing** — **S**
  - *Do:* the distiller already classifies `class: user`; the pipeline routes those to the
    global brain, project-facts to the project brain.
  - *Files:* `MemoryPipeline.ts`.
- **6.3 `[x]` Global memory view** — **M**
  - *Do:* a "Baz" tab in the memory surface showing the global brain + its graph.
  - *Files:* `MemoryPanel.tsx`, `LeftRail.tsx`.
- **Gate 6 `[x]`:** facts about Baz accumulate once, globally, and are available in every
  project. The brain is now master of both the project and the person.

---

## Security & privacy (subordinate to none)

- **Redaction before the model, always** — Phase 1.2 is a hard dependency of Phase 2.
  No transcript text reaches a model un-`redactText`'d. Extend patterns whenever a
  fixture exposes a gap.
- **Renderer never receives raw secrets** — distillation and redaction run in main; the
  renderer only ever gets assembled, safe notes and proposals.
- **Local-first storage** — memory is files + local SQLite. The distiller's only memory-data
  egress is a redacted Hermes/OpenRouter model call; raw transcript text never leaves.
- **Auditable** — the ledger records every write with provenance; nothing the brain does
  is invisible.

## Model & cost notes

- **Distiller model — current hard route:** `MemoryDistiller` uses Hermes oneshot with
  `deepseek/deepseek-v4-flash` from `shared/hermes-model-policy.ts`. This supersedes the
  2026-07-04 local-Claude-only decision because background capture consumed coding quota.
  It runs without rules/tools, after redaction; if Hermes/OpenRouter is unavailable the
  capture job fails visibly/retries rather than silently switching models.
- **The model owns the judgment:** whether a fact is worth saving, and whether to save-vs-ask,
  is the model's call per observation — no numeric threshold in code. Prompt it to prefer
  *few high-signal* facts and to ask when unsure.
- **Incremental capture:** `last_offset` means only *new* turns are distilled, not the
  whole transcript every time — bounds work on long sessions.
- **Consolidation/curation** runs on the weekly due-check or manual action, never per-keystroke.
- **Lifecycle monitoring is deterministic and content-free.** Durable capture status, redacted
  audit verdicts, and review counts/age feed conservative thresholds. Only a verified pressure
  signal reaches Sentinel (where optional Flash triage may interpret it); note bodies, transcript
  paths, and raw errors never enter the lifecycle payload.

## Decisions (current; original set 2026-07-04, model/cadence later superseded)

1. **Save-vs-ask — the model decides.** No fixed `importance × confidence` threshold in
   code. The model judges each fact's importance/value itself; it saves what it's confident
   matters and asks Baz ("not edeyim mi?") when it isn't sure. Reconcile conflicts always enter
   review; a human choice or evidence-backed delegated resolver is required.
2. **Capture trigger — both.** Idle-timeout (transcript quiet for N minutes) **and** explicit
   end-of-session both enqueue a capture job.
3. **Distiller model — Hermes mechanical route.** `deepseek/deepseek-v4-flash`, explicit in
   shared code; redaction happens before invocation and no fallback silently changes authority.
4. **Consolidation cadence — weekly automatic + manual.** ("Consolidation" = the periodic
   "sleep" pass from the maintenance loop above: it re-reads the *whole* brain and cleans it
   — merges duplicate notes, fixes dangling `[[links]]`, splits notes that grew too big,
   flags contradictions. "Cadence" = how often that clean-up runs.) The app checks audit
   history and runs due projects about weekly; the manual button remains. Model curation only
   proposes review items, while deterministic consolidation snapshots first (G7), so a bad
   accepted clean-up remains recoverable.

## Definition of Done (every task)

1. `npm run typecheck` + `npm run lint` + `npm test` green.
2. New pure logic lives in `shared/` with unit tests (TDD).
3. Mock parity: `src/lib/mock.ts` still satisfies `CockpitApi`; new channels mocked.
4. Every new channel is Zod-validated in `registerIpc.ts`.
5. Nothing the brain writes can be structurally invalid (schema-checked) — G3.
6. Every write produces a ledger row — G7.
7. No file over 800 lines; no `any`; no silent catches.
8. Memory-integrity suites (schema, ledger, reconcile, redaction) are **release blockers**.

---

*The brain is only as trustworthy as its worst write. Ship the guarantees before the
features — an empty brain that never lies beats a full one that does.*
