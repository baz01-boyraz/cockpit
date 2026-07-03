# Plan: Memory Graph + Wikilinks (Feature #3 of BridgeSpace roadmap · VISION Phase 5)

> Status: SHIPPED 2026-07-02 (graph included — landed inside its time-box). Originally written before any Phase 5 code (0.1 rule).
> Vision context: [BRIDGESPACE-ROADMAP.md](../BRIDGESPACE-ROADMAP.md) §3.
> Sequencing law: **backlinks before graph view**; graph is last and time-boxed.

## What we're building

A local-first, per-project **markdown knowledge hub** living next to the repo in
`.cockpit-memory/`. Notes connect via `[[wikilinks]]`; every note shows its
**backlinks**; unresolved links invite note creation. Files are the source of
truth — plain markdown you own, commit, and version. Later (5.6) agents read
the same hub so context compounds across sessions.

**What it is NOT:**
- Not a cloud DB, not Supabase — files. (Memory: SQLite stays local-first.)
- Not a replacement for the SQLite session layer — that's operational state;
  the hub is the *knowledge* layer.
- Not Monaco. Plain textarea editing (project limit).
- Not a replacement for Notepad — the left-rail quick-capture drawer stays
  localStorage by design (concurrent-agent dodge). A "promote note to memory"
  action can bridge them later (parked, not scheduled).

## 5.1 Storage map (the decision table)

| Data | Tier | Why | Backup/sync story |
|---|---|---|---|
| UI prefs (chatOpen, …) | localStorage | Per-machine ephemera, zero IPC cost | none — intentionally disposable |
| Notepad quick notes | localStorage | Quick capture; dodges concurrent-agent write races | manual promote-to-hub (later) |
| Sessions, logs, insights, approvals, audit, usage | SQLite (userData) | Operational, queryable, app-scoped | app-local; not user content |
| **Knowledge notes (this feature)** | **markdown in `<project>/.cockpit-memory/`** | User-owned, versionable, agent-readable, survives the app | git — committed with the repo by default (user may gitignore it per-project) |
| Link graph index | in-memory, derived | Hubs are small (≤ hundreds of notes); files stay the ONLY truth | rebuilt on read; mtime cache only if scale demands |

Deletion is a **soft delete** (move into `.cockpit-memory/.trash/`) — honest
with the `delete_file` approval rule without a round-trip UX: nothing
destructive happens, recovery is a file move.

## Security / correctness boundary

- **Note names are slugs by construction**: `^[a-z0-9][a-z0-9._ -]{0,80}$` after
  normalization, no `/`, no leading dot → path traversal unrepresentable; plus a
  resolve()-under-root guard, defense in depth.
- Renderer never supplies paths — only note names; main derives paths.
- Hub reads are plain text; nothing is executed or eval'd. Note content shown
  in the UI is rendered as text (no HTML injection; wikilinks decorated by
  parsing, not innerHTML).
- 5.6 agent access ships read-only first; writes stay human-initiated.

## Kernel (5.2 — pure, TDD): `shared/wikilink.ts`

- `parseWikilinks(text)` → `[{ target, alias, start, end }]` — supports
  `[[name]]` and `[[name|label]]`; ignores code fences/inline code.
- `normalizeNoteName(raw)` → slug (case/space-insensitive matching key).
- `buildLinkIndex(docs: {name, content}[])` → `{ forward, backlinks, unresolved }`
  (maps keyed by normalized name; unresolved lists which notes want a missing note).
- `renameLinkTargets(content, oldName, newName)` — rewrites `[[old]]`/`[[old|x]]`
  across note bodies for rename-with-refresh.

## Service (5.3): `MemoryHubService` (main) + IPC

- Hub dir: `<project>/.cockpit-memory/` (created lazily on first write).
- `list(projectId)` → note summaries (name, title=first heading or name,
  updatedAt, linksOut, backlinks count) + `unresolved` aggregate.
- `read(projectId, name)` → content + backlinks + outgoing + unresolved-for-me.
- `write(projectId, name, content)` — create/update (atomic tmp+rename write).
- `rename(projectId, from, to)` — refreshes `[[links]]` in every other note.
- `trash(projectId, name)` — move to `.cockpit-memory/.trash/<name>-<ts>.md`.
- IPC: `memoryList/Read/Write/Rename/Trash` — typed via IpcResultMap; contract
  test enforces all legs; mock ships seeded, interlinked notes.
- Fully unit-testable with real fs in tmp dirs (no native deps).

## Task list

1. [x] 5.1 Storage map — this table (done by merging this doc)
2. [x] 5.2 `shared/wikilink.ts` kernel + tests (TDD)
3. [x] 5.3 MemoryHubService + tests + IPC all legs + seeded mock
4. [x] 5.4 UI: left-rail "Memory" view — note list, editor (textarea), backlink
       pane, unresolved "create this note" affordance; 2 screenshot rounds
5. [x] 5.5 Graph view — force-directed canvas, TIME-BOXED (ship without it if
       it overruns; backlinks already carry 80% of the value)
6. [x] 5.6 DECISION: deferred to Phase 6 — agent access's first real consumer
       is the Swarm orchestrator; building a consumer-less API now is speculative.
       Recorded in the hub itself ([[memory-hub]] note).
7. [x] Gate 5: notes + backlinks usable daily on THIS repo (dogfood: port the
       VISION progress log habit into hub notes), kernel fully tested, storage
       map documented, graph shipped or consciously parked

## DoD

VISION DoD + hub-specific: traversal attempts (`../x`, `.hidden`, absolute
paths) rejected by tests; rename refreshes links across notes under test;
trash never hard-deletes; mock parity screenshot-able.

## Polish backlog (from the 5.4 build — not blocking)
- `write`/`rename` could return `{ note, snapshot }` to remove a follow-up
  round-trip in the panel (rare, user-paced calls — fine as is).
