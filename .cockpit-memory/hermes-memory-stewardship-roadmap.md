---
schema: 1
name: hermes-memory-stewardship-roadmap
title: Hermes Memory + Sentinel Stewardship roadmap
class: decision
capturedAt: 2026-07-11T23:10:24.000Z
gate: save
updatedAt: 2026-07-12T04:38:25.000Z
---

cockpiT will first tighten memory correctness, then expand Hermes/Sentinel into a proactive operational steward: deterministic sensors watch continuously, Hermes judges only meaningful signals, the owner is notified through the right channel, and durable outcomes return to memory.

## Operating principle

- Deterministic, LLM-free sensors watch Swarm, memory, logs, errors, approvals, quota, git, and process health.
- Hermes is the bounded judgment layer, not a token-burning raw-log watcher: quiet/known events stop at the sensor layer; only anomalies and scheduled digests reach the model.
- Every notification carries evidence, severity, and a concrete next action. Self-discovered coding work is proposed for approval, never started silently.
- App-wide toast + macOS notification is the first delivery channel. Phone delivery and Hermes-managed cron jobs are later transport/scheduling phases built on the same signal/outbox contract.
- Markdown notes remain the durable project-memory truth; deterministic validation, redaction, audit, and rollback remain authoritative safety rails around model judgment.

## Model policy

- **Hermes's main model is DeepSeek V4 Pro** for conversation, orchestration, memory judgment, operational stewardship, and other work where nuanced reasoning matters.
- **DeepSeek V4 Flash is reserved for bounded mechanical background work** such as Sentinel triage, transcript distillation, curation passes, and routine digests.
- Model roles stay explicit in code and audit metadata so a cheap background call can never silently become the authority for a high-judgment decision.

## Ordered delivery

### Phase 1 — Memory correctness and cleanup

1. **Semantic or hybrid retrieval — complete (2026-07-11)**
   - Combine the existing lexical name/hook score with semantic retrieval or reranking.
   - Preserve positive-match-only behavior, strict note/character caps, source paths, and the rule that unrelated recent notes never pad a prompt.
   - Add bilingual and synonym-heavy retrieval evaluations using real project queries.
   - **Result:** deterministic exact-token + bilingual concept reranking is implemented without remote embeddings or model calls. The 72-case synthetic gate includes 12 explicit semantic tune regressions; all return one correct note, Top-3 is 62/62, and no-match false injection is 0/10. The original 30 holdout labels remain untouched. A separate redacted real-Turkish-query dogfood set passes 7/7 task queries at Top-1 plus one correct no-match.

2. **Bullet-level duplicate detection — complete (2026-07-11)**
   - Compare a new observation against atomic bullets/facts inside an existing note, not only the whole accumulated body.
   - Prevent a merge from appending a near-identical bullet.
   - Add long-note, threshold-boundary, and repeated-capture regression tests.
   - **Result:** reconcile now measures the strongest match across individual paragraphs/list items plus a backwards-compatible combined candidate. Dated bullets and `Related:` navigation do not dilute the score; exact and near-duplicate facts at the inclusive `0.82` boundary are skipped. Merge has its own byte-idempotent guard, repeated captures create no write/ledger entry, and Turkish fact tokens remain intact.

3. **Controlled conflict trust policy**
   - Remove silent conflict overwrite as the default behavior.
   - Make the effective policy consistent across backend gate, renderer trust mode, Hermes instructions, and user-facing copy.
   - Preserve before/after provenance and require an explicit human decision or a narrowly defined, auditable policy for destructive replacement.

4. **One-time cleanup of bloated notes**
   - Snapshot first, then dry-run a bullet-level dedup/merge pass over oversized and repetitive notes.
   - Produce a reviewable report before applying changes; use soft-delete only and verify wikilinks afterward.
   - Do not turn cleanup output into fresh memory observations or re-ingest the memory protocol itself.

5. **Code/documentation consistency**
   - Reconcile stale comments, charter text, AGENTS instructions, UI copy, and memory notes with the behavior actually enforced by code.
   - Mark superseded facts clearly instead of leaving contradictory statements as equally current.
   - Add focused contract tests for the trust policy and memory-first delivery rules.

### Phase 2 — Hermes/Sentinel operational stewardship

6. **Hermes executive summary on successful Swarm completion**
   - Convert the existing completion event into a structured, persisted signal.
   - Gather bounded evidence: card/spec, diff stat, checks, branch/worktree state, and notable output or failure markers.
   - Ask Hermes for a short manager summary only after deterministic evidence exists, then deliver it through app toast/macOS with a direct review or chat action.

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

- Memory retrieval and dedup regressions pass on a real, versioned evaluation corpus.
- No conflict policy differs between code, UI, charter, and Hermes instructions.
- A successful or failed Swarm run produces one deduplicated, evidence-backed notification with a useful next action.
- Memory pipeline failures and stale backlogs become observable without creating notification noise.
- A quiet healthy day costs no unnecessary Hermes calls; an actionable anomaly reliably reaches the owner.
- All cleanup and automated writes remain recoverable through snapshots, ledger/audit history, git, and soft-delete.

Related: [[memory-hub]], [[memory-reconcile-dedup-gotcha]], [[memory-trust-modes]], [[memory-contract-unified-source]], [[sentinel-3-layer-architecture]], [[sentinel-anti-noise-gotcha]], [[sentinel-notification-tiering]], [[swarm-completion-notification-gap]], [[hermes-jarvis-plan]], [[self-initiated-card-protocol]]
