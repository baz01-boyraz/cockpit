import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AppRefreshResult } from '@shared/ipc'

/**
 * Kick off `npm run app:refresh` in a source checkout: rebuild the unsigned
 * macOS app, replace the installed bundle, and relaunch. This is the local dev
 * refresh path — it only works when the active project is the cockpit's own
 * source (its package.json defines the `app:refresh` script).
 *
 * The child is spawned through the user's login+interactive shell so it inherits
 * the full PATH (npm/node, electron-builder, etc.) that a GUI-launched app does
 * not get on its own. It is detached and unref'd so it survives the very app it
 * is about to quit and replace.
 */
export function rebuildAndRelaunch(sourceDir: string): AppRefreshResult {
  const pkgPath = join(sourceDir, 'package.json')
  if (!existsSync(pkgPath)) {
    return {
      ok: false,
      message: 'Active project has no package.json. Open the Baz Cockpit source as the active project.',
    }
  }

  let scripts: Record<string, string> = {}
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { scripts?: Record<string, string> }
    scripts = pkg.scripts ?? {}
  } catch {
    return { ok: false, message: 'Could not read package.json in the active project.' }
  }

  if (!scripts['app:refresh']) {
    return {
      ok: false,
      message: 'Active project is not the Baz Cockpit source (no "app:refresh" script).',
    }
  }

  const shell = process.env.SHELL || '/bin/zsh'
  try {
    const child = spawn(shell, ['-ilc', 'npm run app:refresh'], {
      cwd: sourceDir,
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    })
    child.unref()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, message: `Could not start rebuild: ${message}` }
  }

  return {
    ok: true,
    message: 'Rebuilding… the app will quit and relaunch automatically in ~1–2 minutes.',
  }
}
