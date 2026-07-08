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
const COCKPIT_PACKAGE_NAME = 'cockpit'
const COCKPIT_APP_ID = 'com.boyraz.cockpit'

interface PackageJsonShape {
  name?: string
  scripts?: Record<string, string>
  build?: { appId?: string }
}

function readPackageJson(sourceDir: string): PackageJsonShape | null {
  const pkgPath = join(sourceDir, 'package.json')
  if (!existsSync(pkgPath)) return null
  try {
    return JSON.parse(readFileSync(pkgPath, 'utf8')) as PackageJsonShape
  } catch {
    return null
  }
}

/**
 * True only when the directory is cockpiT's own source checkout. The rebuild
 * path runs an npm script from this directory with the user's privileges, so a
 * script-name check alone would let ANY repo that declares `app:refresh`
 * become an execution target. Require the package identity to match too.
 */
export function isCockpitSource(sourceDir: string): boolean {
  const pkg = readPackageJson(sourceDir)
  return Boolean(
    pkg &&
      pkg.name === COCKPIT_PACKAGE_NAME &&
      pkg.build?.appId === COCKPIT_APP_ID &&
      pkg.scripts?.['app:refresh'],
  )
}

function spawnDetachedNpmScript(
  sourceDir: string,
  script: string,
  successMessage: string,
): AppRefreshResult {
  const shell = process.env.SHELL || '/bin/zsh'
  try {
    const child = spawn(shell, ['-ilc', `npm run ${script}`], {
      cwd: sourceDir,
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
    })
    child.unref()
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, message: `Could not start ${script}: ${message}` }
  }
  return { ok: true, message: successMessage }
}

export function rebuildAndRelaunch(sourceDir: string): AppRefreshResult {
  if (!isCockpitSource(sourceDir)) {
    return {
      ok: false,
      message: 'Active project is not the cockpiT source — rebuild refused.',
    }
  }
  return spawnDetachedNpmScript(
    sourceDir,
    'app:refresh',
    'Rebuilding… the app will quit and relaunch automatically in ~1–2 minutes.',
  )
}

/**
 * Rebaseline the installed app onto the latest published GitHub release. This
 * is the way OFF a local `app:refresh` build (ad-hoc signed, no
 * `app-update.yml`, auto-update "unsupported") and back onto the release train
 * where in-app auto-update works. Same trust model as the rebuild path: only
 * cockpiT's own verified source may be an execution target.
 */
export function installLatestRelease(sourceDir: string): AppRefreshResult {
  if (!isCockpitSource(sourceDir)) {
    return {
      ok: false,
      message: 'Active project is not the cockpiT source — install refused.',
    }
  }
  const pkg = readPackageJson(sourceDir)
  if (!pkg?.scripts?.['app:install-release']) {
    return {
      ok: false,
      message: 'This checkout has no app:install-release script — pull the latest source first.',
    }
  }
  return spawnDetachedNpmScript(
    sourceDir,
    'app:install-release',
    'Installing the latest release… the app will quit, replace itself and reopen in ~1 minute.',
  )
}
