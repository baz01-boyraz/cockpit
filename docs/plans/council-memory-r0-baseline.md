# Council + Memory R0 Baseline

> Frozen: 2026-07-11
> Scope: measurement and safety contracts only
> Product behavior changed: no
> User Memory notes changed: no

This document fixes the meaning of the Council and Memory quality measurements used by
`docs/plans/council-memory-quality-roadmap.md`. Later cards may improve a score, but they may
not silently redefine the score, alter holdout labels, or hide a safety failure inside one
composite number.

## 1. Reproduce the committed baselines

```sh
node scripts/diagnostics/council-baseline.mjs \
  --input test/fixtures/council/synthetic-sessions.json --pretty

node node_modules/vite-node/vite-node.mjs \
  scripts/diagnostics/memory-retrieval-baseline.ts \
  --input test/fixtures/memory/retrieval-corpus.json --pretty

node scripts/diagnostics/memory-manifest.mjs \
  --hub .cockpit-memory --pretty
```

All three commands are read-only. Their reports contain case ids, note slugs, labels, hashes
and counts; they do not emit Memory note bodies, Council seat prose, verdict prose, or prompts.

The human-reviewed real Council label set lives at
`.dev-cockpit/evals/council-real-redacted.json`. The entire directory is gitignored because
even redacted finding labels can reveal private project facts. Its contract stores labels and
precomputed metrics, never the original prompt, seat, ranking, or verdict prose. Run it with:

```sh
node scripts/diagnostics/council-baseline.mjs \
  --input .dev-cockpit/evals/council-real-redacted.json --pretty
```

## 2. Frozen corpus rules

- The committed fixtures are synthetic. Real Council prose and real Memory note bodies do not
  belong in them.
- `tune` cases may guide implementation. `holdout` labels must not be inspected to tune a
  prompt/ranker and must not change merely because an implementation misses them.
- A label correction needs a short reason in the changing commit and an independent reread of
  the fixture. Adding a case is preferred to weakening an existing expectation.
- A Council required signal is an outcome label, not a magic wording requirement. A forbidden
  claim represents a factual statement that must not appear as established truth.
- Memory expected top notes and forbidden notes are evaluated independently. Returning a good
  note does not excuse also returning an archived, superseded, expired, conflicted, or otherwise
  ineligible note.
- Real-session quantitative aggregates are derived with read-only SQLite queries that select
  lengths/counts/JSON metadata only. Raw prompt/result text is neither printed nor copied into
  this repository.

## 3. Metric definitions

### Council

| Metric | Fixed meaning |
|---|---|
| Logical calls | One seat generation, one peer judgement, or one chairman synthesis requested by the orchestration graph. |
| Minimum physical attempts | Logical calls plus persisted `usedFallback` seats. This is a lower bound until every attempt is ledgered; it must never be presented as an exact cost. |
| Generated characters | Characters in persisted seat text + ranking text + chairman verdict. It excludes prompts, error bodies, transport overhead, and tokenization. |
| Result bytes | UTF-8 byte length of persisted `result_json`. This measures storage/transfer pressure, not model output quality. |
| Required-signal recall | Required outcome labels observed / required outcome labels total. Severity-weighted recall will be used when the real corpus contains enough cases. |
| Forbidden-claim hit | A labelled unsupported or false assertion is present as established truth. Release target is zero. |
| Intent mismatch | Observed `spec`, `diff`, or `analysis` mode differs from the task's required intent. |
| Provider diversity | Count/set of providers that actually produced seat results. Configured labels do not count as actual execution. |
| Fallback seat | A persisted successful/failed seat marked `usedFallback`. Multiple hidden attempts cannot currently be recovered. |
| Duplicate section | A normalized report heading repeated in the serialized artifact, or the same canonical artifact rendered more than once in UI. The latter is still an explicit instrumentation gap. |

Known Council measurement gaps are deliberately emitted in every report:
`chairman_engine`, exact `physical_attempts`, `stage_input_characters`, `stage_tokens`, and
`rendered_duplicate_sections`. C4/C5 must close these gaps before the UI claims exact cost.

### Memory

| Metric | Fixed meaning |
|---|---|
| Top-1 hit | The first returned slug is one of the case's expected slugs. |
| Top-3 hit | At least one expected slug appears in the first three results. |
| Severity-weighted top-3 | Top-3 hits weighted critical=4, high=3, medium=2, low=1. |
| No-match false injection | A no-match query receives one or more notes. Release target is zero. |
| Unsafe selection | An ineligible note or an explicitly forbidden note is returned in the top three. Release target is zero, independent of top-k relevance. |
| Useful memory | A durable, scoped, source-identifiable fact that is currently eligible for retrieval and has a concrete future use. File count is not usefulness. |
| Duplicate candidate | For R0 manifest only, two whole note bodies with token-set Jaccard similarity >= 0.72. It is a review candidate, never proof and never authorization to merge. |
| Repeated fact group | A normalized bullet appears more than once inside one note. Only note slug and count are reported. |
| Confidence | Not a numeric product metric in R0. No percentage is shown until calibrated against evidence-backed outcomes. Use authority/source/lifecycle labels instead. |

