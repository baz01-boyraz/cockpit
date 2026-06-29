import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { friendlyProvider, parseHermesAuthList, type HermesProvider } from '@shared/hermes-auth'
import { humanizeModelLabel, parseHermesModelConfig } from '@shared/hermes-model'
import { buildHermesArgs, type HermesRunOptions } from '@shared/hermes-run'
import type { ChatEngine, ChatModelInfo, ChatReply } from '@shared/ipc'
import type { ProjectService } from './ProjectService'

const execFileAsync = promisify(execFile)

/** The agent brand stays constant; only the model behind it changes. */
const HERMES_BRAND = 'Hermes'

/**
 * Real chat backend for the AI Cockpit panel. Routes a prompt to the user's
 * locally-installed, already-authenticated Hermes agent via one-shot mode
 * (`hermes -z "<prompt>"`, which prints ONLY the final message). Optional
 * overrides (provider, model, skills, toolsets) are added as discrete argv
 * flags by `buildHermesArgs`. Answers run in the active project's directory, so
 * they are grounded in that project, and are billed to the user's existing
 * provider plans. No API key is handled by the app. We do NOT pass `--yolo`, so
 * Hermes cannot auto-run dangerous commands without a TTY approval — the cockpit
 * chat stays read-mostly.
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
  constructor(private readonly projects: ProjectService) {}

  private cwdFor(projectId: string): string {
    try {
      return this.projects.get(projectId).path
    } catch {
      return homedir()
    }
  }

  /**
   * The model the cockpit chat actually answers with — read live from the
   * user's Hermes config so the UI never claims a model that isn't active.
   * Falls back to a neutral label when Hermes is unconfigured or unreadable.
   */
  async activeModel(): Promise<ChatModelInfo> {
    const fallback: ChatModelInfo = { provider: '', model: '', label: HERMES_BRAND, sub: 'agent' }
    try {
      const text = await readFile(join(homedir(), '.hermes', 'config.yaml'), 'utf8')
      const parsed = parseHermesModelConfig(text)
      if (!parsed) return fallback
      return {
        provider: parsed.provider,
        model: parsed.model,
        label: HERMES_BRAND,
        sub: humanizeModelLabel(parsed.model),
      }
    } catch {
      return fallback
    }
  }

  /** Providers the user has authenticated, for the cockpit's model picker. */
  async listProviders(): Promise<HermesProvider[]> {
    const bin = resolveBin('hermes')
    try {
      const { stdout } = await execFileAsync(bin, ['auth', 'list'], {
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env },
      })
      return parseHermesAuthList(stdout)
    } catch {
      return []
    }
  }

  async ask(
    projectId: string,
    prompt: string,
    _engine: ChatEngine = 'hermes',
    opts: HermesRunOptions = {},
  ): Promise<ChatReply> {
    const cwd = this.cwdFor(projectId)
    const modelLabel = await this.runLabel(opts)
    return this.askHermes(cwd, buildHermesArgs(prompt, opts), modelLabel)
  }

  /**
   * What to show as the answering model. A per-run override wins (we can't read
   * the model Hermes resolves for an override, so we name what we asked for);
   * otherwise fall back to the configured default.
   */
  private async runLabel(opts: HermesRunOptions): Promise<string> {
    if (opts.model?.trim()) return `${HERMES_BRAND} · ${humanizeModelLabel(opts.model)}`
    if (opts.provider?.trim()) return `${HERMES_BRAND} · ${friendlyProvider(opts.provider)}`
    const info = await this.activeModel()
    return `${info.label} · ${info.sub}`
  }

  private async askHermes(cwd: string, args: string[], modelLabel: string): Promise<ChatReply> {
    const bin = resolveBin('hermes')
    try {
      const { stdout } = await execFileAsync(bin, args, {
        cwd,
        timeout: 180_000,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env },
      })
      return { ok: true, text: stdout.trim() || '(Hermes returned no message)', model: modelLabel }
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
