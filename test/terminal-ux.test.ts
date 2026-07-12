import { describe, expect, it } from 'vitest'
import {
  CODEX_INTERACTIVE_COMMAND,
  buildCodexResumeCommand,
  buildTerminalComposerSubmission,
  buildTerminalHistorySuggestions,
  isTerminalCopyShortcut,
  normalizePromptDraft,
  rememberTerminalHistory,
} from '../shared/terminal-ux'

describe('Codex terminal UX', () => {
  it('launches interactive Codex inline so output stays in normal scrollback', () => {
    expect(CODEX_INTERACTIVE_COMMAND).toBe('codex --no-alt-screen')
    expect(buildCodexResumeCommand('session-123')).toBe(
      'codex --no-alt-screen resume session-123',
    )
  })

  it('keeps normal editor text while rejecting an empty prompt draft', () => {
    expect(normalizePromptDraft('first line\r\nsecond line')).toBe('first line\nsecond line')
    expect(normalizePromptDraft('  \n\t')).toBeNull()
  })

  it('sends the composer draft verbatim through terminal-native bracketed paste', () => {
    expect(buildTerminalComposerSubmission('git status\r\nnpm test', true)).toEqual({
      draft: 'git status\nnpm test',
      data: '\x1b[200~git status\rnpm test\x1b[201~\r',
      lineCount: 2,
    })
    expect(buildTerminalComposerSubmission('  npm test  ', false)).toEqual({
      draft: '  npm test  ',
      data: '  npm test  \r',
      lineCount: 1,
    })
    expect(buildTerminalComposerSubmission(' \n\t ', true)).toBeNull()
  })

  it('offers recent matching commands without duplicate noise', () => {
    const history = ['npm test', 'git status', 'npm test', 'npm run typecheck', 'Git log --oneline']

    expect(buildTerminalHistorySuggestions('', history, 3)).toEqual([
      'npm test',
      'git status',
      'npm run typecheck',
    ])
    expect(buildTerminalHistorySuggestions('git', history)).toEqual([
      'git status',
      'Git log --oneline',
    ])
  })

  it('moves a reused entry to the front and keeps history bounded', () => {
    expect(rememberTerminalHistory(['npm test', 'git status'], 'git status', 3)).toEqual([
      'git status',
      'npm test',
    ])
    expect(rememberTerminalHistory(['two', 'three', 'four'], 'one', 3)).toEqual([
      'one',
      'two',
      'three',
    ])
    expect(rememberTerminalHistory(['keep'], ' \n ')).toEqual(['keep'])
  })

  it('copies a selection with the platform shortcut without stealing Ctrl+C on macOS', () => {
    expect(
      isTerminalCopyShortcut(
        { key: 'c', metaKey: true, ctrlKey: false },
        { hasSelection: true, isMac: true },
      ),
    ).toBe(true)
    expect(
      isTerminalCopyShortcut(
        { key: 'c', metaKey: false, ctrlKey: true },
        { hasSelection: true, isMac: true },
      ),
    ).toBe(false)
    expect(
      isTerminalCopyShortcut(
        { key: 'c', metaKey: false, ctrlKey: true },
        { hasSelection: true, isMac: false },
      ),
    ).toBe(true)
    expect(
      isTerminalCopyShortcut(
        { key: 'c', metaKey: true, ctrlKey: false },
        { hasSelection: false, isMac: true },
      ),
    ).toBe(false)
  })
})
