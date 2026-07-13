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

/**
 * One writing place: printable typing aimed at the terminal is rerouted into
 * the composer instead of the pty. Navigation and control keys (Enter, arrows,
 * Escape, Ctrl/Cmd chords, Shift+Tab) still reach the foreground TUI so menus,
 * interrupts, and mode cycling keep working. Alternate-screen apps (vim, htop)
 * own the whole keyboard, and both keydown and keypress must be swallowed or
 * xterm still feeds the pty on the second event.
 */
export interface TerminalKeyStroke {
  type: string
  key: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  isComposing?: boolean
}

export function shouldRouteKeyToComposer(
  event: TerminalKeyStroke,
  opts: { alternateScreen: boolean },
): boolean {
  if (opts.alternateScreen) return false
  if (event.type !== 'keydown' && event.type !== 'keypress') return false
  if (event.isComposing) return false
  if (event.metaKey || event.ctrlKey || event.altKey) return false
  return event.key.length === 1
}

/**
 * Fold the draft and staged image references into one submission. Image paths
 * ride as short `Attached image:` lines after the text, so agents get a
 * readable file reference instead of a wall-of-path echo.
 */
export function buildComposerMessage(
  draft: string,
  attachmentPaths: readonly string[],
): string | null {
  const text = normalizePromptDraft(draft)
  const refs = attachmentPaths.map((path) => path.trim()).filter((path) => path.length > 0)
  if (refs.length === 0) return text
  const refBlock = refs.map((path) => `Attached image: ${path}`).join('\n')
  return text === null ? refBlock : `${text}\n\n${refBlock}`
}

export interface TerminalCopyKey {
  key: string
  metaKey: boolean
  ctrlKey: boolean
}

export interface NativeInputBarSpan {
  start: number
  end: number
}

/**
 * Locate a terminal-native input bar without confusing compact highlights
 * (selected menu rows, badges, progress cells) for a second composer.
 *
 * The bar must be one continuous painted run, contain the live cursor, and
 * occupy most of the terminal width. This keeps the visual mask role-neutral:
 * Codex and Claude can change colours without teaching cockpiT prompt strings,
 * while ordinary shell prompts and terminal menus remain untouched.
 */
export function findNativeInputBarSpan(
  paintedCells: readonly boolean[],
  cursorColumn: number,
): NativeInputBarSpan | null {
  if (
    paintedCells.length === 0 ||
    cursorColumn < 0 ||
    cursorColumn >= paintedCells.length ||
    !paintedCells[cursorColumn]
  ) {
    return null
  }

  let start = cursorColumn
  let end = cursorColumn + 1
  while (start > 0 && paintedCells[start - 1]) start -= 1
  while (end < paintedCells.length && paintedCells[end]) end += 1

  const minimumWidth = Math.max(18, Math.ceil(paintedCells.length * 0.55))
  return end - start >= minimumWidth ? { start, end } : null
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
