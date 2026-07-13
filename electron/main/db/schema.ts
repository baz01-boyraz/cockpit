/**
 * Initial database schema (migration v1).
 *
 * One forward-only SQL string applied inside a transaction. Versioning is
 * tracked in `schema_migrations`; future migrations append new version blocks
 * below rather than editing this one.
 *
 * HISTORICAL NOTE (append-only violation, kept as-is): V1 was edited in place
 * after V2 had already shipped, so `insight_dismissals` and
 * `idx_error_insights_pattern` appear in BOTH blocks. That is harmless only
 * because both use IF NOT EXISTS (fresh installs create them via V1, upgraded
 * installs via V2). Do not restructure the old blocks — and never edit a
 * shipped block again. New DDL must go in a NEW appended SCHEMA_Vn block.
 */
export const SCHEMA_V1 = /* sql */ `
CREATE TABLE IF NOT EXISTS projects (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  path          TEXT NOT NULL UNIQUE,
  tech_stack_json TEXT NOT NULL DEFAULT '[]',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  last_opened_at TEXT
);

CREATE TABLE IF NOT EXISTS project_configs (
  project_id   TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  config_path  TEXT NOT NULL,
  config_json  TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS terminal_sessions (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  role          TEXT,
  cwd           TEXT NOT NULL,
  shell         TEXT NOT NULL,
  status        TEXT NOT NULL,
  pid           INTEGER,
  exit_code     INTEGER,
  created_at    TEXT NOT NULL,
  last_active_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_terminal_sessions_project ON terminal_sessions(project_id);

CREATE TABLE IF NOT EXISTS terminal_layouts (
  project_id  TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  layout_json TEXT NOT NULL DEFAULT '[]',
  updated_at  TEXT NOT NULL
);

-- Was reserved for Phase 6; V5 drops it (plan D3: the kanban card row itself
-- carries the terminal-session link, so a second instance registry would
-- duplicate the same fact). Still created here so V1..V5 replay identically.
CREATE TABLE IF NOT EXISTS agent_sessions (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  agent_type          TEXT NOT NULL,
  terminal_session_id TEXT REFERENCES terminal_sessions(id) ON DELETE SET NULL,
  status              TEXT NOT NULL,
  started_at          TEXT NOT NULL,
  ended_at            TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_project ON agent_sessions(project_id);

CREATE TABLE IF NOT EXISTS git_snapshots (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  branch              TEXT NOT NULL,
  changed_files_count INTEGER NOT NULL DEFAULT 0,
  staged_count        INTEGER NOT NULL DEFAULT 0,
  unstaged_count      INTEGER NOT NULL DEFAULT 0,
  untracked_count     INTEGER NOT NULL DEFAULT 0,
  snapshot_json       TEXT NOT NULL,
  created_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_git_snapshots_project ON git_snapshots(project_id);

CREATE TABLE IF NOT EXISTS railway_connections (
  id                    TEXT PRIMARY KEY,
  project_id            TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  railway_project_id    TEXT,
  railway_environment_id TEXT,
  token_ref             TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_railway_connections_project ON railway_connections(project_id);

CREATE TABLE IF NOT EXISTS railway_services (
  id                 TEXT PRIMARY KEY,
  connection_id      TEXT NOT NULL REFERENCES railway_connections(id) ON DELETE CASCADE,
  railway_service_id TEXT NOT NULL,
  name               TEXT NOT NULL,
  service_type       TEXT NOT NULL,
  status             TEXT NOT NULL,
  url                TEXT,
  start_command      TEXT,
  config_json        TEXT NOT NULL DEFAULT '{}',
  updated_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_railway_services_connection ON railway_services(connection_id);

CREATE TABLE IF NOT EXISTS log_events (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_type  TEXT NOT NULL,
  source_id    TEXT,
  level        TEXT NOT NULL,
  message      TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_log_events_project ON log_events(project_id, created_at);

CREATE TABLE IF NOT EXISTS error_insights (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  log_event_id    TEXT REFERENCES log_events(id) ON DELETE SET NULL,
  title           TEXT NOT NULL,
  likely_cause    TEXT NOT NULL,
  suggested_action TEXT NOT NULL,
  suggested_agent TEXT NOT NULL,
  severity        TEXT NOT NULL,
  matched_pattern TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_error_insights_project ON error_insights(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_error_insights_pattern ON error_insights(project_id, matched_pattern, created_at);

-- Dismissals are per-pattern, not per-row: dismissing acknowledges "I handled
-- this error shape up to here". dismissed_up_to is the newest occurrence's
-- timestamp at dismiss time, so a genuinely new occurrence (created after that)
-- makes the insight resurface — we never hide a recurring, still-live failure.
CREATE TABLE IF NOT EXISTS insight_dismissals (
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  matched_pattern TEXT NOT NULL,
  dismissed_up_to TEXT NOT NULL,
  dismissed_at    TEXT NOT NULL,
  PRIMARY KEY (project_id, matched_pattern)
);

CREATE TABLE IF NOT EXISTS usage_events (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider         TEXT NOT NULL,
  event_type       TEXT NOT NULL,
  count            INTEGER NOT NULL DEFAULT 1,
  duration_ms      INTEGER,
  estimated_tokens INTEGER,
  metadata_json    TEXT NOT NULL DEFAULT '{}',
  created_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_usage_events_project ON usage_events(project_id, provider);

CREATE TABLE IF NOT EXISTS approval_requests (
  id                    TEXT PRIMARY KEY,
  project_id            TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  action_type           TEXT NOT NULL,
  risk_level            TEXT NOT NULL,
  command_or_payload_json TEXT NOT NULL DEFAULT '{}',
  summary               TEXT NOT NULL DEFAULT '',
  status                TEXT NOT NULL,
  created_at            TEXT NOT NULL,
  resolved_at           TEXT
);
CREATE INDEX IF NOT EXISTS idx_approval_requests_project ON approval_requests(project_id, status);

CREATE TABLE IF NOT EXISTS audit_log (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT REFERENCES projects(id) ON DELETE SET NULL,
  actor               TEXT NOT NULL,
  action_type         TEXT NOT NULL,
  summary             TEXT NOT NULL,
  payload_redacted_json TEXT NOT NULL DEFAULT '{}',
  created_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_log_project ON audit_log(project_id, created_at);
`

