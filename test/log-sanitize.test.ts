import { describe, expect, it } from 'vitest'
import {
  hasCursorControl,
  initialTerminalScanState,
  looksLikeGarbage,
  sanitizeChunkToLines,
  sanitizeStoredLine,
  scanTerminalChunk,
  stripAnsi,
} from '@shared/log-sanitize'

const ESC = '\u001b'

describe('stripAnsi', () => {
  it('removes SGR colour codes but keeps the text', () => {
    expect(stripAnsi(`${ESC}[31mError:${ESC}[0m boom`)).toBe('Error: boom')
  })

  it('removes cursor-movement and erase codes', () => {
    expect(stripAnsi(`${ESC}[52Ghello${ESC}[K${ESC}[2Cworld`)).toBe('helloworld')
  })

  it('removes truecolor SGR sequences', () => {
    expect(stripAnsi(`${ESC}[38;2;177;185;249mtypecheck${ESC}[39m`)).toBe('typecheck')
  })

  it('strips stray control bytes', () => {
    expect(stripAnsi('a\x07b\x08c')).toBe('abc')
  })
})

describe('hasCursorControl', () => {
  it('detects a TUI repaint frame', () => {
    expect(hasCursorControl(`${ESC}[2J${ESC}[H redraw`)).toBe(true)
    expect(hasCursorControl(`${ESC}[1Bsome line`)).toBe(true)
  })

  it('does not flag plain colour codes', () => {
    expect(hasCursorControl(`${ESC}[31mjust red${ESC}[0m`)).toBe(false)
  })
})

describe('looksLikeGarbage', () => {
  it('rejects empty or punctuation-only debris', () => {
    expect(looksLikeGarbage('')).toBe(true)
    expect(looksLikeGarbage('[ ][ ]  ; ;')).toBe(true)
  })

  it('keeps real log text', () => {
    expect(looksLikeGarbage('Error: Cannot find module foo')).toBe(false)
  })
})

describe('sanitizeChunkToLines', () => {
  it('drops TUI repaint frames and returns clean log lines', () => {
    const chunk = [
      `${ESC}[52Gengi, düşünce ${ESC}[K ${ESC}[2C redraw noise`,
      `${ESC}[31mError: Cannot find module 'framer-motion'${ESC}[0m`,
      `${ESC}[32m✓ build${ESC}[0m`,
    ].join('\n')
    const lines = sanitizeChunkToLines(chunk)
    expect(lines).toContain("Error: Cannot find module 'framer-motion'")
    expect(lines).toContain('✓ build')
    expect(lines.some((l) => l.includes('redraw noise'))).toBe(false)
  })

  it('splits lone carriage-return progress redraws', () => {
    expect(sanitizeChunkToLines('downloading 10%\rdownloading 50%\rdownloading 100%')).toEqual([
      'downloading 10%',
      'downloading 50%',
      'downloading 100%',
    ])
  })
})

describe('sanitizeStoredLine', () => {
  it('returns null for legacy cursor-control garbage', () => {
    expect(sanitizeStoredLine(`${ESC}[52Gengi ${ESC}[K ${ESC}[2C`)).toBeNull()
  })

  it('cleans a stored colourised line', () => {
    expect(sanitizeStoredLine(`${ESC}[33mwarning: deprecated${ESC}[0m`)).toBe('warning: deprecated')
  })
})

describe('scanTerminalChunk', () => {
  const fresh = () => initialTerminalScanState()

  it('passes plain line-oriented tool output through', () => {
    const r = scanTerminalChunk('npm run build\n✓ built in 126ms\n', fresh())
    expect(r.suppress).toBe(false)
    expect(r.state.tuiActive).toBe(false)
  })

  it('does not suppress a real coloured error line', () => {
    const r = scanTerminalChunk(`${ESC}[31mError: Cannot find module 'pg'${ESC}[39m\n`, fresh())
    expect(r.suppress).toBe(false)
  })

  it('suppresses a self-contained agent repaint frame and ends inactive', () => {
    // Hide cursor → home → boxed source text (the pattern file itself) → show.
    const frame = `${ESC}[?25l${ESC}[H│ build failed / Failed to compile / webpack ${ESC}[?25h`
    const r = scanTerminalChunk(frame, fresh())
    expect(r.suppress).toBe(true)
    expect(r.state.tuiActive).toBe(false)
  })

  it('suppresses on full-screen addressing alone (cursor home / absolute)', () => {
    expect(scanTerminalChunk(`${ESC}[2J${ESC}[H redraw`, fresh()).suppress).toBe(true)
    expect(scanTerminalChunk(`${ESC}[12;5HError: build failed`, fresh()).suppress).toBe(true)
  })

  it('stays suppressed across a fragmented frame until the cursor is shown', () => {
    // Chunk 1 enters a repaint (hide) but is split before the cursor is shown.
    const c1 = scanTerminalChunk(`${ESC}[?25l${ESC}[H some preview`, fresh())
    expect(c1.suppress).toBe(true)
    expect(c1.state.tuiActive).toBe(true)
    // Chunk 2 is pure on-screen text — no markers — but must still be dropped.
    const c2 = scanTerminalChunk(`│ build failed / Failed to compile │`, c1.state)
    expect(c2.suppress).toBe(true)
    expect(c2.state.tuiActive).toBe(true)
    // Chunk 3 shows the cursor: the frame ends, mode clears.
    const c3 = scanTerminalChunk(`more preview${ESC}[?25h`, c2.state)
    expect(c3.state.tuiActive).toBe(false)
    // Real output that follows is ingested again.
    const c4 = scanTerminalChunk('Error: Cannot find module foo\n', c3.state)
    expect(c4.suppress).toBe(false)
  })

  it('clears mode when the alternate screen is left', () => {
    const entered = scanTerminalChunk(`${ESC}[?1049h`, fresh())
    expect(entered.state.tuiActive).toBe(true)
    const left = scanTerminalChunk(`${ESC}[?1049l`, entered.state)
    expect(left.state.tuiActive).toBe(false)
  })
})
