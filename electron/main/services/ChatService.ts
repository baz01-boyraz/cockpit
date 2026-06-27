import { execFile } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import type { ChatEngine, ChatReply } from '@shared/ipc'
import type { ProjectService } from './ProjectService'

const execFileAsync = promisify(execFile)

/**
 * Real chat backend for the AI Cockpit panel. Routes a prompt to the user's
 * chosen, already-authenticated CLI agent and returns its answer:
 *   - claude → `claude -p "<prompt>"`            (Claude Opus 4.8)
 *   - codex  → `codex exec -s read-only -o <f>`  (final message only)
 * Answers run in the active project's directory, so they are grounded in that
 * project, and are billed to the user's existing plans. No API key is handled by
 * the app. Codex runs read-only here — the chat never mutates files.
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

const ENGINE_LABEL: Record<ChatEngine, string> = {
  claude: 'Claude Code · Opus 4.8',
  codex: 'Codex · OpenAI',
}

export class ChatService {
  constructor(private readonly projects: ProjectService) {}

  private cwdFor(projectId: string): string {
    try {
      return this.projects.get(projectId).path
    } catch {
      return homedir()
    }
  }

  async ask(projectId: string, prompt: string, engine: ChatEngine = 'claude'): Promise<ChatReply> {
    const cwd = this.cwdFor(projectId)
    return engine === 'codex' ? this.askCodex(cwd, prompt) : this.askClaude(cwd, prompt)
  }

  private async askClaude(cwd: string, prompt: string): Promise<ChatReply> {
    const bin = resolveBin('claude')
    try {
      const { stdout } = await execFileAsync(bin, ['-p', prompt], {
        cwd,
        timeout: 180_000,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env },
      })
      return { ok: true, text: stdout.trim(), model: ENGINE_LABEL.claude }
    } catch (err) {
      return this.fail(err, 'Claude Code')
    }
  }

  private async askCodex(cwd: string, prompt: string): Promise<ChatReply> {
    const bin = resolveBin('codex')
    const outFile = join(tmpdir(), `cockpit-codex-${randomUUID()}.txt`)
    try {
      await execFileAsync(
        bin,
        ['exec', '--skip-git-repo-check', '-s', 'read-only', '-o', outFile, prompt],
        { cwd, timeout: 180_000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env } },
      )
      const text = existsSync(outFile) ? readFileSync(outFile, 'utf8').trim() : ''
      return { ok: true, text: text || '(Codex returned no message)', model: ENGINE_LABEL.codex }
    } catch (err) {
      return this.fail(err, 'Codex')
    } finally {
      try {
        rmSync(outFile, { force: true })
      } catch {
        /* ignore */
      }
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
