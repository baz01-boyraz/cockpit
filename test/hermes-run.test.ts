import { describe, expect, it } from 'vitest'
import { buildHermesArgs } from '@shared/hermes-run'

describe('buildHermesArgs', () => {
  it('defaults to a bare one-shot run', () => {
    expect(buildHermesArgs('hello')).toEqual(['-z', 'hello'])
  })

  it('adds a provider override before the prompt', () => {
    expect(buildHermesArgs('hi', { provider: 'anthropic' })).toEqual([
      '--provider',
      'anthropic',
      '-z',
      'hi',
    ])
  })

  it('adds a model override', () => {
    expect(buildHermesArgs('hi', { model: 'claude-opus-4-8' })).toEqual([
      '-m',
      'claude-opus-4-8',
      '-z',
      'hi',
    ])
  })

  it('joins, trims, and de-duplicates skills into a csv flag', () => {
    expect(buildHermesArgs('hi', { skills: [' obsidian ', 'design-md', 'obsidian'] })).toEqual([
      '--skills',
      'obsidian,design-md',
      '-z',
      'hi',
    ])
  })

  it('joins toolsets into a -t flag', () => {
    expect(buildHermesArgs('hi', { toolsets: ['files', 'web'] })).toEqual([
      '-t',
      'files,web',
      '-z',
      'hi',
    ])
  })

  it('omits flags for empty or whitespace-only values', () => {
    expect(buildHermesArgs('hi', { provider: '  ', skills: [], toolsets: ['', '  '] })).toEqual([
      '-z',
      'hi',
    ])
  })

  it('combines every override in a stable order', () => {
    expect(
      buildHermesArgs('q', {
        provider: 'anthropic',
        model: 'claude-opus-4-8',
        skills: ['obsidian'],
        toolsets: ['files'],
      }),
    ).toEqual([
      '--provider',
      'anthropic',
      '-m',
      'claude-opus-4-8',
      '--skills',
      'obsidian',
      '-t',
      'files',
      '-z',
      'q',
    ])
  })
})
