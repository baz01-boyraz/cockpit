# Council + Memory Quality Roadmap

> Status: IN EXECUTION · R0 + C1 COMPLETE · Created 2026-07-11
> Scope: Council output quality/efficiency/usability + Brain/Memory correctness,
> retrieval and product UX
> Governing docs: `docs/DESIGN.md`, `docs/MEMORY-CHARTER.md`,
> `docs/HERMES-SWARM-PLAYBOOK.md`, `docs/memory-imp.md`,
> `docs/plans/system-roadmap.md`
> Safety rule: this plan changes no user memory. Every later migration is full-backup-first,
> dry-run-first, recovery-drilled, and non-destructive by default.
> Review: repository and three Council captures inspected; independent adversarial
> architecture review completed and P0/P1 findings incorporated.

## Türkçe yönetici özeti

Bu program iki yüzeysel redesign değil, birbirine bağlı iki güvenilirlik operasyonudur:

- Council önce kısa ve net kararı gösterecek; bütün metin mouse/klavye ile seçilebilir,
  `Cmd/Ctrl+C`, sağ tık ve butonlarla kopyalanabilir, tam rapor deterministik Markdown olarak
  export edilebilir olacak.
- “Spec’i refine et”, “diff’i review et” ve “repository’yi gerçekten analiz et” ayrı modlar
  olacak. Repository iddiası yapan her Council cümlesi doğrulanmış evidence id/file hash ile
  bağlı olacak; dış provider’a kod gönderimi açık izin ve local-only seçeneğine sahip olacak.
- Beş seat + beş uzun ranking essay modeli ölçülecek ve daha kısa structured çıktıya
  dönüştürülecek. Hedef, kaliteyi düşürmeden standard run’ı en fazla sekiz mantıksal çağrıya ve
  bugünkü toplam çıktının yaklaşık %40’ına indirmek.
- Memory silinip yeniden yazılmayacak. Markdown source of truth, mevcut charter, redaction,
  review queue, ledger, snapshots ve capability-aware retrieval korunacak.
- İlk Memory işi UI değildir: project/global brain authorization, tek mutation gateway,
  base-hash CAS, per-brain serialization ve crash sonrası devam edebilen durable mutation journal
  tamamlanmadan yeni otomasyon açılmayacak.
- Autopilot contradiction’ı “yenisi doğrudur” diye sessizce overwrite etmeyecek. Conflict,
  açıkça Hermes’e delege edilmiş bir resolver veya kullanıcı kararıyla, actor/rationale ledger’i
  ile çözülecek.
- Capture her şeyi kaydetmeyecek. Mevcut Claude capture korunacak; ilk yeni kaynaklar yalnızca
  structured Hermes/Swarm completion outcome’ları olacak. Ham terminal, bütün Council metni,
  generic file/system event ingestion ertelenecek.
- Dedup whole-note Jaccard yerine atomik fact/fingerprint seviyesinde, byte-idempotent ve
  contradiction-aware olacak. Mevcut not temizliği sadece dry-run proposal üretecek.
- Memory tipi, source, authority, lifecycle ve artifact referansı additive schema v2 ile gelecek;
  sahte “%87 confidence” gösterilmeyecek. Archive tek bir `status: archived` gerçeği olacak,
  Forget ise recoverable `.trash` olarak kalacak.
- Retrieval önce basit ve ölçülebilir lexical/BM25 sinyalleriyle geliştirilecek; frozen Türkçe/
  İngilizce holdout başarısız olmadan entity/popularity/embedding eklenmeyecek.
- Yeni Memory UI `Overview / Knowledge / Review / Diagnostics` yapısında olacak. Kullanıcı
  varsayılan ekranda ham dosya görmeyecek; raw Markdown, graph, queue, ledger ve index yine
  Diagnostics altında erişilebilir kalacak.
- Rollout tam project + Baz-global + SQLite backup bundle, pending-review rebase, shadow ranking,
  restore drill ve geçici rollback flag’leriyle yapılacak. Tek devasa task açılmayacak; roadmap
  küçük, testli ve bağımlılık sıralı Swarm kartlarına bölünecek.

## 1. Outcome

Build two systems that feel like one calm product:

1. **Council** returns a short, grounded decision first; makes the complete report
   selectable, copyable and exportable; separates spec refinement from real repository
   research; and spends model calls only where they improve the decision.
2. **Memory** remains local-first Markdown, but stops behaving like a raw file dump. It
   captures only durable candidates, reconciles at fact level, preserves provenance and
   lifecycle, retrieves a small high-quality context pack, and presents an understandable
   management surface instead of internal storage mechanics.

This is an evolution of the current architecture, not a rewrite. The current foundations
that stay are:

- `.cockpit-memory/*.md` remains the durable source of truth.
- SQLite remains operational metadata, queues, ledger, telemetry and derived read models;
  it does not become a second canonical memory store.
- Working context remains ephemeral and is not promoted automatically into durable memory.
- Existing redaction, charter gate, review queue, snapshots, trash, recall receipts and
  capability-aware context delivery are preserved and strengthened.
- Council keeps verdict-first progressive disclosure and the existing visual language.

## 2. Evidence base and corrected interpretation

### 2.1 Material reviewed

- The original “Council Task — Cockpit Memory System Analysis & Redesign” prompt.
- Three scroll captures totalling roughly 44,070 vertical pixels:
  - `.dev-cockpit/attachments/2026-07-11T05-04-06-945Z-att_f5071e150f914aa5-council-ss-1.png`
  - `.dev-cockpit/attachments/2026-07-11T05-04-15-122Z-att_f13952bd0dcd4f47-council-ss-2.png`
  - `.dev-cockpit/attachments/2026-07-11T05-04-16-906Z-att_7fa26b110edc468b-council-ss-3.png`
- The current Council service, prompts, engine runner, result model, persistence, IPC,
  renderer, history, scorecard and tests.
- The current Memory capture, distillation, reconciliation, write gate, review, curation,
  ledger, recall, context gateway, file hub, UI and tests.
- Existing project plans and relevant `.cockpit-memory` notes.

### 2.2 What the Council answer got right

- The user does not want “all files in a prettier list”; they want a curated knowledge
  system with clear lifecycle and retrieval behavior.
- Working, episodic, semantic, procedural and artifact concerns must not be collapsed into
  one undifferentiated dump.
- Deduplication, conflict handling, provenance, review and migration safety are product
  behavior, not hidden backend details.
- Raw chunks, indexes and generated internals belong in Diagnostics, not the default UI.
- UI and backend behavior must be redesigned together.
- Retrieval should be bounded and relevance-driven; agents should not receive the whole hub.

### 2.3 What must be corrected before implementation

The Council response contained plausible but unverified repository claims. The roadmap uses
the code as authority:

| Council claim / implication | Repository truth used by this plan |
|---|---|
| The hub uses `.cockpit-memory/*.md` plus a canonical `MEMORY.md` index. | Markdown note files are canonical; the link graph/index is derived. There is no canonical `MEMORY.md` index in this project. |
| Existing types are `user / feedback / project / reference`. | Managed note `class` is currently `decision / gotcha / user / reference / architecture` in `shared/memory-note-schema.ts`. |
| Every agent gets broadly similar memory context. | `shared/memory-context.ts` is capability-aware: file/tool-capable agents get a lookup contract; tool-less Council/review engines get at most two short positive-match hooks; zero-overlap gets nothing. |
| A vector/embedding store is the natural next step. | Current scale and architecture do not justify a vector database. Improve deterministic retrieval and measure misses first. |
| “Millions of files” is the literal current scale. | The project has roughly a hundred top-level notes; “millions” accurately describes cognitive overload, not storage cardinality. |
| GPT 5.6 Sol is not represented in the repository. | Sol/Terra/Luna engine aliases are explicitly defined in `shared/council.ts`. |
| The Memory foundation is mostly absent. | Capture queue, distiller, review gate, snapshots, trash, ledger, curation, recall telemetry and context receipts already exist. The problem is policy drift, weak reconciliation/retrieval, incomplete mutation consistency and a file-centric UI. |

### 2.4 Important gaps the Council response did not surface

1. `body { user-select: none; }` blocks normal Council text selection and Council does not
   opt content back into `user-select: text`.
