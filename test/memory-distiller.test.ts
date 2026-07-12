import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryDistiller, type DistillRunner } from '../electron/main/services/MemoryDistiller'
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
    const runner: DistillRunner = vi.fn(async () => goodReply)
    const d = new MemoryDistiller(stubProjects(dir), new TranscriptReader(), runner)
    const out = await d.distill({ projectId: 'p1', transcriptPath: path, projectSlugs: [], userSlugs: [] })
    expect(out.error).toBeUndefined()
    expect(out.observations).toHaveLength(1)
    expect(out.observations[0].targetSlug).toBe('router-placement')
    expect(out.nextOffset).toBeGreaterThan(0)
  })

  it('defaults mechanical distillation to DeepSeek V4 Flash', async () => {
    const runner: DistillRunner = vi.fn(async () => goodReply)
    const d = new MemoryDistiller(stubProjects(dir), new TranscriptReader(), runner)

    await d.distill({ projectId: 'p1', transcriptPath: path, projectSlugs: [], userSlugs: [] })

    expect(runner).toHaveBeenCalledWith(
      dir,
      expect.any(String),
      'deepseek/deepseek-v4-flash',
    )
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
      .fn<DistillRunner>()
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
      throw new Error('hermes not found')
    })
    const d = new MemoryDistiller(stubProjects(dir), new TranscriptReader(), runner)
    const out = await d.distill({ projectId: 'p1', transcriptPath: path, projectSlugs: [], userSlugs: [] })
    expect(out.error).toContain('hermes not found')
  })

  it('feeds a failure→correction session through a prompt that asks about it', async () => {
    // A synthetic transcript with an obvious mistake-then-correction pattern.
    writeFileSync(
      path,
      line({ type: 'user', message: { content: 'the build is broken after my import change' } }) +
        line({
          type: 'assistant',
          message: {
            content:
              'I first tried a relative import path, but it failed to resolve at build time; ' +
              'switching to the @shared/ alias fixed it.',
          },
        }),
    )
    const gotchaReply = JSON.stringify({
      observations: [
        {
          scope: 'project',
          class: 'gotcha',
          targetSlug: 'shared-import-alias',
          isNew: true,
          title: 'Use @shared/ alias, not relative paths',
          body: 'Relative imports into shared/ fail at build time; the @shared/ alias resolves.',
          links: [],
          decision: 'save',
          reason: 'failure then correction',
        },
      ],
    })
    let capturedPrompt = ''
    const runner: DistillRunner = vi.fn(async (_cwd, prompt) => {
      capturedPrompt = prompt
      return gotchaReply
    })
    const d = new MemoryDistiller(stubProjects(dir), new TranscriptReader(), runner)
    const out = await d.distill({ projectId: 'p1', transcriptPath: path, projectSlugs: [], userSlugs: [] })

    // The prompt the distiller sent must explicitly ask for the failure pattern,
    // and must carry the transcript's failure content.
    expect(capturedPrompt).toContain('mistake-then-correction')
    expect(capturedPrompt).toContain('failed to resolve at build time')
    // And the (mocked) reply surfaces it as a durable gotcha.
    expect(out.error).toBeUndefined()
    expect(out.observations).toHaveLength(1)
    expect(out.observations[0].class).toBe('gotcha')
  })
})
