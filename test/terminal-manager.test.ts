import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalManager } from '../electron/main/services/TerminalManager'
import { CockpitEvents } from '../electron/main/events'
import type { ProjectService } from '../electron/main/services/ProjectService'
import { makeRecordingDb, type RecordingDb } from './helpers/fakeDb'

/** Scripted stand-in for a node-pty process — nothing is ever really spawned. */
interface FakePtyProc {
  pid: number
  spawnShell: string
  spawnArgs: string[]
  spawnOpts: { cwd: string; env: Record<string, string> }
  write: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  onData: (cb: (data: string) => void) => { dispose: () => void }
  onExit: (cb: (e: { exitCode: number; signal?: number }) => void) => { dispose: () => void }
  emitData: (data: string) => void
  emitExit: (exitCode: number, signal?: number) => void
}

const ptyState = vi.hoisted(() => ({ spawned: [] as FakePtyProc[] }))

vi.mock('node-pty', () => ({
  spawn: vi.fn((shell: string, args: string[], opts: { cwd: string; env: Record<string, string> }) => {
    const dataHandlers: Array<(data: string) => void> = []
    const exitHandlers: Array<(e: { exitCode: number; signal?: number }) => void> = []
    const proc: FakePtyProc = {
      pid: 4000 + ptyState.spawned.length,
      spawnShell: shell,
      spawnArgs: args,
      spawnOpts: opts,
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: (cb) => {
        dataHandlers.push(cb)
        return { dispose: () => undefined }
      },
      onExit: (cb) => {
        exitHandlers.push(cb)
        return { dispose: () => undefined }
      },
      emitData: (data) => {
        for (const cb of dataHandlers) cb(data)
      },
      emitExit: (exitCode, signal) => {
        for (const cb of exitHandlers) cb({ exitCode, signal })
      },
    }
    ptyState.spawned.push(proc)
    return proc
  }),
}))

const PROJECT_DIR = '/tmp/proj-x'
const integrationDirs: string[] = []