2. `CouncilPanel.tsx` copies only the refined spec through
   `navigator.clipboard.writeText`; it has no fallback, full-report serialization or
   section-level copy.
3. The current run can perform 11 logical model calls (5 seats + 5 peer rankings + one
   chairman), with additional fallback attempts. The captured run converged heavily onto
   Claude fallbacks, reducing the diversity the UI implies.
4. Seat, ranking and chairman prompts have no enforceable stage-specific output budget;
   OpenRouter calls do not send `max_tokens`.
5. Council’s `spec` mode refines a task for a downstream builder. It is not the same thing
   as a grounded, read-only repository analysis. The original prompt expected the latter.
6. `CouncilSessionStore.listRecent()` selects and parses full `result_json` blobs even for
   compact history and scorecard reads; the panel triggers overlapping reads.
7. Memory trust is a renderer/localStorage policy. Background behavior is therefore not
   reliably governed when the Memory panel is closed.
8. Autopilot conflict policy contradicts its own comments and older policy notes: current
   code can accept conflicts by recency while UI comments still promise conflicts wait.
9. A queued review can overwrite a note that changed after the proposal was created; there
   is no base-hash compare-and-swap at acceptance time.
10. Human UI writes and accepted Hermes writes can bypass the same validation/ledger path
    used by `MemoryPipeline`.
11. Curation “archive” acceptance currently re-saves identical content; it does not archive.
12. Dedup compares an incoming fact with a whole accumulated body using Jaccard similarity,
    then merges by blindly appending. Idempotency degrades as notes gain bullets.
13. The capture watcher automatically mines Claude sessions, but there is no explicit,
    audited source-coverage policy for Hermes, Codex, Swarm outcomes, Council decisions,
    files or artifacts.
14. The UI repeatedly reads file content to assemble lists/health and exposes a three-zone
    file manager rather than a quality-oriented memory read model.

## 3. Product and architecture decisions

These decisions are binding for the roadmap unless a measured experiment disproves one.

### 3.1 Council decisions

- **Three explicit intents:**
  - `spec`: refine/gate a request before Swarm.
  - `diff`: review an actual change set.
  - `analysis`: perform a read-only, repository-grounded investigation and return a concise
    report plus an optional downstream implementation brief.
- **Decision first, evidence on demand.** Default UI shows status, one-paragraph rationale,
  questions/risks and the primary artifact. Raw seat prose and engine diagnostics are
  secondary.
- **One canonical result contract.** The chairman returns normalized fields; Markdown is a
  presentation/export format, not the only machine contract.
- **Claims declare their basis:** `input`, `repository`, `memory`, or `inference`.
  Repository claims require a file/evidence reference. Tool-less seats may reason only from
  the bounded evidence pack they receive.
- **Length is budgeted per stage.** A complex refined spec may be long because it is the
  artifact, but five repetitive essays and five repetitive ranking essays are not allowed.
- **Actual execution is shown honestly.** UI and telemetry use the engine that actually ran,
  fallback attempts, provider diversity, duration and output size—not the configured primary
  label.
- **Council output is not automatically durable Memory.** An approved decision or completed
  task may emit one memory candidate; the full deliberation remains a Council artifact.

### 3.2 Memory decisions

- **Markdown remains canonical.** No cloud memory store and no vector database in the first
  implementation program.
- **Logical layers do not equal five physical stores:**
  - Working memory is ephemeral task/session state and never a durable note by default.
  - Episodic, semantic and procedural are durable note types.
  - Artifacts remain files/attachments/reports; notes reference them instead of copying
    binaries or giant outputs into the hub.
- **Existing `class` is preserved.** A new optional `memoryType` is additive and can initially
  be derived from existing class. Old notes remain valid.
- **No fake precision.** Do not display uncalibrated values such as “confidence 87%.” Use
  evidence-backed discrete authority (`user-confirmed`, `repo-verified`, `agent-inferred`),
  lifecycle status and source reliability. Numeric confidence is deferred until calibrated.
- **One mutation gateway.** Human edit, Hermes write, auto-capture, review acceptance,
  curation, rename, archive, trash and migration all share structural validation,
  concurrency control, atomic file write and ledger rules. The charter’s semantic write gate
  still applies only to agent-initiated writes; human edits remain quality-gate-free.
- **Conflicts never become silent “newer wins.”** Autopilot may commit new facts and safe,
  idempotent merges. A contradiction requires an explicit resolver decision (Hermes when the
  project policy delegates it, otherwise the user), recorded with actor and rationale.
- **Volatile usage metadata stays out of Markdown.** Access counts, last recall, ranking
  traces and index health live in SQLite/derived indexes so recalls do not churn Git files.
- **Archived and forgotten are different.** Archive is inactive-but-restorable and excluded
  from retrieval; Forget moves to recoverable trash. Neither hard-deletes.

### 3.3 Target Council flow

```text
user request
  -> explicit intent (spec | diff | analysis) + response language
  -> bounded, redacted evidence pack + memory receipt
  -> 5 independent, length-bounded seat assessments
  -> bounded peer judgement (candidate strategy measured in shadow mode)
  -> structured chairman decision
  -> compact session summary + raw evidence artifact
  -> verdict-first UI / copy-export / lazy diagnostics
```

### 3.4 Target Memory flow

```text
authorized source event
  -> candidate envelope (source, scope, evidence, cursor/idempotency key)
  -> redact + distill durable atomic facts
  -> fact-level candidate search + duplicate/contradiction classification
  -> charter/safety gate + compare-and-swap mutation decision
  -> commit OR typed review action
  -> Markdown source + immutable ledger + derived index
  -> retrieval ranker (relevance + scope + authority + lifecycle + recency)
  -> capability-aware bounded context gateway
  -> agent receipt / recall telemetry / user-facing “where used”
```

## 4. Success metrics and release guardrails

Baselines are captured in R0. Relative improvements are measured against the same frozen
corpus and machine profile; no dashboard may imply causation or accuracy it cannot prove.

### Council quality and efficiency

- Default decision surface is understandable without opening raw evidence.
- Every rendered report can be selected with mouse/keyboard and copied through button,
  `Cmd/Ctrl+C`, and a scoped context-menu action.
- Full-report export is deterministic Markdown and contains decision, refined spec/report,
  key evidence, actual engines, fallbacks and session id.
- Default UI repeats the refined spec exactly once.
- Seat outputs: at most 3 high-signal findings per seat (Builder may add a bounded execution
  note); normalized text target <= 2,500 characters per seat.
- Peer judgement target <= 1,200 characters per judge; chairman summary target <= 1,500
  characters, excluding the separately bounded refined spec/analysis artifact.
- Standard Council target <= 8 logical model calls after the peer-stage experiment; physical
  attempts are hard-capped and provider-wide failures short-circuit within a run.
- Median total generated characters falls at least 60% from the R0 baseline without a
  severity-weighted issue-recall regression greater than the predeclared eval tolerance.
- Unsupported repository claims and wrong file citations are zero on the release corpus.
- History list and scorecard reads do not parse full raw evidence blobs.

### Memory correctness and retrieval

- Replaying the same candidate is idempotent: no repeated bullet, twin note or second review.
- Accepting a stale review cannot overwrite a newer note; it rebases or returns to conflict.
- Every mutation has an actor, source, idempotency key and before/after hash. In-app mutations
  retain recoverable prior bytes for a documented recovery window; after that window the ledger
  is explicitly audit evidence, not a false claim that a hash can restore content.
- Agent-written secret-shaped content never reaches Markdown, review payloads or external
  prompts. Human editing retains control but receives the same hard secret safety boundary.
- Superseded, archived, conflicted or rejected facts are never injected automatically.
- Curated bilingual retrieval corpus target: expected note appears in top 3 for >= 90% of
  positive queries; unrelated/no-match injection remains 0%; p95 local retrieval < 100 ms at
  1,000 synthetic notes on the reference dev machine.
- Tool-less inline context remains <= 1,200 characters and <= 2 notes unless a later eval
  explicitly changes the cap. File/tool-capable agents keep the compact lookup contract.
- The user can answer “what is remembered, why, from where, whether it is trusted, and where
  it was used” from the normal UI without reading raw Markdown.
