import { describe, expect, it } from 'vitest'
import {
  CODEX_INTERACTIVE_COMMAND,
  buildAgentLaunchCommand,
  buildCodexResumeCommand,
  buildComposerMessage,
  buildTerminalComposerSubmission,
  buildTerminalHistorySuggestions,
  findNativeInputBarSpan,
  isTerminalCopyShortcut,
  normalizePromptDraft,
  rememberTerminalHistory,
  shouldRouteKeyToComposer,
} from '../shared/terminal-ux'

describe('Codex terminal UX', () => {
  it('launches interactive Codex inline so output stays in normal scrollback', () => {
    expect(CODEX_INTERACTIVE_COMMAND).toBe('codex --no-alt-screen')
    expect(buildCodexResumeCommand('session-123')).toBe(
      'codex --no-alt-screen resume session-123',
    )
  })

  it('launches Claude or Codex with a shell-quoted Sentinel investigation prompt', () => {
    const prompt = "Investigate: it's failing; $(touch /tmp/never)\nReport restart impact."

    expect(buildAgentLaunchCommand('claude', prompt)).toBe(
      "claude 'Investigate: it'\\''s failing; $(touch /tmp/never)\nReport restart impact.'",
    )
    expect(buildAgentLaunchCommand('codex', prompt)).toBe(
      "codex --no-alt-screen 'Investigate: it'\\''s failing; $(touch /tmp/never)\nReport restart impact.'",
    )
    expect(buildAgentLaunchCommand('claude')).toBe('claude')
    expect(buildAgentLaunchCommand('codex')).toBe(CODEX_INTERACTIVE_COMMAND)
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

  it('routes printable typing into the composer so the terminal has one writing place', () => {
    const keydown = { type: 'keydown', key: 'g', metaKey: false, ctrlKey: false, altKey: false }

    expect(shouldRouteKeyToComposer(keydown, { alternateScreen: false })).toBe(true)
    expect(
      shouldRouteKeyToComposer(
        { ...keydown, key: ' ' },
        { alternateScreen: false },
      ),
    ).toBe(true)
    // Shifted characters are still plain typing.
    expect(
      shouldRouteKeyToComposer(
        { ...keydown, key: 'G' },
        { alternateScreen: false },
      ),
    ).toBe(true)
    // keypress must be swallowed too or xterm still feeds the pty.
    expect(
      shouldRouteKeyToComposer(
        { ...keydown, type: 'keypress' },
        { alternateScreen: false },
      ),
    ).toBe(true)
  })

  it('keeps TUI navigation, chords, IME, and alt-screen apps on the terminal', () => {
    const keydown = { type: 'keydown', key: 'g', metaKey: false, ctrlKey: false, altKey: false }

    expect(
      shouldRouteKeyToComposer(
        { ...keydown, key: 'Enter' },
        { alternateScreen: false },
      ),
    ).toBe(false)
    expect(
      shouldRouteKeyToComposer(
        { ...keydown, key: 'ArrowDown' },
        { alternateScreen: false },
      ),
    ).toBe(false)
    expect(
      shouldRouteKeyToComposer(
        { ...keydown, key: 'c', ctrlKey: true },
        { alternateScreen: false },
      ),
    ).toBe(false)
    expect(
      shouldRouteKeyToComposer(
        { ...keydown, key: 'v', metaKey: true },
        { alternateScreen: false },
      ),
    ).toBe(false)
    expect(
      shouldRouteKeyToComposer(
        { ...keydown, altKey: true },
        { alternateScreen: false },
      ),
    ).toBe(false)
    expect(
      shouldRouteKeyToComposer(
        { ...keydown, isComposing: true },
        { alternateScreen: false },
      ),
    ).toBe(false)
    expect(
      shouldRouteKeyToComposer(
        { ...keydown, type: 'keyup' },
        { alternateScreen: false },
      ),
    ).toBe(false)
    // vim, htop & friends own the keyboard on the alternate screen.
    expect(shouldRouteKeyToComposer(keydown, { alternateScreen: true })).toBe(false)
  })

  it('finds a wide terminal-native input bar that contains the live cursor', () => {
    const paintedCells = Array.from({ length: 80 }, (_, index) => index >= 2 && index < 76)

    expect(findNativeInputBarSpan(paintedCells, 3)).toEqual({ start: 2, end: 76 })
  })

  it('does not mistake a short highlighted menu option for an input bar', () => {
    const paintedCells = Array.from({ length: 80 }, (_, index) => index >= 2 && index < 18)

    expect(findNativeInputBarSpan(paintedCells, 3)).toBeNull()
  })

  it('does not hide a wide terminal band when the cursor sits outside it', () => {
    const paintedCells = Array.from({ length: 80 }, (_, index) => index >= 10 && index < 75)

    expect(findNativeInputBarSpan(paintedCells, 2)).toBeNull()
  })

  it('finds an unpainted ghost prompt when its suggestion continues after the cursor', () => {
    const paintedCells = Array.from({ length: 80 }, () => false)
    const contentCells = Array.from(
      { length: 80 },
      (_, index) => index === 0 || (index >= 2 && index < 38),
    )

    expect(findNativeInputBarSpan(paintedCells, 2, contentCells)).toEqual({ start: 0, end: 38 })
  })

  it('keeps an ordinary shell prompt whose text ends at the cursor', () => {
    const paintedCells = Array.from({ length: 80 }, () => false)
    const contentCells = Array.from({ length: 80 }, (_, index) => index < 34)

    expect(findNativeInputBarSpan(paintedCells, 34, contentCells)).toBeNull()
  })

  it('folds staged image references into one composer message', () => {
    expect(buildComposerMessage('fix this screen', ['.dev-cockpit/attachments/a.png'])).toBe(
      'fix this screen\n\nAttached image: .dev-cockpit/attachments/a.png',
    )
    expect(
      buildComposerMessage('', ['.dev-cockpit/attachments/a.png', '.dev-cockpit/attachments/b.png']),
    ).toBe(
      'Attached image: .dev-cockpit/attachments/a.png\nAttached image: .dev-cockpit/attachments/b.png',
    )
    expect(buildComposerMessage('plain text', [])).toBe('plain text')
    expect(buildComposerMessage('  \n ', ['  '])).toBeNull()
    expect(buildComposerMessage('', [])).toBeNull()
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
