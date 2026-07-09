import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CockpitEvents } from '../electron/main/events'

/**
 * B2.2 — AppUpdateService state machine.
 *
 * electron-updater and electron `app` are unavailable under the plain Node test
 * runner, and `readGhToken` shells out to `gh` — all three are mocked. The
 * autoUpdater stand-in is a hand-rolled event bus so a test can drive the real
 * bindEvents() handlers by emitting `update-available`, `download-progress`,
 * etc. exactly as electron-updater would.
 */
const h = vi.hoisted(() => {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {}
  const autoUpdater = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    on(event: string, cb: (...args: unknown[]) => void) {
      ;(listeners[event] ??= []).push(cb)
      return autoUpdater
    },
    emit(event: string, ...args: unknown[]) {
      for (const cb of listeners[event] ?? []) cb(...args)
    },
    removeAllListeners() {
      for (const key of Object.keys(listeners)) delete listeners[key]
    },
    checkForUpdates: vi.fn(async () => ({})),
    downloadUpdate: vi.fn(async () => []),
    quitAndInstall: vi.fn(),
    addAuthHeader: vi.fn(),
  }
  const app = { isPackaged: false, getVersion: () => '0.1.47' }
  const existsSync = vi.fn(() => false)
  // promisify(execFile) rejects → readGhToken swallows and returns null, so
  // addAuthHeader is never called and no real `gh` process is spawned.
  const execFile = vi.fn(
    (
      _file: string,
      _args: string[],
      _opts: unknown,
      cb: (err: Error | null, result?: { stdout: string }) => void,
    ) => cb(new Error('gh unavailable')),
  )
  return { autoUpdater, app, existsSync, execFile }
})

vi.mock('electron-updater', () => ({ autoUpdater: h.autoUpdater }))
vi.mock('electron', () => ({ app: h.app }))
vi.mock('node:fs', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  existsSync: h.existsSync,
}))
vi.mock('node:child_process', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  execFile: h.execFile,
}))

import { AppUpdateService } from '../electron/main/services/AppUpdateService'

function makeEvents(): { events: CockpitEvents; emitted: unknown[] } {
  const emitted: unknown[] = []
  const events = {
    emitTyped: (_event: string, payload: unknown) => {
      emitted.push(payload)
    },
  } as unknown as CockpitEvents
  return { events, emitted }
}

const originalResourcesPath = process.resourcesPath

/** Put the service into a state where `unsupportedReason() === null`. */
function makeSupported(): void {
  h.app.isPackaged = true
  h.existsSync.mockReturnValue(true)
  // hasUpdateConfig() joins process.resourcesPath before calling existsSync; a
  // defined string keeps join() from throwing so the existsSync mock is reached.
  Object.defineProperty(process, 'resourcesPath', { value: '/tmp/resources', configurable: true })
}

beforeEach(() => {
  h.autoUpdater.removeAllListeners()
  h.autoUpdater.autoDownload = true
  h.autoUpdater.autoInstallOnAppQuit = true
  h.autoUpdater.checkForUpdates.mockReset().mockResolvedValue({})
  h.autoUpdater.downloadUpdate.mockReset().mockResolvedValue([])
  h.autoUpdater.quitAndInstall.mockReset()
  h.autoUpdater.addAuthHeader.mockReset()
  h.app.isPackaged = false
  h.existsSync.mockReset().mockReturnValue(false)
})

afterEach(() => {
  vi.useRealTimers()
  Object.defineProperty(process, 'resourcesPath', {
    value: originalResourcesPath,
    configurable: true,
  })
})

