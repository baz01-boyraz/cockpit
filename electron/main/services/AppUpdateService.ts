import { app } from 'electron'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import type { AppUpdateState } from '@shared/domain'
import type { CockpitEvents } from '../events'
import { nowIso } from '../util/ids'

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

  constructor(private readonly events: CockpitEvents) {
    const canCheck = app.isPackaged
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
      error: canCheck ? null : 'Auto-update is available only in a packaged app.',
      checkedAt: null,
    }

    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    this.bindEvents()
  }

  status(): AppUpdateState {
    return this.state
  }

  async check(): Promise<AppUpdateState> {
    if (!app.isPackaged) {
      this.setState({
        phase: 'unsupported',
        canCheck: false,
        canDownload: false,
        canInstall: false,
        error: 'Auto-update is available only in a packaged app.',
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

    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      this.setState({
        phase: 'error',
        error: err instanceof Error ? err.message : String(err),
        canDownload: false,
        canInstall: false,
        checkedAt: nowIso(),
      })
    }
    return this.state
  }

  async download(): Promise<AppUpdateState> {
    if (!app.isPackaged || this.state.phase !== 'available') return this.state
    this.setState({ phase: 'downloading', error: null, progressPercent: 0, canDownload: false })
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