/**
 * v2 — per-pattern insight dismissals. Incremental DDL for databases created
 * before this table existed. Idempotent (IF NOT EXISTS) so it is safe even when
 * a fresh install already provisioned these objects via SCHEMA_V1.
 */
export const SCHEMA_V2 = /* sql */ `
CREATE INDEX IF NOT EXISTS idx_error_insights_pattern ON error_insights(project_id, matched_pattern, created_at);

CREATE TABLE IF NOT EXISTS insight_dismissals (
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  matched_pattern TEXT NOT NULL,
  dismissed_up_to TEXT NOT NULL,
  dismissed_at    TEXT NOT NULL,
  PRIMARY KEY (project_id, matched_pattern)
);
`

/**
 * v3 — optional per-terminal alias (a user-set task label shown next to the
 * agent name). Forward-only DDL; `terminal_sessions` predates this column so it
 * is added via ALTER. Not added to SCHEMA_V1 — a fresh DB runs V1 (no column)
 * then this ALTER, and SQLite has no `ADD COLUMN IF NOT EXISTS`, so defining it
 * in both would throw "duplicate column name".
 */
export const SCHEMA_V3 = /* sql */ `
ALTER TABLE terminal_sessions ADD COLUMN alias TEXT;
`

/**
 * v4 — terminal lifecycle honesty + query performance. Append-only.
 *
 * - `terminal_sessions.reconciled_at`: pty processes never survive the app
 *   process, so any row still claiming running/starting at boot is stale. Boot
 *   reconciliation (TerminalManager) flips its status to 'exited' and stamps
 *   this column — NULL means the exit was observed live, a timestamp means the
 *   row was reconciled after a crash/quit.
 * - `terminal_sessions.command`: the startup command the pane was launched with
 *   (dev server, `claude`, `codex --resume …`). cwd/shell/project were already
 *   persisted by V1; with the command stored too, a Phase 6 resume can relaunch
 *   the session from its row alone.
 * - `idx_usage_events_project_created`: `UsageService.summarize()` filters by
 *   project and orders by created_at; V1 only indexed (project_id, provider).
 *
 * Like V3, the ALTERs live only here (SQLite has no ADD COLUMN IF NOT EXISTS,
 * so defining them in V1 as well would throw "duplicate column name").
 */
export const SCHEMA_V4 = /* sql */ `
ALTER TABLE terminal_sessions ADD COLUMN reconciled_at TEXT;
ALTER TABLE terminal_sessions ADD COLUMN command TEXT;
CREATE INDEX IF NOT EXISTS idx_usage_events_project_created ON usage_events(project_id, created_at);
`

