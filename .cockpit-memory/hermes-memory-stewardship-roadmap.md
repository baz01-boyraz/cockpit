---
schema: 1
name: hermes-memory-stewardship-roadmap
title: Hermes Memory + Sentinel Stewardship roadmap
class: decision
capturedAt: 2026-07-11T23:10:24.000Z
gate: save
updatedAt: 2026-07-12T12:02:04.000Z
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
   - **Result:** model-free exact-token + bilingual concept reranking passed synthetic Top-3 62/62, false-match 0/10, and Turkish dogfood Top-1 7/7 plus one correct no-match.

2. **Bullet-level duplicate detection — complete (2026-07-11)**
   - Compare a new observation against atomic bullets/facts inside an existing note, not only the whole accumulated body.
   - Prevent a merge from appending a near-identical bullet.
   - Add long-note, threshold-boundary, and repeated-capture regression tests.
   - **Result:** reconcile scores atomic facts, ignores dates/navigation, and dedups at `0.82`; merges are byte-idempotent and repeated captures create no note/ledger churn.

3. **Controlled conflict trust policy — complete (2026-07-11)**
   - Remove silent conflict overwrite as the default behavior.
   - Make the effective policy consistent across backend gate, renderer trust mode, Hermes instructions, and user-facing copy.
   - Preserve before/after provenance and require an explicit human decision or a narrowly defined, auditable policy for destructive replacement.
   - **Result:** policy v2 never auto-commits conflicts. Delegated replacement requires closed evidence, rationale, stale-check, ledger, and audit; ambiguity stays pending.

4. **One-time cleanup of bloated notes — complete (2026-07-12)**
   - Snapshot first, then dry-run a bullet-level dedup/merge pass over oversized and repetitive notes.
   - Produce a reviewable report before applying changes; use soft-delete only and verify wikilinks afterward.
   - Do not turn cleanup output into fresh memory observations or re-ingest the memory protocol itself.
   - **Result:** snapshot `2026-07-12T05-01-41-495Z-6b8a3a5c` covered all 126 notes. Nine repetitive notes were compacted without deletion: 208,006 → 136,505 bytes, duplicate facts 66 → 0, oversized notes 4 → 0; links stayed valid.

5. **Code/documentation consistency — complete (2026-07-12)**
   - Reconcile stale comments, charter text, AGENTS instructions, UI copy, and memory notes with the behavior actually enforced by code.
   - Mark superseded facts clearly instead of leaving contradictory statements as equally current.
   - Add focused contract tests for the trust policy and memory-first delivery rules.
   - **Result:** shared policy pins main=V4 Pro and mechanical=V4 Flash; callers cannot promote distillation. Empty-hub lookup, mock/backend policy, code, charter, plans, and canonical notes now agree.

### Phase 2 — Hermes/Sentinel operational stewardship

6. **Hermes executive summary on successful Swarm completion — complete (2026-07-12)**
   - Convert the existing completion event into a structured, persisted signal.
   - Gather bounded evidence: card/spec, diff stat, checks, branch/worktree state, and notable output or failure markers.
   - Ask Hermes for a short manager summary only after deterministic evidence exists, then deliver it through app toast/macOS with a direct review or chat action.
   - **Result:** successful cards persist bounded evidence before tool-less V4 Pro summaries, with recovery, fallback, dedup, app/macOS delivery, and Review/Ask actions; failures keep their existing path.

7. **Memory lifecycle events as Sentinel sources — complete (2026-07-12)**
   - Raise structured signals for capture retry exhaustion, distiller failure, review-queue backlog, unresolved conflicts, curation failure/staleness, write-gate rejection spikes, and memory-contract compliance misses.
   - Deduplicate and threshold these events so normal queue activity stays quiet.
   - Let recurring, verified failures become charter-gated gotcha candidates; never write raw errors or secrets directly into memory.
   - **Result:** `memory-lifecycle` thresholds durable queue/audit/review facts; empty hubs and isolated events stay quiet. Sentinel receives only counts, age, and closed failure categories—never content, paths, or raw errors.

8. **Scheduled operational health sweep — complete (2026-07-12)**
   - Build a cheap deterministic snapshot of git state, quota, stuck/parked Swarm work, orphaned processes, recent log/error patterns, pending approvals, and memory queue health.
   - Invoke Hermes only when the snapshot contains an anomaly; the later visible daily schedule owns digest delivery.
   - Persist last-run/result metadata, prevent overlapping runs, and notify only on state change or actionable degradation.
   - **Result:** every 30 minutes, content-free sensors persist one bounded V20 row per project. Atomic claims prevent overlap; healthy/unchanged runs cost no model call, transient misses wait for confirmation, and changed anomalies reach `operational-health` → V4 Flash. Item 9 moved the daily digest to one visible, pausable 09:00 job so the two layers cannot double-notify.

### Later phase — same architecture, new channels

9. **Daily digest and Hermes-managed cron jobs — complete (2026-07-12)**
   - Manage idempotent schedules with visible last-run, next-run, result, retry, and disable controls.
   - Keep risky actions behind the existing approval boundary; cron may observe and propose but must not silently perform destructive work.
   - **Result:** cockpiT owns a durable V21 schedule table, atomic overlap/stale-run claims, and one idempotent 09:00 daily briefing per project. The Automations view exposes plain-language create, last/next/result, run/retry, pause/resume, and safe delete controls with no cron syntax. V4 Flash receives only the content-free health snapshot through a harmless `todo` allowlist; results persist before delivery, app/macOS publication spends no second triage call, and any suggested Swarm work lands in the existing approval queue instead of starting. Native Hermes cron is deliberately not the execution boundary because its non-interactive mode auto-bypasses soft approvals.

10. **Phone delivery**
    - Add a channel-neutral notification outbox first, then a sender-authenticated Telegram/mobile adapter.
    - Preserve severity, context handoff, acknowledgement, redaction, and approval semantics across Mac and phone.

## Completion bar

- Retrieval/dedup regressions pass on a real versioned corpus; trust policy agrees across code, UI, charter, and Hermes.
- Swarm outcomes and memory failures produce deduplicated, evidence-backed signals with a useful next action.
- Healthy days cost no unnecessary Hermes calls; actionable degradation reaches the owner.
- Cleanup and writes remain recoverable through snapshots, ledger/audit, git, and soft-delete.

Related: [[memory-hub]], [[memory-reconcile-dedup-gotcha]], [[memory-trust-modes]], [[memory-contract-unified-source]], [[sentinel-3-layer-architecture]], [[sentinel-anti-noise-gotcha]], [[sentinel-notification-tiering]], [[swarm-completion-notification-gap]], [[hermes-jarvis-plan]], [[self-initiated-card-protocol]]
