import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryDistiller, type ClaudeRunner } from '../electron/main/services/MemoryDistiller'
import { TranscriptReader } from '../electron/main/services/TranscriptReader'
import type { ProjectService } from '../electron/main/services/ProjectService'

const stubProjects = (path: string): ProjectService =>
  ({ get: () => ({ path }) }) as unknown as ProjectService

const line = (obj: unknown) => `${JSON.stringify(obj)}\n`

const goodReply = JSON.stringify({
  observations: [
    {
      scope: 'project',
      class: 'decision',
      targetSlug: 'router-placement',
      isNew: true,
      title: 'Router in shared/',
      body: 'Router lives in shared/ so both bridges classify identically.',
      links: [],
      decision: 'save',
      reason: 'clear decision',
    },
  ],
})

describe('MemoryDistiller', () => {
  let dir: string
  let path: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cockpit-distill-'))
    path = join(dir, 'session.jsonl')
    writeFileSync(
      path,
      line({ type: 'user', message: { content: 'why is the router in shared?' } }) +
        line({ type: 'assistant', message: { content: 'so both bridges agree' } }),
    )
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('distills a transcript into validated observations', async () => {
    const runner: ClaudeRunner = vi.fn(async () => goodReply)
    const d = new MemoryDistiller(stubProjects(dir), new TranscriptReader(), runner)
    const out = await d.distill({ projectId: 'p1', transcriptPath: path, projectSlugs: [], userSlugs: [] })
    expect(out.error).toBeUndefined()
    expect(out.observations).toHaveLength(1)
    expect(out.observations[0].targetSlug).toBe('router-placement')
    expect(out.nextOffset).toBeGreaterThan(0)
  })

  it('short-circuits an empty transcript without calling the model', async () => {
    writeFileSync(path, line({ type: 'summary', summary: 'nothing' }))
    const runner = vi.fn(async () => goodReply)
    const d = new MemoryDistiller(stubProjects(dir), new TranscriptReader(), runner)
    const out = await d.distill({ projectId: 'p1', transcriptPath: path, projectSlugs: [], userSlugs: [] })
    expect(out.observations).toEqual([])
    expect(runner).not.toHaveBeenCalled()
  })

  it('retries once on a non-JSON reply, then succeeds', async () => {
    const runner = vi
      .fn<ClaudeRunner>()
      .mockResolvedValueOnce('sorry, here is prose with no json')
      .mockResolvedValueOnce(goodReply)
    const d = new MemoryDistiller(stubProjects(dir), new TranscriptReader(), runner)
    const out = await d.distill({ projectId: 'p1', transcriptPath: path, projectSlugs: [], userSlugs: [] })
    expect(runner).toHaveBeenCalledTimes(2)
    expect(out.observations).toHaveLength(1)
  })

  it('reports an error (and writes nothing) when both attempts fail', async () => {
    const runner = vi.fn(async () => 'never valid json')
    const d = new MemoryDistiller(stubProjects(dir), new TranscriptReader(), runner)
    const out = await d.distill({ projectId: 'p1', transcriptPath: path, projectSlugs: [], userSlugs: [] })
    expect(out.observations).toEqual([])
    expect(out.error).toBeTruthy()
  })

  it('surfaces a CLI failure as an error, not a throw', async () => {
    const runner = vi.fn(async () => {
      throw new Error('claude not found')
    })
    const d = new MemoryDistiller(stubProjects(dir), new TranscriptReader(), runner)
    const out = await d.distill({ projectId: 'p1', transcriptPath: path, projectSlugs: [], userSlugs: [] })
    expect(out.error).toContain('claude not found')
  })
})