/**
 * V5 — Phase 6 (Swarm + Kanban), plan decisions D2/D3.
 *
 * The Kanban card is the unit of agent work: one implicit board per project,
 * and the card row itself links to its terminal session, worktree, and branch.
 * That makes the never-written agent_sessions table a duplicate registry of
 * the same fact, so it goes away here.
 */
export const SCHEMA_V5 = /* sql */ `
DROP TABLE IF EXISTS agent_sessions;
CREATE TABLE IF NOT EXISTS kanban_cards (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title               TEXT NOT NULL,
  body                TEXT NOT NULL DEFAULT '',
  status              TEXT NOT NULL,
  position            REAL NOT NULL,
  role                TEXT,
  persona             TEXT,
  terminal_session_id TEXT REFERENCES terminal_sessions(id) ON DELETE SET NULL,
  worktree_path       TEXT,
  branch              TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kanban_cards_project ON kanban_cards(project_id);
`

/**
 * V6 — Named Agents (docs/plans/named-agents-plan.md): a card can be assigned
 * to an identity from `.claude/agents/` (user or project scope). Only the slug
 * is stored — definition files are the truth.
 */
export const SCHEMA_V6 = /* sql */ `
ALTER TABLE kanban_cards ADD COLUMN agent TEXT;
`

/**
 * V7 — Memory brain provenance ledger (docs/memory-imp.md, G7). Append-only:
 * every change the brain makes to a note is recorded with before/after content
 * hashes, so any note is traceable to the session that produced it and is
 * revertible. `brain` is 'project:<id>' or 'baz-global' (the global hub is not a
 * project, so no FK). No FK on note_slug either — notes are files, not rows, and
 * a soft-deleted note must keep its history.
 */
export const SCHEMA_V7 = /* sql */ `
CREATE TABLE IF NOT EXISTS memory_ledger (
  id           TEXT PRIMARY KEY,
  brain        TEXT NOT NULL,
  note_slug    TEXT NOT NULL,
  action       TEXT NOT NULL,
  gate         TEXT NOT NULL,
  source_id    TEXT,
  hash_before  TEXT,
  hash_after   TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_ledger_note ON memory_ledger(brain, note_slug, created_at);
`

/**
 * V8 — Memory review queue (docs/memory-imp.md, G4). When the distiller is
 * unsure a fact is worth keeping, or reconciliation finds a collision, the
 * proposed change waits here for Baz's one-tap decision instead of being written
 * silently. `payload` is the JSON proposal (title, proposed content, reason,
 * existing content). No FK — brains include the non-project global hub.
 */
export const SCHEMA_V8 = /* sql */ `
CREATE TABLE IF NOT EXISTS memory_review (
  id           TEXT PRIMARY KEY,
  brain        TEXT NOT NULL,
  kind         TEXT NOT NULL,
  slug         TEXT NOT NULL,
  payload      TEXT NOT NULL,
  status       TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  resolved_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_memory_review_pending ON memory_review(brain, status, created_at);
`

/**
 * V9 — Durable memory capture queue (docs/memory-imp.md, G2 "never miss"). One
 * row per Claude session; `last_offset` is the byte cursor so only new turns are
 * distilled. The row survives app quit/crash, so a pending capture is never
 * dropped — on boot any 'processing' row is reset to 'queued' and resumed.
 * `session_id` is unique: a session has exactly one queue row, re-armed when it
 * grows. No FK (a project row could be removed while a capture is pending).
 */
export const SCHEMA_V9 = /* sql */ `
CREATE TABLE IF NOT EXISTS memory_capture_queue (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL,
  session_id    TEXT NOT NULL UNIQUE,
  source_path   TEXT NOT NULL,
  status        TEXT NOT NULL,
  last_offset   INTEGER NOT NULL DEFAULT 0,
  attempts      INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  enqueued_at   TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mcq_status ON memory_capture_queue(status, enqueued_at);
`

/**
 * V10 — Systematic role pipeline (auto-assign). A card carries an ORDERED list
 * of role/spec assignments (`shared/agent-taxonomy`) run sequentially in one
 * worktree, and `pipeline_step` tracks how far the chain has advanced. The
 * legacy single `role`/`persona`/`agent` columns stay for back-compat; when
 * `assignments` is non-empty it is the source of truth. Append-only ALTERs
 * (SQLite has no ADD COLUMN IF NOT EXISTS), each with a default so existing
 * rows migrate cleanly.
 *
 * Renumbered from V7→V10 during the 2026-07-04 batch integration (the memory
 * brain independently claimed V7–V9 on a parallel branch).
 */
