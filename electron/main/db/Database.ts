import BetterSqlite3 from 'better-sqlite3'
import {
  SCHEMA_V1,
  SCHEMA_V2,
  SCHEMA_V3,
  SCHEMA_V4,
  SCHEMA_V5,
  SCHEMA_V6,
  SCHEMA_V7,
  SCHEMA_V8,
  SCHEMA_V9,
  SCHEMA_V10,
  SCHEMA_V11,
  SCHEMA_V12,
  SCHEMA_V13,
  SCHEMA_V14,
  SCHEMA_V15,
  SCHEMA_V16,
  SCHEMA_V17,
  SCHEMA_V18,
  SCHEMA_V19,
} from './schema'

export type Db = BetterSqlite3.Database

interface Migration {
  version: number
  name: string
  sql: string
}

const MIGRATIONS: Migration[] = [
  { version: 1, name: 'initial_schema', sql: SCHEMA_V1 },
  { version: 2, name: 'insight_dismissals', sql: SCHEMA_V2 },
  { version: 3, name: 'terminal_alias', sql: SCHEMA_V3 },
  { version: 4, name: 'terminal_lifecycle_and_usage_index', sql: SCHEMA_V4 },
  { version: 5, name: 'kanban_cards', sql: SCHEMA_V5 },
  { version: 6, name: 'kanban_card_agent', sql: SCHEMA_V6 },
  { version: 7, name: 'memory_ledger', sql: SCHEMA_V7 },
  { version: 8, name: 'memory_review', sql: SCHEMA_V8 },
  { version: 9, name: 'memory_capture_queue', sql: SCHEMA_V9 },
  { version: 10, name: 'kanban_card_assignments', sql: SCHEMA_V10 },
  { version: 11, name: 'council_sessions', sql: SCHEMA_V11 },
  { version: 12, name: 'kanban_card_council_session', sql: SCHEMA_V12 },
  { version: 13, name: 'sentinel_signals', sql: SCHEMA_V13 },
  { version: 14, name: 'sentinel_signal_triage', sql: SCHEMA_V14 },
  { version: 15, name: 'hermes_chat_turns', sql: SCHEMA_V15 },
  { version: 16, name: 'memory_recalls', sql: SCHEMA_V16 },
  { version: 17, name: 'sentinel_signal_outcome', sql: SCHEMA_V17 },
  { version: 18, name: 'council_session_status', sql: SCHEMA_V18 },
  { version: 19, name: 'memory_brain_settings', sql: SCHEMA_V19 },
]

/**
 * Opens (or creates) the SQLite database, applies pending migrations inside a
 * transaction, and returns the live connection. Pass `:memory:` for tests.
 */
export function openDatabase(filename: string): Db {
  const db = new BetterSqlite3(filename)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')

  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name    TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`)

  const applied = new Set<number>(
    db.prepare('SELECT version FROM schema_migrations').all().map((r) => (r as { version: number }).version),
  )

  const insertMigration = db.prepare(
    'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)',
  )

  const runPending = db.transaction(() => {
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue
      db.exec(migration.sql)
      insertMigration.run(migration.version, migration.name, new Date().toISOString())
    }
  })

  runPending()
  return db
}
