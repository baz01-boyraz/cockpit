---
schema: 1
name: memory-reconcile-dedup-gotcha
title: Memory distiller dedup broken on multi-bullet notes: whole-body Jaccard dilutes as bullets accumulate
class: gotcha
capturedAt: 2026-07-06T01:21:16.713Z
gate: save
updatedAt: 2026-07-12T04:38:25.000Z
---

**Status: fixed 2026-07-11.** Reconciliation now compares the incoming observation with each atomic paragraph/list item and the combined note candidate; merge independently refuses to append a fact at or above the `0.82` duplicate threshold. Long-note, exact-boundary, repeated-capture, byte-idempotency, and Turkish-token regressions cover the failure. Existing historical bloat is intentionally left for the snapshot-first cleanup phase.

**Historical failure (pre-fix):** The reconcile() function in shared/memory-reconcile.ts (line 75) compared a new observation's body against the ENTIRE existing note body (all accumulated dated bullets) as a single bag-of-words via Jaccard similarity (threshold DUPLICATE_SIMILARITY=0.82). Once a note grew beyond about 5-6 bullets (e.g. swarm-design.md: 20 bullets, release-tagging-gotcha.md: 17 bullets, named-agents-team.md: 28 bullets), the token pool of the full body diluted enough that near-identical restatements fell below 0.82 — so reconcile() returned 'merge' instead of 'duplicate'. mergeObservationIntoNote in shared/memory-commit.ts (lines 105-106) then blindly appended: \n- (date) ${obs.body} with ZERO bullet-level dedup check. Result: 8+ near-identical bullets in swarm-design.md across 2026-07-04/05/06, 9+ in release-tagging-gotcha.md, and growing bloat in named-agents-team.md (29KB/28 bullets), diff-review.md (9.5KB/11), molten-obsidian-design.md (6.9KB/11). The test suite (memory-reconcile.test.ts) had no multi-bullet scenario and no boundary test near 0.82 — the only 'duplicate' test used exact-match text (similarity 1.0). The fix was to compare against each atomic existing fact and add a merge-time guard.

Related: [[memory-distiller-self-ingestion-loop]]
- (2026-07-06) The whole-body Jaccard similarity in shared/memory-reconcile.ts stops treating near-duplicate notes as duplicates when they exceed ~5-6 bullet points. This causes ~20 identical memory entries for recurring topics (e.g., hero/wordmark, release-tagging-gotcha itself) to accumulate without detection. Not caused by this session's work — it was pre-existing and surfaced during live testing. The 22 pending reviews found during development were largely this same bloat.