- Migration loses zero note bytes; the backup/restore drill covers project brain, Baz-global
  brain, active/archived/trash/history bytes, pending reviews, settings and capture cursors—not
  only top-level project notes.

### UX and accessibility

- Default Memory opening is Overview, not a raw file tree.
- Raw Markdown, graph internals, capture queue, ledger and index details are available under
  Diagnostics/Advanced rather than removed.
- All primary actions have idle/hover/focus/disabled/loading/success/error states.
- Keyboard navigation, text selection, focus order, screen-reader names and reduced-motion
  behavior are tested.
- Visual QA at compact, normal and wide desktop widths; no content requires a 44k-pixel
  scroll capture to be usable.

## 5. Dependency map and execution waves

```text
R0 Baseline + contracts
 ├─ Council lane: C1 -> C2 -> C3 -> C4 -> C5 ───────────────┐
 └─ Memory lane: M1 policy/scope                            │
                  -> mutation journal + authorization       │
                  -> review CAS/actions                     │
                  -> M2a distiller/cursor integrity         │
                  -> M3 fact reconciliation                 │
                  -> M2b source adapters                    │
                  -> M4 lifecycle/index                     │
                  -> M5 retrieval -> M6 UX ─────────────────┤
                                                            └─ R1 rollout
```

Council and Memory lanes may run in parallel with each other. Within a lane the arrows are the
integration order. Pure fixtures/experiments may be prepared earlier, but no downstream contract
lands before its dependency.

Recommended waves:

| Wave | Parallel work | Exit condition |
|---|---|---|
| 0 | R0 only | Frozen fixtures, baselines, invariants and rollback manifests exist. |
| 1 | C1 + M1a policy/scope | Council is copyable; brain authorization/trust semantics are locked. |
| 2 | C2 + M1b/M1c mutation journal, authorization, CAS/actions | Council contract is bounded; Memory writes are crash-recoverable and scoped. |
| 3 | C3 + M2a, then M3 | Grounded analysis and Memory distiller/reconciliation integrity are stable. |
| 4 | C4 + M2b, then M4 | Engine execution truth, approved source adapters and lifecycle/index are stable. |
| 5 | C5 + M5 | Compact reads and retrieval quality clear eval gates. |
| 6 | M6 | New user-facing Memory experience runs on proven contracts. |
| 7 | R1 | Shadow/dogfood evidence passes; flags removed only after full backup/restore drill. |

Effort bands are implementation/review complexity, not calendar promises:
`S = <= 1.5 engineer-days`, `M = 2–4`, `L = 5–8` on the current repository.

### 5.1 Card granularity and file ownership

No Swarm card may contain both a Council package and a Memory package, and no card may claim
an entire `L` package. Split the large packages at these review boundaries:

| Package | Reviewable cards |
|---|---|
| C2 | C2a result types + legacy adapter; C2b prompts/parsers/budgets; C2c IPC/store/renderer adoption |
| C3 | C3a read-only evidence pack; C3b analysis orchestration + claim validation; C3c sources UI/eval |
| C4 | C4a run-scoped attempt telemetry/circuit breaker; C4b offline peer-strategy experiment; C4c promoted strategy + diagnostics |
| M1 | M1a policy/trust + brain authorization; M1b mutation gateway + lock/CAS; M1c durable mutation journal/recovery; M1d typed reviews/archive/ledger routing |
| M2 | M2a self-ingestion/empty-result safety; M2b source envelope/registry; M2c one source adapter at a time |
| M3 | M3a fact parser/fingerprints; M3b reconcile/merge pipeline; M3c cleanup dry-run/report |
| M4 | M4a schema v2 round-trip/lifecycle; M4b archive semantics; M4c derived index/rebuild |
| M5 | M5a eval harness; M5b candidate search/ranker; M5c context gateway integration/shadow telemetry |
| M6 | M6a read API + Overview; M6b Knowledge + Detail; M6c Review + Diagnostics + old-panel parity |
| R1 | R1a full backup/preview; R1b schema/data migration; R1c retrieval shadow; R1d UI dogfood/rollback drill; R1e legacy-write removal |

Every card includes its own targeted tests and one observable acceptance outcome. Shared hot
files are serialized even when conceptual work can run in parallel:

- `electron/main/services/CouncilService.ts`, `shared/council.ts`,
  `shared/council-prompts.ts`: one Council card at a time.
- `electron/main/services/MemoryPipeline.ts`, `shared/memory-observation.ts`,
  `shared/memory-note-schema.ts`: one Memory
  contract card at a time.
- `shared/ipc.ts`, `shared/schemas.ts`, `electron/main/ipc/registerIpc.ts`, `src/lib/mock.ts`: one integration
  owner per wave.
- `electron/main/db/schema.ts` and `Database.ts`: one migration-number owner for the whole wave;
  no parallel card independently chooses a schema version.

Each implementation card goes through the project’s normal interview/spec-gate/Swarm flow.
This roadmap is the parent source; Council may tighten one card, but must not expand it back into
a monolithic “implement the whole roadmap” brief.

## 6. Detailed implementation roadmap

### R0 — Freeze truth, eval corpora and safety contracts (M)

> Completed 2026-07-11. Baseline contract and measured results:
> `docs/plans/council-memory-r0-baseline.md`. This milestone changed no product behavior and
> wrote no user Memory data.

**Goal:** create a repeatable baseline before changing prompts, data models or UI.

**Work:**

1. Record Council metrics for a representative set of spec, diff and research-shaped tasks:
   logical calls, physical attempts, providers, fallbacks, input/output characters, duration,
   verdict, factual claims, duplicate sections and report bytes.
2. Create a committed synthetic Council corpus and a local-only redacted corpus from real
   sessions. Label critical issues, severity, forbidden claims and expected intent
   (`spec/diff/analysis`); freeze an untouched holdout. Corpus changes require a documented,
   independently rechecked reason, so prompt changes cannot improve scores by relabelling.
3. Create a bilingual Memory retrieval corpus with at least 60 queries: balanced Turkish/English
   positives plus ambiguous, stale/conflicting and no-match cases, split into tuning and untouched
   holdout sets. Label expected top notes and severity of misses. Keep committed fixtures
   synthetic; keep real note bodies out of new test artifacts unless already intentionally
   versioned.
4. Export the current hub manifest: slug, byte size, content hash, frontmatter validity,
   duplicate candidates, repeated bullets, unresolved links, current review queue and latest
   snapshot id. Do not modify notes.
5. Add explicit invariant tests: Markdown is canonical, old schema notes remain readable,
   empty retrieval injects nothing, context caps hold, secret redaction holds, and no migration
   writes without a snapshot.
6. Document metric definitions so “quality,” “useful,” “confidence” and “duplicate” cannot be
   reinterpreted between cards.

**Likely files:**

- `test/fixtures/council/**` and `test/fixtures/memory/**` (synthetic only)
- `test/council-eval.test.ts` (new)
- `test/memory-retrieval-eval.test.ts` (new)
- `scripts/diagnostics/council-baseline.mjs` (new, read-only)
- `scripts/diagnostics/memory-manifest.mjs` (new, read-only)
- `docs/plans/council-memory-quality-roadmap.md`

**Acceptance / verification:** same fixtures produce deterministic labels/manifests; scripts
are read-only; no `.cockpit-memory` diff; `npm run typecheck`, `npm test`, `npm run lint` pass.

**Rollback:** delete only the new diagnostics/fixtures. There is no product or user-data write.

---

### C1 — Council P0: select, copy, export and remove visual repetition (S–M)

**Completed 2026-07-11.** Council text is selectable; primary/full/section/seat,
keyboard and scoped context-menu copy paths share one tested clipboard fallback;
deterministic Markdown export uses result data rather than DOM scraping. The refined spec is
rendered once, safe Markdown rendering covers emphasis/rules/links/fenced code, and the
cross-session scorecard now lives under History. Verification passed at 1024, 1280 and 1600 px,
with the full unit/integration, coverage and seven-journey Playwright suites green.

**Goal:** solve the immediate failure shown by the screenshots without waiting for backend
redesign.

**Work:**

