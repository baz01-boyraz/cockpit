---
schema: 1
name: memory-hub
title: Living memory brain built on the markdown hub
class: architecture
gate: save
updatedAt: 2026-07-06T02:31:02.544Z
---

# Memory Hub

This knowledge layer (Phase 5). Files in `.cockpit-memory/` are the ONLY
truth — committed with the repo; the link index is derived in memory.

Design decisions:
- Note names are slugs by construction (`normalizeNoteName`), so path
  traversal is unrepresentable; resolve()-guard is defense in depth only.
- Deletion is a soft move to `.trash/` — honest with the delete_file approval
  rule without an approvals round-trip.
- `shared/wikilink.ts` is the kernel (parse, index, rename-refresh);
  `shared/memory-hub.ts` is the assembly rule shared by service and mock
  (the [[ipc-contract]] single-rule principle).
- Storage map: localStorage = UI prefs + Notepad; SQLite = operational;
  markdown = knowledge. Documented in `docs/plans/memory-graph-plan.md`.

Polish backlog: `write`/`rename` could return `{note, snapshot}` to save the
UI a round-trip (asymmetry noted by the 5.4 build); graph view is time-boxed
extra credit — backlinks carry 80% of the value. Agent read access is deferred
to [[swarm-design]], where its first real consumer lives.
- (2026-07-04) cockpiT memory is markdown files (`.cockpit-memory/*.md`), not SQLite. In v0.1.33 it grew a full auto-brain pipeline: Capture → Distill → Reconcile → Gate → Commit/Review. It reads the Claude Code session `.jsonl` transcripts (via ClaudeSessionsService), redacts every fact through `redactText`, an LLM distills observations, reconcile detects duplicate/conflict against existing notes, a gate decides save-vs-ask, then atomic write with a provenance ledger + snapshot/restore. Two brains: project brain (`.cockpit-memory/`) and a global Baz brain (`<userData>/baz-memory/`) for cross-project user facts. Auto-capture runs on both idle-timeout and session-end via a durable SQLite queue. Roadmap: docs/memory-imp.md.
- (2026-07-04) cockpiT has two separate memory stores: the project 'Living brain' (flat .md files in .cockpit-memory/) and the global 'Baz brain' (MEMORY.md + files). The graph only resolves links between notes that exist in the SAME store. When a project note links to a Baz-brain note (e.g. [[model-routing-preference]], [[app-refresh-consent-rule]], [[swarm-auto-assign]], [[swarm-agent-boundaries]]), the target isn't in the project folder, so the graph reports it as 'unresolved', and a note whose only links point out of the store shows as 'orphan' (e.g. named-agents-team). This is by design (two brains are intentionally separate), not a bug — it's a cosmetic graph warning. Consolidate reports these same links as 'dangling'.
- (2026-07-05) cockpiT memory is markdown files (`.cockpit-memory/*.md`), not SQLite. In v0.1.33 it grew a full auto-brain pipeline: Capture → Distill → Reconcile → Gate → Commit/Review. It reads the Claude Code session `.jsonl` transcripts (via ClaudeSessionsService), redacts every fact through `redactText`, an LLM distills observations, reconcile detects duplicate/conflict against existing notes, a gate decides save-vs-ask, then atomic write with a provenance ledger + snapshot/restore. Two brains: project brain (`.cockpit-memory/`) and a global Baz brain (`<userData>/baz-memory/`) for cross-project user facts. Auto-capture runs on both idle-timeout and session-end via a durable SQLite queue. Roadmap: docs/memory-imp.md.
- (2026-07-05) cockpiT memory is markdown files (`.cockpit-memory/*.md`), not SQLite. In v0.1.33 it grew a full auto-brain pipeline: Capture → Distill → Reconcile → Gate → Commit/Review. It reads the Claude Code session `.jsonl` transcripts (via ClaudeSessionsService), redacts every fact through `redactText`, an LLM distills observations, reconcile detects duplicate/conflict against existing notes, a gate decides save-vs-ask, then atomic write with a provenance ledger + snapshot/restore. Two brains: project brain (`.cockpit-memory/`) and a global Baz brain (`<userData>/baz-memory/`) for cross-project user facts. Auto-capture runs on both idle-timeout and session-end via a durable SQLite queue. Roadmap: docs/memory-imp.md.
- (2026-07-06) cockpiT has two separate memory stores: the project 'Living brain' (flat .md files in .cockpit-memory/) and the global 'Baz brain' (MEMORY.md + files). The graph only resolves links between notes that exist in the SAME store. When a project note links to a Baz-brain note (e.g. [[model-routing-preference]], [[app-refresh-consent-rule]], [[swarm-auto-assign]], [[swarm-agent-boundaries]]), the target isn't in the project folder, so the graph reports it as 'unresolved', and a note whose only links point out of the store shows as 'orphan' (e.g. named-agents-team). This is by design (two brains are intentionally separate), not a bug — it's a cosmetic graph warning. Consolidate reports these same links as 'dangling'.
- (2026-07-06) MemoryHubService auto-generates timestamped snapshot copies of all memory notes under `.cockpit-memory/.snapshots/<timestamp>/` on every edit (for internal undo/versioning). These and the `.trash/` directory are internal backup artifacts that must never enter git tracking — without a gitignore entry they accumulate hundreds of untracked files that pollute git status. Fixed in commit 5525b36 (July 2026) by adding both dirs to .gitignore.
