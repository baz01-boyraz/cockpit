import { execFile, type ChildProcess } from 'node:child_process'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { buildHermesArgs } from '@shared/hermes-run'
import { buildTranscriptPrompt, capHistory, type ChatRole, type ChatTurn } from '@shared/hermes-chat'
import type { HermesChatReply } from '@shared/ipc'
import { redactText } from '@shared/redaction'
import type { MemoryContextProvider } from '@shared/memory-context'
import type { Db } from '../../db/Database'
import { logFatal } from '../../logging'
import { nowIso } from '../../util/ids'
import type { ProjectService } from '../ProjectService'
import { resolveBin } from '../resolveBin'
import { MCP_TOKEN_ENV } from './HermesMcpServer'

const execFileAsync = promisify(execFile)

/**
 * Restrict the Hermes CLI's loaded tool namespaces to what the chat widget
 * actually needs. Live testing (see `.cockpit-memory/hermes-chat-latency-*`)
 * measured a trimmed `-t` list at ~20-25% faster per turn than loading the full
 * tool set. `-t` is a WHITELIST: `cockpit` (the MCP server name — hermes
 * resolves MCP server names as toolset aliases) must be listed or the 18
 * cockpit tools silently vanish — v0.2.0 shipped without it and Hermes lost
 * git/checks/council access in production. Kept as a frozen tuple so callers
 * spread it without mutating the shared array.
 */
export const HERMES_CHAT_TOOLS = ['-t', 'memory,skills,cockpit'] as const

/**
 * A single conversational turn may have Hermes call several MCP tools (checking
 * quota, reading git status, etc.) before it answers, so the timeout is far more
 * generous than a plain chat/distill call's 180s.
 */
const HERMES_CHAT_TIMEOUT_MS = 5 * 60 * 1000
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024

/** Injectable so unit tests never spawn a real `hermes` binary. */
export type HermesChatRunner = (
  cwd: string,
  args: string[],
  opts: { timeout: number; maxBuffer: number; env?: Record<string, string> },
) => Promise<{ stdout: string }>

/** One persisted transcript row, hydrated back into the in-memory Map on boot. */
interface ChatTurnRow {
  projectId: string
  role: ChatRole
  content: string
}

/**
 * Backend for the Hermes chat widget (docs/plans/hermes.md Faz 7). Each user
 * message runs one `hermes --oneshot` in the active project's directory, WITHOUT
 * `--ignore-rules` so the orchestrator persona (`AGENTS.md`) and the `cockpit`
 * MCP tools stay loaded — that back-and-forth is the whole point of the widget.
 *
 * Because Hermes oneshot is stateless, this service owns the conversation: a
 * per-project history that is BOTH held in memory (re-sent as a transcript each
 * turn and capped so the prompt can't grow unbounded) AND persisted to SQLite so
 * it survives an app restart (roadmap A7b). Failures degrade to
 * `{ ok: false, error }`; an unhandled exception never crosses the IPC boundary.
 */
export class HermesChatService {
  private readonly histories = new Map<string, ChatTurn[]>()
  /**
   * Tracks back-to-back timeouts per project. The `hermes` CLI can hang
   * silently during its own startup (before it ever reaches our MCP tool
   * bridge or logs anything), so a single timeout is ambiguous — a second
   * one in a row is the signal that it's genuinely stuck, not just slow.
   */
  private readonly consecutiveTimeouts = new Map<string, number>()
  /**
   * Live `hermes` child processes. On app quit `Services.shutdown()` calls
   * {@link killAll} BEFORE `db.close()` so a chat turn mid-flight (up to 5min)
   * doesn't reparent and keep burning CPU/API spend (roadmap A2). Tracked
   * whenever the runner's promise carries a `.child` handle.
   */
  private readonly children = new Set<ChildProcess>()
  private readonly runner: HermesChatRunner
  /**
   * Lazily resolves the loopback MCP server's per-session bearer token (D3). It
   * is a thunk because the MCP server is constructed after this service, so the
   * token doesn't exist yet at construction — it's read at spawn time. Undefined
   * (no server, or not yet started) simply omits the env var.
   */
  private readonly mcpToken?: () => string | undefined

  constructor(
    private readonly projects: ProjectService,
    private readonly db: Db,
    runner?: HermesChatRunner,
    mcpToken?: () => string | undefined,
    private readonly memoryContexts?: MemoryContextProvider,
  ) {
    this.runner = runner ?? this.spawnHermes.bind(this)
    this.mcpToken = mcpToken
    this.hydrate()
  }

