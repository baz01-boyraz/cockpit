import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { IPC } from '@shared/ipc'
import { CockpitEvents } from './events'
import { registerIpc } from './ipc/registerIpc'
import { Services } from './services/Services'

const events = new CockpitEvents()
let services: Services | null = null
let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1080,
    minHeight: 680,
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

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // Harden: block in-app navigation and open external links in the OS browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
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
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(channel, payload)
    }
  }
  events.onTyped('terminal:data', (p) => send(IPC.evtTerminalData, p))
  events.onTyped('terminal:exit', (p) => send(IPC.evtTerminalExit, p))
  events.onTyped('approvals:changed', (p) => send(IPC.evtApprovalsChanged, p))
  events.onTyped('logs:changed', (p) => send(IPC.evtLogsChanged, p))
  events.onTyped('appUpdate:changed', (p) => send(IPC.evtAppUpdateChanged, p))
}

app.whenReady().then(() => {
  const userDataDir = app.getPath('userData')
  services = new Services({
    dbPath: join(userDataDir, 'cockpit.sqlite'),
    userDataDir,
    events,
  })
  registerIpc(services)
  forwardEvents()
  createWindow()

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

app.on('before-quit', () => services?.shutdown())