1. Opt Council prose, refined spec, questions, seat bodies and evidence back into
   `user-select: text`; keep buttons/chips non-selectable.
2. Extract the proven clipboard fallback pattern from `HermesWidget.tsx` into a shared helper:
   async Clipboard API first, hidden textarea + `document.execCommand('copy')` fallback,
   deterministic success/failure state.
3. Add actions:
   - Copy primary brief/report.
   - Copy full Council report.
   - Copy an individual section/seat.
   - Scoped right-click Copy and Select all for Council text.
4. Add a pure `serializeCouncilReport(result)` Markdown exporter. Export uses actual seat
   engines/fallback flags and stable headings; it never scrapes DOM text.
5. Render the refined spec once. The decision summary may show a short Goal/AC preview, but
   it must link/scroll to the single canonical brief rather than repeating the entire text.
6. Extend the Markdown subset for emphasis, thematic breaks, links and fenced code, or adopt
   the repository’s existing safe renderer if it meets Electron/XSS constraints.
7. Move the cross-session scorecard out of “How Council reached this run” into History/Usage;
   current-run evidence must contain only current-run material.
8. Preserve the current “Nothing has started yet” boundary and make the primary CTA explicit:
   copy, open Swarm, or continue clarification.

**Likely files:**

- `src/panels/CouncilPanel.tsx`
- `src/components/CouncilVerdict.tsx`
- `src/components/CouncilScorecard.tsx`
- `src/lib/clipboard.ts` (new)
- `shared/council-display.ts`
- `src/styles/council-view.css`, `src/styles/council-verdict.css`
- `test/council-display.test.ts`, Council renderer/E2E tests

**Acceptance / verification:** mouse drag and keyboard selection work; all copy paths are
tested with Clipboard API available and rejected; full export round-trips expected sections;
no raw `---`/single-emphasis artifacts; one refined spec in the accessibility tree; visual
screenshots at three desktop widths.

**Rollback:** UI-only revert; persisted `CouncilResult` is unchanged.

---

### C2 — Council v3 result contract, intent and hard output budgets (L)

**Goal:** make concision and intent part of the domain model rather than a prompt suggestion.

**Work:**

1. Version the result (`schemaVersion`) and add a normalized decision object while retaining a
   legacy adapter for stored v2 results:
   - `mode`, `responseLanguage`
   - `decision.kind`, `summary`, `why`
   - bounded `questions`, `keyFindings`, `dissent`
   - one `primaryArtifact` (`refinedSpec`, `analysisReport`, or diff verdict)
   - execution stats and raw evidence kept separately
   The adapter is shared by every consumer, not renderer-only: `composeCouncilBrief`, Hermes,
   Swarm’s spec gate and `OutcomeService` must all read v2/v3 consistently. `analysis` results
   can never satisfy an approved Swarm spec gate or enter spec-gate outcome statistics.
2. Add explicit `analysis` mode. Do not infer execution: UI asks/labels whether the user wants
   request refinement, code-change review, or repository analysis. A compatibility classifier
   may recommend a mode, but the selected mode is stored.
3. Make output language follow the user input unless explicitly overridden. Machine headings
   and enum parsing remain language-stable; human prose does not randomly switch languages.
4. Convert seat output to a tolerant structured envelope (finding, impact, recommendation,
   basis, evidence reference). Accept legacy prose during transition, but normalize/cap before
   ranking and chairman input.
5. Define an engine capability matrix and enforce stage budgets honestly at four layers:
   - prompt contract (finding and character limits),
   - provider-enforced generation cap where supported (`max_tokens` for OpenRouter),
   - hard chairman-input cap for every engine,
   - hard persisted/rendered cap plus one bounded corrective retry or graceful truncation that
     never cuts required machine fields.
   Claude/Codex CLI prompt targets are soft generation targets unless their runner exposes a
   real token cap; do not report them as provider-enforced cost/latency limits.
6. Replace full ranking essays with a compact schema: ordered labels, strongest contribution,
   collective gap, factuality flags. The chairman receives normalized unique gaps and aggregate
   rank, not five repeated ranking essays.
7. Keep the refined spec/report separately bounded (initial ceiling 12,000 chars, measured in
   R0); a task exceeding it must be summarized plus linked/exported, not silently cut.

**Likely files:**

- `shared/council.ts`, `shared/council-prompts.ts`, `shared/council-display.ts`
- `electron/main/services/CouncilService.ts`, `EngineRunner.ts`
- `electron/main/services/hermes/hermesToolsCouncil.ts`
- `electron/main/services/SwarmService.ts`, `OutcomeService.ts`
- `shared/ipc.ts`, `shared/schemas.ts`, `electron/main/ipc/registerIpc.ts`
- `src/store/slices/councilSlice.ts`, `src/lib/mock.ts`
- `test/council.test.ts`, `test/council-llm.test.ts`, `test/council-service.test.ts`

**Acceptance / verification:** old persisted sessions still render/export; new results parse
without Markdown archaeology; stage caps hold under adversarial verbose fake engines; Turkish
input produces Turkish human prose; Hermes still receives only compact gate payload; analysis
cannot authorize a Swarm card; outcome scorecards distinguish analysis from approved specs;
baseline critical-issue recall stays within the predeclared tolerance.

**Rollback:** feature flag writes v2-compatible raw fields and reads both versions. Never
rewrite old session blobs in place.

---

### C3 — Grounded repository-analysis mode and claim provenance (L)

**Goal:** make the original Memory task’s “inspect the repository, do not assume” request a
real Council capability instead of letting tool-less seats hallucinate repository facts.

**Work:**

1. Add a deterministic, bounded, read-only evidence collection stage for `analysis` mode. It
   consumes no model call and produces an
   `EvidencePack` with evidence ids, file paths, relevant snippets/symbols, current schema/API
   facts, redacted memory receipts and explicit unknowns.
   Collection reuses/extends `shared/diff-sanitize.ts`: repository-root and symlink containment,
   sensitive-path exclusion, ignored/generated/binary/lockfile rules, per-file/total character
   caps, maximum file count and redaction. It uses allowlisted read operations/repository
   services; it is not a general shell/code-execution surface.
2. Keep the evidence collector separate from the five opinion seats. Seats critique the same
   fact pack and may not establish repository facts outside it. Any suggested missing evidence
   becomes an explicit unknown/follow-up; it cannot bypass the same collection boundary.
3. Mark every chairman claim as `input`, `repository`, `memory`, or `inference`. Inference must
   read as inference, not repository fact.
4. Add a contradiction pass against the evidence pack before finalization. Unsupported file,
   table, enum or API claims are removed or marked unverified.
5. Surface a compact “Sources used” block and Memory receipt in evidence. Never expose note
   bodies, secrets or huge source dumps.
6. Store repository/worktree identity and content hashes with evidence references so freshness
   is visible. Persist bounded cited evidence only when required to make the saved report
   intelligible; never create a second permanent raw repository corpus in `result_json`.
7. Before any snippet is sent to OpenRouter or another remote provider, show/obey the Council
   data-egress setting: allowed providers, local-only option, content caps and explicit consent.
   Redaction and path filtering occur before persistence and before network calls.
8. Clarify UI behavior: analysis is read-only and produces a report; it does not edit code or
   start Swarm. The resulting implementation brief is a separate copyable artifact.

**Likely files:**

- `shared/council-evidence.ts` (new)
- `electron/main/services/CouncilEvidenceService.ts` (new)
- `electron/main/services/CouncilService.ts`
- `shared/council-prompts.ts`, `shared/council.ts`
- `src/components/CouncilVerdict.tsx`
- `test/council-evidence.test.ts`, `test/council-service.test.ts`

**Acceptance / verification:** the original Memory prompt on the frozen repo identifies the
real note schema/classes, source-of-truth model, retrieval contract and absence of a canonical
`MEMORY.md`; a tool-less seat cannot introduce an uncited repository fact; secret/redaction
tests, symlink/path-escape fixtures, provider-consent/local-only behavior and prompt-injection
fences remain green. The evidence collector adds zero Council model calls.

**Rollback:** disable `analysis` mode; `spec` and `diff` continue on the C2 contract.

---

### C4 — Engine truth, diversity, call budget and peer-stage experiment (M–L)

