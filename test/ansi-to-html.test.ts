import { describe, expect, it } from 'vitest'
import { ansi256ToHex, ansiToHtml } from '@shared/ansi-to-html'

describe('ansi256ToHex', () => {
  it('maps the 16 base colours', () => {
    expect(ansi256ToHex(0)).toBe('#14161c')
    expect(ansi256ToHex(7)).toBe('#ece6da')
    expect(ansi256ToHex(15)).toBe('#ffffff')
  })

  it('maps the 6×6×6 colour cube', () => {
    expect(ansi256ToHex(16)).toBe('#000000') // cube origin
    expect(ansi256ToHex(231)).toBe('#ffffff') // cube corner
    expect(ansi256ToHex(208)).toBe('#ff8700') // orange used by the mock banner
  })

  it('maps the greyscale ramp', () => {
    expect(ansi256ToHex(232)).toBe('#080808')
    expect(ansi256ToHex(255)).toBe('#eeeeee')
  })

  it('clamps out-of-range indices to a safe default', () => {
    expect(ansi256ToHex(-1)).toBe('#ece6da')
    expect(ansi256ToHex(999)).toBe('#ece6da')
  })
})

describe('ansiToHtml', () => {
  it('returns plain text unchanged when there is no colour', () => {
    expect(ansiToHtml('hello world')).toBe('hello world')
  })

  it('HTML-escapes special characters to prevent injection', () => {
    expect(ansiToHtml('<script>&"</script>')).toBe('&lt;script&gt;&amp;"&lt;/script&gt;')
  })

  it('wraps 256-colour text in a coloured span and closes it on reset', () => {
    const html = ansiToHtml('\x1b[38;5;150m✓ ok\x1b[0m done')
    expect(html).toBe('<span style="color:#afd787">✓ ok</span> done')
  })

  it('renders a standard foreground colour', () => {
    expect(ansiToHtml('\x1b[31mred\x1b[0m')).toBe('<span style="color:#e2563d">red</span>')
  })

  it('renders bold and dim as weight/opacity', () => {
    expect(ansiToHtml('\x1b[1mbold\x1b[0m')).toBe('<span style="font-weight:600">bold</span>')
    expect(ansiToHtml('\x1b[2mdim\x1b[0m')).toBe('<span style="opacity:0.6">dim</span>')
  })

  it('renders a 24-bit truecolour foreground', () => {
    expect(ansiToHtml('\x1b[38;2;255;136;0morange\x1b[0m')).toBe(
      '<span style="color:#ff8800">orange</span>',
    )
  })

  it('strips cursor moves and other CSI sequences while keeping the text', () => {
    expect(ansiToHtml('a\x1b[2Kb\x1b[10;5Hc')).toBe('abc')
  })

  it('strips an embedded OSC string', () => {
    expect(ansiToHtml('a\x1b]0;title\x07b')).toBe('ab')
  })

  it('preserves newlines and drops carriage returns', () => {
    expect(ansiToHtml('line1\r\nline2')).toBe('line1\nline2')
  })
})