function makeManager() {
  const rec: RecordingDb = makeRecordingDb()
  const events = new CockpitEvents()
  const onOutput = vi.fn()
  const onUsage = vi.fn()
  const projects = { get: vi.fn(() => ({ path: PROJECT_DIR })) } as unknown as ProjectService
  const integrationDir = mkdtempSync(join(tmpdir(), 'cockpit-si-test-'))
  integrationDirs.push(integrationDir)
  const mgr = new TerminalManager(rec.db, events, projects, onOutput, onUsage, integrationDir)
  return { mgr, rec, events, onOutput, onUsage }
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

describe('TerminalManager.create', () => {
  it('spawns a pty in the project directory and tracks the running session', () => {
    const { mgr, rec, onUsage } = makeManager()
    const session = mgr.create({ projectId: 'prj_1' })

    expect(ptyState.spawned).toHaveLength(1)
    const proc = ptyState.spawned[0]
    expect(proc.spawnOpts.cwd).toBe(PROJECT_DIR)
    expect(proc.spawnOpts.env.TERM).toBe('xterm-256color')

    expect(session.status).toBe('running')
    expect(session.pid).toBe(proc.pid)
    expect(session.cwd).toBe(PROJECT_DIR)
    expect(session.name).toBe('Terminal 1')

    expect(mgr.list('prj_1')).toEqual([session])
    expect(mgr.count('prj_1')).toBe(1)
    expect(rec.callsFor('run', 'INSERT INTO terminal_sessions')).toHaveLength(1)
    expect(onUsage).toHaveBeenCalledWith('prj_1', 'session')
  })

  it('resolves relative, absolute, and "." working directories', () => {
    const { mgr } = makeManager()
    expect(mgr.create({ projectId: 'prj_1', cwd: 'packages/app' }).cwd).toBe(
      `${PROJECT_DIR}/packages/app`,
    )
    expect(mgr.create({ projectId: 'prj_1', cwd: '/abs/elsewhere' }).cwd).toBe('/abs/elsewhere')
    expect(mgr.create({ projectId: 'prj_1', cwd: '.' }).cwd).toBe(PROJECT_DIR)
  })

  it('auto-names sessions sequentially and trims custom names', () => {
    const { mgr } = makeManager()
    expect(mgr.create({ projectId: 'prj_1' }).name).toBe('Terminal 1')
    expect(mgr.create({ projectId: 'prj_1' }).name).toBe('Terminal 2')
    expect(mgr.create({ projectId: 'prj_1', name: '  dev server  ' }).name).toBe('dev server')
  })

  it('enforces the per-project terminal cap without blocking other projects', () => {
    const { mgr } = makeManager()
    for (let i = 0; i < 6; i += 1) mgr.create({ projectId: 'prj_1' })
    expect(() => mgr.create({ projectId: 'prj_1' })).toThrow(/Terminal limit reached/)
    expect(() => mgr.create({ projectId: 'prj_2' })).not.toThrow()
  })

  it('launches the startup command in the shell after the settle delay', () => {
    vi.useFakeTimers()
    const { mgr } = makeManager()
    mgr.create({ projectId: 'prj_1', command: 'npm run dev' })
    const proc = ptyState.spawned[0]
    expect(proc.write).not.toHaveBeenCalled()
    vi.advanceTimersByTime(120)
    expect(proc.write).toHaveBeenCalledWith('npm run dev\r')
  })
})

describe('TerminalManager IO forwarding', () => {
  it('write() forwards to the pty and counts submitted commands as usage', () => {
    const { mgr, onUsage } = makeManager()
    const session = mgr.create({ projectId: 'prj_1' })
    onUsage.mockClear()

    mgr.write(session.id, 'ls')
    expect(ptyState.spawned[0].write).toHaveBeenCalledWith('ls')
    expect(onUsage).not.toHaveBeenCalled()

    mgr.write(session.id, 'ls\r')
    expect(onUsage).toHaveBeenCalledWith('prj_1', 'command')
  })

  it('write()/resize() on an unknown session are safe no-ops', () => {
    const { mgr } = makeManager()
    expect(() => mgr.write('term_missing', 'ls\r')).not.toThrow()
    expect(() => mgr.resize('term_missing', 80, 24)).not.toThrow()
  })

  it('resize() forwards and swallows failures from an exited pty', () => {
    const { mgr } = makeManager()
    const session = mgr.create({ projectId: 'prj_1' })
    const proc = ptyState.spawned[0]

    mgr.resize(session.id, 120, 40)
    expect(proc.resize).toHaveBeenCalledWith(120, 40)

    proc.resize.mockImplementation(() => {
      throw new Error('pty exited')
    })
    expect(() => mgr.resize(session.id, 80, 24)).not.toThrow()
  })

  it('streams pty output to the event bus and the output sink', () => {
    const { mgr, events, onOutput } = makeManager()
    const dataSpy = vi.fn()
    events.onTyped('terminal:data', dataSpy)
    const session = mgr.create({ projectId: 'prj_1' })

    ptyState.spawned[0].emitData('hello from shell')
    expect(dataSpy).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: session.id, data: 'hello from shell' }),
    )
    expect(onOutput).toHaveBeenCalledWith('prj_1', session.id, 'hello from shell')
  })
})

