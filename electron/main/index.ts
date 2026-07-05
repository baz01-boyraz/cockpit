import { join } from 'node:path'
import { app, BrowserWindow, nativeImage, screen, shell } from 'electron'
import { IPC } from '@shared/ipc'
import { CockpitEvents, TerminalDataCoalescer } from './events'
import { registerIpc } from './ipc/registerIpc'
import { Services } from './services/Services'

const events = new CockpitEvents()
let services: Services | null = null
let mainWindow: BrowserWindow | null = null
let terminalCoalescer: TerminalDataCoalescer | null = null

function appIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'app-icon.png')
    : join(process.cwd(), 'resources/app-icon.png')
}

/**
 * Owner-registry seam: resolves which windows receive a given renderer event.
 * Today there is one window, so every event targets all windows. When
 * detachable panels land, this is the single place that maps an event's owner
 * (sessionId/projectId in the payload) to its window — do not add per-event
 * routing logic elsewhere.
 */
function resolveTargetWindows(_channel: string, _payload: unknown): BrowserWindow[] {
  return BrowserWindow.getAllWindows()
}

function createWindow(): void {
  // Fit the window to the current display's work area so it never opens wider
  // than the screen (which clips the left rail off-screen on smaller displays).
  const workArea = screen.getPrimaryDisplay().workAreaSize
  const width = Math.min(1440, workArea.width)
  const height = Math.min(900, workArea.height)

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: Math.min(1080, workArea.width),
    minHeight: Math.min(680, workArea.height),
    show: false,
    backgroundColor: '#0c0d10',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    },
  })

  // Drain any coalesced terminal output while the webContents still exists —
  // a pending 16ms frame must not be dropped by the window teardown.
  mainWindow.on('close', () => terminalCoalescer?.flush())

  mainWindow.on('ready-to-show', () => {
    // Re-center before showing. macOS window state restoration can re-apply a
    // previously saved frame that sits partly off-screen (the symptom: the left
    // rail and part of the terminal are clipped off the left edge). Centering on
    // the current display guarantees the whole UI is visible.
    mainWindow?.center()
    mainWindow?.show()
  })

  // Harden: block in-app navigation and open external links in the OS browser.
  // Only web URLs may leave the app — a crafted file:// or custom-scheme URL
  // must never reach shell.openExternal.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const protocol = new URL(url).protocol
      if (protocol === 'https:' || protocol === 'http:') {
        void shell.openExternal(url)
      }
    } catch {
      // Malformed URL — drop it.
    }
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl && url.startsWith(devUrl)) return
    e.preventDefault()
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void mainWindow.loadURL(devUrl)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function forwardEvents(): void {
  const send = (channel: string, payload: unknown) => {
    for (const win of resolveTargetWindows(channel, payload)) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload)
    }
  }
  // pty output arrives as many tiny chunks; coalesce per session on a ~16ms
  // frame so a burst produces at most one send per session per frame. All
  // other event types are low-frequency and stay immediate.
  terminalCoalescer = new TerminalDataCoalescer((chunk) => send(IPC.evtTerminalData, chunk))
  events.onTyped('terminal:data', (p) => terminalCoalescer?.push(p))
  events.onTyped('terminal:exit', (p) => {
    // Drain the session's buffered output first so exit never overtakes data.
    terminalCoalescer?.flushSession(p.sessionId)
    send(IPC.evtTerminalExit, p)
  })
  events.onTyped('approvals:changed', (p) => send(IPC.evtApprovalsChanged, p))
  events.onTyped('logs:changed', (p) => send(IPC.evtLogsChanged, p))
  events.onTyped('appUpdate:changed', (p) => send(IPC.evtAppUpdateChanged, p))
}

app.whenReady().then(() => {
  app.setName('cockpiT')
  if (process.platform === 'darwin') {
    const dockIcon = nativeImage.createFromPath(appIconPath())
    if (!dockIcon.isEmpty()) app.dock.setIcon(dockIcon)
  }

  const userDataDir = app.getPath('userData')
  services = new Services({
    dbPath: join(userDataDir, 'cockpit.sqlite'),
    userDataDir,
    events,
  })
  registerIpc(services)
  forwardEvents()
  createWindow()
  // Quietly poll GitHub for new releases so the renderer's update card can pop
  // on its own. No-op on dev/unpackaged builds (see AppUpdateService).
  services.appUpdate.startAutoCheck()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    services?.shutdown()
    app.quit()
  }
})

app.on('before-quit', () => {
  // Flush before shutdown: buffered pty output still reaches any live window,
  // and the coalescer's pending frame timer never outlives the services.
  terminalCoalescer?.flush()
  services?.shutdown()
})
