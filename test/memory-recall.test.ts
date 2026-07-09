import { describe, expect, it } from 'vitest'
import {
  composeMemoryPointerBlock,
  rankNotes,
  tokenize,
  type RankableNote,
} from '@shared/memory-recall'

describe('tokenize', () => {
  it('lowercases, splits on punctuation, drops short + stopwords', () => {
    expect(tokenize('The login-form Validation!')).toEqual(['login', 'form', 'validation'])
  })

  it('keeps Turkish letters inside tokens (no shattering on ç/ğ/ı/ö/ş/ü)', () => {
    // "değildir" must survive whole; "önbellek" (cache) too. Stopwords like "için"
    // and short words like "ve" are dropped, real words are kept intact.
    expect(tokenize('önbellek temizleme için gerekli değildir ve yavaş')).toEqual([
      'önbellek',
      'temizleme',
      'gerekli',
      'değildir',
      'yavaş',
    ])
  })

  it('is empty-safe', () => {
    expect(tokenize('')).toEqual([])
    expect(tokenize('  ,. -- ')).toEqual([])
  })
})

describe('rankNotes', () => {
  const notes: RankableNote[] = [
    // newest-first input order
    { name: 'deploy-pipeline', hook: 'how railway deploys the service' },
    { name: 'login-form-validation', hook: 'the login form rejects empty fields' },
    { name: 'usage-billing', hook: 'the usage billing window math' },
  ]

  it('an exact NAME hit outranks a hook-only hit', () => {
    const ranked = rankNotes('fix the login form', notes, 5)
    // "login" + "form" both hit login-form-validation's NAME (×2 each) — it wins,
    // even over a note whose hook merely mentions the words.
    expect(ranked[0].name).toBe('login-form-validation')
  })

  it('zero-overlap query preserves recency (input) order', () => {
    const ranked = rankNotes('completely unrelated xyzzy', notes, 5)
    expect(ranked.map((n) => n.name)).toEqual([
      'deploy-pipeline',
      'login-form-validation',
      'usage-billing',
    ])
  })

  it('score-0 notes fill the remaining slots after the matches (recency floor)', () => {
    const ranked = rankNotes('billing', notes, 3)
    // usage-billing matches; the other two are score 0 and keep input order.
    expect(ranked.map((n) => n.name)).toEqual([
      'usage-billing',
      'deploy-pipeline',
      'login-form-validation',
    ])
  })

  it('respects the limit', () => {
    expect(rankNotes('login', notes, 1)).toHaveLength(1)
    expect(rankNotes('login', notes, 0)).toEqual([])
  })

  it('is safe on empty notes / empty query and normalizes hook to null', () => {
    expect(rankNotes('anything', [], 5)).toEqual([])
    const ranked = rankNotes('', [{ name: 'solo' }], 5)
    expect(ranked).toEqual([{ name: 'solo', hook: null }])
  })

  it('ranks a Turkish query sanely against Turkish hooks', () => {
    const tr: RankableNote[] = [
      { name: 'guncelleme-notu', hook: 'deploy sonrası doğrulama' },
      { name: 'onbellek-temizleme', hook: 'önbellek temizleme neden gerekli' },
    ]
    const ranked = rankNotes('önbellek temizleme gerekli mi', tr, 2)
    expect(ranked[0].name).toBe('onbellek-temizleme')
  })
})

describe('composeMemoryPointerBlock', () => {
  const notes: RankableNote[] = [
    { name: 'login-form-validation', hook: 'the login form rejects empty fields' },
    { name: 'deploy-pipeline', hook: null },
  ]

  it('renders the top notes as `name — hook`, labeled as trusted project memory', () => {
    const block = composeMemoryPointerBlock('login form', notes, { maxNotes: 5 })
    expect(block).not.toBeNull()
    expect(block).toMatch(/Project memory pointers/)
    expect(block).toMatch(/- login-form-validation — the login form rejects empty fields/)
  })

  it('renders a hook-less note as just its name', () => {
    const block = composeMemoryPointerBlock('deploy', [{ name: 'deploy-pipeline', hook: null }], {})
    expect(block).toMatch(/- deploy-pipeline$/m)
  })

  it('returns null when there are no notes', () => {
    expect(composeMemoryPointerBlock('x', [], {})).toBeNull()
  })

  it('caps the TOTAL length to maxChars', () => {
    const many: RankableNote[] = Array.from({ length: 50 }, (_, i) => ({
      name: `note-${i}`,
      hook: 'x'.repeat(100),
    }))
    const block = composeMemoryPointerBlock('note', many, { maxNotes: 50, maxChars: 300 })
    expect(block).not.toBeNull()
    expect((block ?? '').length).toBeLessThanOrEqual(300)
  })

  it('strips control chars out of a hook before inlining it', () => {
    // ESC (0x1B), a bell (0x07), and a raw CR/newline between the words — none may
    // survive into the prompt (built via char codes so no literal control byte
    // appears in this source file).
    const raw = `clean${String.fromCharCode(0x1b)}text${String.fromCharCode(0x07)}here\r\nline2`
    const block = composeMemoryPointerBlock('weird', [{ name: 'weird', hook: raw }], {})
    expect(block).toContain('clean text here line2')
    const hasControl = [...(block ?? '')].some((c) => {
      const code = c.charCodeAt(0)
      return (
        (code >= 0 && code <= 8) ||
        code === 0x0b ||
        code === 0x0c ||
        (code >= 0x0e && code <= 0x1f) ||
        code === 0x7f
      )
    })
    expect(hasControl).toBe(false)
  })
})
