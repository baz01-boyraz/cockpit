import { describe, expect, it, vi } from 'vitest'
import {
  MemoryCurationService,
  type HermesCurationRunner,
} from '../electron/main/services/MemoryCurationService'
import type { MemoryDoc } from '../shared/memory-hub'

const DOCS: MemoryDoc[] = [
  { name: 'stale-fact', content: '# Stale fact\n\nSomething that used to be true.\n', updatedAt: '2026-01-01T00:00:00.000Z' },
  { name: 'canonical', content: '# Canonical\n\nThe surviving note.\n', updatedAt: '2026-06-01T00:00:00.000Z' },
  { name: 'duplicate', content: '# Duplicate\n\nSays the same as canonical.\n', updatedAt: '2026-05-01T00:00:00.000Z' },
]

function makeDeps(docs: MemoryDoc[] = DOCS) {
  const created: {
    kind: string
    slug: string
    title: string
    operation?: string | null
    alsoTrash?: string | null
    alsoTrashContent?: string | null
  }[] = []
  const audited: { actionType: string; payload?: Record<string, unknown> }[] = []
  const memory = { listDocs: vi.fn(() => docs.map((d) => ({ ...d }))) }
  const reviews = {
    create: vi.fn((input: {
      kind: string
      slug: string
      title: string
      operation?: string | null
      alsoTrash?: string | null
      alsoTrashContent?: string | null
    }) => {
      created.push(input)
      return {} as never
    }),
  }
  const audit = {
    record: vi.fn((input: { actionType: string; payload?: Record<string, unknown> }) => {
      audited.push(input)
      return {} as never
    }),
  }
  return { memory, reviews, audit, created, audited }
}

const NOW = () => Date.parse('2026-07-08T00:00:00.000Z')

describe('MemoryCurationService.sweep', () => {
  it('queues a review + audits for each inventory-backed proposal (happy path)', async () => {
    const deps = makeDeps()
    const runner: HermesCurationRunner = vi.fn(async () => ({
      stdout: JSON.stringify([
        { note: 'stale-fact', action: 'archive', reason: 'no longer true' },
        { note: 'duplicate', action: 'merge', into: 'canonical', reason: 'same as canonical' },
      ]),
    }))
    const svc = new MemoryCurationService(deps.memory, deps.reviews, deps.audit, runner, NOW)

    const result = await svc.sweep('p1')

    expect(result).toEqual({ proposals: 2 })
    expect(deps.created).toHaveLength(2)
    // Archive is an explicit, recoverable cleanup operation.
    expect(deps.created[0]).toMatchObject({
      kind: 'maintenance',
      slug: 'stale-fact',
      operation: 'archive',
    })
    // Merge: survivor is `into`, the duplicate is queued to trash on accept.
    expect(deps.created[1]).toMatchObject({
      kind: 'maintenance',
      slug: 'canonical',
      operation: 'merge',
      alsoTrash: 'duplicate',
      alsoTrashContent: DOCS[2].content,
    })
    expect(deps.audited).toHaveLength(1)
    expect(deps.audited[0].actionType).toBe('memory.curation_sweep')
    expect(deps.audited[0].payload).toMatchObject({
      proposals: 2,
      notes: 3,
      model: 'deepseek/deepseek-v4-flash',
      modelRole: 'bounded-mechanical-analysis',
      modelPolicyVersion: 1,
    })
  })

  it('drops proposals that reference notes not in the inventory', async () => {
    const deps = makeDeps()
    const runner: HermesCurationRunner = vi.fn(async () => ({
      stdout: JSON.stringify([
        { note: 'ghost-note', action: 'archive', reason: 'hallucinated' },
        { note: 'duplicate', action: 'merge', into: 'also-ghost', reason: 'bad target' },
        { note: 'stale-fact', action: 'archive', reason: 'real one' },
      ]),
    }))
    const svc = new MemoryCurationService(deps.memory, deps.reviews, deps.audit, runner, NOW)

    const result = await svc.sweep('p1')

    expect(result).toEqual({ proposals: 1 })
    expect(deps.created).toHaveLength(1)
    expect(deps.created[0].slug).toBe('stale-fact')
  })

  it('returns null and creates nothing when output is garbage', async () => {
    const deps = makeDeps()
    const runner: HermesCurationRunner = vi.fn(async () => ({ stdout: 'I could not decide, sorry.' }))
    const svc = new MemoryCurationService(deps.memory, deps.reviews, deps.audit, runner, NOW)

    await expect(svc.sweep('p1')).resolves.toBeNull()
    expect(deps.created).toHaveLength(0)
    expect(deps.audited).toContainEqual(
      expect.objectContaining({
        actionType: 'memory.curation_failed',
        payload: { stage: 'parse' },
      }),
    )
  })

  it('records a zero-proposal sweep for a healthy hub ([] output)', async () => {
    const deps = makeDeps()
    const runner: HermesCurationRunner = vi.fn(async () => ({ stdout: '[]' }))
    const svc = new MemoryCurationService(deps.memory, deps.reviews, deps.audit, runner, NOW)

    const result = await svc.sweep('p1')

    expect(result).toEqual({ proposals: 0 })
    expect(deps.created).toHaveLength(0)
    // A real, recordable sweep — the cadence marks the hub swept so it won't re-run.
    expect(deps.audited).toHaveLength(1)
  })

  it('returns null on a runner timeout — no throw, no creates', async () => {
    const deps = makeDeps()
    const runner: HermesCurationRunner = vi.fn(async () => {
      throw Object.assign(new Error('Command failed'), { killed: true })
    })
    const svc = new MemoryCurationService(deps.memory, deps.reviews, deps.audit, runner, NOW)

    await expect(svc.sweep('p1')).resolves.toBeNull()
    expect(deps.created).toHaveLength(0)
    expect(deps.audited).toContainEqual(
      expect.objectContaining({
        actionType: 'memory.curation_failed',
        payload: { stage: 'runner' },
      }),
    )
  })

  it('returns null for an empty hub without calling the model', async () => {
    const deps = makeDeps([])
    const runner: HermesCurationRunner = vi.fn(async () => ({ stdout: '[]' }))
    const svc = new MemoryCurationService(deps.memory, deps.reviews, deps.audit, runner, NOW)

    await expect(svc.sweep('p1')).resolves.toBeNull()
    expect(runner).not.toHaveBeenCalled()
  })

  it('passes the cheap model + oneshot argv, prompt is a discrete argv entry', async () => {
    const deps = makeDeps()
    const runner: HermesCurationRunner = vi.fn(async () => ({ stdout: '[]' }))
    const svc = new MemoryCurationService(deps.memory, deps.reviews, deps.audit, runner, NOW)

    await svc.sweep('p1')

    const args = (runner as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[]
    expect(args).toContain('--ignore-rules')
    expect(args).toEqual(expect.arrayContaining(['-m', 'deepseek/deepseek-v4-flash']))
    expect(args).toContain('--oneshot')
    const prompt = args[args.indexOf('--oneshot') + 1]
    expect(prompt).toMatch(/UNTRUSTED DATA/)
    expect(prompt).toMatch(/Lifecycle/)
  })
})
