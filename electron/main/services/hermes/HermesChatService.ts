import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { buildHermesArgs } from '@shared/hermes-run'
import { buildTranscriptPrompt, capHistory, type ChatTurn } from '@shared/hermes-chat'
import type { HermesChatReply } from '@shared/ipc'
import type { ProjectService } from '../ProjectService'
import { resolveBin } from '../resolveBin'

const execFileAsync = promisify(execFile)

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
  opts: { timeout: number; maxBuffer: number },
) => Promise<{ stdout: string }>

const defaultRunner: HermesChatRunner = (cwd, args, opts) =>
  execFileAsync(resolveBin('hermes'), args, { cwd, ...opts, env: { ...process.env } })

/**
 * Backend for the Hermes chat widget (docs/plans/hermes.md Faz 7). Each user
 * message runs one `hermes --oneshot` in the active project's directory, WITHOUT
 * `--ignore-rules` so the orchestrator persona (`AGENTS.md`) and the `cockpit`
 * MCP tools stay loaded — that back-and-forth is the whole point of the widget.
 *
 * Because Hermes oneshot is stateless, this service owns the conversation: an
 * in-memory per-project history, re-sent as a transcript each turn and capped so
 * the prompt can't grow unbounded. Failures degrade to `{ ok: false, error }`;
 * an unhandled exception never crosses the IPC boundary.
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

  constructor(
    private readonly projects: ProjectService,
    private readonly runner: HermesChatRunner = defaultRunner,
  ) {}

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
    const historyContent = safeImagePath ? `${message}\n\n[User attached an image]` : message

    const prior = this.histories.get(projectId) ?? []
    const withUser = capHistory([...prior, { role: 'user', content: historyContent }])
    const prompt = buildTranscriptPrompt(withUser)
    const cwd = this.cwdFor(projectId)
    try {
      const { stdout } = await this.runner(
        cwd,
        buildHermesArgs(prompt, { ignoreRules: false, imagePath: safeImagePath }),
        { timeout: HERMES_CHAT_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES },
      )
      const text = stdout.trim() || '(Hermes returned no message)'
      this.histories.set(
        projectId,
        capHistory([...withUser, { role: 'assistant', content: text }]),
      )
      this.consecutiveTimeouts.delete(projectId)
      return { ok: true, text }
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
}
