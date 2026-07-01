/**
 * Minimal, dependency-free ANSI → HTML renderer for captured command-block output.
 *
 * The Blocks view shows the output a command produced between its OSC 133 `C` and
 * `D` marks. That text still carries SGR colour codes (`ESC [ … m`); this module
 * turns the common ones into `<span style="color:#…">` while stripping every other
 * escape (cursor moves, other OSC strings) and HTML-escaping the visible text.
 *
 * Security: colours come from a fixed palette computed here, never from the input,
 * and all text is HTML-escaped — the returned string is safe to inject as HTML.
 * It is pure (no DOM), so both the renderer and unit tests can use it.
 */

// 16 base colours mirror the live xterm theme in `TerminalView` for visual parity.
const BASE_16 = [
  '#14161c', '#e2563d', '#93c46a', '#e3a93f', '#6fa8c4', '#c08bd0', '#5fb3b3', '#ece6da',
  '#645f57', '#f0786a', '#c4e35a', '#f0c06a', '#8fc4dc', '#d6a8e0', '#8fd6d6', '#ffffff',
]

function hex2(n: number): string {
  return n.toString(16).padStart(2, '0')
}

/** Map an xterm 256-colour index to a hex string (base 16 + 6×6×6 cube + greyscale). */
export function ansi256ToHex(index: number): string {
  if (index < 0 || index > 255) return BASE_16[7]
  if (index < 16) return BASE_16[index]
  if (index < 232) {
    const n = index - 16
    const r = Math.floor(n / 36)
    const g = Math.floor((n % 36) / 6)
    const b = n % 6
    const c = (v: number) => (v === 0 ? 0 : 55 + v * 40)
    return `#${hex2(c(r))}${hex2(c(g))}${hex2(c(b))}`
  }
  const v = 8 + (index - 232) * 10
  return `#${hex2(v)}${hex2(v)}${hex2(v)}`
}

interface SgrState {
  fg: string | null
  bold: boolean
  dim: boolean
}

function emptyState(): SgrState {
  return { fg: null, bold: false, dim: false }
}

function isDefault(s: SgrState): boolean {
  return s.fg === null && !s.bold && !s.dim
}

/** Apply one SGR sequence's numeric params to the running state (immutable copy). */
function applySgr(prev: SgrState, params: number[]): SgrState {
  const next: SgrState = { ...prev }
  for (let i = 0; i < params.length; i++) {
    const p = params[i]
    if (p === 0) {
      next.fg = null
      next.bold = false
      next.dim = false
    } else if (p === 1) next.bold = true
    else if (p === 2) next.dim = true
    else if (p === 22) {
      next.bold = false
      next.dim = false
    } else if (p === 39) next.fg = null
    else if (p >= 30 && p <= 37) next.fg = BASE_16[p - 30]
    else if (p >= 90 && p <= 97) next.fg = BASE_16[p - 90 + 8]
    else if (p === 38) {
      if (params[i + 1] === 5) {
        next.fg = ansi256ToHex(params[i + 2] ?? 7)
        i += 2
      } else if (params[i + 1] === 2) {
        const r = params[i + 2] ?? 0
        const g = params[i + 3] ?? 0
        const b = params[i + 4] ?? 0
        next.fg = `#${hex2(r & 255)}${hex2(g & 255)}${hex2(b & 255)}`
        i += 4
      }
    }
  }
  return next
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (ch) => (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : '&gt;'))
}

function openSpan(s: SgrState): string {
  const styles: string[] = []
  if (s.fg) styles.push(`color:${s.fg}`)
  if (s.bold) styles.push('font-weight:600')
  if (s.dim) styles.push('opacity:0.6')
  return `<span style="${styles.join(';')}">`
}

function segment(text: string, s: SgrState): string {
  if (!text) return ''
  const safe = escapeHtml(text)
  return isDefault(s) ? safe : `${openSpan(s)}${safe}</span>`
}

const ESC = '\x1b'
const BEL = '\x07'

/**
 * Render ANSI-coloured terminal output as an HTML fragment. Newlines are preserved
 * verbatim (the Blocks view renders inside a `pre`), carriage returns are dropped,
 * and any escape sequence that is not an SGR colour is stripped.
 */
export function ansiToHtml(input: string): string {
  const normalized = input.replace(/\r\n/g, '\n').replace(/\r/g, '')
  let state = emptyState()
  let out = ''
  let i = 0

  while (i < normalized.length) {
    const esc = normalized.indexOf(ESC, i)
    if (esc === -1) {
      out += segment(normalized.slice(i), state)
      break
    }
    out += segment(normalized.slice(i, esc), state)

    const next = normalized[esc + 1]
    if (next === '[') {
      // CSI: ESC [ params letter. Only the 'm' (SGR) form changes colour.
      // eslint-disable-next-line no-control-regex
      const m = /^\x1b\[([0-9;]*)([ -/]*)([@-~])/.exec(normalized.slice(esc))
      if (!m) {
        i = esc + 1
        continue
      }
      if (m[3] === 'm') {
        const params = m[1] === '' ? [0] : m[1].split(';').map((p) => Number.parseInt(p, 10) || 0)
        state = applySgr(state, params)
      }
      i = esc + m[0].length
    } else if (next === ']') {
      // OSC string: skip to BEL or ST terminator.
      const belAt = normalized.indexOf(BEL, esc)
      const stAt = normalized.indexOf(`${ESC}\\`, esc)
      const end = [belAt, stAt].filter((n) => n >= 0).sort((a, b) => a - b)[0]
      i = end === undefined ? normalized.length : end + (end === stAt ? 2 : 1)
    } else {
      // Some other two-byte escape; drop it.
      i = esc + 2
    }
  }

  return out
}
