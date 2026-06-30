import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import type { AppUpdateState } from '@shared/domain'
import type { CockpitEvents } from '../events'
import { nowIso } from '../util/ids'
import { resolveBin } from './resolveBin'

const execFileAsync = promisify(execFile)

const NOT_PACKAGED_MESSAGE = 'Auto-update is available only in a packaged app.'
const NO_UPDATE_CONFIG_MESSAGE =
  'This local build has no update metadata (app-update.yml). Install a released DMG/ZIP to enable auto-update.'

// Give the window time to finish loading before the first background check, then
// poll periodically so a release published mid-session still surfaces the card.
const AUTO_CHECK_INITIAL_DELAY_MS = 8_000
const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/**
 * electron-updater reads `app-update.yml` from the app's resources directory to
 * learn where to look for releases. Local `--dir` builds (e.g. `npm run app:refresh`)
 * report `app.isPackaged === true` but never generate that file, so calling
 * `checkForUpdates()` throws a raw `ENOENT`. Probe for the file first so we can
 * present a clean "unsupported" state instead of crashing.
 */
function hasUpdateConfig(): boolean {
  try {
    return existsSync(join(process.resourcesPath, 'app-update.yml'))
  } catch {
    return false
  }
}

function unsupportedReason(): string | null {
  if (!app.isPackaged) return NOT_PACKAGED_MESSAGE
  if (!hasUpdateConfig()) return NO_UPDATE_CONFIG_MESSAGE
  return null
}

const PRIVATE_REPO_AUTH_HINT =
  'GitHub returned 404. This repository is private — connect GitHub (so the app can read the gh token) before checking for updates.'

/**
 * electron-updater fetches release metadata (`latest-mac.yml`) and assets over
 * plain HTTPS with no credentials. For a **private** GitHub repo those requests
 * 404 with `logged_in=no`. We reuse the developer's already-connected `gh`
 * credentials by reading `gh auth token` and attaching it as the update request
 * auth header. This never initiates a login — if gh is not connected it returns
 * nothing and the update simply stays unauthenticated.
 */
async function readGhToken(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(resolveBin('gh'), ['auth', 'token'], {
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env },
    })
    const token = stdout.trim()
    return token.length > 0 ? token : null
  } catch {
    return null
  }
}

function looksLikePrivateRepoAuthError(message: string): boolean {
  const lower = message.toLowerCase()
  return lower.includes('404') || lower.includes('logged_in=no')
}

function notesToString(notes: UpdateInfo['releaseNotes']): string | null {
  if (!notes) return null
  if (typeof notes === 'string') return notes
  if (Array.isArray(notes)) {
    return notes
      .map((note) => {
        if (typeof note === 'string') return note
        if (note && typeof note === 'object' && 'note' in note) return String(note.note)
        return ''
      })
      .filter(Boolean)
      .join('\n\n')
  }
  return null
}

export class AppUpdateService {
  private state: AppUpdateState
  private autoCheckTimers: NodeJS.Timeout[] = []

  constructor(private readonly events: CockpitEvents) {
    const reason = unsupportedReason()
    const canCheck = reason === null
    this.state = {
      phase: canCheck ? 'idle' : 'unsupported',
      currentVersion: app.getVersion(),
      latestVersion: null,
      releaseName: null,
      releaseNotes: null,
      progressPercent: null,
      canCheck,
      canDownload: false,
      canInstall: false,
      error: reason,
      checkedAt: null,
    }

    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    this.bindEvents()
  }

  status(): AppUpdateState {
    return this.state
  }

  /**
   * Quietly poll GitHub for a published release so the renderer can surface an
   * "update available" card without the developer manually checking. No-op on
   * builds that can't auto-update (dev / unpackaged / no `app-update.yml`) so we
   * never spin a useless interval or emit error noise there.
   */
  startAutoCheck(): void {
    if (!this.state.canCheck || this.autoCheckTimers.length > 0) return
    const run = () => {
      void this.check()
    }
    this.autoCheckTimers.push(setTimeout(run, AUTO_CHECK_INITIAL_DELAY_MS))
    this.autoCheckTimers.push(setInterval(run, AUTO_CHECK_INTERVAL_MS))
  }

