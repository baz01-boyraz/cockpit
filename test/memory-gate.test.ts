import { describe, expect, it } from 'vitest'
import {
  GATE_OVERSIZE_CHARS,
  gateMemoryWrite,
  MIN_SCENARIO_CHARS,
  type GateInput,
  type MemoryWriteJustification,
} from '@shared/memory-gate'

const goodJustification = (
  over: Partial<MemoryWriteJustification> = {},
): MemoryWriteJustification => ({
  sevenDayScenario:
    'when someone hits posix_spawnp failed after a fresh npm install of node-pty',
  dedupChecked: 'no-overlap',
  targetNote: 'native-modules',
  evidence: 'the session where the spawn-helper exec bit was lost',
  ...over,
})

const input = (over: Partial<GateInput> = {}): GateInput => ({
  name: 'native-modules-spawn-helper',
  content: 'node-pty spawn-helper loses its exec bit on npm extraction; restore it in postinstall.',
  justification: goodJustification(),
  existingNames: [],
  ...over,
})

describe('gateMemoryWrite — accept', () => {
  it('accepts a justified, deduped, secret-free write', () => {
    const r = gateMemoryWrite(input())
    expect(r.verdict).toBe('accept')
    expect(r.reasons).toEqual([])
  })

  it('accepts an update to an existing note (dedupChecked=updates-existing) even on a name collision', () => {
    const r = gateMemoryWrite(
      input({
        name: 'native-modules',
        existingNames: ['native-modules', 'memory-hub'],
        justification: goodJustification({ dedupChecked: 'updates-existing' }),
      }),
    )
    expect(r.verdict).toBe('accept')
  })

  it('accepts content exactly at the oversize boundary', () => {
    const r = gateMemoryWrite(input({ content: 'x'.repeat(GATE_OVERSIZE_CHARS) }))
    expect(r.verdict).toBe('accept')
  })
})

describe('gateMemoryWrite — review (soft failures, never hard-reject a human)', () => {
  it('reviews a write with no justification', () => {
    const r = gateMemoryWrite(input({ justification: null }))
    expect(r.verdict).toBe('review')
    expect(r.reasons.join(' ')).toMatch(/no justification/)
  })

  it('reviews a write with undefined justification', () => {
    const r = gateMemoryWrite(input({ justification: undefined }))
    expect(r.verdict).toBe('review')
  })

  it('reviews a scenario shorter than the minimum', () => {
    const r = gateMemoryWrite(
      input({ justification: goodJustification({ sevenDayScenario: 'x'.repeat(MIN_SCENARIO_CHARS - 1) }) }),
    )
    expect(r.verdict).toBe('review')
    expect(r.reasons.join(' ')).toMatch(/too vague/)
  })

  it('reviews a generic "might be useful" scenario even when long enough', () => {
    const r = gateMemoryWrite(
      input({ justification: goodJustification({ sevenDayScenario: 'this might be useful later on for us' }) }),
    )
    expect(r.verdict).toBe('review')
    expect(r.reasons.join(' ')).toMatch(/generic filler/)
  })

  it.each([
    'good to know for the team',
    'just in case we need it again',
    'kept for future reference only',
    'nice to have around somewhere',
  ])('reviews the filler phrase: %s', (scenario) => {
    const r = gateMemoryWrite(input({ justification: goodJustification({ sevenDayScenario: scenario }) }))
    expect(r.verdict).toBe('review')
  })

  it('reviews a justification with empty evidence', () => {
    const r = gateMemoryWrite(input({ justification: goodJustification({ evidence: '   ' }) }))
    expect(r.verdict).toBe('review')
    expect(r.reasons.join(' ')).toMatch(/missing evidence/)
  })

  it('reviews an oversized note (> 6000 chars)', () => {
    const r = gateMemoryWrite(input({ content: 'x'.repeat(GATE_OVERSIZE_CHARS + 1) }))
    expect(r.verdict).toBe('review')
    expect(r.reasons.join(' ')).toMatch(/oversized/)
  })

  it('reviews a "no-overlap" claim against a name that already exists (a twin)', () => {
    const r = gateMemoryWrite(
      input({
        name: 'memory-hub',
        existingNames: ['memory-hub', 'swarm-design'],
        justification: goodJustification({ dedupChecked: 'no-overlap' }),
      }),
    )
    expect(r.verdict).toBe('review')
    expect(r.reasons.join(' ')).toMatch(/already exists/)
  })

  it('normalizes names before the twin check', () => {
    const r = gateMemoryWrite(
      input({
        name: 'Memory Hub',
        existingNames: ['memory-hub'],
        justification: goodJustification({ dedupChecked: 'no-overlap' }),
      }),
    )
    expect(r.verdict).toBe('review')
  })

  it('does NOT flag a twin when the name is genuinely new', () => {
    const r = gateMemoryWrite(
      input({ name: 'brand-new-fact', existingNames: ['memory-hub'], justification: goodJustification() }),
    )
    expect(r.verdict).toBe('accept')
  })
})

describe('gateMemoryWrite — reject (secrets)', () => {
  it.each([
    'the token is sk-or-v1-0123456789abcdefghijklmnop',
    'export GITHUB_TOKEN=ghp_0123456789abcdefghij0123456789abcdef',
    'connect via postgres://user:s3cretpass@db.internal:5432/app',
    '-----BEGIN RSA PRIVATE KEY-----',
    'AKIAIOSFODNN7EXAMPLE is the key id',
  ])('rejects secret-shaped content: %s', (content) => {
    const r = gateMemoryWrite(input({ content }))
    expect(r.verdict).toBe('reject')
    expect(r.reasons.join(' ')).toMatch(/secret/)
  })

  it('reject wins over review (secret + missing justification)', () => {
    const r = gateMemoryWrite(
      input({ content: 'key: sk-or-v1-0123456789abcdefghijklmnop', justification: null }),
    )
    expect(r.verdict).toBe('reject')
    // both reasons surface — the caller sees the full picture
    expect(r.reasons.length).toBeGreaterThanOrEqual(2)
  })

  it('does not flag an ordinary git SHA or long hash as a secret', () => {
    const r = gateMemoryWrite(
      input({ content: 'fixed in commit 5525b36ac9f1e2d3b4a5c6d7e8f9012345678abc — see the diff' }),
    )
    expect(r.verdict).toBe('accept')
  })
})

describe('gateMemoryWrite — combinations accumulate reasons', () => {
  it('collects every failing reason at once', () => {
    const r = gateMemoryWrite(
      input({
        name: 'memory-hub',
        existingNames: ['memory-hub'],
        content: 'x'.repeat(GATE_OVERSIZE_CHARS + 1),
        justification: goodJustification({ sevenDayScenario: 'nope', dedupChecked: 'no-overlap' }),
      }),
    )
    expect(r.verdict).toBe('review')
    // vague scenario + oversize + twin
    expect(r.reasons.length).toBe(3)
  })
})
