import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalManager } from '../electron/main/services/TerminalManager'
import { CockpitEvents } from '../electron/main/events'
import type { ProjectService } from '../electron/main/services/ProjectService'
import { makeRecordingDb, type RecordingDb } from './helpers/fakeDb'

/**
 * Task 3.3 — boot reconciliation + honest lifecycle rows.
 *
 * - A new TerminalManager means a new process: no pty can have survived, so any
 *   row still claiming running/starting is stale and must be reconciled.
 * - 'killed' means WE ended the session (kill/killAll/restart); a natural exit
 *   is 'exited' whatever its code.
 * - The session row durably stores what a Phase 6 resume needs (cwd, shell,
 *   project, command).
 */

/** Scripted stand-in for a node-pty process — nothing is ever really spawned. */
interface FakePtyProc {
  pid: number
  write: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  onData: (cb: (data: string) => void) => { dispose: () => void }
  onExit: (cb: (e: { exitCode: number; signal?: number }) => void) => { dispose: () => void }
  emitExit: (exitCode: number, signal?: number) => void
}

const ptyState = vi.hoisted(() => ({ spawned: [] as FakePtyProc[] }))

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => {
    const exitHandlers: Array<(e: { exitCode: number; signal?: number }) => void> = []
    const proc: FakePtyProc = {
      pid: 5000 + ptyState.spawned.length,
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: () => ({ dispose: () => undefined }),
      onExit: (cb) => {
        exitHandlers.push(cb)
        return { dispose: () => undefined }
      },
      emitExit: (exitCode, signal) => {
        for (const cb of exitHandlers) cb({ exitCode, signal })
      },
    }
    ptyState.spawned.push(proc)
    return proc
  }),
}))

const PROJECT_DIR = '/tmp/proj-rec'
const integrationDirs: string[] = []

function makeManager() {
  const rec: RecordingDb = makeRecordingDb()
  const events = new CockpitEvents()
  const projects = { get: vi.fn(() => ({ path: PROJECT_DIR })) } as unknown as ProjectService
  const integrationDir = mkdtempSync(join(tmpdir(), 'cockpit-rec-test-'))
  integrationDirs.push(integrationDir)
  const mgr = new TerminalManager(rec.db, events, projects, vi.fn(), vi.fn(), integrationDir)
  return { mgr, rec, events }
}

