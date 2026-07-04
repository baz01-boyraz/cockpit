import { describe, expect, it } from 'vitest'
import { buildWorkerCommand, buildWorkerPrompt, shellQuote } from '../shared/swarm-worker'

describe('shellQuote', () => {
  it('wraps in single quotes', () => {
    expect(shellQuote('hello world')).toBe(`'hello world'`)
  })

  it('escapes embedded single quotes', () => {
    expect(shellQuote(`it's done`)).toBe(`'it'\\''s done'`)
  })

  it('neutralizes shell metacharacters by quoting', () => {
    expect(shellQuote('$(rm -rf ~) `x` ; && |')).toBe(`'$(rm -rf ~) \`x\` ; && |'`)
  })
})

describe('buildWorkerPrompt', () => {
  const card = { title: 'Fix contact form', body: 'Zod schema on the API route.' }

  it('contains the card title and body', () => {
    const p = buildWorkerPrompt(card, [])
    expect(p).toContain('Fix contact form')
    expect(p).toContain('Zod schema on the API route.')
  })

  it('lists hub notes as pointers, never contents', () => {
    const p = buildWorkerPrompt(card, ['swarm-design', 'diff-review'])
    expect(p).toContain('.cockpit-memory/swarm-design.md')
    expect(p).toContain('.cockpit-memory/diff-review.md')
  })

  it('omits the hub section when the hub is empty', () => {
    expect(buildWorkerPrompt(card, [])).not.toContain('.cockpit-memory')
  })

  it('caps the hub pointer list', () => {
    const names = Array.from({ length: 40 }, (_, i) => `note-${i}`)
    const p = buildWorkerPrompt(card, names)
    expect(p).toContain('note-19')
    expect(p).not.toContain('note-20.md')
  })

  it('tells the worker not to commit or push', () => {
    expect(buildWorkerPrompt(card, []).toLowerCase()).toMatch(/do not push/)
  })

  it('strips C0 control characters that could act on the pty line editor', () => {
    const p = buildWorkerPrompt(
      { title: 'evil\rtitle', body: 'a\r\nb\x03c\x1b[31m' },
      [],
    )
    expect(p).not.toContain('\r')
    expect(p).not.toContain('\x03')
    expect(p).not.toContain('\x1b')
    expect(p).toContain('a\nb')
  })
})

describe('buildWorkerCommand', () => {
  it('is a single claude invocation with the whole prompt quoted', () => {
    const cmd = buildWorkerCommand({ title: 'T', body: 'B' }, [])
    expect(cmd.startsWith(`claude '`)).toBe(true)
  })

  it('chains `; exit` so the pane (and card) actually finishes with the worker', () => {
    const cmd = buildWorkerCommand({ title: 'T', body: 'B' }, [])
    expect(cmd.endsWith(`'; exit`)).toBe(true)
  })

  it('adds a validated --model flag and ignores hostile model strings', () => {
    expect(buildWorkerCommand({ title: 'T', body: 'B' }, [], '', 'opus')).toContain('claude --model opus ')
    expect(buildWorkerCommand({ title: 'T', body: 'B' }, [], '', 'x; rm -rf /')).not.toContain('rm -rf')
    expect(buildWorkerCommand({ title: 'T', body: 'B' }, [], '', null).startsWith("claude '")).toBe(true)
  })

  it('never contains a carriage return (a \\r would submit the pty line early)', () => {
    const cmd = buildWorkerCommand({ title: 'x\r rm -rf /', body: 'y\rz' }, ['n\rote'])
    expect(cmd).not.toContain('\r')
  })
})
