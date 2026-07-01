import { platform } from 'node:os'
import * as pty from 'node-pty'
import type { TerminalRole, TerminalSession } from '@shared/domain'
import type { Db } from '../db/Database'
import type { CockpitEvents } from '../events'
import { newId, nowIso } from '../util/ids'
import type { ProjectService } from './ProjectService'
import { prepareShellIntegration } from './shellIntegration'

interface LiveTerminal {
  session: TerminalSession
  proc: pty.IPty
  command: string | null
}

type OutputSink = (projectId: string, sessionId: string, data: string) => void

const MAX_TERMINALS = 6

/**
 * Owns real terminal sessions backed by node-pty. Enforces the per-project cap
 * (max 6), streams output to the renderer via the event bus, and mirrors session
 * lifecycle into SQLite. Roles are optional metadata — never required.
 */
export class TerminalManager {
  private readonly live = new Map<string, LiveTerminal>()
  /** Set during shutdown so late async pty events never touch a closed DB. */
  private disposed = false

  constructor(
    private readonly db: Db,
    private readonly events: CockpitEvents,
    private readonly projects: ProjectService,
    private readonly onOutput: OutputSink,
    private readonly onUsage: (projectId: string, kind: 'session' | 'command') => void,
    /** Directory for cockpit-owned shell-integration startup files (OSC 133). */
    private readonly shellIntegrationDir: string,
  ) {}

  private defaultShell(): string {
    if (platform() === 'win32') return process.env.COMSPEC ?? 'powershell.exe'
    return process.env.SHELL ?? '/bin/zsh'
  }

  list(projectId: string): TerminalSession[] {
    return [...this.live.values()]
      .filter((t) => t.session.projectId === projectId)
      .map((t) => t.session)
  }

  count(projectId: string): number {
    return this.list(projectId).length
  }

  create(input: {
    projectId: string
    name?: string
    role?: TerminalRole | null
    alias?: string | null
    cwd?: string
    command?: string | null
  }): TerminalSession {
    if (this.count(input.projectId) >= MAX_TERMINALS) {
      throw new Error(`Terminal limit reached (max ${MAX_TERMINALS} per project).`)
    }
    const project = this.projects.get(input.projectId)
    const shell = this.defaultShell()
    const cwd = this.resolveCwd(project.path, input.cwd)
    const id = newId('term')
    const session: TerminalSession = {
      id,
      projectId: input.projectId,
      name: input.name?.trim() || this.autoName(input.projectId),
      role: input.role ?? null,
      alias: input.alias ?? null,
      cwd,
      shell,
      status: 'running',
      pid: null,
      exitCode: null,
      createdAt: nowIso(),
      lastActiveAt: nowIso(),
    }

    const baseEnv = {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    } as Record<string, string>
    // Inject OSC 133 command-block marks (non-destructive; no-op for unsupported
    // shells). zsh integrates via env (ZDOTDIR), bash via a `--rcfile` spawn arg.
    const { env, args } = prepareShellIntegration(shell, this.shellIntegrationDir, baseEnv)

    const proc = pty.spawn(shell, args ?? [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd,
      env,
    })
    session.pid = proc.pid

    proc.onData((data) => {
      if (this.disposed) return
      this.touch(session.id)
      this.events.emitTyped('terminal:data', {
        sessionId: session.id,
        data,
        at: nowIso(),
      })
      this.onOutput(input.projectId, session.id, data)
    })

    proc.onExit(({ exitCode, signal }) => {
      if (this.disposed) return
      const live = this.live.get(session.id)
      if (live) {
        live.session.status = exitCode === 0 ? 'exited' : 'killed'
        live.session.exitCode = exitCode
        this.updateRow(live.session)
      }
      this.events.emitTyped('terminal:exit', {
        sessionId: session.id,
        exitCode,
        signal: signal ?? null,
      })
    })

    this.live.set(id, { session, proc, command: input.command ?? null })
    this.insertRow(session)
    this.onUsage(input.projectId, 'session')

    // Optionally launch a command (e.g. dev server, claude, codex) in the shell.
    if (input.command) {
      setTimeout(() => {
        const live = this.live.get(id)
        if (live) live.proc.write(`${input.command}\r`)
      }, 120)
    }
    return session
  }

