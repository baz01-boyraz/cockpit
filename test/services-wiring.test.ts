import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeRecordingDb, type RecordingDb } from './helpers/fakeDb'

/**
 * B2.1 — Services composition-root smoke test.
 *
 * Services is the main-process DI root: its constructor builds ~40 services,
 * runs their boot reconcilers against SQLite, and wires the cross-cutting flows.
 * Under a plain Node runner none of the native/electron seams exist, so we mock
 * the three module edges the tree touches — `openDatabase` (better-sqlite3),
 * `electron` (Notification/app/safeStorage), `electron-updater`, and `node-pty`
 * — then assert the root constructs, every advertised service field is present,
 * boot reconcilers ran against the fake DB without throwing, and shutdown()
 * tears down cleanly with db.close() last.
 *
 * The service-set assertions are deliberately PRESENCE-only (never exact-set):
 * a concurrently-added service field must never break this smoke test.
 */

const h = vi.hoisted(() => {
  // Filled per-test in beforeEach; the mocked openDatabase reads it at call time
  // (Services calls openDatabase() inside its constructor, after beforeEach).
  const dbHolder = { db: null as unknown }
  const autoUpdater = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    on: vi.fn(),
    checkForUpdates: vi.fn(async () => ({})),
    downloadUpdate: vi.fn(async () => []),
    quitAndInstall: vi.fn(),
    addAuthHeader: vi.fn(),
  }
  class FakeNotification {
    static isSupported() {
      return false
    }
    show() {
      /* headless: never actually shows */
    }
  }
  const app = { isPackaged: false, getVersion: () => '0.1.47', getPath: () => '/tmp' }
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s, 'utf8'),
    decryptString: (b: Buffer) => b.toString('utf8'),
  }
  return { dbHolder, autoUpdater, app, safeStorage, Notification: FakeNotification }
})

vi.mock('../electron/main/db/Database', () => ({
  openDatabase: () => h.dbHolder.db,
}))
vi.mock('electron', () => ({
  Notification: h.Notification,
  app: h.app,
  safeStorage: h.safeStorage,
}))
vi.mock('electron-updater', () => ({ autoUpdater: h.autoUpdater }))
// Construction never spawns a pty (only boot reconciliation runs), so a bare
// spawn stub is enough to keep the native module out of the Node runner.
vi.mock('node-pty', () => ({ spawn: vi.fn() }))
// HermesMcpServer.start() is fired forget-style in the constructor and binds a
// loopback port. Stub node:http so the smoke test opens no real socket (and so
// parallel/repeated constructions never collide on the fixed default port).
vi.mock('node:http', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  const { EventEmitter } = await import('node:events')
  class FakeServer extends EventEmitter {
    listen(): this {
      setImmediate(() => this.emit('listening'))
      return this
    }
    close(cb?: () => void): this {
      cb?.()
      return this
    }
    address() {
      return { port: 0 }
    }
  }
  const createServer = () => new FakeServer()
  return { ...actual, createServer, default: { ...actual, createServer } }
})

import { Services } from '../electron/main/services/Services'
import { CockpitEvents } from '../electron/main/events'

/**
 * The fake DB from the shared helper covers prepare()/transaction(); the DI root
 * also calls db.close() on shutdown, so we graft a spy close() onto it.
 */
function makeDbWithClose(): { rec: RecordingDb; close: ReturnType<typeof vi.fn> } {
  const rec = makeRecordingDb()
  const close = vi.fn()
  ;(rec.db as unknown as { close: () => void }).close = close
  return { rec, close }
}

let userDataDir: string
let services: Services | null = null
let events: CockpitEvents

/** Every service field the DI root advertises as part of its public surface. */
const EXPECTED_SERVICE_FIELDS = [
  'db',
  'audit',
  'attachments',
  'approvals',
  'usage',
  'agentUsage',
  'openRouterUsage',
  'logs',
  'projects',
  'git',
  'github',
  'railway',
  'secrets',
  'terminals',
  'claudeSessions',
  'chat',
  'hermesChat',
  'hermesTriage',
  'review',
  'council',
  'memory',
  'globalMemory',
  'memoryLedger',
  'memoryReviews',
  'memoryDistiller',
  'memoryPipeline',
  'memoryCaptureQueue',
  'memoryAutoCapture',
  'memoryConsolidator',
  'memoryCuration',
  'swarm',
  'sentinel',
  'namedAgents',
  'cardOutput',
  'hermesChecks',
  'appScreenshot',
  'hermesMcp',
  'hermesApprovalExecutor',
  'appUpdate',
] as const

beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'cockpit-services-'))
  events = new CockpitEvents()
})

afterEach(async () => {
  if (services) {
    // stop() the MCP server explicitly (shutdown fires it forget-style); awaiting
    // it here guarantees the (stubbed) server is torn down and no handle leaks.
    services.shutdown()
    await services.hermesMcp.stop().catch(() => undefined)
    services = null
  }
  rmSync(userDataDir, { recursive: true, force: true })
})