describe('AppUpdateService — construction & event pins', () => {
  it('pins autoDownload and autoInstallOnAppQuit to false', () => {
    const { events } = makeEvents()
    new AppUpdateService(events)
    expect(h.autoUpdater.autoDownload).toBe(false)
    expect(h.autoUpdater.autoInstallOnAppQuit).toBe(false)
  })

  it('seeds currentVersion from app.getVersion()', () => {
    const { events } = makeEvents()
    const svc = new AppUpdateService(events)
    expect(svc.status().currentVersion).toBe('0.1.47')
  })

  it('emits appUpdate:changed on every state transition', () => {
    makeSupported()
    const { events, emitted } = makeEvents()
    const svc = new AppUpdateService(events)
    expect(emitted).toHaveLength(0)
    h.autoUpdater.emit('update-available', { version: '9.9.9' })
    expect(emitted).toHaveLength(1)
    expect((emitted[0] as { phase: string }).phase).toBe('available')
    void svc
  })
})

describe('AppUpdateService — unsupported local-build detection', () => {
  it('reports NOT_PACKAGED when app is not packaged', () => {
    const { events } = makeEvents()
    const svc = new AppUpdateService(events)
    const state = svc.status()
    expect(state.phase).toBe('unsupported')
    expect(state.canCheck).toBe(false)
    expect(state.error).toContain('only in a packaged app')
  })

  it('reports the app-update.yml hint when packaged without update config', () => {
    h.app.isPackaged = true
    h.existsSync.mockReturnValue(false)
    Object.defineProperty(process, 'resourcesPath', { value: '/tmp/resources', configurable: true })
    const { events } = makeEvents()
    const state = new AppUpdateService(events).status()
    expect(state.phase).toBe('unsupported')
    expect(state.error).toContain('app-update.yml')
  })

  it('check() short-circuits to unsupported without calling the updater', async () => {
    const { events } = makeEvents()
    const svc = new AppUpdateService(events)
    const state = await svc.check()
    expect(state.phase).toBe('unsupported')
    expect(h.autoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })
})

describe('AppUpdateService — check/download/install happy path', () => {
  beforeEach(makeSupported)

  it('starts idle and can check', () => {
    const { events } = makeEvents()
    const state = new AppUpdateService(events).status()
    expect(state.phase).toBe('idle')
    expect(state.canCheck).toBe(true)
  })

  it('drives idle → checking → available → downloading → downloaded → install', async () => {
    const { events } = makeEvents()
    const svc = new AppUpdateService(events)

    await svc.check()
    expect(h.autoUpdater.checkForUpdates).toHaveBeenCalledOnce()
    expect(svc.status().phase).toBe('checking')

    h.autoUpdater.emit('update-available', {
      version: '9.9.9',
      releaseName: 'Nine',
      releaseNotes: 'shiny',
    })
    let state = svc.status()
    expect(state.phase).toBe('available')
    expect(state.latestVersion).toBe('9.9.9')
    expect(state.releaseName).toBe('Nine')
    expect(state.releaseNotes).toBe('shiny')
    expect(state.canDownload).toBe(true)
    expect(state.canInstall).toBe(false)

    await svc.download()
    expect(h.autoUpdater.downloadUpdate).toHaveBeenCalledOnce()
    expect(svc.status().phase).toBe('downloading')

    h.autoUpdater.emit('download-progress', { percent: 42 })
    expect(svc.status().progressPercent).toBe(42)

    h.autoUpdater.emit('update-downloaded', { version: '9.9.9' })
    state = svc.status()
    expect(state.phase).toBe('downloaded')
    expect(state.progressPercent).toBe(100)
    expect(state.canInstall).toBe(true)

    svc.install()
    expect(h.autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true)
  })

  it('clamps download-progress into 0..100', async () => {
    const { events } = makeEvents()
    const svc = new AppUpdateService(events)
    await svc.check()
    h.autoUpdater.emit('update-available', { version: '9.9.9' })
    h.autoUpdater.emit('download-progress', { percent: 250 })
    expect(svc.status().progressPercent).toBe(100)
    h.autoUpdater.emit('download-progress', { percent: -10 })
    expect(svc.status().progressPercent).toBe(0)
  })

  it('reports update-not-available cleanly', async () => {
    const { events } = makeEvents()
    const svc = new AppUpdateService(events)
    await svc.check()
    h.autoUpdater.emit('update-not-available', { version: '0.1.47' })
    const state = svc.status()
    expect(state.phase).toBe('not-available')
    expect(state.error).toBeNull()
    expect(state.canDownload).toBe(false)
  })

  it('ignores install() when not installable', () => {
    const { events } = makeEvents()
    const svc = new AppUpdateService(events)
    svc.install()
    expect(h.autoUpdater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('ignores download() when no update is available', async () => {
    const { events } = makeEvents()
    const svc = new AppUpdateService(events)
    await svc.download()
    expect(h.autoUpdater.downloadUpdate).not.toHaveBeenCalled()
  })
})

describe('AppUpdateService — error surfacing', () => {
  beforeEach(makeSupported)

  it('surfaces a thrown checkForUpdates error without crashing', async () => {
    h.autoUpdater.checkForUpdates.mockRejectedValueOnce(new Error('disk exploded'))
    const { events } = makeEvents()
    const svc = new AppUpdateService(events)
    const state = await svc.check()
    expect(state.phase).toBe('error')
    expect(state.error).toContain('disk exploded')
  })

  it('adds the private-repo auth hint on a 404 check failure', async () => {
    h.autoUpdater.checkForUpdates.mockRejectedValueOnce(new Error('HTTP 404 Not Found'))
    const { events } = makeEvents()
    const svc = new AppUpdateService(events)
    const state = await svc.check()
    expect(state.phase).toBe('error')
    expect(state.error).toContain('connect GitHub')
    expect(state.error).toContain('404')
  })

  it('surfaces a download failure and re-enables retry', async () => {
    h.autoUpdater.downloadUpdate.mockRejectedValueOnce(new Error('network gone'))
    const { events } = makeEvents()
    const svc = new AppUpdateService(events)
    await svc.check()
    h.autoUpdater.emit('update-available', { version: '9.9.9' })
    const state = await svc.download()
    expect(state.phase).toBe('error')
    expect(state.error).toContain('network gone')
    expect(state.canDownload).toBe(true)
  })

  it('surfaces an updater "error" event', () => {
    const { events } = makeEvents()
    const svc = new AppUpdateService(events)
    h.autoUpdater.emit('error', new Error('signature mismatch'))
    const state = svc.status()
    expect(state.phase).toBe('error')
    expect(state.error).toContain('signature mismatch')
  })
})

describe('AppUpdateService — auto-check scheduling', () => {
  it('does not schedule an auto-check on an unsupported build', () => {
    vi.useFakeTimers()
    const { events } = makeEvents()
    const svc = new AppUpdateService(events)
    svc.startAutoCheck()
    vi.advanceTimersByTime(60 * 60 * 1000)
    expect(h.autoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('runs a background check after the initial delay on a supported build', () => {
    makeSupported()
    vi.useFakeTimers()
    const { events } = makeEvents()
    const svc = new AppUpdateService(events)
    svc.startAutoCheck()
    expect(svc.status().phase).toBe('idle')
    // The scheduled run() enters check() synchronously through 'checking' before
    // it awaits the gh-token read; asserting the phase avoids racing the awaited
    // checkForUpdates() call under fake timers.
    vi.advanceTimersByTime(8_000)
    expect(svc.status().phase).toBe('checking')
    svc.stopAutoCheck()
  })

  it('stopAutoCheck is idempotent and clears pending timers', () => {
    makeSupported()
    vi.useFakeTimers()
    const { events } = makeEvents()
    const svc = new AppUpdateService(events)
    svc.startAutoCheck()
    svc.stopAutoCheck()
    svc.stopAutoCheck()
    vi.advanceTimersByTime(24 * 60 * 60 * 1000)
    expect(h.autoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })
})
