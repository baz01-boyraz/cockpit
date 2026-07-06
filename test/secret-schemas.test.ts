import { describe, expect, it } from 'vitest'
import { SECRET_KINDS, secretKindOnlySchema, secretSetSchema } from '@shared/schemas'

describe('secret schemas', () => {
  it('exposes openrouter as a known kind', () => {
    expect(SECRET_KINDS).toContain('openrouter')
  })

  it('accepts a valid openrouter set payload', () => {
    const parsed = secretSetSchema.parse({ kind: 'openrouter', value: 'sk-or-v1-abc123' })
    expect(parsed).toEqual({ kind: 'openrouter', value: 'sk-or-v1-abc123' })
  })

  it('accepts a valid kind-only payload', () => {
    expect(secretKindOnlySchema.parse({ kind: 'openrouter' })).toEqual({ kind: 'openrouter' })
  })

  it('rejects an unknown kind (the enum is a trust boundary)', () => {
    expect(() => secretSetSchema.parse({ kind: 'anthropic', value: 'x' })).toThrow()
    expect(() => secretKindOnlySchema.parse({ kind: 'railway' })).toThrow()
    expect(() => secretKindOnlySchema.parse({ kind: '' })).toThrow()
  })

  it('rejects an empty or missing value', () => {
    expect(() => secretSetSchema.parse({ kind: 'openrouter', value: '' })).toThrow()
    expect(() => secretSetSchema.parse({ kind: 'openrouter' })).toThrow()
  })

  it('rejects an over-long value', () => {
    expect(() => secretSetSchema.parse({ kind: 'openrouter', value: 'a'.repeat(501) })).toThrow()
  })
})
