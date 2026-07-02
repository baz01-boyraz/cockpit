import type { Db } from '../../electron/main/db/Database'

/**
 * Recording stand-in for the SQLite layer. Tests never import better-sqlite3
 * (its native build targets Electron's ABI); services only need `prepare()`
 * returning `run/get/all`, so this fake records every statement invocation and
 * lets a test script the read results per SQL string.
 */
export interface DbCall {
  sql: string
  method: 'run' | 'get' | 'all'
  args: unknown[]
}

export interface RecordingDbHandlers {
  get?: (sql: string, args: unknown[]) => unknown
  all?: (sql: string, args: unknown[]) => unknown[]
  run?: (sql: string, args: unknown[]) => { changes: number }
}

export interface RecordingDb {
  db: Db
  /** Every prepared-statement invocation, in order. */
  calls: DbCall[]
  /** Calls of one method whose SQL contains the given fragment. */
  callsFor: (method: DbCall['method'], sqlFragment: string) => DbCall[]
}

export function makeRecordingDb(handlers: RecordingDbHandlers = {}): RecordingDb {
  const calls: DbCall[] = []
  const fake = {
    prepare(sql: string) {
      return {
        run: (...args: unknown[]) => {
          calls.push({ sql, method: 'run', args })
          return handlers.run?.(sql, args) ?? { changes: 1 }
        },
        get: (...args: unknown[]) => {
          calls.push({ sql, method: 'get', args })
          return handlers.get?.(sql, args)
        },
        all: (...args: unknown[]) => {
          calls.push({ sql, method: 'all', args })
          return handlers.all?.(sql, args) ?? []
        },
      }
    },
  }
  return {
    db: fake as unknown as Db,
    calls,
    callsFor: (method, sqlFragment) =>
      calls.filter((c) => c.method === method && c.sql.includes(sqlFragment)),
  }
}
