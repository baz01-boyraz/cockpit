---
schema: 1
name: hermes-memory-stewardship-roadmap
title: Hermes Memory + Sentinel Stewardship roadmap
class: decision
capturedAt: 2026-07-11T23:10:24.000Z
gate: save
updatedAt: 2026-07-12T05:17:51.000Z
---

cockpiT first tightens memory correctness, then expands Hermes/Sentinel into a proactive steward: sensors watch, Hermes judges meaningful signals, notifications reach the right channel, and durable outcomes return to memory.

## Operating principle

- LLM-free sensors watch Swarm, memory, logs, errors, approvals, quota, git, and process health; quiet/known states never reach Hermes.
- Notifications carry evidence, severity, and a next action. Self-discovered coding work is proposed, never silently started.
- Toast/macOS ships first; phone/cron reuse the same signal/outbox contract. Markdown truth stays protected by validation, redaction, audit, and rollback.

## Model policy

- **DeepSeek V4 Pro** handles conversation/orchestration; **V4 Flash** handles bounded tool-less triage, distillation, curation, and routine digests.
- Roles stay explicit in code/audit metadata so background calls cannot silently gain high-judgment authority.

## Ordered delivery

### Phase 1 — Memory correctness and cleanup

1. **Semantic or hybrid retrieval — complete (2026-07-11)**
   - Combine the existing lexical name/hook score with semantic retrieval or reranking.
   - Preserve positive-match-only behavior, strict note/character caps, source paths, and the rule that unrelated recent notes never pad a prompt.
   - Add bilingual and synonym-heavy retrieval evaluations using real project queries.
   - **Result:** local exact-token + bilingual concept reranking needs no embedding/model call. The untouched holdout stays clean; synthetic Top-3 is 62/62 with 0/10 false no-match injection, and redacted Turkish dogfood is 7/7 Top-1 plus one correct no-match.

2. **Bullet-level duplicate detection — complete (2026-07-11)**
   - Compare a new observation against atomic bullets/facts inside an existing note, not only the whole accumulated body.
   - Prevent a merge from appending a near-identical bullet.
   - Add long-note, threshold-boundary, and repeated-capture regression tests.
   - **Result:** reconcile scores paragraphs/list items independently, ignores dates/navigation, and skips facts at the inclusive `0.82` boundary. Merge is byte-idempotent, repeated captures write no note/ledger entry, and Turkish tokens remain intact.

3. **Controlled conflict trust policy — complete (2026-07-11)**
   - Remove silent conflict overwrite as the default behavior.
   - Make the effective policy consistent across backend gate, renderer trust mode, Hermes instructions, and user-facing copy.
   - Preserve before/after provenance and require an explicit human decision or a narrowly defined, auditable policy for destructive replacement.
   - **Result:** policy v2 excludes conflicts from every auto-commit mode. Owner choices are explicit; Hermes needs a closed evidence basis, plain rationale, and concrete evidence. Recency is rejected. Delegated replacements are stale-checked, ledgered, and audited; ambiguity stays pending with plain UI copy.

4. **One-time cleanup of bloated notes — complete (2026-07-12)**
   - Snapshot first, then dry-run a bullet-level dedup/merge pass over oversized and repetitive notes.
   - Produce a reviewable report before applying changes; use soft-delete only and verify wikilinks afterward.
   - Do not turn cleanup output into fresh memory observations or re-ingest the memory protocol itself.
   - **Result:** snapshot `2026-07-12T05-01-41-495Z-6b8a3a5c` captured all 126 notes before the committed dry-run report. Nine repetitive notes were canonically compacted with no deletion/archive: 208,006 → 136,505 bytes, repeated facts 66 → 0, oversized notes 4 → 0. No link target disappeared and no unresolved target was introduced.

5. **Code/documentation consistency — complete (2026-07-12)**
   - Reconcile stale comments, charter text, AGENTS instructions, UI copy, and memory notes with the behavior actually enforced by code.
   - Mark superseded facts clearly instead of leaving contradictory statements as equally current.
   - Add focused contract tests for the trust policy and memory-first delivery rules.
   - **Result:** shared policy now pins Hermes main=V4 Pro and mechanical=V4 Flash; callers cannot promote distillation. Empty hubs still receive lookup contracts, mock/backend policy versions match, and stale Claude-only/native-channel claims were replaced with current behavior across code, charter, plans, and canonical notes.

### Phase 2 — Hermes/Sentinel operational stewardship

6. **Hermes executive summary on successful Swarm completion — complete (2026-07-12)**
   - Convert the existing completion event into a structured, persisted signal.
   - Gather bounded evidence: card/spec, diff stat, checks, branch/worktree state, and notable output or failure markers.
   - Ask Hermes for a short manager summary only after deterministic evidence exists, then deliver it through app toast/macOS with a direct review or chat action.
   - **Result:** successful cards now stage a deduplicated `swarm-completion` Sentinel row before inference. A session-scoped 64 KiB tail is reduced to redacted valid JSON (≤1,900 chars) with card/spec, diff, observed checks, worktree state, and notable markers. Tool-less Hermes V4 Pro calls are serialized; invalid/unavailable Pro falls back to a deterministic summary, crash-staged rows resume on boot, and the final signal publishes once to app toast + macOS with Review card / Ask Hermes actions. Nonzero exits stay on the existing worker-failure path.

7. **Memory lifecycle events as Sentinel sources**
   - Raise structured signals for capture retry exhaustion, distiller failure, review-queue backlog, unresolved conflicts, curation failure/staleness, write-gate rejection spikes, and memory-contract compliance misses.
   - Deduplicate and threshold these events so normal queue activity stays quiet.
   - Let recurring, verified failures become charter-gated gotcha candidates; never write raw errors or secrets directly into memory.

8. **Scheduled operational health sweep**
   - Build a cheap deterministic snapshot of git state, quota, stuck/parked Swarm work, orphaned processes, recent log/error patterns, pending approvals, and memory queue health.
   - Invoke Hermes only when the snapshot contains an anomaly or when a scheduled digest is due.
   - Persist last-run/result metadata, prevent overlapping runs, and notify only on state change or actionable degradation.

### Later phase — same architecture, new channels

9. **Daily digest and Hermes-managed cron jobs**
   - Manage idempotent schedules with visible last-run, next-run, result, retry, and disable controls.
   - Keep risky actions behind the existing approval boundary; cron may observe and propose but must not silently perform destructive work.

10. **Phone delivery**
    - Add a channel-neutral notification outbox first, then a sender-authenticated Telegram/mobile adapter.
    - Preserve severity, context handoff, acknowledgement, redaction, and approval semantics across Mac and phone.

## Completion bar

- Retrieval/dedup regressions pass on a real versioned corpus; trust policy agrees across code, UI, charter, and Hermes.
- Swarm outcomes and memory failures produce deduplicated, evidence-backed signals with a useful next action.
- Healthy days cost no unnecessary Hermes calls; actionable degradation reaches the owner.
- Cleanup and writes remain recoverable through snapshots, ledger/audit, git, and soft-delete.

Related: [[memory-hub]], [[memory-reconcile-dedup-gotcha]], [[memory-trust-modes]], [[memory-contract-unified-source]], [[sentinel-3-layer-architecture]], [[sentinel-anti-noise-gotcha]], [[sentinel-notification-tiering]], [[swarm-completion-notification-gap]], [[hermes-jarvis-plan]], [[self-initiated-card-protocol]]
