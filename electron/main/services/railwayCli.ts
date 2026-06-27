import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/**
 * Thin wrapper around the user-authenticated `railway` CLI.
 *
 * Security: this never handles a Railway token. It relies entirely on the
 * session created by `railway login` (stored by the CLI in the user's home).
 * The cockpit just shells out — so no secret ever enters the app or the
 * renderer. All commands are read-only here; mutations stay behind the approval
 * gate and are not executed in this build.
 */

let cachedBin: string | null | undefined

/**
 * Resolve the railway binary. A macOS GUI app does not inherit the shell PATH,
 * so we probe the common install locations explicitly before falling back to a
 * bare `railway` (which works when launched from a terminal).
 */
export function resolveRailwayBin(): string | null {
  if (cachedBin !== undefined) return cachedBin
  const candidates = [
    join(homedir(), '.local/bin/railway'),
    '/opt/homebrew/bin/railway',
    '/usr/local/bin/railway',
    join(homedir(), '.bun/bin/railway'),
  ]
  cachedBin = candidates.find((p) => existsSync(p)) ?? 'railway'
  return cachedBin
}

export interface RailwayResult {
  ok: boolean
  stdout: string
  stderr: string
}

export async function runRailway(args: string[], cwd: string): Promise<RailwayResult> {
  const bin = resolveRailwayBin()
  if (!bin) return { ok: false, stdout: '', stderr: 'railway CLI not found' }
  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      cwd,
      timeout: 15_000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env },
    })
    return { ok: true, stdout, stderr }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string }
    return { ok: false, stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? 'railway command failed' }
  }
}

export async function railwayJson<T>(args: string[], cwd: string): Promise<T | null> {
  const res = await runRailway(args, cwd)
  if (!res.ok || !res.stdout.trim()) return null
  try {
    return JSON.parse(res.stdout) as T
  } catch {
    return null
  }
}

/** Whether the CLI is installed and a session exists. */
export async function railwayAvailable(cwd: string): Promise<boolean> {
  if (!resolveRailwayBin()) return false
  const res = await runRailway(['whoami'], cwd)
  return res.ok
}
