import { execFile, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { buildClaudeArgs } from '@shared/claude-run'
import { buildCodexArgs, type EngineSpec } from '@shared/engines'
import { OPENROUTER_SECRET_REF } from './OpenRouterUsageService'
import { resolveBin } from './resolveBin'
import type { SecretStore } from './SecretStore'

const execFileAsync = promisify(execFile)

/** Per-call spawn/fetch budget. The renderer never sets these; a seat's council
 *  config does, so the runner treats them as trusted numbers, not input. */
export interface EngineCallOpts {
  cwd: string
  timeout: number
  maxBuffer: number
  /** Provider-enforced only where the engine capability says so. */
  maxTokens?: number
  /** Disable local/MCP/browser tools so the model can use only supplied evidence. */
  evidenceOnly?: boolean
}

/** Injectable so tests never spawn a real CLI (mirrors CouncilService). */
export type CliRunner = (
  bin: string,
  args: string[],
  opts: EngineCallOpts,
) => Promise<{ stdout: string }>

/** Injectable so tests never hit the network. `typeof fetch` keeps the fake
 *  honest — it must accept the same (url, init) the real call passes. */
export type HttpFetch = typeof fetch

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

/** User-facing failure text. Callers render these per-seat, so they must read
 *  as guidance, not stack traces. The decrypted key never appears in any of
 *  them (or in a log) — every message here is a fixed string or a status code. */
const NO_KEY_MSG = 'Add an OpenRouter key in Settings to run this engine.'
const TIMEOUT_MSG = 'OpenRouter request timed out.'
const NETWORK_MSG = 'Could not reach OpenRouter. Check your connection and try again.'
const MALFORMED_MSG = 'OpenRouter returned a malformed response.'
const NO_CONTENT_MSG = 'OpenRouter returned no message content.'

/** Map an OpenRouter HTTP status to actionable text — never the response body,
 *  which can echo request fields. Codes cover the ones a key actually hits. */
function mapHttpStatus(status: number): string {
  if (status === 401 || status === 403) return 'Your OpenRouter key is invalid or expired.'
  if (status === 402) return 'Your OpenRouter account is out of credits.'
  return `OpenRouter request failed (HTTP ${status}).`
}

/** Parse `choices[0].message.content` from an unknown JSON body without trusting
 *  its shape at any level. Returns null when the reply is not a plain string. */
function extractMessageContent(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const choices = (body as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return null
  const first: unknown = choices[0]
  if (typeof first !== 'object' || first === null) return null
  const message = (first as { message?: unknown }).message
  if (typeof message !== 'object' || message === null) return null
  const content = (message as { content?: unknown }).content
  return typeof content === 'string' ? content : null
}

/**
 * Runs one prompt on any {engine, model} seat and returns the reply text. This
 * is the single seam a future multi-engine council calls per member — it hides
 * whether a seat is a local CLI (`claude`/`codex`, spawned) or a remote model
 * (`openrouter`, fetched). The CLI runner and fetch are injectable so tests
 * exercise every branch without a process or a socket.
 *
 * Security: OpenRouter's key is read main-process-only via `SecretStore.get`
 * (per its own doc comment) and never crosses IPC or lands in a thrown error.
 */
export class EngineRunner {
  private readonly cliRunner: CliRunner
  private readonly fetchImpl: HttpFetch
  /**
   * Live CLI child processes — the `claude`/`codex` seats currently spawned. On
   * app quit `Services.shutdown()` calls {@link killAll} BEFORE `db.close()`, so a
   * council mid-run doesn't reparent and keep burning CPU/API spend until its own
   * 360s timeout (roadmap A2). A child is tracked whenever the runner's returned
   * promise carries a `.child` handle (the real `execFile` promise always does),
   * and forgotten when it emits `close`. A Set is the right shape here — this is
   * process bookkeeping, not domain state.
   */
  private readonly children = new Set<ChildProcess>()

  constructor(
    private readonly secrets: SecretStore,
    cliRunner?: CliRunner,
    fetchImpl?: HttpFetch,
  ) {
    this.cliRunner = cliRunner ?? this.spawnCli.bind(this)
    this.fetchImpl = fetchImpl ?? fetch
  }

  /**
   * The default CLI runner spawns `claude`/`codex` with `execFile` (never a shell)
   * and CLOSES the child's stdin immediately. That close is mandatory for Codex:
   * with an open stdin pipe, `codex exec` prints "Reading additional input from
   * stdin..." and blocks until timeout (see `buildCodexArgs`). Claude tolerates a
   * closed stdin, so one runner serves both branches.
   */
  private spawnCli(bin: string, args: string[], opts: EngineCallOpts): Promise<{ stdout: string }> {
    const running = execFileAsync(bin, args, {
      cwd: opts.cwd,
      timeout: opts.timeout,
      maxBuffer: opts.maxBuffer,
      env: { ...process.env },
    })
    running.child.stdin?.end()
    return running
  }

  /**
   * Register the child of an in-flight CLI call so {@link killAll} can reach it,
   * dropping it once it closes. Works for any runner whose promise exposes a
   * `.child` (the real `execFile` promise, or a test double that mirrors it); a
   * runner without one simply isn't tracked.
   */
  private track(running: Promise<{ stdout: string }>): void {
    const child = (running as { child?: ChildProcess }).child
    if (!child) return
    this.children.add(child)
    child.once('close', () => this.children.delete(child))
  }

  /**
   * Terminate every in-flight CLI child (the app-quit path). Best-effort and
   * synchronous-safe: each kill is guarded (a child may have already exited) and
   * we clear the set so a double-call is idempotent. SIGTERM is enough — these
   * are cooperative CLIs, not shells that ignore it.
   */
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

  async call(spec: EngineSpec, prompt: string, opts: EngineCallOpts): Promise<string> {
    switch (spec.engine) {
      case 'claude':
        return this.runCli(
          resolveBin('claude'),
          buildClaudeArgs(prompt, {
            model: spec.model,
            evidenceOnly: opts.evidenceOnly,
          }),
          opts,
        )
      case 'codex':
        return this.runCli(
          resolveBin('codex'),
          buildCodexArgs(prompt, {
            model: spec.model,
            evidenceOnly: opts.evidenceOnly,
          }),
          opts,
        )
      case 'openrouter':
        return this.runOpenRouter(spec, prompt, opts)
      default: {
        // Exhaustiveness: a new EngineId must be handled here, not silently dropped.
        const unreachable: never = spec.engine
        throw new Error(`Unsupported engine: ${String(unreachable)}`)
      }
    }
  }

  private async runCli(bin: string, args: string[], opts: EngineCallOpts): Promise<string> {
    const running = this.cliRunner(bin, args, opts)
    this.track(running)
    const { stdout } = await running
    return stdout.trim()
  }

  private async runOpenRouter(spec: EngineSpec, prompt: string, opts: EngineCallOpts): Promise<string> {
    const key = this.secrets.get(OPENROUTER_SECRET_REF)
    if (!key) throw new Error(NO_KEY_MSG)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), opts.timeout)

    let res: Response
    try {
      res = await this.fetchImpl(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: spec.model,
          messages: [{ role: 'user', content: prompt }],
          ...(Number.isInteger(opts.maxTokens) && (opts.maxTokens ?? 0) > 0
            ? { max_completion_tokens: opts.maxTokens }
            : {}),
        }),
        signal: controller.signal,
      })
    } catch {
      // The only failures here are the abort we triggered or a transport error.
      // Neither carries the key; we still map to a fixed string rather than
      // surface fetch internals to a seat panel.
      throw new Error(controller.signal.aborted ? TIMEOUT_MSG : NETWORK_MSG)
    } finally {
      clearTimeout(timer)
    }

    if (!res.ok) throw new Error(mapHttpStatus(res.status))

    let body: unknown
    try {
      body = await res.json()
    } catch {
      throw new Error(MALFORMED_MSG)
    }

    const content = extractMessageContent(body)
    if (content === null) throw new Error(NO_CONTENT_MSG)
    return content.trim()
  }
}
