import { describe, expect, it } from 'vitest'
import {
  buildCurationPrompt,
  CURATION_INVENTORY_CAP,
  MAX_CURATION_PROPOSALS,
  parseCurationResponse,
  type CurationNote,
} from '@shared/memory-curation'

const FENCE = '====COCKPIT-UNTRUSTED-MEMORY-test===='

const note = (over: Partial<CurationNote> = {}): CurationNote => ({
  name: 'some-note',
  hook: 'a one-line hook',
  ageDays: 3,
  ...over,
})

describe('buildCurationPrompt', () => {
  it('states the charter lifecycle rules and the strict-JSON contract', () => {
    const p = buildCurationPrompt([note()], FENCE)
    expect(p).toMatch(/Lifecycle/)
    expect(p).toMatch(/decay/i)
    expect(p).toMatch(/archive/)
    expect(p).toMatch(/merge/)
    expect(p).toMatch(new RegExp(`at most ${MAX_CURATION_PROPOSALS}`))
    expect(p).toMatch(/STRICT JSON/)
    expect(p).toMatch(/NEVER propose deleting/i)
    expect(p).toMatch(/OWNER approves/i)
  })

  it('fences the inventory as untrusted and lists names + hooks + ages', () => {
    const p = buildCurationPrompt([note({ name: 'stale-fact', hook: 'old truth', ageDays: 42 })], FENCE)
    expect(p).toContain(FENCE)
    expect(p).toMatch(/UNTRUSTED DATA/)
    expect(p).toMatch(/- stale-fact \(age 42d\): old truth/)
    // The fence appears three times: once named in the SECURITY RULE, then the two
    // markers that wrap the inventory (so split yields four segments).
    expect(p.split(FENCE)).toHaveLength(4)
  })

  it('renders a hook-less note with a placeholder', () => {
    const p = buildCurationPrompt([note({ name: 'bare', hook: null })], FENCE)
    expect(p).toMatch(/- bare \(age 3d\): \(no hook\)/)
  })

  it('caps the inventory so a huge hub cannot blow the prompt budget', () => {
    const many: CurationNote[] = Array.from({ length: 500 }, (_, i) => ({
      name: `note-${i}`,
      hook: 'x'.repeat(60),
      ageDays: i,
    }))
    const p = buildCurationPrompt(many, FENCE)
    // The inventory is the segment between the two wrapping fence markers (index 2:
    // [before] [rule↔open] [inventory] [after]).
    const inventory = p.split(FENCE)[2]
    expect(inventory.length).toBeLessThanOrEqual(CURATION_INVENTORY_CAP + 2)
    // Not every note fits — the tail is dropped.
    expect(p).not.toContain('note-499')
  })
})

describe('parseCurationResponse', () => {
  it('parses a clean array, keeping archive/merge and dropping keep', () => {
    const text = JSON.stringify([
      { note: 'stale-a', action: 'archive', reason: 'superseded' },
      { note: 'dup-a', action: 'merge', into: 'canonical-a', reason: 'duplicate' },
      { note: 'good-a', action: 'keep', reason: 'still load-bearing' },
    ])
    expect(parseCurationResponse(text)).toEqual([
      { note: 'stale-a', action: 'archive', reason: 'superseded' },
      { note: 'dup-a', action: 'merge', into: 'canonical-a', reason: 'duplicate' },
    ])
  })

  it('tolerates prose and a ```json fence around the array (messy)', () => {
    const text = [
      "Sure, here's my curation plan:",
      '```json',
      '[{"note":"old-note","action":"archive","reason":"dead"}]',
      '```',
      'Let me know if you want changes.',
    ].join('\n')
    expect(parseCurationResponse(text)).toEqual([{ note: 'old-note', action: 'archive', reason: 'dead' }])
  })

  it('is string-aware and drops unknown actions / malformed entries (hostile)', () => {
    const text = JSON.stringify([
      { note: 'has-bracket', action: 'archive', reason: 'a ] inside a string must not end the array' },
      { note: 'x', action: 'delete', reason: 'delete is not in the vocabulary' },
      { note: '', action: 'archive', reason: 'empty note name' },
      { note: 'dup-no-target', action: 'merge', reason: 'merge with no into' },
      { note: 'self-merge', action: 'merge', into: 'self-merge', reason: 'into equals note' },
      { action: 'archive', reason: 'no note field' },
      'not an object',
    ])
    expect(parseCurationResponse(text)).toEqual([
      { note: 'has-bracket', action: 'archive', reason: 'a ] inside a string must not end the array' },
    ])
  })

  it('caps at MAX_CURATION_PROPOSALS non-keep proposals', () => {
    const arr = Array.from({ length: 12 }, (_, i) => ({
      note: `n-${i}`,
      action: 'archive' as const,
      reason: 'stale',
    }))
    const parsed = parseCurationResponse(JSON.stringify(arr))
    expect(parsed).toHaveLength(MAX_CURATION_PROPOSALS)
    expect(parsed?.[0].note).toBe('n-0')
  })

  it('returns null for unparseable output but [] for a valid empty array', () => {
    // Garbage / no array at all → null (the model failed; do not record a sweep).
    expect(parseCurationResponse('I could not decide.')).toBeNull()
    expect(parseCurationResponse('{}')).toBeNull()
    expect(parseCurationResponse('')).toBeNull()
    // A well-formed empty array → [] (the hub is healthy; a real zero-proposal sweep).
    expect(parseCurationResponse('[]')).toEqual([])
  })
})
