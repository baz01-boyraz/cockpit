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
