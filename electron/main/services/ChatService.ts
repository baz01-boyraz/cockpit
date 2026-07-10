import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { buildClaudeArgs, type ClaudeRunOptions } from '@shared/claude-run'
import { resolveChatModel } from '@shared/chat-models'
import type { ChatReply } from '@shared/ipc'
import { wrapTaskWithMemory, type MemoryContextProvider, type MemoryContextReceipt } from '@shared/memory-context'
import type { ProjectService } from './ProjectService'

const execFileAsync = promisify(execFile)

export type ChatRunner = (
  bin: string,
  args: string[],
  opts: { cwd: string; timeout: number; maxBuffer: number },
) => Promise<{ stdout: string }>

const defaultRunner: ChatRunner = (bin, args, opts) =>
  execFileAsync(bin, args, { ...opts, env: { ...process.env } })

/** The chat brand shown alongside the picked model. */
const CHAT_BRAND = 'Claude'

/**
 * Real chat backend for the AI Cockpit panel. Routes a prompt to the user's
 * locally-installed, already-authenticated Claude Code CLI via print mode
 * (`claude --print "<prompt>"`, which emits ONLY the final message). The picked
 * model is passed with `--model <alias>`. Answers run in the active project's
 * directory, so they are grounded in that project, and are billed to the user's
 * existing Claude subscription — no API key is handled by the app. We do NOT
 * pass any permission-bypass flag, so Claude cannot auto-run dangerous commands
 * without a TTY approval; the cockpit chat stays read-mostly.
 */
function resolveBin(name: string): string {
  const candidates = [
    join(homedir(), '.local/bin', name),
    `/opt/homebrew/bin/${name}`,
    `/usr/local/bin/${name}`,
    join(homedir(), '.bun/bin', name),
  ]
  return candidates.find((p) => existsSync(p)) ?? name
}

export class ChatService {
  constructor(
    private readonly projects: ProjectService,
    private readonly memoryContexts: MemoryContextProvider,
    private readonly runner: ChatRunner = defaultRunner,
  ) {}

  private cwdFor(projectId: string): string {
    try {
      return this.projects.get(projectId).path
    } catch {
      return homedir()
    }
  }

  async ask(projectId: string, prompt: string, opts: ClaudeRunOptions = {}): Promise<ChatReply> {
    const cwd = this.cwdFor(projectId)
    const model = resolveChatModel(opts.model)
    const context = this.memoryContexts.forTask({
      projectId,
      surface: 'claude_chat',
      query: prompt,
    })
    const args = buildClaudeArgs(wrapTaskWithMemory(prompt, context), { model: model.id })
    return this.askClaude(cwd, args, `${CHAT_BRAND} · ${model.label}`, context.receipt)
  }

  private async askClaude(
    cwd: string,
    args: string[],
    modelLabel: string,
    memoryContext: MemoryContextReceipt,
  ): Promise<ChatReply> {
    const bin = resolveBin('claude')
    try {
      const { stdout } = await this.runner(bin, args, {
        cwd,
        timeout: 180_000,
        maxBuffer: 8 * 1024 * 1024,
      })
      return {
        ok: true,
        text: stdout.trim() || '(Claude returned no message)',
        model: modelLabel,
        memoryContext,
      }
    } catch (err) {
      return { ...this.fail(err, 'Claude'), memoryContext }
    }
  }

  private fail(err: unknown, label: string): ChatReply {
    const e = err as { stdout?: string; stderr?: string; message?: string }
    return {
      ok: false,
      text: e.stderr?.trim() || e.message || `${label} request failed.`,
      model: '',
    }
  }
}
