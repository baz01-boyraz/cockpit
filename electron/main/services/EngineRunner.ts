import { execFile } from 'node:child_process'
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

/**
 * The default CLI runner spawns `claude`/`codex` with `execFile` (never a shell)
 * and CLOSES the child's stdin immediately. That close is mandatory for Codex:
 * with an open stdin pipe, `codex exec` prints "Reading additional input from
 * stdin..." and blocks until timeout (see `buildCodexArgs`). Claude tolerates a
 * closed stdin, so one runner serves both branches.
 */
const defaultCliRunner: CliRunner = (bin, args, opts) => {
  const running = execFileAsync(bin, args, { ...opts, env: { ...process.env } })
  running.child.stdin?.end()
  return running
}

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

  constructor(
    private readonly secrets: SecretStore,
    cliRunner?: CliRunner,
    fetchImpl?: HttpFetch,
  ) {
    this.cliRunner = cliRunner ?? defaultCliRunner
    this.fetchImpl = fetchImpl ?? fetch
  }

  async call(spec: EngineSpec, prompt: string, opts: EngineCallOpts): Promise<string> {
    switch (spec.engine) {
      case 'claude':
        return this.runCli(resolveBin('claude'), buildClaudeArgs(prompt, { model: spec.model }), opts)
      case 'codex':
        return this.runCli(resolveBin('codex'), buildCodexArgs(prompt, { model: spec.model }), opts)
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
    const { stdout } = await this.cliRunner(bin, args, opts)
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
        body: JSON.stringify({ model: spec.model, messages: [{ role: 'user', content: prompt }] }),
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
