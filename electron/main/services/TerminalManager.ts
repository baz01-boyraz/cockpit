import { platform } from 'node:os'
import * as pty from 'node-pty'
import { countActiveAgents } from '@shared/dashboard-assembly'
import type { TerminalRole, TerminalSession } from '@shared/domain'
import { buildAgentLaunchCommand, buildCodexResumeCommand } from '@shared/terminal-ux'
import type { Db } from '../db/Database'
import type { CockpitEvents } from '../events'
import { logFatal } from '../logging'
import { newId, nowIso } from '../util/ids'
import type { ProjectService } from './ProjectService'
import { prepareShellIntegration } from './shellIntegration'

interface LiveTerminal {
  session: TerminalSession
  proc: pty.IPty
  command: string | null
}

/**
 * A row this process reconciled from running/starting → exited at boot, captured
 * BEFORE the flip so its `pid`/`lastActiveAt` still reflect the crashed previous
 * process's last claim. The A4 zombie-liveness audit reads these; because pid
 * reuse is real, the caller must still verify recency + liveness before acting.
 */
export interface ReconciledStaleSession {
  id: string
  projectId: string
  pid: number | null
  lastActiveAt: string
}

type OutputSink = (projectId: string, sessionId: string, data: string) => void

const MAX_TERMINALS = 6

/** Grace after SIGTERM before a killAll SIGKILL escalation (roadmap A5). */
const KILL_GRACE_MS = 500

/**
 * Owns real terminal sessions backed by node-pty. Enforces the per-project cap
 * (max 6), streams output to the renderer via the event bus, and mirrors session
 * lifecycle into SQLite. Roles are optional metadata — never required.
 *
 * Row lifecycle: spawned ('running') → 'exited' (the pty ended on its own,
 * whatever the exit code) or 'killed' (WE ended it via kill()/killAll()/
 * restart()). Rows still claiming running/starting at boot are stale history
 * from a previous process — the constructor reconciles them to 'exited' with a
 * `reconciled_at` stamp, so the DB never reports phantom live sessions.
 */
export class TerminalManager {
  private readonly live = new Map<string, LiveTerminal>()
  /** Set during shutdown so late async pty events never touch a closed DB. */
  private disposed = false
  /** Rows flipped from running/starting → exited at THIS boot (A4 seam). Captured
   *  before the reconcile UPDATE; read once by the zombie-liveness audit. */
  private reconciledThisBoot: readonly ReconciledStaleSession[] = []

  constructor(
    private readonly db: Db,
    private readonly events: CockpitEvents,
    private readonly projects: ProjectService,
    private readonly onOutput: OutputSink,
    private readonly onUsage: (projectId: string, kind: 'session' | 'command') => void,
    /** Directory for cockpit-owned shell-integration startup files (OSC 133). */
    private readonly shellIntegrationDir: string,
  ) {
    // Boot reconciliation runs before any session can spawn, so from the first
    // moment both the live map and the DB agree: nothing is running yet.
    this.reconcileStaleRows()
  }

  /**
   * Mark rows a previous process left as running/starting as exited-with-
   * reconciliation. pty processes cannot outlive the app, so these rows are
   * provably stale. `reconciled_at IS NOT NULL` distinguishes "we inferred the
   * exit at boot" from "we observed the exit live" (Phase 6 resume will offer
   * exactly these rows back, relaunching from cwd/shell/command).
   */
  private reconcileStaleRows(): void {
    // Capture the rows about to be flipped FIRST — their pid/last_active_at reflect
    // the previous (crashed) process's last claim, which is the A4 audit's input.
    this.reconciledThisBoot = (
      this.db
        .prepare(
          `SELECT id, project_id, pid, last_active_at FROM terminal_sessions
           WHERE status IN ('running', 'starting')`,
        )
        .all() as { id: string; project_id: string; pid: number | null; last_active_at: string }[]
    ).map((r) => ({
      id: r.id,
      projectId: r.project_id,
      pid: r.pid,
      lastActiveAt: r.last_active_at,
    }))
    this.db
      .prepare(
        `UPDATE terminal_sessions
         SET status = 'exited', reconciled_at = @now
         WHERE status IN ('running', 'starting')`,
      )
      .run({ now: nowIso() })
  }