  write(sessionId: string, data: string): void {
    const live = this.live.get(sessionId)
    if (!live) return
    live.proc.write(data)
    this.touch(sessionId)
    if (data.includes('\r') || data.includes('\n')) {
      this.onUsage(live.session.projectId, 'command')
    }
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const live = this.live.get(sessionId)
    if (!live) return
    try {
      live.proc.resize(cols, rows)
    } catch {
      /* terminal may have exited */
    }
  }

  kill(sessionId: string): void {
    const live = this.live.get(sessionId)
    if (!live) return
    try {
      live.proc.kill()
    } catch {
      /* already dead */
    }
    live.session.status = 'killed'
    this.updateRow(live.session)
    this.live.delete(sessionId)
  }

  restart(sessionId: string): TerminalSession {
    const live = this.live.get(sessionId)
    if (!live) throw new Error(`Terminal ${sessionId} not found`)
    const { projectId, name, role, alias, cwd } = live.session
    const command = live.command
    this.kill(sessionId)
    return this.create({ projectId, name, role, alias, cwd, command })
  }

  rename(
    sessionId: string,
    name: string,
    role?: TerminalRole | null,
    alias?: string | null,
  ): TerminalSession {
    const live = this.live.get(sessionId)
    if (!live) throw new Error(`Terminal ${sessionId} not found`)
    live.session.name = name
    if (role !== undefined) live.session.role = role
    if (alias !== undefined) live.session.alias = alias
    this.updateRow(live.session)
    return live.session
  }

  launchAgent(projectId: string, agent: 'claude' | 'codex'): TerminalSession {
    const name = agent === 'claude' ? 'Claude Code' : 'Codex'
    const role: TerminalRole = agent
    return this.create({ projectId, name, role, command: agent })
  }

  /**
   * Open a new Claude pane that resumes a prior conversation by id, so the agent
   * starts with full memory of that session instead of cold. The caller validates
   * `sessionId` as a strict UUID (see `resumeClaudeSchema`) before it reaches the
   * shell command interpolated here.
   */
  resumeClaude(projectId: string, sessionId: string): TerminalSession {
    return this.create({
      projectId,
      name: 'Claude Code',
      role: 'claude',
      command: `claude --resume ${sessionId}`,
    })
  }

  killAll(): void {
    // Flag first so in-flight pty data/exit events stop writing to the DB before
    // we (and the caller) close it.
    this.disposed = true
    for (const live of this.live.values()) {
      try {
        live.proc.kill()
      } catch {
        /* already dead */
      }
    }
    this.live.clear()
  }

  private resolveCwd(projectPath: string, cwd?: string): string {
    if (!cwd || cwd === '.') return projectPath
    if (cwd.startsWith('/')) return cwd
    return `${projectPath}/${cwd}`
  }

  private autoName(projectId: string): string {
    return `Terminal ${this.count(projectId) + 1}`
  }

  private touch(sessionId: string): void {
    const live = this.live.get(sessionId)
    if (live) live.session.lastActiveAt = nowIso()
  }

  private insertRow(s: TerminalSession): void {
    if (this.disposed) return
    this.db
      .prepare(
        `INSERT INTO terminal_sessions
         (id, project_id, name, role, alias, cwd, shell, status, pid, exit_code, created_at, last_active_at)
         VALUES (@id, @projectId, @name, @role, @alias, @cwd, @shell, @status, @pid, @exitCode, @createdAt, @lastActiveAt)`,
      )
      .run({ ...s })
  }

  private updateRow(s: TerminalSession): void {
    if (this.disposed) return
    this.db
      .prepare(
        `UPDATE terminal_sessions SET name=@name, role=@role, alias=@alias, status=@status, pid=@pid,
         exit_code=@exitCode, last_active_at=@lastActiveAt WHERE id=@id`,
      )
      .run({ ...s })
  }
}