beforeEach(() => {
  ptyState.spawned.length = 0
  vi.stubEnv('SHELL', '/bin/zsh')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

afterAll(() => {
  for (const dir of integrationDirs) rmSync(dir, { recursive: true, force: true })
})

describe('boot reconciliation', () => {
  it('runs a reconciliation UPDATE at construction, before anything else', () => {
    const { rec } = makeManager()
    expect(rec.calls.length).toBeGreaterThanOrEqual(1)
    const first = rec.calls[0]
    expect(first.method).toBe('run')
    expect(first.sql).toContain('UPDATE terminal_sessions')
    expect(first.sql).toContain('reconciled_at')
  })

  it('only targets stale running/starting rows and flips them to exited', () => {
    const { rec } = makeManager()
    const reconcile = rec.callsFor('run', 'reconciled_at')
    expect(reconcile).toHaveLength(1)
    // Status filter: never touch rows that already ended honestly.
    expect(reconcile[0].sql).toContain(`WHERE status IN ('running', 'starting')`)
    expect(reconcile[0].sql).toContain(`SET status = 'exited'`)
  })

  it('stamps reconciled rows with a timestamp so inferred exits stay auditable', () => {
    const { rec } = makeManager()
    const reconcile = rec.callsFor('run', 'reconciled_at')
    const params = reconcile[0].args[0] as { now: string }
    expect(typeof params.now).toBe('string')
    expect(Number.isNaN(Date.parse(params.now))).toBe(false)
  })

  it('reconciles before the first insert so DB and live map agree from spawn 0', () => {
    const { mgr, rec } = makeManager()
    mgr.create({ projectId: 'prj_1' })
    const reconcileIdx = rec.calls.findIndex((c) => c.sql.includes('reconciled_at'))
    const insertIdx = rec.calls.findIndex((c) => c.sql.includes('INSERT INTO terminal_sessions'))
    expect(reconcileIdx).toBeGreaterThanOrEqual(0)
    expect(insertIdx).toBeGreaterThan(reconcileIdx)
  })
})

describe('resume capture (Phase 6 substrate)', () => {
  it('persists command, cwd, and shell on the session row', () => {
    const { mgr, rec } = makeManager()
    const session = mgr.create({ projectId: 'prj_1', command: 'npm run dev' })

    const inserts = rec.callsFor('run', 'INSERT INTO terminal_sessions')
    expect(inserts).toHaveLength(1)
    expect(inserts[0].sql).toContain('command')
    expect(inserts[0].args[0]).toMatchObject({
      id: session.id,
      projectId: 'prj_1',
      command: 'npm run dev',
      cwd: PROJECT_DIR,
      shell: '/bin/zsh',
    })
  })

  it('persists a null command for plain shells', () => {
    const { mgr, rec } = makeManager()
    mgr.create({ projectId: 'prj_1' })
    const inserts = rec.callsFor('run', 'INSERT INTO terminal_sessions')
    expect(inserts[0].args[0]).toMatchObject({ command: null })
  })
})

describe('exited vs killed semantics', () => {
  it('a natural zero exit is exited with code 0', () => {
    const { mgr } = makeManager()
    mgr.create({ projectId: 'prj_1' })
    ptyState.spawned[0].emitExit(0)
    expect(mgr.list('prj_1')[0]).toMatchObject({ status: 'exited', exitCode: 0 })
  })

  it('a natural non-zero exit is exited with its real code — never killed', () => {
    const { mgr, rec } = makeManager()
    mgr.create({ projectId: 'prj_1' })
    ptyState.spawned[0].emitExit(1)
    expect(mgr.list('prj_1')[0]).toMatchObject({ status: 'exited', exitCode: 1 })

    const updates = rec.callsFor('run', 'SET name=')
    expect(updates[0].args[0]).toMatchObject({ status: 'exited', exitCode: 1 })
  })

  it('kill() marks the row killed — we initiated that exit', () => {
    const { mgr, rec } = makeManager()
    const session = mgr.create({ projectId: 'prj_1' })
    mgr.kill(session.id)

    const updates = rec.callsFor('run', 'SET name=')
    expect(updates).toHaveLength(1)
    expect(updates[0].args[0]).toMatchObject({ id: session.id, status: 'killed' })

    // The pty's own exit event arriving afterwards must not relabel anything.
    ptyState.spawned[0].emitExit(137, 9)
    expect(rec.callsFor('run', 'SET name=')).toHaveLength(1)
  })

  it('restart() kills the old session (ours) and spawns a running replacement', () => {
    const { mgr, rec } = makeManager()
    const original = mgr.create({ projectId: 'prj_1' })
    const restarted = mgr.restart(original.id)

    const updates = rec.callsFor('run', 'SET name=')
    expect(updates[0].args[0]).toMatchObject({ id: original.id, status: 'killed' })
    expect(restarted.status).toBe('running')
    expect(mgr.list('prj_1')).toEqual([restarted])
  })
})

describe('list() consistency', () => {
  it('never reports a phantom running session after a natural exit', () => {
    const { mgr } = makeManager()
    mgr.create({ projectId: 'prj_1' })
    mgr.create({ projectId: 'prj_1' })
    ptyState.spawned[0].emitExit(2)

    const statuses = mgr.list('prj_1').map((s) => s.status)
    expect(statuses).toEqual(['exited', 'running'])
    // The one remaining 'running' session is backed by a live (fake) pty.
    expect(ptyState.spawned[1].kill).not.toHaveBeenCalled()
  })

  it('starts empty — stale history rows are reconciled in the DB, not resurrected', () => {
    const { mgr } = makeManager()
    expect(mgr.list('prj_1')).toEqual([])
  })
})
