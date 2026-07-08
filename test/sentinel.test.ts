import { describe, expect, it } from 'vitest'
import {
  SENTINEL_COOLDOWN_MS,
  buildSignal,
  shouldSuppress,
  signalFingerprint,
  type SentinelSource,
} from '../shared/sentinel'

describe('signalFingerprint', () => {
  it('is stable for the same project + source + title', () => {
    const a = signalFingerprint({ projectId: 'p1', source: 'approval', title: 'Force-push needs approval' })
    const b = signalFingerprint({ projectId: 'p1', source: 'approval', title: 'Force-push needs approval' })
    expect(a).toBe(b)
  })

  it('normalizes whitespace/case so trivially different renderings collide', () => {
    const a = signalFingerprint({ projectId: 'p1', source: 'council', title: 'Needs   CLARIFICATION' })
    const b = signalFingerprint({ projectId: 'p1', source: 'council', title: '  needs clarification ' })
    expect(a).toBe(b)
  })

  it('differs across project, source, or title', () => {
    const base = { projectId: 'p1', source: 'approval' as SentinelSource, title: 'x' }
    expect(signalFingerprint(base)).not.toBe(signalFingerprint({ ...base, projectId: 'p2' }))
    expect(signalFingerprint(base)).not.toBe(signalFingerprint({ ...base, source: 'council' }))
    expect(signalFingerprint(base)).not.toBe(signalFingerprint({ ...base, title: 'y' }))
  })

  it('does not let a project id bleed into the source field (delimited)', () => {
    // Without a delimiter, ("ab","c") and ("a","bc") would collide.
    const left = signalFingerprint({ projectId: 'ab', source: 'council', title: 't' })
    const right = signalFingerprint({ projectId: 'a', source: 'council', title: 't' })
    expect(left).not.toBe(right)
  })
})

describe('shouldSuppress', () => {
  const now = '2026-07-08T12:00:00.000Z'
  const candidate = { fingerprint: 'fp' }

  it('never suppresses against empty history', () => {
    expect(shouldSuppress([], candidate, now, SENTINEL_COOLDOWN_MS)).toBe(false)
  })

  it('suppresses a same-fingerprint signal inside the window', () => {
    const recent = new Date(Date.parse(now) - (SENTINEL_COOLDOWN_MS - 1)).toISOString()
    expect(shouldSuppress([{ fingerprint: 'fp', createdAt: recent }], candidate, now, SENTINEL_COOLDOWN_MS)).toBe(true)
  })

  it('does NOT suppress at exactly the cooldown boundary (exclusive)', () => {
    const exactly = new Date(Date.parse(now) - SENTINEL_COOLDOWN_MS).toISOString()
    expect(shouldSuppress([{ fingerprint: 'fp', createdAt: exactly }], candidate, now, SENTINEL_COOLDOWN_MS)).toBe(false)
  })

  it('does not suppress when the existing fingerprint differs', () => {
    const recent = new Date(Date.parse(now) - 1).toISOString()
    expect(shouldSuppress([{ fingerprint: 'other', createdAt: recent }], candidate, now, SENTINEL_COOLDOWN_MS)).toBe(false)
  })

  it('ignores unparseable timestamps rather than throwing', () => {
    expect(shouldSuppress([{ fingerprint: 'fp', createdAt: 'not-a-date' }], candidate, now, SENTINEL_COOLDOWN_MS)).toBe(false)
    expect(shouldSuppress([{ fingerprint: 'fp', createdAt: now }], candidate, 'nope', SENTINEL_COOLDOWN_MS)).toBe(false)
  })
})

describe('buildSignal', () => {
  const base = {
    id: 'sig_1',
    projectId: 'p1',
    severity: 'notice' as const,
    source: 'log-intelligence' as const,
    createdAt: '2026-07-08T12:00:00.000Z',
  }

  it('caps title (120), summary (300), and context (2000)', () => {
    const sig = buildSignal({
      ...base,
      title: 'T'.repeat(200),
      summary: 'S'.repeat(400),
      context: 'C'.repeat(3000),
    })
    expect(sig.title).toHaveLength(120)
    expect(sig.summary).toHaveLength(300)
    expect(sig.context).toHaveLength(2000)
  })

  it('strips C0 control characters and normalizes CRLF', () => {
    const sig = buildSignal({
      ...base,
      title: 'clean\x00ti\x07tle',
      summary: 'line1\r\nline2\x1b[0m',
      context: 'a\x08b',
    })
    expect(sig.title).toBe('cleantitle')
    expect(sig.summary).toBe('line1\nline2[0m')
    expect(sig.context).toBe('ab')
  })

  it('turns an empty or missing context into null', () => {
    expect(buildSignal({ ...base, title: 't', summary: 's', context: '   ' }).context).toBeNull()
    expect(buildSignal({ ...base, title: 't', summary: 's' }).context).toBeNull()
  })

  it('stamps status=new and a fingerprint from the untrimmed title', () => {
    const sig = buildSignal({ ...base, title: '  Build failed  ', summary: 's' })
    expect(sig.status).toBe('new')
    expect(sig.title).toBe('Build failed')
    expect(sig.fingerprint).toBe(
      signalFingerprint({ projectId: 'p1', source: 'log-intelligence', title: '  Build failed  ' }),
    )
  })
})
