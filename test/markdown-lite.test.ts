import { describe, expect, it } from 'vitest'
import { parseInline, parseMarkdownBlocks } from '../shared/markdown-lite'

describe('parseMarkdownBlocks', () => {
  it('splits headings, paragraphs and blank lines', () => {
    const blocks = parseMarkdownBlocks('# Title\n\nFirst line\nsecond line\n\n## Sub')
    expect(blocks).toEqual([
      { kind: 'heading', level: 1, inline: [{ kind: 'text', text: 'Title' }] },
      { kind: 'paragraph', inline: [{ kind: 'text', text: 'First line second line' }] },
      { kind: 'heading', level: 2, inline: [{ kind: 'text', text: 'Sub' }] },
    ])
  })

  it('groups list runs into one list block', () => {
    const blocks = parseMarkdownBlocks('- one\n- two\n\ntail')
    expect(blocks[0]).toEqual({
      kind: 'list',
      ordered: false,
      items: [[{ kind: 'text', text: 'one' }], [{ kind: 'text', text: 'two' }]],
    })
    expect(blocks[1].kind).toBe('paragraph')
  })

  it('parses ordered lists and asterisk bullets', () => {
    const blocks = parseMarkdownBlocks('1. a\n2. b')
    expect(blocks[0]).toMatchObject({ kind: 'list', ordered: true })
    const star = parseMarkdownBlocks('* a')
    expect(star[0]).toMatchObject({ kind: 'list', ordered: false })
  })

  it('keeps fenced code verbatim (no inline parsing inside)', () => {
    const blocks = parseMarkdownBlocks('```\nconst a = **not bold**\n[[not-a-link]]\n```')
    expect(blocks).toEqual([{ kind: 'code', text: 'const a = **not bold**\n[[not-a-link]]' }])
  })

  it('treats an unterminated fence as code to the end', () => {
    const blocks = parseMarkdownBlocks('```\nabc')
    expect(blocks).toEqual([{ kind: 'code', text: 'abc' }])
  })

  it('parses blockquotes and horizontal rules', () => {
    const blocks = parseMarkdownBlocks('> quoted words\n\n---')
    expect(blocks[0]).toMatchObject({ kind: 'quote' })
    expect(blocks[1]).toEqual({ kind: 'rule' })
  })

  it('never throws on empty content', () => {
    expect(parseMarkdownBlocks('')).toEqual([])
    expect(parseMarkdownBlocks('\n\n')).toEqual([])
  })
})

describe('parseInline', () => {
  it('parses bold, inline code and wikilinks in order', () => {
    expect(parseInline('a **b** `c` [[note-d|D]] e')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'bold', text: 'b' },
      { kind: 'text', text: ' ' },
      { kind: 'code', text: 'c' },
      { kind: 'text', text: ' ' },
      { kind: 'wikilink', target: 'note-d', alias: 'D' },
      { kind: 'text', text: ' e' },
    ])
  })

  it('does not treat brackets inside inline code as links', () => {
    expect(parseInline('`[[x]]`')).toEqual([{ kind: 'code', text: '[[x]]' }])
  })

  it('keeps unmatched markers as plain text', () => {
    expect(parseInline('2 ** 3 and `open')).toEqual([{ kind: 'text', text: '2 ** 3 and `open' }])
  })

  it('parses a wikilink without alias', () => {
    expect(parseInline('[[memory-hub]]')).toEqual([
      { kind: 'wikilink', target: 'memory-hub', alias: null },
    ])
  })
})
