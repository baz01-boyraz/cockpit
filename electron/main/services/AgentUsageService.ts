import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type {
  AgentUsageProvider,
  AgentUsageReport,
  AgentUsageSnapshot,
  AgentUsageWindow,
} from '@shared/domain'
import { windowFromUsedPercent, windowFromUtilization } from '@shared/agent-usage'
import { redactText } from '@shared/redaction'
import { logFatal } from '../logging'

const execFileAsync = promisify(execFile)

const FETCH_TIMEOUT_MS = 12_000
/** Don't re-probe the upstream APIs more often than this (they rate-limit). */
const MIN_REFRESH_MS = 60_000
/** Keep serving the last good snapshot through transient errors for this long. */
const STALE_FALLBACK_MS = 6 * 60 * 60 * 1000

export interface OAuthCreds {
  token: string
  expiresAt: number | null
  plan: string | null
}

export interface CodexAuth {
  token: string
  accountId: string | null
}

export interface AgentUsageServiceOptions {
  fetchImpl?: typeof fetch
  resolveClaudeCreds?: () => Promise<OAuthCreds | null>
  readCodexAuth?: () => Promise<CodexAuth | null>
  /** Receives a redacted diagnostic string; never credentials or response bodies. */
  onProbeError?: (provider: AgentUsageProvider, diagnostic: string) => void
}

interface CacheEntry {
  snapshot: AgentUsageSnapshot
  at: number
}

const LABELS: Record<AgentUsageProvider, string> = {
  claude: 'Claude',
  codex: 'Codex',
}

/**
 * Account-quota awareness for the developer's already-authenticated agent CLIs.
 *
 * Security model: this service is the *only* place credentials are touched. It
 * reads the OAuth tokens Claude Code / Codex already store locally (keychain or
 * dotfile), calls each provider's own usage endpoint with the developer's token,
 * and returns a summarized snapshot. Tokens, account ids, and emails never leave
 * this service — the IPC layer only ever forwards the window percentages.
 *
 * Providers are probed independently: one failing (or signed out) never blanks
 * the other. Missing/expired credentials degrade to a polished `available:false`
 * snapshot with a human reason. Network blips fall back to the last good cache.
 */
export class AgentUsageService {
  private readonly cache = new Map<AgentUsageProvider, CacheEntry>()

  constructor(private readonly options: AgentUsageServiceOptions = {}) {}

  async getReport(): Promise<AgentUsageReport> {
    const [claude, codex] = await Promise.all([
      this.getProvider('claude', () => this.fetchClaude()),
      this.getProvider('codex', () => this.fetchCodex()),
    ])
    return { providers: [claude, codex] }
  }

  // --- cache + stale-fallback wrapper -------------------------------------

  private async getProvider(
    provider: AgentUsageProvider,
    fetcher: () => Promise<AgentUsageSnapshot>,
  ): Promise<AgentUsageSnapshot> {
    const cached = this.cache.get(provider)
    if (cached && Date.now() - cached.at < MIN_REFRESH_MS) return cached.snapshot

    try {
      const snapshot = await fetcher()
      if (snapshot.available) {
        this.cache.set(provider, { snapshot, at: Date.now() })
        return snapshot
      }
      // A clean "signed out / no quota" state — prefer a still-fresh cache so a
      // momentary credential read miss doesn't make the pill flicker away.
      if (cached && Date.now() - cached.at < STALE_FALLBACK_MS) return cached.snapshot
      return snapshot
    } catch (err) {
      this.reportProbeError(provider, err)
      if (cached && Date.now() - cached.at < STALE_FALLBACK_MS) return cached.snapshot
      return this.unavailable(provider, this.errorReason(err))
    }
  }

  // --- Claude (Anthropic OAuth usage) -------------------------------------

  private async fetchClaude(): Promise<AgentUsageSnapshot> {
    const creds = this.options.resolveClaudeCreds
      ? await this.options.resolveClaudeCreds()
      : await this.resolveClaudeCreds()
    if (!creds) {
      return this.unavailable('claude', 'Sign in with Claude Code to see usage.')
    }
    if (creds.expiresAt !== null && creds.expiresAt <= Date.now()) {
      return this.unavailable('claude', 'Session expired — reopen Claude Code to refresh.')
    }
    if (!creds.token.startsWith('sk-ant-oat')) {
      return this.unavailable(
        'claude',
        'Account limits need an OAuth-backed Claude Code login.',
      )
    }

    const payload = await this.getJson('https://api.anthropic.com/api/oauth/usage', {
      Authorization: `Bearer ${creds.token}`,
      Accept: 'application/json',
      'anthropic-beta': 'oauth-2025-04-20',
      'User-Agent': 'claude-code/2.1.0',
    })

    const windows: AgentUsageWindow[] = []
    for (const [key, label] of [
      ['five_hour', 'Session'],
      ['seven_day', 'Weekly'],
    ] as const) {
      const win = (payload as Record<string, unknown>)[key]
      const window = windowFromUtilization(label, win)
      if (window) windows.push(window)
    }
    if (!windows.length) {
      return this.unavailable('claude', 'No quota windows reported yet.')
    }

    return {
      provider: 'claude',
      label: LABELS.claude,
      available: true,
      plan: prettyPlan(creds.plan ?? (payload as { plan?: unknown }).plan),
      windows,
      reason: null,
      fetchedAt: new Date().toISOString(),
    }
  }