describe('Services — composition root construction', () => {
  it('constructs the full tree against the fake DB without throwing', () => {
    const { rec } = makeDbWithClose()
    h.dbHolder.db = rec.db
    expect(() => {
      services = new Services({ dbPath: ':memory:', userDataDir, events })
    }).not.toThrow()
    expect(services).toBeInstanceOf(Services)
  })

  it('exposes every advertised service field', () => {
    const { rec } = makeDbWithClose()
    h.dbHolder.db = rec.db
    services = new Services({ dbPath: ':memory:', userDataDir, events })
    for (const field of EXPECTED_SERVICE_FIELDS) {
      expect(services, `missing service field: ${field}`).toHaveProperty(field)
      expect(
        (services as unknown as Record<string, unknown>)[field],
        `service field is nullish: ${field}`,
      ).toBeTruthy()
    }
  })

  it('runs boot reconcilers as write statements against the fake DB', () => {
    const { rec } = makeDbWithClose()
    h.dbHolder.db = rec.db
    services = new Services({ dbPath: ':memory:', userDataDir, events })
    // TerminalManager.reconcileStaleRows() fires at construction; it is the DI
    // root's canonical boot reconciler and proves the fake DB was exercised.
    const reconcile = rec.callsFor('run', "status = 'exited'")
    expect(reconcile.length).toBeGreaterThan(0)
    // The tree also prepares statements broadly during wiring.
    expect(rec.calls.length).toBeGreaterThan(0)
  })

  it('pins the electron-updater auto flags off during construction', () => {
    const { rec } = makeDbWithClose()
    h.dbHolder.db = rec.db
    services = new Services({ dbPath: ':memory:', userDataDir, events })
    expect(h.autoUpdater.autoDownload).toBe(false)
    expect(h.autoUpdater.autoInstallOnAppQuit).toBe(false)
  })
})

describe('Services — zombie liveness audit (A4)', () => {
  /** A recording DB whose reconcile SELECT returns one scripted stale row. */
  function dbWithStaleRow(row: { id: string; pid: number | null; last_active_at: string }) {
    const rec = makeRecordingDb({
      all: (sql) => (sql.includes('pid, last_active_at') ? [row] : []),
    })
    ;(rec.db as unknown as { close: () => void }).close = vi.fn()
    return rec
  }

  it('probes then SIGTERMs a recent, still-alive orphan pid and audits the reap', () => {
    const rec = dbWithStaleRow({ id: 't1', pid: 999999, last_active_at: new Date().toISOString() })
    h.dbHolder.db = rec.db
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)

    services = new Services({ dbPath: ':memory:', userDataDir, events })

    expect(killSpy).toHaveBeenCalledWith(999999, 0) // liveness probe
    expect(killSpy).toHaveBeenCalledWith(999999, 'SIGTERM') // the reap
    const auditRuns = rec.callsFor('run', 'INSERT INTO audit_log')
    expect(auditRuns.some((c) => JSON.stringify(c.args[0]).includes('zombie_reaped'))).toBe(true)
    killSpy.mockRestore()
  })

  it('skips a stale-dated orphan pid entirely — never signals it (pid reuse guard)', () => {
    const rec = dbWithStaleRow({ id: 't1', pid: 999999, last_active_at: '2000-01-01T00:00:00.000Z' })
    h.dbHolder.db = rec.db
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)

    services = new Services({ dbPath: ':memory:', userDataDir, events })

    expect(killSpy).not.toHaveBeenCalledWith(999999, 0)
    expect(killSpy).not.toHaveBeenCalledWith(999999, 'SIGTERM')
    killSpy.mockRestore()
  })

  it('does not reap a null pid, and leaves boot unharmed', () => {
    const rec = dbWithStaleRow({ id: 't1', pid: null, last_active_at: new Date().toISOString() })
    h.dbHolder.db = rec.db
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)

    expect(() => {
      services = new Services({ dbPath: ':memory:', userDataDir, events })
    }).not.toThrow()
    expect(killSpy).not.toHaveBeenCalledWith(null, 'SIGTERM')
    killSpy.mockRestore()
  })
})

describe('Services — shutdown', () => {
  it('completes cleanly and closes the DB last', () => {
    const { rec, close } = makeDbWithClose()
    h.dbHolder.db = rec.db
    services = new Services({ dbPath: ':memory:', userDataDir, events })

    const terminalsKill = vi.spyOn(services.terminals, 'killAll')
    const chatKill = vi.spyOn(services.hermesChat, 'killAll')
    const triageKill = vi.spyOn(services.hermesTriage, 'killAll')
    const autoCaptureStop = vi.spyOn(services.memoryAutoCapture, 'stop')

    expect(() => services!.shutdown()).not.toThrow()

    expect(terminalsKill).toHaveBeenCalledOnce()
    expect(chatKill).toHaveBeenCalledOnce()
    expect(triageKill).toHaveBeenCalledOnce()
    expect(autoCaptureStop).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()

    // db.close() must run AFTER the CLI killAlls (roadmap A2: orphan children
    // die before the connection they might still be writing through is closed).
    const closeOrder = close.mock.invocationCallOrder[0]
    expect(closeOrder).toBeGreaterThan(terminalsKill.mock.invocationCallOrder[0])
    expect(closeOrder).toBeGreaterThan(chatKill.mock.invocationCallOrder[0])
    expect(closeOrder).toBeGreaterThan(triageKill.mock.invocationCallOrder[0])
  })

  it('is idempotent — a second shutdown() is a no-op', () => {
    const { rec, close } = makeDbWithClose()
    h.dbHolder.db = rec.db
    services = new Services({ dbPath: ':memory:', userDataDir, events })
    services.shutdown()
    expect(() => services!.shutdown()).not.toThrow()
    // The `closing` guard means close() is spent exactly once.
    expect(close).toHaveBeenCalledOnce()
  })
})
