import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/**
 * Appends a timestamped fatal-class entry to `main-crash.log` in userData.
 * Used for errors we deliberately swallow to keep the app alive — background
 * hiccups, uncaught async errors, event-listener throws — so they stay
 * diagnosable without ever taking the whole process down.
 */
export function logFatal(kind: string, err: unknown): void {
  const line = `[${new Date().toISOString()}] ${kind}: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`
  try {
    appendFileSync(join(app.getPath('userData'), 'main-crash.log'), line)
  } catch {
    // last resort: at least surface it on stderr
    console.error(line)
  }
}
