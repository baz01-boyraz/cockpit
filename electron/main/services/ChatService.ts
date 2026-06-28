import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ChatEngine, ChatReply } from '@shared/ipc'
import type { ProjectService } from './ProjectService'

const execFileAsync = promisify(execFile)

/**
 * Real chat backend for the AI Cockpit panel. Routes a prompt to the user's
 * locally-installed, already-authenticated Hermes agent and returns its answer:
 *   - hermes → `hermes -z "<prompt>"`  (one-shot mode, prints ONLY the final message)
 * Answers run in the active project's directory, so they are grounded in that
 * project, and are billed to the user's existing Hermes/provider plans. No API
 * key is handled by the app. We do NOT pass `--yolo`, so Hermes cannot auto-run
 * dangerous commands without a TTY approval — the cockpit chat stays read-mostly.
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
  hermes: 'Hermes · Nous',
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

  async ask(projectId: string, prompt: string, _engine: ChatEngine = 'hermes'): Promise<ChatReply> {
    const cwd = this.cwdFor(projectId)
    return this.askHermes(cwd, prompt)
  }

  private async askHermes(cwd: string, prompt: string): Promise<ChatReply> {
    const bin = resolveBin('hermes')
    try {
      const { stdout } = await execFileAsync(bin, ['-z', prompt], {
        cwd,
        timeout: 180_000,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env },
      })
      return { ok: true, text: stdout.trim() || '(Hermes returned no message)', model: ENGINE_LABEL.hermes }
    } catch (err) {
      return this.fail(err, 'Hermes')
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
