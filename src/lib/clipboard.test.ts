import { describe, expect, it, vi } from 'vitest'
import { copyText, type ClipboardEnvironment } from './clipboard'

function environment(overrides: Partial<ClipboardEnvironment> = {}): ClipboardEnvironment {
  return {
    clipboard: { writeText: vi.fn(async () => undefined) },
    fallback: vi.fn(() => true),
    ...overrides,
  }
}

describe('copyText', () => {
  it('prefers the async Clipboard API and skips the DOM fallback', async () => {
    const env = environment()

    await expect(copyText('Council report', env)).resolves.toBe(true)
    expect(env.clipboard?.writeText).toHaveBeenCalledWith('Council report')
    expect(env.fallback).not.toHaveBeenCalled()
  })

  it('uses the fallback when Clipboard API is missing or denied', async () => {
    const missing = environment({ clipboard: null })
    const denied = environment({
      clipboard: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) },
    })

    await expect(copyText('Missing API', missing)).resolves.toBe(true)
    await expect(copyText('Denied API', denied)).resolves.toBe(true)
    expect(missing.fallback).toHaveBeenCalledWith('Missing API')
    expect(denied.fallback).toHaveBeenCalledWith('Denied API')
  })

  it('returns false instead of throwing when every clipboard path fails', async () => {
    const env = environment({
      clipboard: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) },
      fallback: vi.fn(() => {
        throw new Error('blocked')
      }),
    })

    await expect(copyText('Council report', env)).resolves.toBe(false)
    await expect(copyText('', env)).resolves.toBe(false)
  })
})