  stopAutoCheck(): void {
    for (const timer of this.autoCheckTimers) clearTimeout(timer)
    this.autoCheckTimers = []
  }

  async check(): Promise<AppUpdateState> {
    const reason = unsupportedReason()
    if (reason !== null) {
      this.setState({
        phase: 'unsupported',
        canCheck: false,
        canDownload: false,
        canInstall: false,
        error: reason,
        checkedAt: nowIso(),
      })
      return this.state
    }

    this.setState({
      phase: 'checking',
      error: null,
      progressPercent: null,
      canDownload: false,
      canInstall: false,
      checkedAt: nowIso(),
    })

    await this.applyPrivateRepoAuth()

    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      this.setState({
        phase: 'error',
        error: looksLikePrivateRepoAuthError(raw) ? `${PRIVATE_REPO_AUTH_HINT}\n\n${raw}` : raw,
        canDownload: false,
        canInstall: false,
        checkedAt: nowIso(),
      })
    }
    return this.state
  }

  /**
   * Attach the developer's `gh` token to electron-updater requests so update
   * metadata and assets can be fetched from the private repo. No-op when gh is
   * not connected — the update then surfaces a clear "connect GitHub" hint.
   */
  private async applyPrivateRepoAuth(): Promise<void> {
    const token = await readGhToken()
    if (token) autoUpdater.addAuthHeader(`token ${token}`)
  }

  async download(): Promise<AppUpdateState> {
    if (!app.isPackaged || this.state.phase !== 'available') return this.state
    this.setState({ phase: 'downloading', error: null, progressPercent: 0, canDownload: false })
    await this.applyPrivateRepoAuth()
    try {
      await autoUpdater.downloadUpdate()
    } catch (err) {
      this.setState({
        phase: 'error',
        error: err instanceof Error ? err.message : String(err),
        canDownload: true,
        canInstall: false,
      })
    }
    return this.state
  }

  install(): void {
    if (!this.state.canInstall) return
    autoUpdater.quitAndInstall(false, true)
  }

  private bindEvents(): void {
    autoUpdater.on('update-available', (info) => {
      this.setState({
        phase: 'available',
        latestVersion: info.version,
        releaseName: info.releaseName ?? null,
        releaseNotes: notesToString(info.releaseNotes),
        progressPercent: null,
        canDownload: true,
        canInstall: false,
        error: null,
        checkedAt: nowIso(),
      })
    })

    autoUpdater.on('update-not-available', (info) => {
      this.setState({
        phase: 'not-available',
        latestVersion: info.version ?? this.state.currentVersion,
        releaseName: info.releaseName ?? null,
        releaseNotes: notesToString(info.releaseNotes),
        progressPercent: null,
        canDownload: false,
        canInstall: false,
        error: null,
        checkedAt: nowIso(),
      })
    })

    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      this.setState({
        phase: 'downloading',
        progressPercent: Math.max(0, Math.min(100, progress.percent)),
        canDownload: false,
        canInstall: false,
        error: null,
      })
    })

    autoUpdater.on('update-downloaded', (info) => {
      this.setState({
        phase: 'downloaded',
        latestVersion: info.version,
        releaseName: info.releaseName ?? this.state.releaseName,
        releaseNotes: notesToString(info.releaseNotes) ?? this.state.releaseNotes,
        progressPercent: 100,
        canDownload: false,
        canInstall: true,
        error: null,
      })
    })

    autoUpdater.on('error', (err) => {
      this.setState({
        phase: 'error',
        error: err instanceof Error ? err.message : String(err),
        canDownload: this.state.latestVersion !== null,
        canInstall: false,
      })
    })
  }

  private setState(patch: Partial<AppUpdateState>): void {
    this.state = { ...this.state, ...patch }
    this.events.emitTyped('appUpdate:changed', this.state)
  }
}
