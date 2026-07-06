import type { OpenRouterUsageSnapshot } from '@shared/domain'
import type { SecretStore } from './SecretStore'

const CREDITS_URL = 'https://openrouter.ai/api/v1/credits'
const FETCH_TIMEOUT_MS = 8_000
/** Don't re-probe OpenRouter more often than this. */
const MIN_REFRESH_MS = 60_000
/** Keep serving the last good snapshot through transient errors for this long. */
const STALE_FALLBACK_MS = 6 * 60 * 60 * 1000

interface CacheEntry {
  snapshot: OpenRouterUsageSnapshot
  at: number
}

interface CreditsResponse {
  data?: {
    total_credits?: number
    total_usage?: number
  }
}

/**
 * Live remaining-credit awareness for the OpenRouter key saved in Settings —
 * the key Hermes's DeepSeek/OpenRouter model calls run on. Mirrors
 * AgentUsageService's cache + stale-fallback shape so the rail's Engines row
 * can treat Hermes like a third provider next to Claude/Codex.
 *
 * Security model matches AgentUsageService: the decrypted key is read via
 * `SecretStore.get` (main-process only, per its own doc comment) and never
 * crosses the IPC boundary — only the derived percent/dollar figures do.
 */
export class OpenRouterUsageService {
  private cache: CacheEntry | null = null

  constructor(private readonly secrets: SecretStore) {}

  async status(): Promise<OpenRouterUsageSnapshot> {
    if (this.cache && Date.now() - this.cache.at < MIN_REFRESH_MS) return this.cache.snapshot

    try {
      const snapshot = await this.fetchSnapshot()
      if (snapshot.available) {
        this.cache = { snapshot, at: Date.now() }
        return snapshot
      }
      // A clean "no key / no balance" state — prefer a still-fresh cache so a
      // momentary read miss doesn't make the ring flicker away.
      if (this.cache && Date.now() - this.cache.at < STALE_FALLBACK_MS) return this.cache.snapshot
      return snapshot
    } catch (err) {
      if (this.cache && Date.now() - this.cache.at < STALE_FALLBACK_MS) return this.cache.snapshot
      return this.unavailable(this.errorReason(err))
    }
  }

  private async fetchSnapshot(): Promise<OpenRouterUsageSnapshot> {
    const key = this.secrets.get('openrouter')
    if (!key) return this.unavailable('Add an OpenRouter key in Settings to see live credit.')

    const body = await this.getJson(key)
    const totalCredits = body.data?.total_credits
    const totalUsage = body.data?.total_usage
    if (typeof totalCredits !== 'number' || typeof totalUsage !== 'number') {
      return this.unavailable('OpenRouter did not report a credit balance.')
    }

    const remainingUsd = Math.max(0, totalCredits - totalUsage)
    const remainingPercent =
      totalCredits > 0
        ? Math.max(0, Math.min(100, Math.round((remainingUsd / totalCredits) * 100)))
        : null

    return {
      available: true,
      remainingPercent,
      remainingUsd,
      totalUsd: totalCredits,
      reason: null,
      fetchedAt: new Date().toISOString(),
    }
  }

  private async getJson(key: string): Promise<CreditsResponse> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(CREDITS_URL, {
        headers: { Authorization: `Bearer ${key}` },
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as CreditsResponse
    } finally {
      clearTimeout(timer)
    }
  }

  private unavailable(reason: string): OpenRouterUsageSnapshot {
    return {
      available: false,
      remainingPercent: null,
      remainingUsd: null,
      totalUsd: null,
      reason,
      fetchedAt: new Date().toISOString(),
    }
  }

  private errorReason(err: unknown): string {
    const message = err instanceof Error ? err.message : ''
    if (message.includes('401') || message.includes('403')) {
      return 'OpenRouter key is invalid or expired.'
    }
    if (message.includes('aborted')) return 'OpenRouter request timed out.'
    return 'OpenRouter credit temporarily unavailable.'
  }
}
