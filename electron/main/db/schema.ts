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