“Memory quality” is not one score. Relevance, lifecycle safety, no-match precision,
provenance, contradiction state, bounded context, and user comprehension remain separate gates.

## 4. Baseline results

### 4.1 Real persisted Council sessions (read-only aggregate)

Eight project sessions dated 2026-07-08 through 2026-07-11 contain:

- 88 logical calls.
- At least 105 physical attempts, including 17 persisted fallback seats.
- 450,426 generated characters; mean 56,303 characters per session.
- 2,077,011 ms summed wall duration; mean 259,626 ms per session.
- 478,915 persisted result bytes; mean 59,864 bytes and max 68,199 bytes.
- Actual seat providers: Claude and OpenRouter.

The captured Memory-analysis run alone records 11 logical calls, at least 15 physical attempts,
four fallback seats, 56,341 generated characters, 345,683 ms duration, and a 60,054-byte result.
The human-reviewed redacted holdout finds 4/8 required signals, all three labelled forbidden
claims, and an `analysis` -> `spec` intent mismatch. This is the baseline the Council work must
beat; the synthetic corpus is not a substitute for it.

### 4.2 Synthetic Council contract

- 6 cases: 3 tune / 3 holdout; Turkish and English; spec, diff, research-shaped, degraded, and
  synthesis-failed paths.
- 58 logical calls and minimum 71 physical attempts.
- 3,363 generated characters, 8,294 serialized result bytes, and 431,700 ms fixture duration.
- Required-signal recall 9/9.
- One deliberate forbidden-claim hit and one deliberate intent mismatch in
  `analysis-memory-research-tr`.

The deliberate failures prove that the evaluator detects the exact class of error seen in the
screenshots. They are not product regressions introduced by R0.

### 4.3 Synthetic Memory retrieval contract

- 60 cases: 30 Turkish / 30 English and 30 tune / 30 holdout.
- 40 ordinary positive, 10 lifecycle, and 10 no-match cases.
- Top-1: 42/50 (0.84). Top-3: 50/50 (1.00). Severity-weighted top-3: 1.00.
- No-match false injections: 0/10.
- Unsafe top-three selections: 24 — 8 archived, 8 superseded, 4 conflicted, 4 expired.

The 1.00 top-3 score is therefore not a clean bill of health. The current lexical ranker finds
the desired note but has no lifecycle gate, so it can also inject unsafe context. M5 must drive
unsafe selections to zero without regressing no-match precision or holdout relevance.

### 4.4 Current Memory hub manifest

The read-only 2026-07-11 manifest reports:

- 125 top-level Markdown notes, 199,520 total bytes.
- Latest snapshot: `2026-07-06T05-07-17-233Z-78369a09`.
- 2 schema-invalid frontmatter blocks and 4 intentionally/legacy frontmatterless notes.
- 26 repeated-fact groups, 11 unresolved link targets, and 0 whole-note duplicate candidates
  at the conservative R0 threshold.
- 0 ignored symlinks, foreign entries, or oversized notes.
- The filesystem-only manifest's pending review field is `null` because no review JSON export
  was supplied. A separate read-only SQLite metadata query confirms 5 pending project reviews
  (plus 76 accepted and 1 edited); `null` must never be interpreted as zero.

These are diagnostics, not cleanup authorization. R0 did not edit, merge, archive, normalize,
or rewrite any note.

## 5. Invariants frozen by R0

- Markdown note files remain canonical; SQLite is operational/derived state.
- Plain and legacy schema-1 notes remain readable.
- A zero-overlap tool-less retrieval injects no Memory block.
- Inline context remains at most two notes and <= 1,200 characters.
- Secret-shaped hook content is redacted before prompt delivery.
- Consolidation snapshots the hub before it proposes any cleanup; future migrations must add
  their own snapshot/backup test before gaining a write path.
- Diagnostic scripts are deterministic and read-only, and their reports exclude note bodies,
  prompts, seat prose, ranking prose, and verdict prose.

The existing invariant tests live in `test/memory-note-schema.test.ts`,
`test/memory-context.test.ts`, `test/memory-gate.test.ts`,
`test/memory-hub-snapshot.test.ts`, and `test/memory-consolidator.test.ts`. R0 adds corpus,
manifest, privacy, determinism, no-match, cap, and lifecycle assertions in
`test/council-eval.test.ts` and `test/memory-retrieval-eval.test.ts`.

## 6. R0 boundary

R0 intentionally does not fix the measured failures. C1 begins Council selection/copy/export;
C2-C5 address result structure, grounding, call budget, and persistence. M1a/M1b establish the
safe Memory mutation foundation before M2-M7 change capture, schema, reconciliation, retrieval,
or UI. This separation keeps the baseline trustworthy and rollback trivial.