export const SCHEMA_V10 = /* sql */ `
ALTER TABLE kanban_cards ADD COLUMN assignments TEXT NOT NULL DEFAULT '[]';
ALTER TABLE kanban_cards ADD COLUMN pipeline_step INTEGER NOT NULL DEFAULT 0;
`

/**
 * V11 — Council v2 persisted sessions (Faz 1). Every completed council run is
 * kept as history so the aggregate rankings can be merged into a cross-session
 * scorecard. `result_json` is the full serialized CouncilResult; `verdict_kind`
 * mirrors the spec gate (approved/needs_clarification) for cheap filtering.
 *
 * `card_id` deliberately has NO foreign key: a session is history and must
 * survive the card being removed from the board — the ON DELETE CASCADE that a
 * FK would impose is exactly the wrong behavior here. `project_id` keeps its FK
 * (a session belongs to a project and should vanish with it). Append-only.
 */
export const SCHEMA_V11 = /* sql */ `
CREATE TABLE IF NOT EXISTS council_sessions (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  card_id      TEXT,
  mode         TEXT NOT NULL,
  question     TEXT,
  result_json  TEXT NOT NULL,
  verdict_kind TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_council_sessions_project ON council_sessions(project_id, created_at);
`

/**
 * V12 — a card can carry an approved council session (Faz 2a spec-gate wiring).
 * When the card's worker spawns, that session's conclusions ride along in the
 * opening prompt ("the worker was in the meeting").
 *
 * Like V11's `card_id`, this column deliberately has NO foreign key: the session
 * is HISTORY, not a live relation — a card must keep pointing at the meeting that
 * shaped it even though the row lives in `council_sessions`, and an ON DELETE
 * side effect is exactly the wrong behavior here. A dangling id simply degrades
 * to "no brief" at spawn time. Append-only ALTER (SQLite has no ADD COLUMN IF
 * NOT EXISTS, so this lives only here, never back-edited into V5).
 */
export const SCHEMA_V12 = /* sql */ `
ALTER TABLE kanban_cards ADD COLUMN council_session_id TEXT;
`

/**
 * V13 — sentinel signal spine (Faz A). An always-on, LLM-FREE signal layer:
 * sensors (log intelligence, worker exits, approvals, council) emit structured
 * signals that the SentinelService dedups, persists here, and pushes to the
 * renderer + macOS notifications. `project_id` keeps its FK (a signal belongs to
 * a project and vanishes with it, ON DELETE CASCADE). Two indexes:
 *   - (project_id, created_at) for the feed read (`list`, newest first);
 *   - (project_id, fingerprint, created_at) for the cooldown dedup lookup
 *     (same-fingerprint rows within the window).
 * `status` is 'new' | 'seen' (the unseen badge). Append-only.
 */
export const SCHEMA_V13 = /* sql */ `
CREATE TABLE IF NOT EXISTS sentinel_signals (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  severity     TEXT NOT NULL,
  source       TEXT NOT NULL,
  title        TEXT NOT NULL,
  summary      TEXT NOT NULL,
  context      TEXT,
  fingerprint  TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'new',
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sentinel_signals_project ON sentinel_signals(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sentinel_signals_fingerprint ON sentinel_signals(project_id, fingerprint, created_at);
`

/**
 * V14 — Hermes triage enrichment (Faz B). A cheap Hermes oneshot (DeepSeek)
 * judges a notice/alert signal asynchronously and stores its verdict here. A
 * SINGLE JSON column because triage is an enrichment blob the renderer treats as
 * one unit (headline, action, reportWorthy, gotchaCandidate, at) — no query ever
 * filters on its parts, so decomposing it into columns would buy nothing and add
 * a migration per field. NULL means "not yet triaged" (Hermes missing/slow/wrong
 * always leaves it NULL and the spine works identically). Append-only ALTER
 * (SQLite has no ADD COLUMN IF NOT EXISTS, so it lives only here, never back-
 * edited into V13).
 */
export const SCHEMA_V14 = /* sql */ `
ALTER TABLE sentinel_signals ADD COLUMN triage TEXT;
`

