import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
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
  }

  async ask(projectId: string, message: string): Promise<HermesChatReply> {
    const prior = this.histories.get(projectId) ?? []
    const withUser = capHistory([...prior, { role: 'user', content: message }])
    const prompt = buildTranscriptPrompt(withUser)
    const cwd = this.cwdFor(projectId)
    try {
      const { stdout } = await this.runner(cwd, buildHermesArgs(prompt, { ignoreRules: false }), {
        timeout: HERMES_CHAT_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
      })
      const text = stdout.trim() || '(Hermes returned no message)'
      this.histories.set(
        projectId,
        capHistory([...withUser, { role: 'assistant', content: text }]),
      )
      return { ok: true, text }
    } catch (err) {
      // A failed turn must NOT leave a dangling user message in history — that
      // would desync the transcript on the next turn — so we never commit
      // `withUser`; the prior history stands.
      return this.fail(err)
    }
  }

  private fail(err: unknown): HermesChatReply {
    const e = err as { code?: string | number; stderr?: string; message?: string }
    if (e.code === 'ENOENT') {
      return {
        ok: false,
        text: '',
        error:
          'Hermes CLI not found. Install hermes-agent and configure its OpenRouter key, then try again.',
      }
    }
    return {
      ok: false,
      text: '',
      error: e.stderr?.trim() || e.message || 'Hermes request failed.',
    }
  }
}