**Goal:** reduce latency/cost and misleading diversity without weakening decisions.

**Work:**

1. Add per-run provider health/circuit breaking. Missing OpenRouter key, auth/credit failure or
   a repeated provider outage is detected once; remaining known-dead attempts are skipped.
2. Store every actual attempt: stage, configured engine, actual engine, provider, fallback
   reason class, duration, input/output chars/tokens when available. Never persist secret/error
   bodies.
3. Store chairman engine provenance and ranking engine provenance, not only seat provenance.
4. Replace static scorecard engine labels with actual-run data. Show “degraded diversity” when
   multiple seats collapsed onto one provider.
5. Define a hard physical-attempt ceiling per run and a clear degraded result when it is hit.
   Attempt slots are reserved atomically before parallel dispatch, so `Promise.all` cannot race
   past the ceiling. A fallback cannot create an unbounded retry tree.
6. Shadow-test peer strategies on the R0 corpus:
   - current five peer rankings,
   - two rotating independent peer judges,
   - chairman-only scoring.
   Promote the cheapest strategy that is non-inferior on critical-issue recall, factuality and
   ranking stability. Initial product target is five seats + two judges + one chairman = eight
   logical calls, but measurement—not preference—chooses the winner.
7. Add run-scoped cancellation and stage-level progress so abandoning one run stops only that
   run’s outstanding calls, accurately marks the session, and never kills another concurrent
   Council/Hermes engine process.
   Persist `cancelled` distinctly from `failed`, propagate one `AbortSignal` through CLI child
   ownership and HTTP fetches, and keep circuit/attempt state keyed by run id.

**Likely files:**

- `shared/council.ts`, `shared/council-history.ts`
- `electron/main/services/EngineRunner.ts`, `CouncilService.ts`
- `electron/main/db/CouncilSessionStore.ts`
- `src/components/CouncilScorecard.tsx`, Council diagnostics UI
- `test/council-llm.test.ts`, `test/council-service.test.ts`, engine-runner tests

**Acceptance / verification:** known-dead providers are attempted once per run; attempt cap is
proved under all-failure tests; UI names actual engines; cancellation leaves no child process;
two concurrent runs prove cancellation/circuit state never crosses run ids; promoted peer
strategy meets the R0 quality gate and materially reduces calls/output.

**Rollback:** switch peer strategy/config to current five-ranker path; attempt telemetry remains
read-only and backward compatible.

---

### C5 — Compact Council persistence and lazy raw evidence (M)

**Goal:** stop parsing/transferring giant result blobs for history and scorecard operations.

**Work:**

1. Split store read methods by intent:
   - compact session summaries from existing columns,
   - compact scorecard inputs/aggregate projection,
   - full detail by session id only when opened/exported.
2. Remove `SELECT *` from recent/scorecard paths. Add an explicitly versioned, additive compact
   projection to `council_sessions` (for example `result_schema_version`, `summary_json`,
   `aggregate_json`, `result_bytes`) and write it with every new result. A validated migration or
   lazy one-time backfill derives compact fields for legacy rows; raw `result_json` remains
   untouched. This is required—not conditional on later profiling—because the acceptance contract
   forbids full-blob parsing on history/scorecard paths.
3. Make the renderer load summaries first and lazy-load raw evidence when the user expands
   “How Council reached this.” Deduplicate concurrent detail requests.
4. Track result bytes and provide storage health in Diagnostics. Do not auto-delete history in
   this roadmap; future retention requires a user-visible policy and export.
5. Keep corrupt-row behavior defensive: one bad blob cannot sink history or scorecard.

**Likely files:**

- `electron/main/db/CouncilSessionStore.ts`
- `electron/main/db/schema.ts`, `electron/main/db/Database.ts`
- `electron/main/services/CouncilService.ts`
- `shared/council-history.ts`, `shared/ipc.ts`, `shared/schemas.ts`
- `electron/main/ipc/registerIpc.ts`
- `src/panels/CouncilPanel.tsx`, `src/store/slices/councilSlice.ts`, `src/lib/mock.ts`
- `test/council-history.test.ts`, `test/council-service.test.ts`, IPC parity tests

**Acceptance / verification:** opening Council history transfers no seat/ranking prose;
scorecard reads do not JSON-parse raw seat text after migration/backfill; expanding one session
issues one detail call; migration is idempotent and legacy/corrupt/pending/failed sessions remain
honest.

**Rollback:** compact methods can fall back to current `get/listRecent`; no destructive DB
migration and no result deletion.

---

### M1 — Canonical Memory policy and concurrency-safe mutation gateway (L)

**Goal:** make every write path obey one explicit integrity model before changing retrieval or
UI.

**Work:**

1. Publish one machine-readable policy used by prompts, services and UI:
   source classes, semantic gate rules, trust modes, conflict policy, archive/forget semantics,
   actor vocabulary and ledger requirements. Remove contradictory comments/copy.
2. Move trust mode from renderer `localStorage` into brain-scoped main-process settings.
   Project brains and `baz-global` each have an explicit policy; global review behavior never
   depends on whichever project panel happens to be open. Background capture and review
   resolution use the same policy when Memory UI is closed. `baz-global` defaults to Assisted
   unless the owner explicitly delegates more authority; it never inherits a project setting.
3. Recommended trust behavior:
   - Autopilot: commit high-quality new facts and proven idempotent merges; route conflicts to
     an explicit delegated resolver (Hermes where configured) or review.
   - Assisted: auto-commit new facts only; merge/conflict ask.
   - Manual: every proposal asks.
   No mode silently applies “newer wins” to contradictions.
4. Make review access brain-authorized. Every list/get/resolve request carries target brain and
   origin project; project A cannot read, discard, resolve or transplant project B’s proposal.
   Global proposals use an explicit `baz-global` scope, never a caller-supplied project fallback.
5. Add `MemoryMutationService` (or equivalent single command layer) for create/update/merge/
   replace/rename/archive/trash/restore. Route renderer IPC, Hermes, capture, consolidator,
   curation, Sentinel, snapshot restore and future adapters through it; wire it in `Services.ts`.
   All routes share path safety, managed-frontmatter validation, secret boundary, actor/source
   and ledger rules.
6. Add optimistic concurrency: proposal/edit carries `baseHash`; commit compares current hash.
   A stale proposal is re-reconciled or becomes a fresh conflict, never overwrites.
7. Serialize in-app mutations per brain so simultaneous capture, Hermes and UI writes cannot
   lose updates. External Markdown edits cannot take this lock: detect them by mtime/hash,
   invalidate the read model and force CAS rebase/conflict rather than claiming they are locked.
8. Add a durable cross-store mutation state machine with an idempotency key:
   `prepared -> file-applied -> ledgered -> review-resolved`. Filesystem writes use sibling temp
   + atomic rename; SQLite records phase transitions. Boot recovery inspects file hashes and
   resumes/repairs incomplete commands, so a crash cannot leave an unledgered write or replay a
   still-pending accepted review.
9. Retain recoverable prior bytes for each in-app mutation in a bounded local version journal
   with an explicit recovery/retention policy. Ledger hashes prove history but are not presented
   as restore data. Bulk operations additionally use a full backup/snapshot.
10. Type review actions explicitly (`create`, `merge`, `replace`, `archive`, `split`) instead of
   inferring behavior from `kind`, title or `alsoTrash`.
11. Make `status: archived` the single canonical archive representation; do not also create a
   competing `.archive/` truth. Curation archive acceptance updates lifecycle through the
   mutation journal and excludes the note from retrieval. Trash/Forget remains a separate
   recoverable move to `.trash/`.
12. Snapshot/backup before multi-note rename/link refresh, consolidation, archive batches and
   migration. The backup contract covers project and global brains plus internal state required
   to recover, not only top-level project notes.
13. Ensure human edits bypass the 7-day/dedup semantic gate while still receiving structural,
    secret, concurrency and ledger protection.
14. Version review payloads with `brain`, `originProjectId`, typed operation, `candidateId`,
    `baseHash` and source. Reject secret-shaped content before queue insertion and enforce a
    unique idempotency key so replay cannot create a second review.
