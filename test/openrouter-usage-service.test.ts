import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  OPENROUTER_SECRET_REF,
  OpenRouterUsageService,
} from '../electron/main/services/OpenRouterUsageService'
import type { SecretStore } from '../electron/main/services/SecretStore'

const API_KEY = 'sk-or-v1-test-key'
const KEY_URL = 'https://openrouter.ai/api/v1/key'

function secrets(value: string | null, stored = value !== null): SecretStore {
  return {
    get: (ref: string) => (ref === OPENROUTER_SECRET_REF ? value : null),
    has: (ref: string) => ref === OPENROUTER_SECRET_REF && stored,
  } as unknown as SecretStore
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OpenRouterUsageService routing-key limits', () => {
  it('reads a capped routing key from /api/v1/key', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe(KEY_URL)
      expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${API_KEY}`)
      return jsonResponse({
        data: {
          limit: 20,
          limit_remaining: 12.4,
          usage: 7.6,
          limit_reset: null,
          is_free_tier: false,
        },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const snapshot = await new OpenRouterUsageService(secrets(API_KEY)).status()

    expect(snapshot).toMatchObject({
      available: true,
      remainingPercent: 62,
      remainingUsd: 12.4,
      totalUsd: 20,
      usageUsd: 7.6,
      unlimited: false,
      reason: null,
    })
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('reports an unlimited routing key as live instead of CREDIT N/A', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      data: {
        limit: null,
        limit_remaining: null,
        usage: 3.25,
        limit_reset: null,
        is_free_tier: false,
      },
    })))

    const snapshot = await new OpenRouterUsageService(secrets(API_KEY)).status()

    expect(snapshot).toMatchObject({
      available: true,
      remainingPercent: null,
      remainingUsd: null,
      totalUsd: null,
      usageUsd: 3.25,
      unlimited: true,
      reason: null,
    })
  })

  it('distinguishes an unreadable stored key from a missing key', async () => {
    const snapshot = await new OpenRouterUsageService(secrets(null, true)).status()

    expect(snapshot.available).toBe(false)
    expect(snapshot.reason).toMatch(/cannot be decrypted/i)
  })
})
