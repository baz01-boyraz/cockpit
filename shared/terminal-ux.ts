/**
 * Shared Codex terminal affordances.
 *
 * Interactive Codex normally owns the terminal's alternate screen, which makes
 * scrollback feel as if it disappeared inside an embedded xterm. Inline mode
 * keeps every rendered turn in the normal buffer, so the cockpit's scroll and
 * selection controls work like users expect.
 */
export const CODEX_INTERACTIVE_COMMAND = 'codex --no-alt-screen'

export function buildCodexResumeCommand(sessionId: string): string {
  return `${CODEX_INTERACTIVE_COMMAND} resume ${sessionId}`
}

/** Preserve the draft exactly, apart from normalizing platform newlines. */
export function normalizePromptDraft(draft: string): string | null {
  const normalized = draft.replace(/\r\n?/g, '\n')
  return normalized.trim().length > 0 ? normalized : null
}

export interface TerminalCopyKey {
  key: string
  metaKey: boolean
  ctrlKey: boolean
}

/**
 * Cmd+C copies on macOS only when xterm has a selection. Bare Ctrl+C remains
 * an interrupt there; other platforms use the conventional Ctrl+C selection
 * shortcut. This is deliberately pure so the keyboard boundary stays tested.
 */
export function isTerminalCopyShortcut(
  event: TerminalCopyKey,
  opts: { hasSelection: boolean; isMac: boolean },
): boolean {
  if (!opts.hasSelection || event.key.toLowerCase() !== 'c') return false
  return opts.isMac ? event.metaKey : event.ctrlKey
}
