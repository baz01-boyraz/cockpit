import { describe, expect, it } from 'vitest'
import { buildDistillPrompt, parseObservations } from '@shared/memory-observation'
import type { TranscriptTurn } from '@shared/transcript'

const turns: TranscriptTurn[] = [
  { role: 'user', text: 'why put the router in shared?', timestamp: null },
  { role: 'assistant', text: 'so both bridges classify identically', timestamp: null },
]

const validReply = JSON.stringify({
  observations: [
    {
      scope: 'project',
      class: 'decision',
      targetSlug: 'router-placement',
      isNew: true,
      title: 'Router lives in shared/',
      body: 'The router is in shared/ so the real bridge and the mock classify identically.',
      links: [],
      decision: 'save',
      reason: 'clear architectural decision with a reason',
    },
  ],
})

describe('buildDistillPrompt', () => {
  it('includes the transcript, existing slugs, and the strict-JSON instruction', () => {
    const p = buildDistillPrompt({ turns, projectSlugs: ['ipc-contract'], userSlugs: ['model-routing'] })
    expect(p).toContain('why put the router in shared?')
    expect(p).toContain('ipc-contract')
    expect(p).toContain('model-routing')
    expect(p).toContain('STRICT JSON')
    expect(p).toContain('DEV:')
    expect(p).toContain('AI:')
  })

  it('handles empty hubs gracefully', () => {
    const p = buildDistillPrompt({ turns, projectSlugs: [], userSlugs: [] })
    expect(p).toContain('(none yet)')
  })

  it('asks the model to surface a failure→correction pattern as a gotcha', () => {
    const p = buildDistillPrompt({ turns, projectSlugs: [], userSlugs: [] })
    expect(p).toContain('mistake-then-correction')
    expect(p).toContain('gotcha')
    // The addition must not lower the existing precision-over-recall bar.
    expect(p).toContain('precision over recall')
    expect(p).toContain('empty list')
  })

  it('forbids unresolved task status and caps one turn to a few consolidated facts', () => {
    const p = buildDistillPrompt({ turns, projectSlugs: [], userSlugs: [] })
    expect(p).toMatch(/at most 3 observations/i)
    expect(p).toMatch(/planned fix|unresolved diagnosis/i)
    expect(p).toMatch(/verified/i)
    expect(p).toMatch(/combine|consolidat/i)
  })
})

describe('parseObservations', () => {
  it('parses a clean JSON reply', () => {
    const r = parseObservations(validReply)
    expect(r.ok).toBe(true)
    expect(r.observations).toHaveLength(1)
    expect(r.observations[0].targetSlug).toBe('router-placement')
    expect(r.observations[0].decision).toBe('save')
  })

  it('tolerates a code fence and surrounding prose', () => {
    const noisy = 'Here is the result:\n```json\n' + validReply + '\n```\nHope that helps!'
    const r = parseObservations(noisy)
    expect(r.ok).toBe(true)
    expect(r.observations).toHaveLength(1)
  })

  it('accepts an empty observation list', () => {
    const r = parseObservations('{"observations":[]}')
    expect(r.ok).toBe(true)
    expect(r.observations).toEqual([])
  })

  it('rejects invalid JSON', () => {
    const r = parseObservations('not json at all')
    expect(r.ok).toBe(false)
    expect(r.error).toBeTruthy()
  })

  it('rejects a schema-invalid observation (bad class / bad slug)', () => {
    const bad = JSON.stringify({
      observations: [{ scope: 'project', class: 'nonsense', targetSlug: 'ok', isNew: true, title: 'x', body: 'y', decision: 'save', reason: 'z' }],
    })
    expect(parseObservations(bad).ok).toBe(false)

    const badSlug = JSON.stringify({
      observations: [{ scope: 'project', class: 'decision', targetSlug: 'Bad Slug/../x', isNew: true, title: 'x', body: 'y', decision: 'save', reason: 'z' }],
    })
    expect(parseObservations(badSlug).ok).toBe(false)
  })

  it('rejects a noisy reply with more than three observations', () => {
    const one = JSON.parse(validReply).observations[0]
    const noisy = JSON.stringify({
      observations: Array.from({ length: 4 }, (_, index) => ({
        ...one,
        targetSlug: `fact-${index}`,
      })),
    })

    expect(parseObservations(noisy).ok).toBe(false)
  })
})
