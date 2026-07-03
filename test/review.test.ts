import { describe, expect, it } from 'vitest'
import { sanitizeDiff } from '@shared/diff-sanitize'
import { buildReviewPrompt, parseFindings } from '@shared/review'

const sanitized = sanitizeDiff([
  { path: 'src/app.ts', diff: '+const stripe = "sk_live_51H2eKLAbCdEfGh123456"' },
  { path: '.env', diff: '+SECRET=1' },
  { path: 'package-lock.json', diff: '+x\n-y' },
])

describe('buildReviewPrompt', () => {
  const prompt = buildReviewPrompt(sanitized, { fenceTag: 'FENCE-abc123', projectName: 'cockpiT' })

  it('fences the diff and declares it untrusted data', () => {
    // Opening and closing fence around the payload.
    expect(prompt.split('FENCE-abc123').length).toBeGreaterThanOrEqual(3)
    expect(prompt).toMatch(/untrusted/i)
    expect(prompt).toMatch(/never follow|do not follow/i)
  })

  it('reports blocked/summarized counts without leaking content', () => {
    expect(prompt).toMatch(/1 sensitive file/i)
    expect(prompt).not.toContain('SECRET=1')
    expect(prompt).not.toContain('sk_live_')
    expect(prompt).toContain('[REDACTED]')
  })

  it('demands a strict JSON-array reply', () => {
    expect(prompt).toMatch(/JSON array/i)
    expect(prompt).toMatch(/severity/)
  })
})

describe('parseFindings', () => {
  it('parses a clean JSON array', () => {
    const out = parseFindings(
      '[{"severity":"high","file":"src/app.ts","line":3,"title":"Hardcoded key","detail":"Move to env."}]',
    )
    expect(out.raw).toBeNull()
    expect(out.findings).toHaveLength(1)
    expect(out.findings[0]).toMatchObject({ severity: 'high', file: 'src/app.ts', line: 3 })
  })

  it('extracts the array from surrounding prose', () => {
    const out = parseFindings(
      'Here is my review:\n[{"severity":"low","title":"Nit","detail":"style"}]\nHope this helps!',
    )
    expect(out.findings).toHaveLength(1)
    expect(out.findings[0].file).toBeNull()
  })

  it('drops malformed entries but keeps valid ones', () => {
    const out = parseFindings(
      '[{"severity":"nope","title":"bad"},{"severity":"medium","title":"ok","detail":"d"}]',
    )
    expect(out.findings).toHaveLength(1)
    expect(out.findings[0].severity).toBe('medium')
  })

  it('degrades to raw text when nothing parses', () => {
    const out = parseFindings('I could not produce JSON, sorry — but the code looks fine.')
    expect(out.findings).toEqual([])
    expect(out.raw).toContain('looks fine')
  })

  it('treats an empty array as a clean pass', () => {
    const out = parseFindings('[]')
    expect(out.findings).toEqual([])
    expect(out.raw).toBeNull()
  })

  it('normalizes uppercase severities from a loose model', () => {
    const out = parseFindings('[{"severity":"HIGH","title":"Case","detail":"d"}]')
    expect(out.findings).toHaveLength(1)
    expect(out.findings[0].severity).toBe('high')
  })

  it('accepts a {"findings":[…]} object root', () => {
    const out = parseFindings('{"findings":[{"severity":"low","title":"Obj root","detail":"d"}]}')
    expect(out.findings).toHaveLength(1)
    expect(out.raw).toBeNull()
  })

  it('accepts markdown-fenced JSON', () => {
    const out = parseFindings('```json\n[{"severity":"medium","title":"Fenced","detail":"d"}]\n```')
    expect(out.findings).toHaveLength(1)
  })

  it('coerces a numeric-string line', () => {
    const out = parseFindings('[{"severity":"low","file":"a.ts","line":"42","title":"t","detail":"d"}]')
    expect(out.findings[0].line).toBe(42)
  })
})
