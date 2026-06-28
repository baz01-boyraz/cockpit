import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Resolve a CLI binary to an absolute path. A macOS GUI app launched from
 * Finder/Dock does NOT inherit the shell PATH, so a bare `execFile('gh', …)`
 * fails with ENOENT even when the CLI is installed and authenticated. We probe
 * the common install locations explicitly and fall back to the bare name (which
 * still works when the app is launched from a terminal).
 */
const cache = new Map<string, string>()

export function resolveBin(name: string): string {
  const cached = cache.get(name)
  if (cached !== undefined) return cached
  const candidates = [
    join(homedir(), '.local/bin', name),
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    join(homedir(), '.bun/bin', name),
  ]
  const resolved = candidates.find((p) => existsSync(p)) ?? name
  cache.set(name, resolved)
  return resolved
}