  /**
   * The rows this process reconciled at boot (running/starting → exited),
   * captured before the flip. The A4 zombie audit reads them once; pid reuse
   * means every entry must still pass a recency + liveness check before it is
   * treated as our own orphaned process.
   */
  get reconciledStaleSessions(): readonly ReconciledStaleSession[] {
    return this.reconciledThisBoot
  }

  private defaultShell(): string {
    if (platform() === 'win32') return process.env.COMSPEC ?? 'powershell.exe'
    return process.env.SHELL ?? '/bin/zsh'
  }

  /**
   * Sessions of THIS process run (the live map). Consistent with the DB by
   * construction: boot reconciliation cleared every stale running/starting row
   * before the first spawn, and every lifecycle change here is mirrored to its
   * row — so no session can appear 'running' anywhere unless its pty is live.
   */
  list(projectId: string): TerminalSession[] {
    return [...this.live.values()]
      .filter((t) => t.session.projectId === projectId)
      .map((t) => t.session)
  }

  /** Read one live session for scoped collaborators. */
  get(sessionId: string): TerminalSession | null {
    const session = this.live.get(sessionId)?.session
    return session ? { ...session } : null
  }

  count(projectId: string): number {
    return this.list(projectId).length
  }

  /**
   * Live AI-agent panes (Claude Code / Codex) currently running for a project.
   * The rule itself is shared with the browser mock (`countActiveAgents`).
   */
  countActiveAgents(projectId: string): number {
    return countActiveAgents(this.list(projectId))
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

    // node-pty invokes these from a native ThreadSafeFunction callback (a
    // libuv thread calling into V8), not from a normal JS call stack. Any
    // exception that escapes this callback aborts the whole process (SIGABRT)
    // instead of surfacing as a catchable 'uncaughtException' — so the entire
    // body is guarded, not just the shared event bus.
    proc.onData((data) => {
      try {
        if (this.disposed) return
        this.touch(session.id)
        this.events.emitTyped('terminal:data', {
          sessionId: session.id,
          data,
          at: nowIso(),
        })
        this.onOutput(input.projectId, session.id, data)
      } catch (err) {
        logFatal('pty:onData', err)
      }
    })

    proc.onExit(({ exitCode, signal }) => {
      try {
        if (this.disposed) return
        const live = this.live.get(session.id)
        if (live) {
          // Any exit that reaches here with the session still live is a NATURAL
          // exit — 'exited' whatever the code (a failing build is not 'killed').
          // 'killed' is reserved for exits we initiated: kill()/killAll()/
          // restart() remove the session from the live map (or set `disposed`)
          // before the pty's exit event fires, so they never hit this branch.
          live.session.status = 'exited'
          live.session.exitCode = exitCode
          this.updateRow(live.session)
        }
        this.events.emitTyped('terminal:exit', {
          sessionId: session.id,
          projectId: session.projectId,
          role: session.role,
          exitCode,
          signal: signal ?? null,
        })
      } catch (err) {
        logFatal('pty:onExit', err)
      }
    })

    this.live.set(id, { session, proc, command: input.command ?? null })
    this.insertRow(session, input.command ?? null)
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
      const provider = live.session.role
      if (provider === 'claude' || provider === 'codex') {
        // Never place prompt text on the event bus. Live Memory needs only the
        // lifecycle marker; canonical content is read later from the provider's
        // own redacted transcript path.
        this.events.emitTyped('terminal:agentTurn', {
          sessionId,
          projectId: live.session.projectId,
          provider,
          at: nowIso(),
        })
      }
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

  launchAgent(
    projectId: string,
    agent: 'claude' | 'codex',
    initialPrompt?: string,
  ): TerminalSession {
    const name = agent === 'claude' ? 'Claude Code' : 'Codex'
    const role: TerminalRole = agent
    const command = buildAgentLaunchCommand(agent, initialPrompt)
    return this.create({ projectId, name, role, command })
  }

  /**
   * Open a new Claude pane that resumes a prior conversation by id, so the agent
   * starts with full memory of that session instead of cold. The caller validates
   * `sessionId` as a strict UUID (see `resumeClaudeSchema`) before it reaches the
   * shell command interpolated here.
   */
  resumeClaude(projectId: string, sessionId: string): TerminalSession {
    return this.resumeAgent(projectId, 'claude', sessionId)
  }

  /** Resume a persisted Claude or Codex conversation using its native CLI syntax. */
  resumeAgent(
    projectId: string,
    provider: 'claude' | 'codex',
    sessionId: string,
  ): TerminalSession {
    const isClaude = provider === 'claude'
    return this.create({
      projectId,
      name: isClaude ? 'Claude Code' : 'Codex',
      role: provider,
      command: isClaude ? `claude --resume ${sessionId}` : buildCodexResumeCommand(sessionId),
    })
  }

  killAll(): void {
    // Flag first so in-flight pty data/exit events stop writing to the DB before
    // we (and the caller) close it.
    this.disposed = true
    for (const live of this.live.values()) {
      this.terminate(live.proc)
    }
    this.live.clear()
  }

  /**
   * Best-effort, synchronous-safe termination of one pty for the before-quit path
   * (roadmap A5). Three layers, each guarded so one failure never stops the rest:
   *   1. node-pty's own `kill()` (SIGTERM to the shell);
   *   2. a process-GROUP SIGTERM — node-pty runs the shell in its own session, so
   *      its pid is the group leader and `-pid` reaches children (dev servers,
   *      agent CLIs) that would otherwise ignore the shell's signal and survive;
   *   3. a SIGKILL escalation after a short grace for anything still alive.
   *
   * The escalation timer is fired-and-`unref()`d: it never blocks the synchronous
   * shutdown and never keeps the (quitting) process alive on its own account.
   */
  private terminate(proc: pty.IPty): void {
    const pid = proc.pid
    try {
      proc.kill()
    } catch {
      /* already dead */
    }
    this.killGroup(pid, 'SIGTERM')
    const timer = setTimeout(() => {
      this.killGroup(pid, 'SIGKILL')
      try {
        proc.kill('SIGKILL')
      } catch {
        /* already gone */
      }
    }, KILL_GRACE_MS)
    timer.unref()
  }

  /**
   * Signal a pty's whole process group (`-pid`). Guarded: group kill legitimately
   * fails with ESRCH (already exited) or on platforms without POSIX process groups
   * (Windows), and either is fine — layer 1 (`proc.kill`) covers those hosts.
   */
  private killGroup(pid: number | undefined, signal: NodeJS.Signals): void {
    if (!pid || pid <= 0) return
    try {
      process.kill(-pid, signal)
    } catch {
      /* group already gone, or no process-group support on this platform */
    }
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

  /**
   * `command` is stored alongside the V1 columns so the row alone carries what
   * a Phase 6 resume needs: project, cwd, shell, and the startup command.
   */
  private insertRow(s: TerminalSession, command: string | null): void {
    if (this.disposed) return
    this.db
      .prepare(
        `INSERT INTO terminal_sessions
         (id, project_id, name, role, alias, cwd, shell, status, pid, exit_code, command, created_at, last_active_at)
         VALUES (@id, @projectId, @name, @role, @alias, @cwd, @shell, @status, @pid, @exitCode, @command, @createdAt, @lastActiveAt)`,
      )
      .run({ ...s, command })
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
