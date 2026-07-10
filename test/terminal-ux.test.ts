import { describe, expect, it } from 'vitest'
import {
  CODEX_INTERACTIVE_COMMAND,
  buildCodexResumeCommand,
  isTerminalCopyShortcut,
  normalizePromptDraft,
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
