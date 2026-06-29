import { describe, expect, it } from 'vitest'
import { friendlyProvider, parseHermesAuthList } from '@shared/hermes-auth'

const REAL = `copilot (1 credentials):
  #1  gh auth token        api_key gh_cli ←

openai-codex (1 credentials):
  #1  device_code          oauth   device_code ←

openrouter (1 credentials):
  #1  OPENROUTER_API_KEY   api_key env:OPENROUTER_API_KEY ←
`

describe('parseHermesAuthList', () => {
  it('extracts each authed provider and its credential count', () => {
    expect(parseHermesAuthList(REAL)).toEqual([
      { id: 'copilot', credentials: 1 },
      { id: 'openai-codex', credentials: 1 },
      { id: 'openrouter', credentials: 1 },
    ])
  })

  it('handles multiple credentials and singular wording', () => {
    const text = `anthropic (2 credentials):\nopenai (1 credential):\n`
    expect(parseHermesAuthList(text)).toEqual([
      { id: 'anthropic', credentials: 2 },
      { id: 'openai', credentials: 1 },
    ])
  })

  it('returns an empty list when nothing is configured', () => {
    expect(parseHermesAuthList('  No credentials configured.\n')).toEqual([])
  })
})

describe('friendlyProvider', () => {
  it('maps known providers to brand labels', () => {
    expect(friendlyProvider('anthropic')).toBe('Claude')
    expect(friendlyProvider('openai-codex')).toBe('Codex')
    expect(friendlyProvider('openrouter')).toBe('OpenRouter')
  })

  it('title-cases unknown provider ids', () => {
    expect(friendlyProvider('some-vendor')).toBe('Some Vendor')
  })
})
