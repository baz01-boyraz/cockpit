import { describe, expect, it } from 'vitest'
import { maskEnvEntry, parseEnvMasked, redactPayload } from '@shared/redaction'

describe('env masking', () => {
  it('masks secret-looking keys', () => {
    expect(maskEnvEntry('API_KEY', 'abcdef123456').masked).toBe(true)
    expect(maskEnvEntry('DATABASE_URL', 'postgres://u:p@h/db').masked).toBe(true)
  })

  it('leaves non-secret keys untouched', () => {
    const r = maskEnvEntry('NODE_ENV', 'production')
    expect(r.masked).toBe(false)
    expect(r.maskedValue).toBe('production')
  })

  it('masks values that look like credentials even with innocuous keys', () => {
    expect(maskEnvEntry('THING', 'ghp_0123456789abcdefghij0123').masked).toBe(true)
  })

  it('parses an env buffer without leaking secret values', () => {
    const out = parseEnvMasked('API_KEY="sk-abcdefghijklmnopqrstuvwx"\nNODE_ENV=production\n# comment\n')
    const apiKey = out.find((e) => e.key === 'API_KEY')!
    expect(apiKey.masked).toBe(true)
    expect(apiKey.maskedValue).not.toContain('abcdefghijkl')
    expect(out.find((e) => e.key === 'NODE_ENV')?.masked).toBe(false)
  })
})

describe('redactPayload', () => {
  it('redacts secret keys recursively', () => {
    const out = redactPayload({ token: 'xyz', nested: { password: 'p', ok: 1 } }) as Record<string, unknown>
    expect(out.token).toBe('[REDACTED]')
    expect((out.nested as Record<string, unknown>).password).toBe('[REDACTED]')
    expect((out.nested as Record<string, unknown>).ok).toBe(1)
  })

  it('redacts secret-shaped string values', () => {
    expect(redactPayload('ghp_0123456789abcdefghij0123')).toBe('[REDACTED]')
    expect(redactPayload('just a normal string')).toBe('just a normal string')
  })
})
