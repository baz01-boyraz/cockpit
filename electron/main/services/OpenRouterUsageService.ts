import type { OpenRouterUsageSnapshot } from '@shared/domain'
import type { SecretStore } from './SecretStore'

/** The SecretStore ref this service reads — must match the `openrouter` entry
 *  in registerIpc.ts's `SECRET_REFS`, which is what Settings actually writes
 *  to. Exported so registerIpc imports this instead of hardcoding its own
 *  copy of the string (the two silently drifted once already). */
export const OPENROUTER_SECRET_REF = 'hermes.openrouter'

/** `/credits` requires a management key; Settings stores a normal routing key. */
const KEY_URL = 'https://openrouter.ai/api/v1/key'
const FETCH_TIMEOUT_MS = 8_000
/** Don't re-probe OpenRouter more often than this. */
const MIN_REFRESH_MS = 60_000
/** Keep serving the last good snapshot through transient errors for this long. */
const STALE_FALLBACK_MS = 6 * 60 * 60 * 1000

interface CacheEntry {
  snapshot: OpenRouterUsageSnapshot
  at: number
}

interface KeyResponse {
  data?: {
    limit?: number | null
    limit_remaining?: number | null
    usage?: number
  }
}

/**
 * Live limit awareness for the OpenRouter routing key saved in Settings —
 * the key Council's remote seats run on. Mirrors
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
    const key = this.secrets.get(OPENROUTER_SECRET_REF)
    if (!key) {
      return this.unavailable(
        this.secrets.has(OPENROUTER_SECRET_REF)
          ? 'The stored OpenRouter key cannot be decrypted by this app build. Re-save it in Settings.'
          : 'Add an OpenRouter key in Settings to see its live limit.',
      )
    }

    const body = await this.getJson(key)
    const limit = body.data?.limit
    const limitRemaining = body.data?.limit_remaining
    const usage = body.data?.usage
    if (
      (limit !== null && (typeof limit !== 'number' || !Number.isFinite(limit))) ||
      typeof usage !== 'number' ||
      !Number.isFinite(usage)
    ) {
      return this.unavailable('OpenRouter did not report this key’s limit.')
    }

    const totalUsd = typeof limit === 'number' ? Math.max(0, limit) : null
    const unlimited = totalUsd === null
    const remainingUsd = totalUsd === null
      ? null
      : Math.max(
          0,
          typeof limitRemaining === 'number' && Number.isFinite(limitRemaining)
            ? limitRemaining
            : totalUsd - usage,
        )
    const remainingPercent = totalUsd !== null && totalUsd > 0
      ? Math.max(0, Math.min(100, Math.round(((remainingUsd ?? 0) / totalUsd) * 100)))
      : null

    return {
      available: true,
      remainingPercent,
      remainingUsd,
      totalUsd,
      usageUsd: Math.max(0, usage),
      unlimited,
      reason: null,
      fetchedAt: new Date().toISOString(),
    }
  }

  private async getJson(key: string): Promise<KeyResponse> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(KEY_URL, {
        headers: { Authorization: `Bearer ${key}` },
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as KeyResponse
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
      usageUsd: null,
      unlimited: false,
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
