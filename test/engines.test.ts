import { describe, expect, it } from 'vitest'
import { buildCodexArgs } from '@shared/engines'

const DEFAULT_ARGS = [
  'exec',
  '--skip-git-repo-check',
  '-s',
  'read-only',
  '--ephemeral',
  '--color',
  'never',
]

describe('buildCodexArgs', () => {
  it('emits the read-only, ephemeral one-shot flags with no model override', () => {
    expect(buildCodexArgs('hello')).toEqual([...DEFAULT_ARGS, 'hello'])
  })

  it('sandboxes and never persists a session by default', () => {
    const args = buildCodexArgs('hi')
    expect(args).toContain('read-only')
    expect(args).toContain('--ephemeral')
    // No approval-bypass flag ever appears.
    expect(args).not.toContain('--dangerously-bypass-approvals-and-sandbox')
  })

  it('inserts -m before the prompt when the model id is valid', () => {
    expect(buildCodexArgs('hi', { model: 'gpt-5-codex' })).toEqual([
      ...DEFAULT_ARGS,
      '-m',
      'gpt-5-codex',
      'hi',
    ])
  })

  it('accepts slug/colon punctuation real model ids use', () => {
    expect(buildCodexArgs('hi', { model: 'openai/o4-mini:latest' })).toContain('openai/o4-mini:latest')
  })

  it('treats an empty or blank model as "use the CLI default" (no -m)', () => {
    expect(buildCodexArgs('hi', { model: '' })).toEqual([...DEFAULT_ARGS, 'hi'])
    expect(buildCodexArgs('hi', { model: '   ' })).toEqual([...DEFAULT_ARGS, 'hi'])
  })

  it('ignores a hostile model id rather than passing it to argv', () => {
    for (const hostile of ['; rm -rf /', 'a b c', '$(whoami)', 'x'.repeat(65)]) {
      const args = buildCodexArgs('hi', { model: hostile })
      expect(args).not.toContain('-m')
      expect(args).not.toContain(hostile)
      expect(args).toEqual([...DEFAULT_ARGS, 'hi'])
    }
  })

  it('keeps the prompt as the final argv entry (no shell, no escaping)', () => {
    const prompt = 'rm -rf / ; echo "$(whoami)" && `id`'
    const args = buildCodexArgs(prompt, { model: 'gpt-5-codex' })
    expect(args[args.length - 1]).toBe(prompt)
  })

  it('can disable repository discovery and tool surfaces for evidence-only calls', () => {
    const args = buildCodexArgs('bounded evidence', {
      model: 'gpt-5-codex',
      evidenceOnly: true,
    })

    expect(args).toEqual([
      ...DEFAULT_ARGS,
      '--ignore-user-config',
      '--ignore-rules',
      '--disable',
      'shell_tool',
      '--disable',
      'unified_exec',
      '--disable',
      'shell_snapshot',
      '--disable',
      'apps',
      '--disable',
      'plugins',
      '--disable',
      'browser_use',
      '--disable',
      'computer_use',
      '--disable',
      'multi_agent',
      '-m',
      'gpt-5-codex',
      'bounded evidence',
    ])
  })
})
