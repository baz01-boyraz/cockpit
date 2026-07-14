/**
 * Terminal output sanitization (pure, testable).
 *
 * Raw PTY output is full of ANSI escape sequences — colours (SGR), but also
 * cursor movement and screen-erase codes emitted by full-screen TUI programs
 * (Claude/Codex CLIs, vim, etc.) that repaint the screen many times a second.
 *
 * For the logs/error-intelligence pipeline we want plain, human-readable text:
 * keep the words, drop the control codes, and entirely discard chunks that are
 * just interactive redraw noise (they are not log lines and only produce
 * garbage + false-positive insights).
 *
 * Regexes are built with the RegExp constructor and string escapes so the
 * source file itself never embeds literal control bytes.
 */

// Matches ANSI escape sequences: CSI/SGR colour codes, OSC strings, etc.
// Adapted from the `ansi-regex` package (MIT).
const ANSI_PATTERN = new RegExp(
  [
    '[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d/#&.:=?%@~_]*)*)?\\u0007)',
    '(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))',
  ].join('|'),
  'g',
)

// Stray control characters (NUL..BS, VT, FF, SO..US, DEL). Tab (\x09) and
// newlines (\x0A/\x0D) are intentionally excluded — tabs become spaces below,
// newlines are split out by the caller before sanitizing.
// eslint-disable-next-line no-control-regex -- matching control bytes is the point
const CONTROL_CHARS_GLOBAL = new RegExp('[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]', 'g')
// eslint-disable-next-line no-control-regex -- matching control bytes is the point
const CONTROL_CHARS_TEST = new RegExp('[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]')

// A CSI escape whose final byte is a cursor-movement / erase / mode command
// (anything except `m`, the colour/SGR command). Lines carrying these are TUI
// repaint frames, not log output.
// eslint-disable-next-line no-control-regex -- matching the ESC byte is the point
const CURSOR_CONTROL = new RegExp('\\u001B\\[[0-9;?]*[A-HJKSTfhlsu]')

// A PTY chunk can begin halfway through an SGR sequence. With the ESC and
// opening parameter lost, stripAnsi cannot recognize the remainder; it looks
// like ordinary source text and can self-match words such as "eslint|error".
const ORPHANED_SGR_PREFIX = /^;\d+(?:;\d+)*m/

// Chromium logs this exact self-recovery when Electron's network helper is
// restarted. It is useful renderer diagnostics, but not an application/deploy
// failure and therefore must never enter error intelligence or Sentinel.
const ELECTRON_NETWORK_SERVICE_RECOVERY =
  /\b(?:content\/browser\/)?network_service_instance_impl\.cc(?::\d+|\(\d+\))\]\s+Network service crashed(?: or was terminated)?,\s*restarting service\.?$/i

/** Known transport/repaint chatter with no owner action. Kept narrow: each
 * signature is an exact runtime shape observed in Cockpit, not a generic
 * suppression of words such as "network" or "crashed". */
export function isNonActionableLogLine(clean: string): boolean {
  const line = clean.trim()
  return ORPHANED_SGR_PREFIX.test(line) || ELECTRON_NETWORK_SERVICE_RECOVERY.test(line)
}

/** Remove ANSI escape sequences and stray control characters from a string. */
export function stripAnsi(input: string): string {
  return input.replace(ANSI_PATTERN, '').replace(CONTROL_CHARS_GLOBAL, '').replace(/\t/g, ' ')
}

/**
 * True when a raw line contains cursor-movement / screen-erase control codes,
 * i.e. it is part of an interactive TUI repaint rather than a real log line.
 */
export function hasCursorControl(raw: string): boolean {
  return CURSOR_CONTROL.test(raw)
}

/**
 * True when a sanitized line carries no useful signal: empty, leftover control
 * bytes, or dominated by punctuation/escape debris rather than real words.
 */
export function looksLikeGarbage(clean: string): boolean {
  const s = clean.trim()
  if (s.length < 2) return true
  if (CONTROL_CHARS_TEST.test(s)) return true
  const meaningful = (s.match(/[\p{L}\p{N}]/gu) ?? []).length
  return meaningful / s.length < 0.45
}

/**
 * Split a raw PTY chunk into candidate log lines. Splits on newlines and lone
 * carriage returns (TUI progress redraws use `\r` to overwrite a line).
 */
export function splitRawChunk(rawChunk: string): string[] {
  return rawChunk.split(/\r\n|\r|\n/)
}

/**
 * Turn a raw PTY chunk into clean, human-readable log lines, dropping TUI
 * repaint frames and garbage. The result is safe to persist and pattern-match.
 */
