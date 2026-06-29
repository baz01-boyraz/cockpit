import { describe, expect, it } from 'vitest'
import { CHAT_MODELS, DEFAULT_CHAT_MODEL, resolveChatModel } from '@shared/chat-models'

describe('CHAT_MODELS', () => {
  it('offers the three Claude tiers with CLI aliases as ids', () => {
    expect(CHAT_MODELS.map((m) => m.id)).toEqual(['sonnet', 'opus', 'haiku'])
  })

  it('defaults to Sonnet', () => {
    expect(DEFAULT_CHAT_MODEL.id).toBe('sonnet')
  })

  it('gives every model a label, full name, and hint', () => {
    for (const m of CHAT_MODELS) {
      expect(m.label).toBeTruthy()
      expect(m.name).toMatch(/^Claude /)
      expect(m.hint).toBeTruthy()
    }
  })
})

describe('resolveChatModel', () => {
  it('resolves a known alias', () => {
    expect(resolveChatModel('opus').id).toBe('opus')
  })

  it('is case- and whitespace-insensitive', () => {
    expect(resolveChatModel('  Haiku ').id).toBe('haiku')
  })

  it('falls back to the default for unknown / empty input', () => {
    expect(resolveChatModel('gpt-5.5').id).toBe('sonnet')
    expect(resolveChatModel('').id).toBe('sonnet')
    expect(resolveChatModel(null).id).toBe('sonnet')
    expect(resolveChatModel(undefined).id).toBe('sonnet')
  })
})