  /** The default runner spawns `hermes` with `execFile` (never a shell). */
  private spawnHermes(
    cwd: string,
    args: string[],
    opts: { timeout: number; maxBuffer: number; env?: Record<string, string> },
  ): Promise<{ stdout: string }> {
    const { env, ...rest } = opts
    return execFileAsync(resolveBin('hermes'), args, {
      cwd,
      ...rest,
      env: { ...process.env, ...env },
    })
  }

  /** Register the in-flight child so {@link killAll} can reach it; drop on close. */
  private track(running: Promise<{ stdout: string }>): void {
    const child = (running as { child?: ChildProcess }).child
    if (!child) return
    this.children.add(child)
    child.once('close', () => this.children.delete(child))
  }

  /** Terminate every in-flight chat child (app-quit path). Best-effort, idempotent. */
  killAll(): void {
    for (const child of this.children) {
      try {
        child.kill('SIGTERM')
      } catch {
        /* already exited */
      }
    }
    this.children.clear()
  }

  private cwdFor(projectId: string): string {
    try {
      return this.projects.get(projectId).path
    } catch {
      return homedir()
    }
  }

  /** Read-only snapshot of a project's turns (for inspection/tests). */
  history(projectId: string): ChatTurn[] {
    return [...(this.histories.get(projectId) ?? [])]
  }

  /** Drop a project's conversation — the widget's "new conversation" action. */
  clear(projectId: string): void {
    this.histories.delete(projectId)
    this.consecutiveTimeouts.delete(projectId)
    this.purge(projectId)
  }

  /**
   * `imagePath` must be an absolute path already saved via
   * `AttachmentService.saveTerminalImage` (the renderer's attach flow) — it is
   * re-confined to that project's `.dev-cockpit/attachments/` directory below
   * so an untrusted IPC payload can't point Hermes's `--image` flag at an
   * arbitrary file on disk.
   */
  async ask(projectId: string, message: string, imagePath?: string): Promise<HermesChatReply> {
    const safeImagePath = imagePath ? this.resolveAttachment(projectId, imagePath) : undefined
    // D1 — redact at intake, ONCE. This message flows outbound to the `hermes`
    // CLI (→ OpenRouter) as argv, is stored in the in-memory Map, is persisted
    // to hermes_chat_turns, and is re-composed into every future transcript. A
    // pasted secret must reach none of them, so we mask here before it touches
    // any of those surfaces rather than at each boundary.
    const safeMessage = redactText(message)
    const historyContent = safeImagePath ? `${safeMessage}\n\n[User attached an image]` : safeMessage

    const prior = this.histories.get(projectId) ?? []
    const withUser = capHistory([...prior, { role: 'user', content: historyContent }])
    const memoryContext = this.memoryContexts?.forTask({
      projectId,
      surface: 'hermes_chat',
      query: safeMessage,
    })
    // The model cannot read process.env directly. `COCKPIT_PROJECT_ID` still
    // rides in the child env for tools/plugins that can, but Hermes itself must
    // see the exact opaque database id in its trusted prompt context. Without
    // this it guessed the display name ("baz-cockpit"), producing ordinary
    // domain errors instead of real git/memory results.
    const prompt = buildTranscriptPrompt(withUser, {
      projectId,
      memoryBlock: memoryContext?.block ?? null,
    })
    const cwd = this.cwdFor(projectId)
    // The tools flag rides after the oneshot/chat argv so the prompt keeps its
    // slot right after --oneshot (or -q for the image path).
    const args = [
      ...buildHermesArgs(prompt, { ignoreRules: false, imagePath: safeImagePath }),
      ...HERMES_CHAT_TOOLS,
    ]
    // D3 — hand the CLI the loopback MCP bearer token so its tool calls back
    // into cockpiT authenticate. Only injected when a token exists; the chat
    // path is the one spawner that loads MCP tools (ignoreRules: false).
    const token = this.mcpToken?.()
    try {
      const running = this.runner(cwd, args, {
        timeout: HERMES_CHAT_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
        // The model has no other ground truth for "which cockpit project is
        // this" — AGENTS.md tells it to read this and pass it verbatim as
        // `projectId` on every Swarm/memory/git tool call. Without it the
        // model has to invent an id, which fails the kanban_cards FK check.
        env: {
          COCKPIT_PROJECT_ID: projectId,
          ...(token ? { [MCP_TOKEN_ENV]: token } : {}),
        },
      })
      this.track(running)
      const { stdout } = await running
      // Redact outbound-then-stored assistant text too: a model that echoes a
      // secret back must not re-leak it to the renderer, the DB, or the next
      // transcript. Fallback before redaction so an empty reply still masks.
      const text = redactText(stdout.trim() || '(Hermes returned no message)')
      const next = capHistory([...withUser, { role: 'assistant', content: text }])
      this.histories.set(projectId, next)
      this.persist(projectId, next)
      this.consecutiveTimeouts.delete(projectId)
      return { ok: true, text, memoryContext: memoryContext?.receipt }
    } catch (err) {
      // A failed turn must NOT leave a dangling user message in history — that
      // would desync the transcript on the next turn — so we never commit
      // `withUser`; the prior history stands.
      return this.fail(projectId, err)
    }
  }

