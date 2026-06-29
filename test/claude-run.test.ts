import { describe, expect, it } from 'vitest'
import { buildClaudeArgs } from '@shared/claude-run'

describe('buildClaudeArgs', () => {
  it('prints the prompt non-interactively with no model override', () => {
    expect(buildClaudeArgs('hello')).toEqual(['--print', 'hello'])
  })

  it('passes the picked model before the prompt', () => {
    expect(buildClaudeArgs('hi', { model: 'opus' })).toEqual(['--print', '--model', 'opus', 'hi'])
  })

  it('ignores a blank model override', () => {
    expect(buildClaudeArgs('hi', { model: '   ' })).toEqual(['--print', 'hi'])
  })

  it('keeps the prompt as a single argv entry (no shell, no escaping)', () => {
    const prompt = 'rm -rf / ; echo "$(whoami)" && `id`'
    expect(buildClaudeArgs(prompt, { model: 'sonnet' })).toEqual([
      '--print',
      '--model',
      'sonnet',
      prompt,
    ])
  })
})
