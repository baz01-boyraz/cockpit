---
schema: 1
name: memory-hub
title: Living memory brain built on the markdown hub
class: architecture
gate: save
updatedAt: 2026-07-12T05:03:45.000Z
---

# Memory hub

Markdown is durable knowledge truth: project notes live in `.cockpit-memory/*.md` and travel with the repository. SQLite holds operational queues/audit state, while the wikilink index and graph are derived views that can be rebuilt.

## Storage and safety

- Note names are normalized slugs, making traversal unrepresentable; resolved-path checks add defense in depth.
- Delete is always a soft move to `.trash/`.
- `shared/wikilink.ts` owns parsing, indexes, and rename refresh. `shared/memory-hub.ts` is the assembly rule shared by the real service and mock, following [[ipc-contract]].
- Snapshots copy top-level notes into `.cockpit-memory/.snapshots/<timestamp>/`. Both `.snapshots/` and `.trash/` are internal recovery data and must remain ignored by git (fixed by `5525b36`).

## Capture pipeline

The v0.1.33 pipeline is Capture → Distill → Reconcile → Gate → Commit/Review. Session transcripts are redacted before an LLM distills bounded observations; deterministic reconciliation classifies new, merge, duplicate, or conflict; policy gates decide save versus review; accepted writes are atomic and carry ledger/snapshot provenance. Idle and session-end capture use a durable SQLite work queue. Current contracts live in `docs/memory-imp.md` and `docs/MEMORY-CHARTER.md`.

There are two isolated brains:

- Project brain: `.cockpit-memory/`
- Baz/global brain: `<userData>/baz-memory/`

Links resolve only inside their own brain. A project note linking to a global fact such as [[model-routing-preference]], [[app-refresh-consent-rule]], [[swarm-auto-assign]], or [[swarm-agent-boundaries]] therefore appears unresolved/orphaned in the project graph. This is a known cross-brain navigation limitation, not proof that the target fact is missing. Consolidation reports the same targets as dangling but must not invent project copies to silence the warning.

Related: [[swarm-design]], [[memory-reconcile-dedup-gotcha]], [[memory-trust-modes]]