  /** Returns the resolved path only if it sits inside the project's attachments dir. */
  private resolveAttachment(projectId: string, imagePath: string): string | undefined {
    const attachmentsDir = join(this.cwdFor(projectId), '.dev-cockpit', 'attachments')
    const resolved = resolve(imagePath)
    const rel = relative(attachmentsDir, resolved)
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) return undefined
    return resolved
  }

  private fail(projectId: string, err: unknown): HermesChatReply {
    const e = err as { code?: string | number; killed?: boolean; signal?: string; stderr?: string; message?: string }
    if (e.code === 'ENOENT') {
      return {
        ok: false,
        text: '',
        error:
          'Hermes CLI not found. Install hermes-agent and configure its OpenRouter key, then try again.',
      }
    }
    // execFile's own timeout kills the child (no distinct error code) — its
    // generic "Command failed" message otherwise dumps the full argv (the
    // entire transcript prompt) back at the user, which is both unreadable
    // and a stderr-shaped leak of prior conversation content.
    if (e.killed) {
      const streak = (this.consecutiveTimeouts.get(projectId) ?? 0) + 1
      this.consecutiveTimeouts.set(projectId, streak)
      const seconds = HERMES_CHAT_TIMEOUT_MS / 1000
      const error =
        streak >= 2
          ? `Hermes has now timed out ${streak} times in a row (${seconds}s each) — it's stuck starting up, not just slow. Retrying won't help; check ~/.hermes/logs/agent.log for where it stalls, or restart the hermes process.`
          : `Hermes didn't respond within ${seconds}s and was stopped. This can be a one-off — try again.`
      return { ok: false, text: '', error }
    }
    return {
      ok: false,
      text: '',
      error: e.stderr?.trim() || e.message || 'Hermes request failed.',
    }
  }

  /**
   * Rewrite a project's persisted transcript to match its capped in-memory
   * history: delete the project's rows, then re-insert the (already capped) turns
   * in order. A blunt delete+insert keeps the DB == memory with no reconciliation
   * logic; a capped history is at most `MAX_HISTORY_TURNS` rows, so the cost is
   * trivial. Insert order preserves conversation order (AUTOINCREMENT id).
   *
   * Durability is best-effort: the live turn is already in the in-memory Map, so
   * a write failure only forfeits cross-restart survival, never the current
   * reply. It is logged (not swallowed) rather than surfaced to the widget.
   */
  private persist(projectId: string, turns: readonly ChatTurn[]): void {
    try {
      const write = this.db.transaction(() => {
        this.db.prepare('DELETE FROM hermes_chat_turns WHERE project_id = ?').run(projectId)
        const insert = this.db.prepare(
          `INSERT INTO hermes_chat_turns (project_id, role, content, created_at)
           VALUES (@projectId, @role, @content, @createdAt)`,
        )
        const at = nowIso()
        for (const turn of turns) {
          insert.run({ projectId, role: turn.role, content: turn.content, createdAt: at })
        }
      })
      write()
    } catch (err) {
      logFatal('hermesChat:persist', err)
    }
  }

  /** Drop a project's persisted transcript (the "new conversation" action). */
  private purge(projectId: string): void {
    try {
      this.db.prepare('DELETE FROM hermes_chat_turns WHERE project_id = ?').run(projectId)
    } catch (err) {
      logFatal('hermesChat:purge', err)
    }
  }

  /**
   * Load persisted transcripts into the in-memory Map at construction so a
   * restart resumes each project's conversation. Rows are read in insert order
   * and re-capped per project (a transcript persisted before a cap change could
   * exceed the current bound). A read failure just starts empty — never a boot
   * blocker.
   */
  private hydrate(): void {
    try {
      const rows = this.db
        .prepare(
          `SELECT project_id AS projectId, role, content
           FROM hermes_chat_turns ORDER BY id`,
        )
        .all() as ChatTurnRow[]
      for (const row of rows) {
        const prior = this.histories.get(row.projectId) ?? []
        this.histories.set(row.projectId, [...prior, { role: row.role, content: row.content }])
      }
      for (const [projectId, turns] of this.histories) {
        this.histories.set(projectId, capHistory(turns))
      }
    } catch (err) {
      logFatal('hermesChat:hydrate', err)
    }
  }
}
