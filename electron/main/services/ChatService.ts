import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ChatReply } from '@shared/ipc'
import type { ProjectService } from './ProjectService'

const execFileAsync = promisify(execFile)

/**
 * Real chat backend for the AI Cockpit panel. Runs the user's authenticated
 * Claude Code CLI in print mode (`claude -p "<prompt>"`) from the active
 * project's directory, so answers are grounded in that project and billed to the
 * user's existing Claude plan. No API key is handled by the app.
 */
let cachedBin: string | null | undefined

function resolveClaudeBin(): string | null {
  if (cachedBin !== undefined) return cachedBin
  const candidates = [
    join(homedir(), '.local/bin/claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    join(homedir(), '.bun/bin/claude'),
  ]
  cachedBin = candidates.find((p) => existsSync(p)) ?? 'claude'
  return cachedBin
}

export class ChatService {
  constructor(private readonly projects: ProjectService) {}

  async ask(projectId: string, prompt: string): Promise<ChatReply> {
    const bin = resolveClaudeBin()
    if (!bin) {
      return { ok: false, text: 'Claude Code CLI not found. Install it and run `claude` once.', model: '' }
    }
    let cwd = homedir()
    try {
      cwd = this.projects.get(projectId).path
    } catch {
      /* project may not exist yet — fall back to home */
    }
    try {
      const { stdout } = await execFileAsync(bin, ['-p', prompt], {
        cwd,
        timeout: 180_000,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env },
      })
      return { ok: true, text: stdout.trim(), model: 'Claude Code · Opus 4.8' }
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string }
      return {
        ok: false,
        text: e.stderr?.trim() || e.message || 'Claude Code request failed.',
        model: '',
      }
    }
  }
}
