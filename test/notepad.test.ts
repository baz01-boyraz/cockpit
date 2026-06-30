import { describe, expect, it } from 'vitest'
import {
  type Note,
  NOTE_MAX_LENGTH,
  addNote,
  createNote,
  filterNotes,
  normalizeContent,
  parseNotes,
  removeNote,
  restoreNote,
  serializeNotes,
  sortNotes,
  togglePin,
  updateNoteContent,
} from '@shared/notepad'

const T0 = new Date('2026-06-29T10:00:00.000Z').getTime()
const MIN = 60_000

const makeNote = (over: Partial<Note> = {}): Note => ({
  id: 'n1',
  content: 'hello',
  pinned: false,
  createdAt: new Date(T0).toISOString(),
  updatedAt: new Date(T0).toISOString(),
  ...over,
})

describe('normalizeContent', () => {
  it('trims surrounding whitespace, keeps internal newlines', () => {
    expect(normalizeContent('  a\nb  ')).toBe('a\nb')
  })

  it('clamps to the max length', () => {
    expect(normalizeContent('x'.repeat(NOTE_MAX_LENGTH + 50))).toHaveLength(NOTE_MAX_LENGTH)
  })
})

describe('createNote', () => {
  it('builds an unpinned note with matching timestamps', () => {
    const note = createNote('  idea  ', T0)
    expect(note.content).toBe('idea')
    expect(note.pinned).toBe(false)
    expect(note.createdAt).toBe(new Date(T0).toISOString())
    expect(note.updatedAt).toBe(note.createdAt)
    expect(note.id).toBeTruthy()
  })

  it('gives distinct ids to distinct notes', () => {
    expect(createNote('a', T0).id).not.toBe(createNote('b', T0).id)
  })
})

describe('addNote', () => {
  it('prepends a new note', () => {
    const start = [makeNote()]
    const next = addNote(start, 'fresh', T0 + MIN)
    expect(next).toHaveLength(2)
    expect(next[0].content).toBe('fresh')
    expect(next[1]).toEqual(start[0])
  })

  it('is a no-op for empty / whitespace input but returns a new array', () => {
    const start = [makeNote()]
    const next = addNote(start, '   ')
    expect(next).toHaveLength(1)
    expect(next).not.toBe(start) // shallow copy, so callers can compare lengths
  })

  it('does not mutate the input list', () => {
    const start = [makeNote()]
    addNote(start, 'x')
    expect(start).toHaveLength(1)
  })
})

describe('updateNoteContent', () => {
  it('replaces content and bumps updatedAt', () => {
    const next = updateNoteContent([makeNote()], 'n1', 'changed', T0 + 5 * MIN)
    expect(next[0].content).toBe('changed')
    expect(next[0].updatedAt).toBe(new Date(T0 + 5 * MIN).toISOString())
    expect(next[0].createdAt).toBe(new Date(T0).toISOString())
  })

  it('leaves the list untouched when content normalizes to empty', () => {
    const start = [makeNote()]
    const next = updateNoteContent(start, 'n1', '   ', T0 + MIN)
    expect(next[0].content).toBe('hello')
    expect(next[0].updatedAt).toBe(new Date(T0).toISOString())
  })

  it('ignores unknown ids', () => {
    const next = updateNoteContent([makeNote()], 'nope', 'x')
    expect(next[0].content).toBe('hello')
  })
})

describe('removeNote / restoreNote', () => {
  it('removes by id', () => {
    expect(removeNote([makeNote()], 'n1')).toHaveLength(0)
  })

  it('restores a removed note at the front', () => {
    const kept = makeNote({ id: 'n2', content: 'keep' })
    const restored = restoreNote([kept], makeNote())
    expect(restored).toHaveLength(2)
    expect(restored[0].id).toBe('n1')
  })

  it('does not duplicate an already-present note on restore', () => {
    const note = makeNote()
    expect(restoreNote([note], note)).toHaveLength(1)
  })
})

describe('togglePin', () => {
  it('flips the pinned flag without touching updatedAt', () => {
    const pinned = togglePin([makeNote()], 'n1')
    expect(pinned[0].pinned).toBe(true)
    expect(pinned[0].updatedAt).toBe(new Date(T0).toISOString())
    expect(togglePin(pinned, 'n1')[0].pinned).toBe(false)
  })
})

describe('sortNotes', () => {
  it('orders pinned first, then most-recently-updated', () => {
    const a = makeNote({ id: 'a', updatedAt: new Date(T0).toISOString() })
    const b = makeNote({ id: 'b', updatedAt: new Date(T0 + 2 * MIN).toISOString() })
    const c = makeNote({ id: 'c', pinned: true, updatedAt: new Date(T0 - MIN).toISOString() })
    expect(sortNotes([a, b, c]).map((n) => n.id)).toEqual(['c', 'b', 'a'])
  })

  it('does not mutate the input', () => {
    const input = [makeNote({ id: 'a' }), makeNote({ id: 'b' })]
    sortNotes(input)
    expect(input.map((n) => n.id)).toEqual(['a', 'b'])
  })
})

describe('filterNotes', () => {
  const notes = [
    makeNote({ id: 'a', content: 'Buy milk' }),
    makeNote({ id: 'b', content: 'Refactor router' }),
  ]

  it('returns everything for an empty query', () => {
    expect(filterNotes(notes, '   ')).toHaveLength(2)
  })

  it('matches case-insensitive substrings', () => {
    expect(filterNotes(notes, 'ROUTER').map((n) => n.id)).toEqual(['b'])
  })
})

describe('parseNotes / serializeNotes', () => {
  it('round-trips a clean list', () => {
    const notes = [makeNote(), makeNote({ id: 'n2', pinned: true })]
    expect(parseNotes(serializeNotes(notes))).toEqual(notes)
  })

  it('returns [] for null, malformed JSON, or non-arrays', () => {
    expect(parseNotes(null)).toEqual([])
    expect(parseNotes('{not json')).toEqual([])
    expect(parseNotes('{"a":1}')).toEqual([])
  })

  it('drops entries that do not match the note shape', () => {
    const raw = JSON.stringify([makeNote(), { id: 'x' }, 42, null])
    expect(parseNotes(raw)).toHaveLength(1)
  })

  it('clamps over-long persisted content', () => {
    const raw = JSON.stringify([makeNote({ content: 'y'.repeat(NOTE_MAX_LENGTH + 10) })])
    expect(parseNotes(raw)[0].content).toHaveLength(NOTE_MAX_LENGTH)
  })
})
