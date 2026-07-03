import { describe, expect, it } from 'vitest'
import {
  buildLinkIndex,
  normalizeNoteName,
  parseWikilinks,
  renameLinkTargets,
} from '@shared/wikilink'

describe('parseWikilinks', () => {
  it('finds plain and aliased links with positions', () => {
    const text = 'See [[Auth Flow]] and [[deploy-notes|the deploy doc]].'
    const links = parseWikilinks(text)
    expect(links).toHaveLength(2)
    expect(links[0]).toMatchObject({ target: 'Auth Flow', alias: null })
    expect(links[1]).toMatchObject({ target: 'deploy-notes', alias: 'the deploy doc' })
    expect(text.slice(links[0].start, links[0].end)).toBe('[[Auth Flow]]')
  })

  it('ignores empty, unclosed, and nested-bracket noise', () => {
    expect(parseWikilinks('[[]] [[  ]] [[unclosed')).toEqual([])
    expect(parseWikilinks('array[[0]] is not a link target with slashes [[a/b]]')).toHaveLength(1)
  })

  it('skips fenced and inline code', () => {
    const text = 'real [[one]]\n```\nfake [[two]]\n```\nand `inline [[three]]` done'
    const links = parseWikilinks(text)
    expect(links.map((l) => l.target)).toEqual(['one'])
  })
})

describe('normalizeNoteName', () => {
  it('is case- and whitespace-insensitive and strips .md', () => {
    expect(normalizeNoteName('Auth Flow')).toBe('auth-flow')
    expect(normalizeNoteName('  auth   flow ')).toBe('auth-flow')
    expect(normalizeNoteName('AUTH-FLOW.md')).toBe('auth-flow')
  })

  it('refuses traversal and hidden shapes', () => {
    expect(normalizeNoteName('../evil')).toBeNull()
    expect(normalizeNoteName('a/b')).toBeNull()
    expect(normalizeNoteName('.hidden')).toBeNull()
    expect(normalizeNoteName('')).toBeNull()
    expect(normalizeNoteName('x'.repeat(120))).toBeNull()
  })
})

describe('buildLinkIndex', () => {
  const docs = [
    { name: 'auth-flow', content: 'uses [[session-store]] and [[Deploy Notes]]' },
    { name: 'session-store', content: 'referenced by auth. see [[auth-flow]]' },
    { name: 'deploy-notes', content: 'plain note, no links' },
  ]

  it('builds forward links, backlinks, and resolves case-insensitively', () => {
    const idx = buildLinkIndex(docs)
    expect([...(idx.forward.get('auth-flow') ?? [])]).toEqual(['session-store', 'deploy-notes'])
    expect([...(idx.backlinks.get('session-store') ?? [])]).toEqual(['auth-flow'])
    expect([...(idx.backlinks.get('auth-flow') ?? [])]).toEqual(['session-store'])
    expect(idx.unresolved.size).toBe(0)
  })

  it('collects unresolved targets with their wanting sources', () => {
    const idx = buildLinkIndex([{ name: 'a', content: '[[ghost-note]] and [[Ghost Note]]' }])
    expect([...(idx.unresolved.get('ghost-note') ?? [])]).toEqual(['a'])
  })

  it('ignores self-links and duplicates', () => {
    const idx = buildLinkIndex([{ name: 'a', content: '[[a]] [[b]] [[b]]' }, { name: 'b', content: '' }])
    expect([...(idx.forward.get('a') ?? [])]).toEqual(['b'])
    expect([...(idx.backlinks.get('b') ?? [])]).toEqual(['a'])
  })
})

describe('renameLinkTargets', () => {
  it('rewrites plain and aliased links, preserving aliases', () => {
    const content = 'see [[Old Note]] and [[old-note|the old one]] but not [[other]]'
    const out = renameLinkTargets(content, 'old-note', 'new-note')
    expect(out).toBe('see [[new-note]] and [[new-note|the old one]] but not [[other]]')
  })

  it('leaves code fences untouched', () => {
    const content = '[[old]]\n```\n[[old]]\n```'
    const out = renameLinkTargets(content, 'old', 'new')
    expect(out).toBe('[[new]]\n```\n[[old]]\n```')
  })
})