describe('TerminalManager lifecycle', () => {
  it('kill() stops the pty, marks the row killed, and drops the session', () => {
    const { mgr, rec } = makeManager()
    const session = mgr.create({ projectId: 'prj_1' })

    mgr.kill(session.id)
    expect(ptyState.spawned[0].kill).toHaveBeenCalled()
    expect(mgr.list('prj_1')).toEqual([])

    const updates = rec.callsFor('run', 'UPDATE terminal_sessions')
    expect(updates).toHaveLength(1)
    expect(updates[0].args[0]).toMatchObject({ id: session.id, status: 'killed' })
  })

  it('a clean pty exit marks the session exited and persists the exit code', () => {
    const { mgr, rec, events } = makeManager()
    const exitSpy = vi.fn()
    events.onTyped('terminal:exit', exitSpy)
    const session = mgr.create({ projectId: 'prj_1' })

    ptyState.spawned[0].emitExit(0)
    const live = mgr.list('prj_1')[0]
    expect(live.status).toBe('exited')
    expect(live.exitCode).toBe(0)
    expect(exitSpy).toHaveBeenCalledWith({ sessionId: session.id, exitCode: 0, signal: null })

    const updates = rec.callsFor('run', 'UPDATE terminal_sessions')
    expect(updates[0].args[0]).toMatchObject({ status: 'exited', exitCode: 0 })
  })

  it('a non-zero pty exit marks the session killed', () => {
    const { mgr } = makeManager()
    mgr.create({ projectId: 'prj_1' })
    ptyState.spawned[0].emitExit(137, 9)
    expect(mgr.list('prj_1')[0].status).toBe('killed')
    expect(mgr.list('prj_1')[0].exitCode).toBe(137)
  })

  it('rename() updates name, role, and alias and persists the change', () => {
    const { mgr, rec } = makeManager()
    const session = mgr.create({ projectId: 'prj_1' })

    const renamed = mgr.rename(session.id, 'API server', 'backend', 'api')
    expect(renamed).toMatchObject({ name: 'API server', role: 'backend', alias: 'api' })

    // Omitted role/alias are left untouched.
    const again = mgr.rename(session.id, 'API server 2')
    expect(again).toMatchObject({ name: 'API server 2', role: 'backend', alias: 'api' })
    expect(rec.callsFor('run', 'UPDATE terminal_sessions')).toHaveLength(2)
    expect(() => mgr.rename('term_missing', 'x')).toThrow(/not found/)
  })

  it('restart() replaces the session but keeps identity and startup command', () => {
    vi.useFakeTimers()
    const { mgr } = makeManager()
    const original = mgr.create({
      projectId: 'prj_1',
      name: 'dev',
      role: 'frontend',
      command: 'npm run dev',
    })
    vi.advanceTimersByTime(120)

    const restarted = mgr.restart(original.id)
    expect(ptyState.spawned[0].kill).toHaveBeenCalled()
    expect(restarted.id).not.toBe(original.id)
    expect(restarted).toMatchObject({ name: 'dev', role: 'frontend', status: 'running' })
    expect(mgr.list('prj_1')).toEqual([restarted])

    vi.advanceTimersByTime(120)
    expect(ptyState.spawned[1].write).toHaveBeenCalledWith('npm run dev\r')
  })

  it('launchAgent() opens a named agent terminal that runs the agent CLI', () => {
    vi.useFakeTimers()
    const { mgr } = makeManager()
    const session = mgr.launchAgent('prj_1', 'claude')
    expect(session).toMatchObject({ name: 'Claude Code', role: 'claude' })
    vi.advanceTimersByTime(120)
    expect(ptyState.spawned[0].write).toHaveBeenCalledWith('claude\r')
  })

  it('resumeClaude() launches claude with the resume flag and session id', () => {
    vi.useFakeTimers()
    const { mgr } = makeManager()
    const uuid = '123e4567-e89b-12d3-a456-426614174000'
    mgr.resumeClaude('prj_1', uuid)
    vi.advanceTimersByTime(120)
    expect(ptyState.spawned[0].write).toHaveBeenCalledWith(`claude --resume ${uuid}\r`)
  })

  it('killAll() disposes every session and blocks late pty events from the DB', () => {
    const { mgr, rec, events, onOutput } = makeManager()
    const dataSpy = vi.fn()
    const exitSpy = vi.fn()
    events.onTyped('terminal:data', dataSpy)
    events.onTyped('terminal:exit', exitSpy)
    mgr.create({ projectId: 'prj_1' })
    mgr.create({ projectId: 'prj_1' })

    mgr.killAll()
    expect(ptyState.spawned[0].kill).toHaveBeenCalled()
    expect(ptyState.spawned[1].kill).toHaveBeenCalled()
    expect(mgr.list('prj_1')).toEqual([])

    // Late async pty events after shutdown must not touch the DB or event bus.
    const dbCallsAfterShutdown = rec.calls.length
    ptyState.spawned[0].emitData('late output')
    ptyState.spawned[0].emitExit(0)
    expect(rec.calls.length).toBe(dbCallsAfterShutdown)
    expect(dataSpy).not.toHaveBeenCalled()
    expect(exitSpy).not.toHaveBeenCalled()
    expect(onOutput).not.toHaveBeenCalled()
  })
})
