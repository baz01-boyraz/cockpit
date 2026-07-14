import { describe, expect, it } from 'vitest'
import {
  MEMORY_NOTE_SCHEMA_VERSION,
  type NoteFrontmatter,
  noteLifecycle,
  parseNote,
  serializeNote,
  validateNoteContent,
} from '@shared/memory-note-schema'

const fm = (over: Partial<NoteFrontmatter> = {}): NoteFrontmatter => ({
  schema: MEMORY_NOTE_SCHEMA_VERSION,
  name: 'router-decision',
  title: 'Router decision',
  class: 'decision',
  gate: 'save',
  updatedAt: '2026-07-04T10:00:00.000Z',
  tags: [],
  status: 'active',
  authority: 'observed',
  scope: 'project',
  confidence: 'medium',
  firstSeenAt: '2026-07-04T10:00:00.000Z',
  reviewAfter: '2026-10-02T10:00:00.000Z',
  supersedes: [],
  ...over,
})

describe('serializeNote / parseNote round-trip', () => {
  it('uses schema v2 with lifecycle and authority metadata', () => {
    expect(MEMORY_NOTE_SCHEMA_VERSION).toBe(2)
    const parsed = parseNote(serializeNote(fm({ authority: 'human-directive' }), 'fact'))
    expect(parsed.frontmatter).toMatchObject({
      schema: 2,
      status: 'active',
      authority: 'human-directive',
      scope: 'project',
      confidence: 'medium',
    })
  })

  it('round-trips a full frontmatter block losslessly', () => {
    const front = fm({
      session: 'sess-123',
      capturedAt: '2026-07-04T09:00:00.000Z',
      tags: ['infra', 'ipc'],
    })
    const body = 'The router lives in shared/ so both bridges classify identically.\n'
    const parsed = parseNote(serializeNote(front, body))
    expect(parsed.frontmatter).toEqual(front)
    expect(parsed.body).toBe(body)
  })

  it('omits optional fields when absent and still round-trips', () => {
    const front = fm()
    const serialized = serializeNote(front, 'body text')
    const parsed = parseNote(serialized)
    expect(parsed.frontmatter).toEqual(front)
    expect(parsed.frontmatter?.session).toBeUndefined()
    expect(parsed.frontmatter?.tags).toEqual([])
    expect(serialized).not.toContain('\nsupersedes: ')
  })

  it('is deterministic — identical input yields identical output', () => {
    const front = fm({ tags: ['a', 'b'] })
    expect(serializeNote(front, 'x')).toBe(serializeNote(front, 'x'))
  })
})

describe('parseNote tolerance', () => {
  it('keeps schema v1 notes readable with explicit legacy lifecycle defaults', () => {
    const legacy = [
      '---',
      'schema: 1',
      'name: legacy-note',
      'title: Legacy note',
      'class: reference',
      'gate: manual',
      'updatedAt: 2026-01-01T00:00:00.000Z',
      '---',
      'historical fact',
    ].join('\n')
    const parsed = parseNote(legacy)
    expect(noteLifecycle(parsed.frontmatter)).toMatchObject({
      status: 'active',
      authority: 'legacy',
      scope: 'project',
      confidence: 'low',
    })
  })

  it('treats a plain human note (no frontmatter) as body-only', () => {
    const human = '# My note\n\nSome freeform thought with a [[link]].'
    const parsed = parseNote(human)
    expect(parsed.frontmatter).toBeNull()
    expect(parsed.body).toBe(human)
  })

  it('treats a malformed frontmatter block as a human note (never throws)', () => {
    const weird = '---\nthis is not key value\njust prose\n---\nbody'
    const parsed = parseNote(weird)
    expect(parsed.frontmatter).toBeNull()
    expect(parsed.body).toBe(weird)
  })

  it('rejects a schema-invalid block (bad class) as frontmatter, keeps content', () => {
    const bad = '---\nschema: 1\nname: x\ntitle: X\nclass: nonsense\ngate: save\nupdatedAt: 2026-07-04T10:00:00.000Z\n---\nbody'
    const parsed = parseNote(bad)
    expect(parsed.frontmatter).toBeNull()
    expect(parsed.body).toBe(bad)
  })
})

describe('validateNoteContent (G3 write guard)', () => {
  it('accepts a well-formed brain note whose name matches the slug', () => {
    const content = serializeNote(fm({ name: 'router-decision' }), 'a real fact')
    expect(validateNoteContent('router-decision', content)).toEqual({ ok: true, errors: [] })
  })

  it('accepts a plain human note with no frontmatter', () => {
    const res = validateNoteContent('my-thought', '# Thought\n\nfreeform')
    expect(res.ok).toBe(true)
  })

  it('refuses an empty body', () => {
    const res = validateNoteContent('x', '   \n  ')
    expect(res.ok).toBe(false)
    expect(res.errors).toContain('note body is empty')
  })

  it('refuses a name/slug mismatch (no file drift)', () => {
    const content = serializeNote(fm({ name: 'router-decision' }), 'fact')
    const res = validateNoteContent('something-else', content)
    expect(res.ok).toBe(false)
    expect(res.errors.some((e) => e.includes('does not match slug'))).toBe(true)
  })

  it('refuses a declared-but-malformed frontmatter block', () => {
    const res = validateNoteContent('x', '---\nschema: 1\nname: x\n---\nbody')
    // missing required fields → block fails schema → treated as malformed declaration
    expect(res.ok).toBe(false)
    expect(res.errors).toContain('frontmatter block is present but malformed')
  })

  it('refuses a note larger than the ceiling', () => {
    const res = validateNoteContent('x', 'x'.repeat(500_001))
    expect(res.ok).toBe(false)
    expect(res.errors.some((e) => e.includes('exceeds'))).toBe(true)
  })
})
