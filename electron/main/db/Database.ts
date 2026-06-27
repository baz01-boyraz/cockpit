import BetterSqlite3 from 'better-sqlite3'
import { SCHEMA_V1 } from './schema'

export type Db = BetterSqlite3.Database

interface Migration {
  version: number
  name: string
  sql: string
}

const MIGRATIONS: Migration[] = [{ version: 1, name: 'initial_schema', sql: SCHEMA_V1 }]

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
