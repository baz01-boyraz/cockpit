import { describe, expect, it } from 'vitest'
import {
  hasCursorControl,
  looksLikeGarbage,
  sanitizeChunkToLines,
  sanitizeStoredLine,
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