15. Define resolved-review payload lifecycle. Full proposed/existing bodies are needed while a
    review is pending, but after resolution they are compacted to action, rationale and hashes
    after a documented recovery window; Forget/archive removes them from active indexes. Never
    keep duplicate private note bodies indefinitely merely for analytics.

**Likely files:**

- `shared/memory-policy.ts` (new), `shared/memory-review.ts`, `shared/memory-ledger.ts`
- `electron/main/services/MemoryMutationService.ts` (new)
- `electron/main/services/MemoryHubService.ts`, `MemoryPipeline.ts`, `MemoryReviewService.ts`,
  `MemoryCurationService.ts`, `MemoryLedgerService.ts`
- `electron/main/services/SentinelService.ts`, `electron/main/services/Services.ts`
- `electron/main/services/hermes/hermesToolsMemory.ts`
- `electron/main/ipc/registerIpc.ts`, `electron/main/db/schema.ts`,
  `electron/main/db/Database.ts`
- `src/lib/memoryTrust.ts`, `src/components/memory/MemoryBrainBar.tsx`
- IPC/schema/mock parity files and memory mutation/review/concurrency tests

**Acceptance / verification:** project A cannot list/resolve/transplant project B reviews; global
trust never inherits active-project mode; race test with UI edit + capture + review cannot lose
content; stale/external-edit review is blocked/rebased; crash injection at every journal phase
recovers idempotently; prior bytes restore within policy; every direct writer goes through the
gateway; archive acceptance changes canonical lifecycle and retrieval; behavior is identical with
panel mounted/unmounted.

**Rollback:** old notes remain readable; new settings/payloads have safe defaults; stop new
mutations, finish/recover every journal entry, then switch routes. Restore the full pre-batch
backup for bulk actions—never bypass an unfinished journal by flipping a UI flag.

---

### M2 — Capture integrity, self-ingestion guard and source registry (M–L)

**Goal:** know exactly what can create a candidate and prevent silent loss or recursive memory
pollution.

**Work:**

1. Define a source registry/coverage matrix: Claude transcript, Hermes task summary, Codex task
   summary, Swarm completion/outcome, Council approved decision, user note, file/artifact
   reference and system event. Each source declares trigger, cursor/idempotency key, redaction,
   origin project/brain authorization, default durability and whether explicit approval is
   required. This is a coverage map, not authorization to implement every adapter.
2. Preserve the current Claude idle/exit capture. First add only structured completed Swarm and
   Hermes outcomes, one adapter/card at a time. Defer broad Codex transcript, generic file/system
   events and automatic Council capture until miss analysis proves value. Never ingest raw
   terminal logs, every Council essay, every file change or arbitrary system event.
3. Extend `Observation` with source kind/ref, evidence digest, stable candidate id and atomic
   facts. Validate source identity before it reaches reconciliation.
4. Strengthen automatic-context stripping. Detect when the distiller output echoes its own
   prompt, the Memory contract or previously injected note text.
5. Distinguish valid `[]` (“nothing durable”) from suspicious empty/recursive/malformed output.
   Suspicious results retry with a clean minimal prompt and then remain an auditable queue error;
   they never advance the cursor as successful data loss.
6. Record capture coverage and failure reason classes without transcript/note content. Expose
   last successful capture and source gaps in Diagnostics.
7. If a later Council adapter clears its separate eval, it may emit at most one candidate from
   an approved durable decision or completed implementation outcome; it stores a session/artifact
   reference, not deliberation. It is not part of the first source-adapter release.

**Likely files:**

- `shared/memory-source.ts` (new), `shared/memory-observation.ts`, `shared/memory-context.ts`
- `electron/main/services/MemoryDistiller.ts`, `MemoryAutoCapture.ts`,
  `MemoryCaptureQueue.ts`, `MemoryPipeline.ts`, `TranscriptReader.ts`
- Council/Swarm completion hooks only where a structured source is added
- `test/memory-distiller.test.ts`, `test/memory-auto-capture.test.ts`,
  `test/memory-capture-queue.test.ts`, source-registry tests

**Acceptance / verification:** recursive prompt fixture is rejected; valid empty advances only
under explicit valid-empty semantics; duplicate source event is idempotent; raw Council/terminal
output never becomes a note; failure telemetry contains no content/secrets.

**Rollback:** disable new source adapters individually; current Claude capture continues.

---

### M3 — Fact-level deduplication, idempotent merge and contradiction handling (L)

**Goal:** stop note growth and conflict mistakes at the reconciliation layer.

**Work:**

1. Replace whole-body-only comparison with atomic fact units: normalized bullets/paragraphs,
   exact fingerprints, token similarity and candidate note scoring by slug/title/hook/class.
2. Compare each incoming fact against existing facts. Outcomes are explicit:
   `exact_duplicate`, `supports_existing`, `extends_existing`, `supersedes`, `contradicts`,
   `new_note`.
3. Make merge byte-idempotent. Never append an observation whose fact fingerprint already
   exists; do not wrap multi-bullet bodies into malformed nested bullets.
4. A new slug similar to an existing fact proposes a merge/alias; it does not create a twin.
5. A contradiction carries old fact, new fact, sources, dates and authority into a typed review.
   Low-authority/old/conflicted facts are excluded from retrieval until resolved.
6. Add a dry-run cleanup analyzer for the existing hub: repeated bullets, twins, oversized
   mixed-fact notes, stale conflicts and ambiguous merges. All cleanup proposals go through the
   review/mutation gateway; no automatic destructive pass.
7. Keep semantic model assistance optional and bounded. Deterministic fingerprints and
   retrieval candidates narrow the comparison; the model never gets the whole hub.

**Likely files:**

- `shared/memory-facts.ts` (new), `shared/memory-reconcile.ts`, `memory-commit.ts`,
  `memory-consolidate.ts`
- `electron/main/services/MemoryPipeline.ts`, `MemoryConsolidator.ts`,
  `MemoryReviewService.ts`
- `test/memory-reconcile.test.ts`, `test/memory-commit.test.ts`,
  `test/memory-consolidate.test.ts`, `test/memory-pipeline.test.ts`

**Acceptance / verification:** multi-bullet boundary fixtures catch the known Jaccard failure;
same fact twice changes zero bytes; similar-title/different-fact does not false-merge; explicit
contradiction never auto-commits; cleanup dry-run changes no note and produces reviewable diffs.

**Rollback:** retain the existing reconcile adapter behind a flag for new captures only; no
cleanup proposal is accepted automatically.

---

### M4 — Additive memory model, lifecycle and derived index (L)

**Goal:** support understandable types/provenance/lifecycle without turning SQLite into the
truth or breaking hand-written Markdown.

**Work:**

1. Introduce schema v2 as optional additive frontmatter. Candidate durable fields:
   `memoryType`, `status`, `authority`, `sourceKind`, `sourceRef`, `reviewAt`, `expiresAt`,
   `supersedes`, `pinned`, `artifacts`. Final names are locked in a schema RFC before code.
2. Preserve unknown frontmatter keys and human Markdown on parse/serialize. Old/frontmatterless
   notes remain valid; managed writes do not strip user keys.
3. Define deterministic initial mapping:
   - decision/gotcha -> episodic,
   - user/architecture/reference -> semantic by default,
   - procedures are explicit,
   - artifacts are references, never copied blobs.
   Users can correct the derived type; migration does not pretend certainty.
4. Add lifecycle states: active, needs-review, superseded, archived. Superseded/archived are
   excluded from automatic retrieval and remain inspectable/restorable.
5. Define authority transitions:
   - only an explicit owner UI action grants `user-confirmed`;
   - `repo-verified` requires repository path/content-hash evidence and becomes stale when that
     evidence changes;
   - an agent cannot self-award an authority above its source;
   - a delegated resolver records its actor/rationale but does not impersonate user confirmation.
6. Keep `reviewAt` and `expiresAt` distinct. Review-overdue flags/down-ranks a fact and puts it in
   Needs review; only expired or explicitly inactive facts are hard-excluded.
7. Use frontmatter lifecycle `status: archived` as the one canonical archive truth. Do not add a
   parallel `.archive/` directory. `.trash/` remains the separate recoverable Forget path.
   Link/index behavior for archived/trash targets is specified and tested.
