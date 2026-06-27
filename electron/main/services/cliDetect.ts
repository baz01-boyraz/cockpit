import { execFileSync } from 'node:child_process'

/** Detect whether a CLI is available on PATH. Cached per process. */
const cache = new Map<string, boolean>()

export function hasCli(bin: string): boolean {
  if (cache.has(bin)) return cache.get(bin) as boolean
  let available = false
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [bin], {
      stdio: 'ignore',
      timeout: 3000,
    })
    available = true
  } catch {
    available = false
  }
  cache.set(bin, available)
  return available
}
