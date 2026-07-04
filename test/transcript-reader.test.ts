import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TranscriptReader } from '../electron/main/services/TranscriptReader'

const line = (obj: unknown) => `${JSON.stringify(obj)}\n`

describe('TranscriptReader', () => {
  let dir: string
  let path: string
  const reader = new TranscriptReader()

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cockpit-tr-'))
    path = join(dir, 'session.jsonl')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('extracts conversation turns and drops tool traffic', async () => {
    writeFileSync(
      path,
      line({ type: 'user', message: { content: 'implement the router' } }) +
        line({ type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } }) +
        line({ type: 'summary', summary: 'noise' }),
    )
    const { turns } = await reader.read(path)
    expect(turns.map((t) => t.role)).toEqual(['user', 'assistant'])
    expect(turns[0].text).toBe('implement the router')
  })

  it('redacts secret-shaped text by default (security hard rule)', async () => {
    writeFileSync(
      path,
      line({ type: 'user', message: { content: 'use key sk-ABCDEFGHIJKLMNOP1234 and AKIAIOSFODNN7EXAMPLE' } }),
    )
    const { turns } = await reader.read(path)
    expect(turns[0].text).not.toContain('sk-ABCDEFGHIJKLMNOP1234')
    expect(turns[0].text).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(turns[0].text).toContain('[REDACTED]')
  })

  it('reads incrementally from an offset without re-emitting old turns', async () => {
    writeFileSync(path, line({ type: 'user', message: { content: 'first' } }))
    const first = await reader.read(path)
    expect(first.turns).toHaveLength(1)

    appendFileSync(path, line({ type: 'assistant', message: { content: 'second' } }))
    const second = await reader.read(path, first.nextOffset)
    expect(second.turns).toHaveLength(1)
    expect(second.turns[0].text).toBe('second')
  })

  it('leaves an incomplete trailing line unconsumed', async () => {
    // no trailing newline — the session is still being written
    writeFileSync(path, line({ type: 'user', message: { content: 'complete' } }) + '{"type":"assistant","messa')
    const { turns, nextOffset } = await reader.read(path)
    expect(turns).toHaveLength(1)

    // completing the line and re-reading from nextOffset picks it up whole
    writeFileSync(path, line({ type: 'user', message: { content: 'complete' } }) + line({ type: 'assistant', message: { content: 'now complete' } }))
    const more = await reader.read(path, nextOffset)
    expect(more.turns[0].text).toBe('now complete')
  })
})
