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

const BRACKETED_PASTE_START = '\x1b[200~'
const BRACKETED_PASTE_END = '\x1b[201~'

export interface TerminalComposerSubmission {
  /** Normalized user text, retained verbatim for history and UI feedback. */
  draft: string
  /** Bytes written to the pty, including the final Enter key. */
  data: string
  lineCount: number
}

/**
 * Build one atomic pty write from the editor draft.
 *
 * xterm converts pasted newlines to carriage returns and wraps the payload only
 * when the foreground program has enabled bracketed-paste mode. Mirroring that
 * contract here gives shell readline and full-screen agent TUIs the same safe
 * paste semantics as xterm's hidden textarea, without changing the user's text.
 */
export function buildTerminalComposerSubmission(
  draft: string,
  bracketedPasteMode: boolean,
): TerminalComposerSubmission | null {
  const normalized = normalizePromptDraft(draft)
  if (normalized === null) return null

  const terminalText = normalized.replace(/\n/g, '\r')
  const pasted = bracketedPasteMode
    ? `${BRACKETED_PASTE_START}${terminalText}${BRACKETED_PASTE_END}`
    : terminalText

  return {
    draft: normalized,
    data: `${pasted}\r`,
    lineCount: normalized.split('\n').length,
  }
}

/** Keep newest-first history compact while preserving the submitted text. */
export function rememberTerminalHistory(
  history: readonly string[],
  entry: string,
  limit = 80,
): string[] {
  const normalized = normalizePromptDraft(entry)
  if (normalized === null || limit <= 0) return [...history].slice(0, Math.max(0, limit))
  return [normalized, ...history.filter((item) => item !== normalized)].slice(0, limit)
}

/**
 * Search newest-first local and captured command history. Prefix hits lead
 * substring hits, duplicates collapse, and the source order breaks ties.
 */
export function buildTerminalHistorySuggestions(
  query: string,
  history: readonly string[],
  limit = 6,
): string[] {
  if (limit <= 0) return []
  const needle = query.trim().toLocaleLowerCase()
  const seen = new Set<string>()
  const unique = history.filter((item) => {
    const normalized = normalizePromptDraft(item)
    if (normalized === null || seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })

  if (!needle) return unique.slice(0, limit)

  return unique
    .map((item, index) => {
      const candidate = item.toLocaleLowerCase()
      const matchAt = candidate.indexOf(needle)
      return { item, index, matchAt }
    })
    .filter((match) => match.matchAt >= 0)
    .sort((a, b) => {
      const aPrefix = a.matchAt === 0 ? 0 : 1
      const bPrefix = b.matchAt === 0 ? 0 : 1
      return aPrefix - bPrefix || a.matchAt - b.matchAt || a.index - b.index
    })
    .slice(0, limit)
    .map((match) => match.item)
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
