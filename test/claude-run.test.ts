import { describe, expect, it } from 'vitest'
import { buildClaudeArgs } from '@shared/claude-run'

describe('buildClaudeArgs', () => {
  it('prints the prompt non-interactively with no model override', () => {
    expect(buildClaudeArgs('hello')).toEqual(['--print', '--no-session-persistence', 'hello'])
  })

  it('passes the picked model before the prompt', () => {
    expect(buildClaudeArgs('hi', { model: 'opus' })).toEqual([
      '--print',
      '--no-session-persistence',
      '--model',
      'opus',
      'hi',
    ])
  })

  it('ignores a blank model override', () => {
    expect(buildClaudeArgs('hi', { model: '   ' })).toEqual(['--print', '--no-session-persistence', 'hi'])
  })

  it('never persists a session transcript, so automated one-shot calls cannot feed the memory-capture loop', () => {
    expect(buildClaudeArgs('hi')).toContain('--no-session-persistence')
  })

  it('rides extra instructions on --append-system-prompt, keeping the user prompt last and verbatim', () => {
    expect(buildClaudeArgs('user words', { systemPrompt: 'MEMORY CONTRACT' })).toEqual([
      '--print',
      '--no-session-persistence',
      '--append-system-prompt',
      'MEMORY CONTRACT',
      'user words',
    ])
    expect(buildClaudeArgs('hi', { systemPrompt: '   ' })).toEqual([
      '--print',
      '--no-session-persistence',
      'hi',
    ])
  })

  it('keeps the prompt as a single argv entry (no shell, no escaping)', () => {
    const prompt = 'rm -rf / ; echo "$(whoami)" && `id`'
    expect(buildClaudeArgs(prompt, { model: 'sonnet' })).toEqual([
      '--print',
      '--no-session-persistence',
      '--model',
      'sonnet',
      prompt,
    ])
  })
})