  private async resolveClaudeCreds(): Promise<OAuthCreds | null> {
    const candidates = (
      await Promise.all([this.claudeKeychain(), this.claudeFile()])
    ).filter((c): c is OAuthCreds => c !== null)
    if (!candidates.length) return null

    const now = Date.now()
    const valid = candidates.filter((c) => c.expiresAt === null || c.expiresAt > now)
    // Prefer the credential that stays valid longest (Claude Code refreshes the
    // keychain copy during use, so it's usually fresher than the dotfile).
    const pool = valid.length ? valid : candidates
    return pool.sort((a, b) => (b.expiresAt ?? Infinity) - (a.expiresAt ?? Infinity))[0]
  }

  private async claudeKeychain(): Promise<OAuthCreds | null> {
    if (process.platform !== 'darwin') return null
    try {
      const { stdout } = await execFileAsync(
        'security',
        ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
        { timeout: 4000 },
      )
      return parseClaudeOAuth(stdout)
    } catch {
      return null
    }
  }

  private async claudeFile(): Promise<OAuthCreds | null> {
    try {
      const raw = await readFile(join(homedir(), '.claude', '.credentials.json'), 'utf8')
      return parseClaudeOAuth(raw)
    } catch {
      return null
    }
  }

  // --- Codex (ChatGPT backend usage) --------------------------------------

  private async fetchCodex(): Promise<AgentUsageSnapshot> {
    const auth = this.options.readCodexAuth
      ? await this.options.readCodexAuth()
      : await this.readCodexAuth()
    if (!auth) {
      return this.unavailable('codex', 'Sign in with the Codex CLI to see usage.')
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${auth.token}`,
      Accept: 'application/json',
      'User-Agent': 'codex-cli',
    }
    if (auth.accountId) headers['ChatGPT-Account-Id'] = auth.accountId

    const payload = await this.getJson('https://chatgpt.com/backend-api/wham/usage', headers)
    const rateLimit = (payload as { rate_limit?: Record<string, unknown> }).rate_limit ?? {}

    const windows: AgentUsageWindow[] = []
    for (const [key, label] of [
      ['primary_window', 'Session'],
      ['secondary_window', 'Weekly'],
    ] as const) {
      const window = windowFromUsedPercent(label, rateLimit[key])
      if (window) windows.push(window)
    }
    if (!windows.length) {
      return this.unavailable('codex', 'No quota windows reported yet.')
    }

    return {
      provider: 'codex',
      label: LABELS.codex,
      available: true,
      plan: prettyPlan((payload as { plan_type?: unknown }).plan_type),
      windows,
      reason: null,
      fetchedAt: new Date().toISOString(),
    }
  }

  private async readCodexAuth(): Promise<CodexAuth | null> {
    try {
      const raw = await readFile(join(homedir(), '.codex', 'auth.json'), 'utf8')
      const parsed = JSON.parse(raw) as { tokens?: Record<string, unknown> }
      const tokens = parsed.tokens ?? {}
      const token = String(tokens.access_token ?? '')
      if (!token) return null
      const accountId = tokens.account_id ? String(tokens.account_id) : null
      return { token, accountId }
    } catch {
      return null
    }
  }

  // --- shared helpers ------------------------------------------------------

  private async getJson(url: string, headers: Record<string, string>): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await (this.options.fetchImpl ?? fetch)(url, {
        headers,
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } finally {
      clearTimeout(timer)
    }
  }

  private unavailable(provider: AgentUsageProvider, reason: string): AgentUsageSnapshot {
    return {
      provider,
      label: LABELS[provider],
      available: false,
      plan: null,
      windows: [],
      reason,
      fetchedAt: new Date().toISOString(),
    }
  }

  private errorReason(err: unknown): string {
    const message = err instanceof Error ? err.message : ''
    if (message.includes('401') || message.includes('403')) {
      return 'Session expired — reopen the CLI to refresh.'
    }
    if (message.includes('429')) return 'Usage endpoint rate-limited — retrying automatically.'
    if (message.includes('aborted')) return 'Usage request timed out.'
    return 'Usage temporarily unavailable.'
  }

  private reportProbeError(provider: AgentUsageProvider, err: unknown): void {
    const diagnostic = usageProbeDiagnostic(err)
    try {
      if (this.options.onProbeError) {
        this.options.onProbeError(provider, diagnostic)
      } else {
        logFatal(`agent-usage:${provider}`, new Error(diagnostic))
      }
    } catch {
      // Observability must never make quota telemetry fail harder.
    }
  }
}

/** Reduce a provider failure to a short, secret-free diagnostic for local logs. */
export function usageProbeDiagnostic(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '')
  const redacted = redactText(raw).trim()
  const status = /\bHTTP\s+\d{3}\b/i.exec(redacted)?.[0]
  if (status) return status.toUpperCase()
  if (/abort/i.test(redacted)) return 'request aborted'
  return redacted.slice(0, 240) || 'unknown probe failure'
}

function parseClaudeOAuth(raw: string): OAuthCreds | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const oauth = isRecord(parsed.claudeAiOauth) ? parsed.claudeAiOauth : parsed
    const token = String(oauth.accessToken ?? oauth.access_token ?? '')
    if (!token) return null
    const expiresAt = typeof oauth.expiresAt === 'number' ? oauth.expiresAt : null
    const plan = typeof oauth.subscriptionType === 'string' ? oauth.subscriptionType : null
    return { token, expiresAt, plan }
  } catch {
    return null
  }
}

function prettyPlan(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.trim()
  if (!cleaned) return null
  return cleaned
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