/**
 * V15 — Hermes chat transcript persistence (roadmap A7b). The chat widget's
 * per-project history was in-memory only, so conversations evaporated on restart.
 * Each turn is one row; the `id` is an AUTOINCREMENT rowid so insert order is
 * conversation order (hydration reads `ORDER BY id`). `project_id` keeps its FK
 * (a project's chat vanishes with it, ON DELETE CASCADE). The service rewrites a
 * project's rows on each successful turn — delete-then-insert the capped history
 * — so the table stays bounded to the same transcript cap as the in-memory Map.
 * No redaction is applied here by design (that is security task D1's concern);
 * this migration is purely persistence. Append-only.
 */
export const SCHEMA_V15 = /* sql */ `
CREATE TABLE IF NOT EXISTS hermes_chat_turns (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role         TEXT NOT NULL,
  content      TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_hermes_chat_turns_project ON hermes_chat_turns(project_id, id);
`

/**
 * V16 — Memory recall telemetry (Track G2, docs/plans/outcome-tracking-plan.md).
 * `memory_ledger` (V7) records only WRITES; recalls — the selection of hub notes
 * that reach a prompt — were invisible. This slim table records that selection at
 * its two hooks (`SwarmService.hubNoteNames`, `CouncilService.memoryPointerBlock`)
 * so the 7-day "earns its keep" test is a one-line query: notes recalled since
 * now-7d vs the hub's list. Kept OUT of `memory_ledger` on purpose — the ledger is
 * revertible write-provenance (before/after hashes), and mixing high-frequency
 * recalls in would pollute its semantics and its `list()`.
 *
 * `brain` is 'project:<id>' | 'baz-global' with NO FK — brains address files/hubs,
 * not rows, and the non-project global hub is a valid brain (mirrors V7/V8/V9).
 * `note_slug` also has no FK (notes are files). `surface` is
 * 'swarm_worker' | 'council_spec'. Two indexes: (brain, note_slug, created_at) for
 * the per-note recency lookup, (brain, created_at) for the since-window scan.
 *
 * The plan reserved V15 for this table; V15 was independently taken by
 * hermes_chat_turns on a parallel branch, so this lands as V16 (same renumber-on-
 * integration rule as the V7→V10 memory-brain batch). Append-only.
 */
export const SCHEMA_V16 = /* sql */ `
CREATE TABLE IF NOT EXISTS memory_recalls (
  id         TEXT PRIMARY KEY,
  brain      TEXT NOT NULL,
  note_slug  TEXT NOT NULL,
  surface    TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_recalls_note ON memory_recalls(brain, note_slug, created_at);
CREATE INDEX IF NOT EXISTS idx_memory_recalls_brain ON memory_recalls(brain, created_at);
`

/**
 * V17 — Sentinel triage accuracy (Track G3, docs/plans/outcome-tracking-plan.md).
 * `status` ('new' | 'seen', V13) only tracks the badge; it cannot tell a signal
 * dismissed as noise from one acted on. These two columns record the user's
 * RESPONSE so triage precision is measurable: among `reportWorthy` signals, how
 * many were acted on / became cards vs dismissed. `outcome` is
 * 'dismissed' | 'acted' | 'card_created' | NULL (no response yet); `outcome_at`
 * stamps when it was set. They sit ON the signal row — co-located with `triage`
 * (V14) and durable under the row's `ON DELETE CASCADE`.
 *
 * The plan reserved V16 for this ALTER; V16 was independently taken by
 * memory_recalls on a parallel branch, so this lands as V17 (same renumber-on-
 * integration rule as V16 and the V7→V10 memory-brain batch). Append-only ALTER
 * (SQLite has no ADD COLUMN IF NOT EXISTS, so it lives only here, never back-
 * edited into V13).
 */
export const SCHEMA_V17 = /* sql */ `
ALTER TABLE sentinel_signals ADD COLUMN outcome    TEXT;
ALTER TABLE sentinel_signals ADD COLUMN outcome_at TEXT;
`

/**
 * V18 — Council run lifecycle marker (roadmap A6). Until now a council session
 * row appeared only at the FINAL persist, so a mid-run crash left no trace at
 * all. `CouncilService.run()` now inserts a `pending` row up front and flips it
 * to `final` on completion; a `failed` row is a run that never finished. This
 * column makes that state explicit and queryable so the boot sweep can mark any
 * orphaned `pending` row (residue of a crashed previous process) as `failed`.
 *
 * `status` is 'pending' | 'final' | 'failed'. DEFAULT 'final' so every row that
 * predates this migration — all of which are completed runs written by the old
 * single-insert path — reads back as `final` without a data migration. Append-
 * only ALTER (SQLite has no ADD COLUMN IF NOT EXISTS, so it lives only here,
 * never back-edited into V11).
 */
