import { describe, expect, it } from 'vitest'
import {
  buildNoteFromObservation,
  decideGate,
  mergeObservationIntoNote,
} from '@shared/memory-commit'
import { parseNote, validateNoteContent } from '@shared/memory-note-schema'
import type { Observation } from '@shared/memory-observation'
import type { Reconciled } from '@shared/memory-reconcile'

const obs = (over: Partial<Observation> = {}): Observation => ({
  scope: 'project',
  class: 'decision',
  targetSlug: 'router-placement',
  isNew: true,
  title: 'Router in shared',
  body: 'The router lives in shared so both bridges classify identically.',
  links: ['ipc-contract'],
  decision: 'save',
  reason: 'clear',
  ...over,
})

const rec = (over: Partial<Reconciled> = {}): Reconciled => ({
  decision: 'new',
  targetSlug: 'router-placement',
  similarity: 0,
  existingContent: null,
  ...over,
})

const NOW = '2026-07-04T12:00:00.000Z'

describe('decideGate', () => {
  it('skips duplicates', () => {
    expect(decideGate(obs(), rec({ decision: 'duplicate' }))).toBe('skip')
  })
  it('always reviews conflicts, even when the model said save', () => {
    expect(decideGate(obs({ decision: 'save' }), rec({ decision: 'conflict' }))).toBe('review')
  })
  it('reviews when the model itself is unsure (ask)', () => {
    expect(decideGate(obs({ decision: 'ask' }), rec({ decision: 'new' }))).toBe('review')
  })
  it('commits a confident, non-conflicting new fact', () => {
    expect(decideGate(obs({ decision: 'save' }), rec({ decision: 'new' }))).toBe('commit')
  })
})

describe('buildNoteFromObservation', () => {
  it('produces a valid, self-consistent note with links footer', () => {
    const { slug, content } = buildNoteFromObservation(obs(), { now: NOW, gate: 'save', sessionId: 's1' })
    expect(slug).toBe('router-placement')
    expect(validateNoteContent(slug, content)).toEqual({ ok: true, errors: [] })
    const { frontmatter, body } = parseNote(content)
    expect(frontmatter?.name).toBe('router-placement')
    expect(frontmatter?.gate).toBe('save')
    expect(frontmatter?.session).toBe('s1')
    expect(body).toContain('[[ipc-contract]]')
  })

  it('never links a note to itself', () => {
    const { content } = buildNoteFromObservation(obs({ links: ['router-placement'] }), { now: NOW, gate: 'save' })
    expect(content).not.toContain('[[router-placement]]')
  })
})

describe('mergeObservationIntoNote', () => {
  it('appends a dated bullet and keeps the prior body + frontmatter', () => {
    const existing = buildNoteFromObservation(obs({ body: 'original fact' }), { now: '2026-07-01T00:00:00.000Z', gate: 'save' }).content
    const { slug, content } = mergeObservationIntoNote(existing, obs({ body: 'a newer related fact' }), { now: NOW, gate: 'asked' })
    expect(validateNoteContent(slug, content).ok).toBe(true)
    expect(content).toContain('original fact')
    expect(content).toContain('a newer related fact')
    expect(content).toContain('(2026-07-04)')
    expect(parseNote(content).frontmatter?.updatedAt).toBe(NOW)
  })

  it('adds frontmatter when merging into a plain human note', () => {
    const human = '# My freeform note\n\nsome earlier thought'
    const { slug, content } = mergeObservationIntoNote(human, obs({ body: 'brain addition' }), { now: NOW, gate: 'asked' })
    expect(validateNoteContent(slug, content).ok).toBe(true)
    expect(content).toContain('some earlier thought')
    expect(content).toContain('brain addition')
    expect(parseNote(content).frontmatter?.name).toBe('router-placement')
  })

  it('is byte-idempotent when a near-identical fact already exists as one bullet', () => {
    const shared =
      'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november'
    const existingFact = `${shared} papa quebec`
    const incomingFact = `${shared} oscar`
    const existing = buildNoteFromObservation(
      obs({
        body: [
          'A separate original fact about the routing subsystem.',
          `- (2026-07-01) ${existingFact}`,
        ].join('\n'),
      }),
      { now: '2026-07-01T00:00:00.000Z', gate: 'save' },
    ).content

    const merged = mergeObservationIntoNote(
      existing,
      obs({ isNew: false, body: incomingFact }),
      { now: NOW, gate: 'save' },
    )

    expect(merged.content).toBe(existing)
  })
})