8. Build an incremental derived read model/cache for title, hook, parsed metadata, hashes,
   fact fingerprints and search fields. Invalidate on mutation and detect external file edits by
   mtime/hash. A full rebuild from Markdown is always possible.
9. Keep access count, last access, retrieval score traces and index status in SQLite; do not
   write them into note files.

**Likely files:**

- `shared/memory-note-schema.ts`, `shared/memory-hub.ts`, `shared/memory-health.ts`
- `electron/main/services/MemoryIndexService.ts` (new), `MemoryHubService.ts`,
  `MemoryMutationService.ts`, DB schema only for rebuildable operational fields
- migration/read-model tests and large synthetic hub performance tests

**Acceptance / verification:** every v1/frontmatterless/unknown-key fixture round-trips without
loss; derived index deletion/rebuild yields the same view; archived/superseded notes never enter
context; external Markdown edit appears after invalidation; 1,000-note list/health target meets
the R0-derived budget.

**Rollback:** v2 parser reads v1; no in-place bulk rewrite. Delete/rebuild derived index safely;
archived status is restored through the mutation history, and trash remains separately recoverable.

---

### M5 — Retrieval eval, deterministic hybrid ranking and context assembly (L)

**Goal:** improve relevance measurably while keeping context small, local and explainable.

**Work:**

1. Run every ranking change against the frozen bilingual train corpus and untouched holdout with
   positive/no-match/stale/conflict cases. Record top-k, miss reason and context characters;
   label changes are independently rechecked before moving the goalposts.
2. Improve ranking one measured feature at a time. Initial deterministic candidate signals are:
   exact/phrase title and slug, hook and bounded-body full text/BM25, bilingual token
   normalization, project/brain scope, lifecycle and authority. Add tags, pin or recency only
   when one wins a holdout ablation. Defer entities and past-recall/popularity boosting to avoid a
   self-reinforcing retrieval loop. Weights live in one pure module and are explainable.
3. Use a two-stage pipeline: cheap candidate search, then bounded rerank. Never pass all notes
   to a model.
4. Apply hard filters before scoring: wrong project/brain scope, archived, superseded,
   unresolved conflict and expired. Review-overdue is flagged/down-ranked, not silently erased.
   `baz-global` may cross projects only through its explicit global policy; one project’s private
   memory never leaks into another.
5. Preserve capability-aware delivery from `MemoryContextService`:
   - lookup contract for file/tool-capable agents,
   - <=2 short redacted hooks for tool-less engines,
   - zero positive score means zero injected context.
6. Record “why selected,” score components and receipt ids for Diagnostics, but do not inject
   the explanation into agent prompts.
7. Gate embeddings as a later experiment only if the eval miss analysis proves lexical hybrid
   cannot meet the target. Any experiment must be local/private, rebuildable, optional and beat
   the deterministic baseline before shipping; no raw vector UI.

**Likely files:**

- `shared/memory-recall.ts`, `shared/memory-context.ts`
- `electron/main/services/MemoryContextService.ts`, `MemoryRecallService.ts`,
  `MemoryIndexService.ts`
- `electron/main/services/hermes/hermesToolsMemory.ts`
- `test/memory-recall.test.ts`, `test/memory-context.test.ts`,
  `test/memory-context-service.test.ts`, retrieval eval tests

**Acceptance / verification:** top-3/no-match/stale/context-size targets pass; score explanation
is deterministic; no full hub body crosses a tool-less prompt; lookup status evidence remains
accurate; p95 performance passes at 1,000 synthetic notes.

**Rollback:** switch ranker version in one place; old deterministic token ranker remains a
temporary fallback until dogfood completes.

---

### M6 — Memory product redesign: Overview, Knowledge, Review, Diagnostics (L)

**Goal:** replace the file-manager default with a calm management experience powered by the
proven M1–M5 contracts.

**Information architecture:**

1. **Overview**
   - Active useful memories, recently added/used, needs review, conflicts, capture/index health.
   - Real metrics only. “Duplicates merged” comes from ledger; “where used” from recalls;
     “low authority” from metadata. No decorative numbers.
   - Project/Baz scope is an explicit selector, not a hidden expansion inside one toolbar.
   - Every metric defines loading, empty, unavailable, partial and index-rebuilding states; an
     absent measurement is never rendered as a reassuring zero.
2. **Knowledge**
   - Plain-language search and filters: scope/project, memory type, class, status, authority,
     source, date, pin, usage surface, needs-review, archived. Call it semantic/natural-language
     search only if M5’s held-out evaluation supports that claim.
   - Compact rows/cards: title, 1–2 line hook, type, project, authority, updated date, source,
     use indicator, status.
   - Sort by relevance when a query exists; otherwise use a stable, user-understandable
     recent/pinned/authority order, not raw filename or an opaque “AI relevance” claim.
3. **Detail**
   - Clean summary/facts first; source and why saved; where used; related memories/artifacts;
     history; authority/status; edit, merge, archive, forget, pin, mark incorrect, replace.
   - Current recall data supports honest surfaces such as “used in Council/Swarm” plus count/date,
     not a precise agent identity. Add card/session/agent identity only with privacy-bounded ids,
     authorization and retention; otherwise keep the label at surface level.
   - Raw Markdown is an Advanced tab, selectable/copyable and never the only view.
4. **Review**
   - Dedicated inbox for new/merge/replace/conflict/archive with side-by-side fact diff,
     source/authority/base-changed warning and clear effect of Accept/Edit/Discard.
   - Trust policy and delegated resolver are explained in plain language.
5. **Diagnostics**
   - Raw files, graph, capture queue, failed sources, ledger, snapshots, retrieval receipts,
     index health and rebuild. This preserves developer power without forcing it on everyone.

**Interaction/design rules:**

- Preserve cockpiT typography, cards, ember/glacier semantics and motion budget from
  `docs/DESIGN.md`; at most three simultaneous ember attention points.
- Do not render all note bodies in the list. Use the derived read model and virtual/incremental
  rendering based on measured cardinality.
- Text content is selectable. Every destructive action is recoverable and names its destination
  (`Archived` status or `.trash`), not generic “Delete.”
- Search, filters and selected detail are URL/state-restorable where the current navigation
  model supports it; switching projects cannot leak state from the prior project.

**Likely files:**

- `src/panels/MemoryPanel.tsx`
- replace/decompose `src/components/memory/MemoryBrainBar.tsx`, `MemoryNoteList.tsx`,
  `MemoryReader.tsx`, `MemoryConnections.tsx`; preserve `MemoryGraph.tsx` under Diagnostics
- new `MemoryOverview`, `MemoryKnowledgeList`, `MemoryDetail`, `MemoryReviewInbox`,
  `MemoryDiagnostics` components
- `src/styles/memory.css`, shared IPC/schemas/mock/read-model service
- Memory panel component tests + Playwright flows + screenshot fixtures

**Acceptance / verification:** five usability tasks pass without opening raw Markdown: find a
preference, explain why a memory exists, resolve a conflict, archive/restore a memory, inspect
where a note was used. Keyboard/a11y and three-width visual QA pass. The old graph and raw editor
remain reachable in Diagnostics/Advanced.

**Rollback:** keep the old panel behind a temporary local feature flag during dogfood; both
surfaces use the same M1 mutation gateway, so rollback does not fork data behavior.

---

### R1 — Migration, shadow mode, dogfood and release (M–L)

**Goal:** land the new contracts without losing user data or hiding regressions.

**Work:**

1. Council: dual-read v2/v3, v3-only new writes after the adapter is proven. Do not rewrite old
   session blobs. Compare old/new peer strategy in shadow evaluation, not double-billed live runs
   without explicit dogfood consent.
2. Memory: create a full backup bundle and manifest before any v2 backfill/archive/cleanup.
   The bundle includes project and Baz-global active notes, `.trash`, version history/snapshots,
   a consistent SQLite backup (reviews, ledger, mutation journal, trust settings, capture cursors)
   and a derived-index rebuild manifest. Existing project-only top-level snapshots are not
   sufficient. Backfill is previewable, append-only where possible, and emits per-note
   before/after hashes.