export const SCHEMA_V18 = /* sql */ `
ALTER TABLE council_sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'final';
`

/**
 * V19 — Brain-scoped Memory trust settings. Knowledge remains Markdown; this
 * table stores operational policy only. The global brain has its own row and
 * never inherits whichever project happens to be active in the renderer.
 */
export const SCHEMA_V19 = /* sql */ `
CREATE TABLE IF NOT EXISTS memory_brain_settings (
  brain          TEXT PRIMARY KEY,
  trust_mode     TEXT NOT NULL,
  policy_version INTEGER NOT NULL,
  updated_at     TEXT NOT NULL
);
`

/**
 * V20 — one bounded operational-health state row per project. Snapshots contain
 * counts/categories only; raw logs, paths, card text, approval payloads, and
 * Memory content never enter this table. The row doubles as an atomic run claim
 * so a timer tick or second app process cannot overlap an active sweep.
 */
export const SCHEMA_V20 = /* sql */ `
CREATE TABLE IF NOT EXISTS operational_health_state (
  project_id                 TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  status                     TEXT NOT NULL DEFAULT 'idle',
  last_run_at                TEXT,
  last_result_json           TEXT,
  last_fingerprint           TEXT,
  last_notified_fingerprint  TEXT,
  last_notified_at           TEXT,
  last_digest_at             TEXT,
  updated_at                 TEXT NOT NULL
);
`

/** V21 — durable app-owned Hermes automations. The scheduler stores only the
 * owner's bounded instruction and bounded/redacted manager result. */
export const SCHEMA_V21 = /* sql */ `
CREATE TABLE IF NOT EXISTS automation_jobs (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  instruction   TEXT NOT NULL,
  kind          TEXT NOT NULL,
  schedule_json TEXT NOT NULL,
  system        INTEGER NOT NULL DEFAULT 0,
  enabled       INTEGER NOT NULL DEFAULT 1,
  state         TEXT NOT NULL DEFAULT 'scheduled',
  next_run_at   TEXT NOT NULL,
  last_run_at   TEXT,
  last_status   TEXT NOT NULL DEFAULT 'never',
  last_result   TEXT,
  last_error    TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_automation_jobs_due
  ON automation_jobs(enabled, state, next_run_at);
`

/**
 * V22 — provider-aware durable memory capture. Existing rows predate Codex
 * capture and therefore migrate as Claude. Rebuilding the small queue replaces
 * the old session-only UNIQUE constraint with provider + session, so native ids
 * can never collide across transcript stores.
 */
export const SCHEMA_V22 = /* sql */ `
CREATE TABLE memory_capture_queue_v22 (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL,
  provider      TEXT NOT NULL CHECK(provider IN ('claude', 'codex')),
  session_id    TEXT NOT NULL,
  source_path   TEXT NOT NULL,
  status        TEXT NOT NULL,
  last_offset   INTEGER NOT NULL DEFAULT 0,
  attempts      INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  enqueued_at   TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE(provider, session_id)
);

INSERT INTO memory_capture_queue_v22
  (id, project_id, provider, session_id, source_path, status, last_offset, attempts, error, enqueued_at, updated_at)
SELECT
  id, project_id, 'claude', session_id, source_path, status, last_offset, attempts, error, enqueued_at, updated_at
FROM memory_capture_queue;

DROP TABLE memory_capture_queue;
ALTER TABLE memory_capture_queue_v22 RENAME TO memory_capture_queue;
CREATE INDEX idx_mcq_status ON memory_capture_queue(status, enqueued_at);
`

/**
 * V23 — observable Memory capture lifecycle. `status` now carries the live
 * processing stage; retry scheduling and recovery guidance stay durable so a
 * quit/crash never turns a blocked capture into a silent failure.
 */
export const SCHEMA_V23 = /* sql */ `
ALTER TABLE memory_capture_queue ADD COLUMN next_retry_at TEXT;
ALTER TABLE memory_capture_queue ADD COLUMN guidance TEXT;
UPDATE memory_capture_queue SET status = 'reading' WHERE status = 'processing';
`
