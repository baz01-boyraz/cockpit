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
    if (looksLikeGarbage(clean)) continue
    out.push(clean)
  }
  return out
}

/** Clean a single already-stored line for display; returns null if it is noise. */
export function sanitizeStoredLine(message: string): string | null {
  if (hasCursorControl(message)) return null
  const clean = stripAnsi(message).trim()
  if (looksLikeGarbage(clean)) return null
  return clean
}