export function sanitizeChunkToLines(rawChunk: string): string[] {
  const out: string[] = []
  for (const raw of splitRawChunk(rawChunk)) {
    if (raw.trim().length === 0) continue
    if (hasCursorControl(raw)) continue
    const clean = stripAnsi(raw).trim()
    if (isNonActionableLogLine(clean)) continue
    if (looksLikeGarbage(clean)) continue
    out.push(clean)
  }
  return out
}

/** Clean a single already-stored line for display; returns null if it is noise. */
export function sanitizeStoredLine(message: string): string | null {
  if (hasCursorControl(message)) return null
  const clean = stripAnsi(message).trim()
  if (isNonActionableLogLine(clean)) return null
  if (looksLikeGarbage(clean)) return null
  return clean
}

// --- Full-screen TUI detection (alt-screen / repainting agents) ---------------
//
// Interactive agent CLIs (Claude/Codex), pagers, and editors repaint the screen
// thousands of times a session. Each frame *renders the project's own source*
// (diffs, file previews, this very pattern file) — text that legitimately
// contains words like "build failed" or "Cannot find module". Per-line ANSI
// stripping cannot tell that boxed source text from a real tool error, because
// the frame's control prefix (cursor home/hide) is split onto a different line
// than the visible words. The only reliable discriminator is *mode*: was the
// pane mid-repaint when the bytes were emitted? We track that across chunks and
// suppress ingestion entirely while a TUI frame is being painted, so the error
// matchers never see a pane echoing the codebase back at itself.

// Each regex matches the ESC byte; disabling no-control-regex is the point.
/* eslint-disable no-control-regex */
// Alternate-screen enter/leave (vim, less, full-screen apps).
const TUI_ENTER = new RegExp('\\u001B\\[\\?(?:1049|1047|47)h', 'g')
const TUI_LEAVE = new RegExp('\\u001B\\[\\?(?:1049|1047|47)l', 'g')
// Cursor hide/show brackets every inline repaint frame (ink-based agent CLIs
// render in the normal buffer, so alt-screen toggles never appear for them).
const CURSOR_HIDE = new RegExp('\\u001B\\[\\?25l', 'g')
const CURSOR_SHOW = new RegExp('\\u001B\\[\\?25h', 'g')
// Full-screen 2D addressing — cursor home, clear-screen, absolute positioning.
// Line-oriented tools (tsc, vitest, npm, git, eslint) never emit these; their
// presence in a chunk is an unambiguous repaint, suppressible on its own.
const FULLSCREEN_REPAINT = new RegExp('\\u001B\\[(?:2J|H|[0-9]+;[0-9]+[Hf])')
/* eslint-enable no-control-regex */

/** Per-pane scan state threaded across consecutive PTY chunks. */
export interface TerminalScanState {
  /** True while the pane is mid-render of a full-screen / repainting TUI frame. */
  tuiActive: boolean
}

export interface TerminalScanResult {
  state: TerminalScanState
  /** True when this chunk is TUI repaint noise and must not be ingested. */
  suppress: boolean
}

/** Initial scan state for a freshly-opened pane. */
export function initialTerminalScanState(): TerminalScanState {
  return { tuiActive: false }
}

/** Index of the last match of `re` in `s`, or -1. Mutates only `re.lastIndex`. */
function lastIndexOfMatch(s: string, re: RegExp): number {
  re.lastIndex = 0
  let idx = -1
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    idx = m.index
    if (m.index === re.lastIndex) re.lastIndex++
  }
  return idx
}

/**
 * Decide whether a raw PTY chunk is full-screen TUI repaint noise, threading the
 * alt-screen / repaint mode across chunks. A chunk is suppressed when the pane
 * was already mid-frame, when this chunk *enters* a repaint, or when it carries
 * full-screen addressing. The returned state reflects the mode after this chunk
 * (the last enter/leave marker wins), so a frame fragmented across chunks stays
 * suppressed until the cursor is shown / the alternate screen is left.
 */
export function scanTerminalChunk(rawChunk: string, prev: TerminalScanState): TerminalScanResult {
  const lastEnter = Math.max(
    lastIndexOfMatch(rawChunk, TUI_ENTER),
    lastIndexOfMatch(rawChunk, CURSOR_HIDE),
  )
  const lastLeave = Math.max(
    lastIndexOfMatch(rawChunk, TUI_LEAVE),
    lastIndexOfMatch(rawChunk, CURSOR_SHOW),
  )
  let tuiActive = prev.tuiActive
  if (lastEnter >= 0 || lastLeave >= 0) tuiActive = lastEnter > lastLeave
  const suppress = prev.tuiActive || lastEnter >= 0 || FULLSCREEN_REPAINT.test(rawChunk)
  return { state: { tuiActive }, suppress }
}
