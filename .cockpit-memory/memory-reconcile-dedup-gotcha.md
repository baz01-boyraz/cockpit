---
schema: 1
name: memory-reconcile-dedup-gotcha
title: Memory distiller dedup broken on multi-bullet notes: whole-body Jaccard dilutes as bullets accumulate
class: gotcha
capturedAt: 2026-07-06T01:21:16.713Z
gate: save
updatedAt: 2026-07-06T02:31:37.283Z
---

The reconcile() function in shared/memory-reconcile.ts (line 75) compares a new observation's body against the ENTIRE existing note body (all accumulated dated bullets) as a single bag-of-words via Jaccard similarity (threshold DUPLICATE_SIMILARITY=0.82). Once a note grows beyond about 5-6 bullets (e.g. swarm-design.md: 20 bullets, release-tagging-gotcha.md: 17 bullets, named-agents-team.md: 28 bullets), the token pool of the full body dilutes enough that near-identical restatements fall below 0.82 — so reconcile() returns 'merge' instead of 'duplicate'. mergeObservationIntoNote in shared/memory-commit.ts (lines 105-106) then blindly appends: \n- (date) ${obs.body} with ZERO bullet-level dedup check. Result: 8+ near-identical bullets in swarm-design.md across 2026-07-04/05/06, 9+ in release-tagging-gotcha.md, and growing bloat in named-agents-team.md (29KB/28 bullets), diff-review.md (9.5KB/11), molten-obsidian-design.md (6.9KB/11). The test suite (memory-reconcile.test.ts) has no multi-bullet scenario and no boundary test near 0.82 — the only 'duplicate' test uses exact-match text (similarity 1.0). Fix: compare against each individual existing bullet (split on \n- pattern), not the whole aggregated body.

Related: [[memory-distiller-self-ingestion-loop]]
- (2026-07-06) The whole-body Jaccard similarity in shared/memory-reconcile.ts stops treating near-duplicate notes as duplicates when they exceed ~5-6 bullet points. This causes ~20 identical memory entries for recurring topics (e.g., hero/wordmark, release-tagging-gotcha itself) to accumulate without detection. Not caused by this session's work — it was pre-existing and surfaced during live testing. The 22 pending reviews found during development were largely this same bloat.
