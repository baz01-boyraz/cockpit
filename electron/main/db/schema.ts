/**
 * Initial database schema (migration v1).
 *
 * One forward-only SQL string applied inside a transaction. Versioning is
 * tracked in `schema_migrations`; future migrations append new version blocks
 * in `migrations.ts` rather than editing this one.
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