3. Run fact-dedup cleanup as proposals only. No automatic merge/archive/forget during migration.
   Rebase or invalidate every pending review against post-migration hashes; a pre-migration
   proposal cannot later overwrite a migrated note. Compact existing resolved review payloads
   only after the recovery window and backup verification.
4. Run old and new retrieval rankers in shadow on real tasks; inject only the old result until
   the new ranker clears the corpus and live disagreement review. Shadow logs ids/scores, never
   task/note bodies.
5. Dogfood flags:
   - Council v3 result/UI and peer strategy.
   - Memory v2 read model/retrieval/UI.
   Flags are temporary rollback controls with an owner and removal criterion, not permanent
   product settings.
6. Reserve and document additive database migration versions centrally for any trust/review/
   index columns. Migrations are forward-only and idempotent; JSON payload additions stay
   backwards-readable. No two parallel cards own the same target version.
7. Release gates:
   - typecheck, full tests, lint, E2E;
   - Council factuality/concision/call-budget eval;
   - Memory idempotency/concurrency/retrieval/migration eval;
   - backup restore drill;
   - visual/a11y QA;
   - no unexplained `.cockpit-memory` diff.
8. After a successful dogfood window, compact resolved review payloads according to the M1
   recovery policy, then remove legacy write paths and temporary UI flags; retain legacy readers
   for stored Council v2 and Memory v1 notes.

**Acceptance / verification:** zero-byte-loss manifest; full-bundle restore recreates project and
global brain bytes plus operational state; pending reviews are safely rebased/invalidated; no
stale/conflicted memory reaches agent context; Council default output/call targets pass; support
can diagnose a run from ids/metrics without viewing private content.

**Rollback:** stop/finish mutation journals, flip UI/retrieval flags, restore the full Memory/DB
backup bundle, rebuild derived indexes, and continue reading legacy Council results. Never use
hard reset, hard delete or silent schema downgrade.

## 7. Cross-cutting test matrix

| Layer | Council coverage | Memory coverage |
|---|---|---|
| Pure domain | v2/v3 adapters, parsers, budgets, report serializer, ranking aggregate, claim basis | note v1/v2 round-trip, fact fingerprints, reconcile outcomes, lifecycle filters, rank scoring |
| Service | run-scoped cancellation, atomic attempt budget, fallback circuit, actual engine provenance, evidence validation, compact reads | source cursors, self-ingestion, brain authorization, CAS/lock, crash journal recovery, typed reviews, version restore, index rebuild |
| IPC/mock | summaries vs detail, analysis mode, copy/export payload, schema parity | brain-scoped read models, mutation commands, filters, review actions, diagnostics, schema parity |
| Security | redaction, prompt fences, repository/symlink/path caps, provider consent/local-only, tool-less claim restriction | cross-project review denial, secret rejection before queue, untrusted note text, path traversal, payload compaction, external prompt caps |
| E2E | convene, clarify, copy brief/full/section, select text, open history/evidence, cancel | overview/search/filter/detail, edit conflict, resolve review, archive/restore, diagnostics |
| Performance | logical/physical calls, output chars, p50/p95 duration, history payload bytes | 1k-note list/search/health, retrieval p95, index rebuild, context chars |
| Migration | old sessions render/export, compact projection backfill, corrupt/pending rows survive | v1/frontmatterless/unknown keys, dry run, full backup manifest/restore, pending-review rebase, no accepted cleanup by default |

All implementation cards run targeted tests while developing. Every wave gate runs:

```text
npm run typecheck
npm test
npm run lint
npm run test:e2e        # when renderer flow changes
```

## 8. Risk register and explicit mitigations

| Risk | Mitigation / stop condition |
|---|---|
| Concision removes a critical Council insight. | Frozen severity-weighted corpus; keep raw evidence; do not promote a budget/peer strategy that breaches tolerance. |
| “Analysis mode” becomes an unrestricted coding agent. | Read-only evidence collector, bounded evidence pack, explicit no-write/no-start UI and tests. |
| Repository analysis leaks private code to a remote provider. | Sensitive-path/symlink/binary caps, pre-egress redaction, explicit provider consent, local-only mode, no persistent raw evidence corpus. |
| Fallbacks create false model diversity. | Actual provider provenance and degraded-diversity state; ranking never pretends configured engines ran. |
| Structured output fails on one provider. | Tolerant parser, one bounded corrective retry, graceful degraded result; never unbounded retry. |
| Memory schema migration strips human frontmatter. | Unknown-key preservation tests; no in-place bulk rewrite; hash manifest and snapshot. |
| Two agents overwrite the same note. | Per-brain serialization + base-hash CAS + stale proposal re-reconciliation. |
| A project resolves another project’s review. | Brain-scoped list/get/resolve authorization; explicit global scope; cross-project denial tests. |
| Crash lands a file write without ledger/review completion. | Durable idempotent mutation state machine and boot recovery at every phase. |
| Resolved reviews/snapshots keep private content forever. | Explicit recovery/retention window, content-free ledger hashes, user-visible storage health and a separately designed permanent-erasure path; no analytics need full bodies. |
| Autopilot silently destroys the older truth. | No recency-wins conflict commits; explicit resolver actor/rationale; full ledger and restore. |
| Better dedup false-merges distinct facts. | Candidate proposals first, atomic-fact tests, no destructive cleanup, human/delegated resolution. |
| Retrieval improves recall but injects noise. | Positive/no-match corpus, hard lifecycle filters, unchanged context caps, shadow mode. |
| FTS/derived index drifts from files. | Markdown remains canonical; incremental invalidation plus deterministic full rebuild/parity check. |
| Authority stays “repo verified” after source changes. | Evidence content hash invalidates authority; overdue review is visible and down-ranked. |
| Retrieval eval is tuned to its own fixtures. | Frozen bilingual holdout, documented label changes, severity-weighted misses and feature-by-feature ablation. |
| Dashboard becomes another noisy control center. | Overview uses only decision-support metrics; raw health moves to Diagnostics; follow `docs/DESIGN.md`. |
| Source expansion turns Memory into surveillance/log storage. | Source registry defaults to structured durable outcomes; raw logs/files/Council prose are out of scope. |
| Council/Memory work collides with existing roadmap. | This plan owns only the named files/contracts; cross-cutting DB/IPC edits serialize during integration and reference `system-roadmap.md`. |

## 9. Explicit non-goals for this program

- Replacing Markdown with a vector database, cloud knowledge store or proprietary format.
- Automatically saving every conversation, terminal line, agent response, file change or
  Council deliberation.
- Showing embeddings, chunks or raw indexes in the default Memory UI.
- Bulk-deleting, silently merging or silently rewriting the existing hub.
- Treating recency as truth or a model confidence number as verified evidence.
- Letting Council start implementation merely because it approved/refined a task.
- Rebuilding the entire navigation/design system.
- Adding embeddings before deterministic retrieval is measured and shown insufficient.

## 10. Definition of done

The program is complete only when all of the following are true:

1. Council’s default result is short and decision-first; complete content is selectable,
   copyable and exportable without screenshots.
2. Spec refinement, diff review and repository analysis are explicit, honestly scoped modes.
3. Council repository claims are evidence-backed; actual engines/fallbacks/diversity/call cost
   are visible and accurate.
4. Council output size and logical/physical calls meet the measured release budgets without
   failing the quality corpus.
5. Every Memory mutation is brain-authorized, crash-recoverable, ledgered and concurrency-safe;
   prior bytes restore within the documented recovery window, and stale reviews cannot overwrite
   current truth.
6. The distiller cannot recursively ingest Memory context or silently advance past a suspicious
   empty/failing result.
7. Duplicate facts are idempotent; contradictions are explicit; archive/forget really perform
   their documented reversible actions.
8. The memory model exposes type, source, authority, lifecycle, history and artifact references
   without breaking old or hand-written notes.
9. Retrieval meets top-k/no-match/context/performance targets and excludes inactive/conflicted
   facts.
10. The default Memory UI is an Overview/Knowledge/Review experience; raw files and internals
    remain available in Diagnostics.
11. Migration and full-bundle restore drills prove zero project/global note or operational-state
    loss, and all typecheck/test/lint/E2E/visual/accessibility gates pass.

Until these conditions hold, “new UI shipped” or “backend pipeline refactored” is not completion.
