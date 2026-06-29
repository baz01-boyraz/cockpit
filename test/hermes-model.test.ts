import { describe, expect, it } from 'vitest'
import { humanizeModelLabel, parseHermesModelConfig } from '@shared/hermes-model'

const REAL_CONFIG = `agent:
  name: hermes
model:
  base_url: ''
  default: gpt-5.5
  provider: openai-codex
model_catalog:
  enabled: true
  providers: {}
`

describe('parseHermesModelConfig', () => {
  it('reads default model and provider from the model block', () => {
    expect(parseHermesModelConfig(REAL_CONFIG)).toEqual({
      provider: 'openai-codex',
      model: 'gpt-5.5',
    })
  })

  it('strips surrounding quotes from values', () => {
    const yaml = `model:\n  default: "claude-opus-4-8"\n  provider: 'anthropic'\n`
    expect(parseHermesModelConfig(yaml)).toEqual({
      provider: 'anthropic',
      model: 'claude-opus-4-8',
    })
  })

  it('does not bleed into the sibling model_catalog block', () => {
    const yaml = `model:\n  default: gpt-5.5\nmodel_catalog:\n  default: should-be-ignored\n  provider: nope\n`
    expect(parseHermesModelConfig(yaml)).toEqual({ provider: '', model: 'gpt-5.5' })
  })

  it('returns null when there is no model block', () => {
    expect(parseHermesModelConfig('agent:\n  name: hermes\n')).toBeNull()
  })

  it('ignores inline comments on a value', () => {
    const yaml = `model:\n  default: gpt-5.5  # active brain\n  provider: openai-codex\n`
    expect(parseHermesModelConfig(yaml)).toEqual({
      provider: 'openai-codex',
      model: 'gpt-5.5',
    })
  })
})

describe('humanizeModelLabel', () => {
  it('formats GPT ids', () => {
    expect(humanizeModelLabel('gpt-5.5')).toBe('GPT-5.5')
    expect(humanizeModelLabel('gpt-4o')).toBe('GPT-4o')
  })

  it('formats modern Claude ids with a dotted version', () => {
    expect(humanizeModelLabel('claude-opus-4-8')).toBe('Claude Opus 4.8')
    expect(humanizeModelLabel('claude-sonnet-4-6')).toBe('Claude Sonnet 4.6')
    expect(humanizeModelLabel('claude-haiku-4-5')).toBe('Claude Haiku 4.5')
  })

  it('formats Hermes / Nous ids', () => {
    expect(humanizeModelLabel('hermes-4')).toBe('Hermes 4')
  })

  it('prettifies unknown ids as a readable fallback', () => {
    expect(humanizeModelLabel('some-local-model')).toBe('Some Local Model')
  })

  it('returns a neutral label for empty input', () => {
    expect(humanizeModelLabel('')).toBe('agent')
  })
})
