import { describe, expect, it, vi } from 'vitest'
import { CockpitEvents } from '../electron/main/events'
import { SwarmCompletionSteward } from '../electron/main/services/SwarmCompletionSteward'
import type { CompletionReport } from '../shared/completion-report'
import {
  COMPLETION_CONTEXT_CAP,
  buildCompletionEvidence,
  completionCardId,
  deterministicCompletionTriage,
  parseCompletionManagerResponse,
  parseCompletionEvidence,
  type CompletionEvidence,
} from '../shared/swarm-completion'
import { buildSignal, type SentinelSignal, type SentinelTriage } from '../shared/sentinel'

const REPORT: CompletionReport = {
  cardId: 'c1',
  title: 'Add the widget',
  branch: 'swarm/add-widget-c1',
  diffStat: { files: 3, insertions: 42, deletions: 7 },
  worktreeState: 'changed',
  acceptance: ['Widget renders', 'Input is validated'],
  hasCouncilSpec: true,
  finishedAt: '2026-07-12T01:00:00.000Z',
}

const MANAGER: SentinelTriage = {
  reportWorthy: true,
  headline: 'Widget is ready; one failed check needs attention',
  action: 'Review the three-file diff and rerun typecheck',
  gotchaCandidate: false,
  at: '2026-07-12T01:01:00.000Z',
}

describe('completion evidence', () => {
  it('turns only bounded, relevant terminal facts into valid persisted JSON', () => {
    const noisy = [
      '\u001b[32m✓ 24 tests passed\u001b[0m',
      'npm run typecheck',
      'Type error: Property x does not exist',
      'uninteresting repaint line '.repeat(400),
      'npm run lint — passed',
      'Error: leaked key AKIAIOSFODNN7EXAMPLE',
    ].join('\n')
    const evidence = buildCompletionEvidence(REPORT, noisy)

    expect(evidence.card).toMatchObject({ id: 'c1', hasCouncilSpec: true })
    expect(evidence.worktreeState).toBe('changed')
    expect(evidence.checks).toEqual(
      expect.arrayContaining([
        { name: 'test', status: 'passed' },
        { name: 'typecheck', status: 'failed' },
        { name: 'lint', status: 'passed' },
      ]),
    )
    expect(evidence.markers.join('\n')).toContain('24 tests passed')
    expect(evidence.markers.join('\n')).not.toContain('\u001b')
    expect(evidence.context).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(evidence.context).toContain('[REDACTED]')

    const context = evidence.context
    expect(context.length).toBeLessThanOrEqual(COMPLETION_CONTEXT_CAP)
    expect(() => JSON.parse(context)).not.toThrow()
    expect(parseCompletionEvidence(context)).toEqual(evidence)
    expect(completionCardId({ source: 'swarm-completion', context })).toBe('c1')
  })

  it('keeps a huge spec and output bounded without truncating JSON syntax', () => {
    const evidence = buildCompletionEvidence(
      {
        ...REPORT,
        acceptance: Array.from({ length: 40 }, (_, i) => `criterion-${i}-${'x'.repeat(400)}`),
      },
      Array.from({ length: 100 }, (_, i) => `Error ${i}: ${'y'.repeat(500)}`).join('\n'),
    )
    expect(evidence.context.length).toBeLessThanOrEqual(COMPLETION_CONTEXT_CAP)
    expect(parseCompletionEvidence(evidence.context)?.card.id).toBe('c1')
  })

  it('rejects corrupt persisted evidence field-by-field and ignores non-completion targets', () => {
    const valid = JSON.parse(buildCompletionEvidence(REPORT, '').context) as Record<string, unknown>
    const invalid: unknown[] = [
      null,
      { ...valid, version: 2 },
      { ...valid, card: null },
      { ...valid, card: { ...(valid.card as object), id: 4 } },
      { ...valid, card: { ...(valid.card as object), title: null } },
      { ...valid, card: { ...(valid.card as object), branch: 7 } },
      { ...valid, card: { ...(valid.card as object), hasCouncilSpec: 'yes' } },
      { ...valid, card: { ...(valid.card as object), acceptance: [4] } },
      { ...valid, worktreeState: 'mystery' },
      { ...valid, checks: [{ name: 'deploy', status: 'passed' }] },
      { ...valid, checks: [{ name: 'test', status: 'maybe' }] },
      { ...valid, markers: [9] },
      { ...valid, finishedAt: 9 },
      { ...valid, changes: undefined },
      { ...valid, changes: { files: '3', insertions: 2, deletions: 1 } },
    ]
    for (const value of invalid) expect(parseCompletionEvidence(JSON.stringify(value))).toBeNull()
    expect(parseCompletionEvidence(null)).toBeNull()
    expect(parseCompletionEvidence('{broken')).toBeNull()
    expect(completionCardId({ source: 'worker-exit', context: JSON.stringify(valid) })).toBeNull()
    expect(completionCardId({ source: 'swarm-completion', context: '{broken' })).toBeNull()
  })

  it('parses manager JSON defensively and covers every deterministic fallback tone', () => {
    const now = '2026-07-12T02:00:00.000Z'
    expect(parseCompletionManagerResponse('no json', now)).toBeNull()
    expect(parseCompletionManagerResponse('{broken}', now)).toBeNull()
    expect(parseCompletionManagerResponse('{"headline":"","action":"go"}', now)).toBeNull()
    expect(parseCompletionManagerResponse('{"headline":4,"action":"go"}', now)).toBeNull()
    const parsed = parseCompletionManagerResponse(
      `prose {"headline":"ok\\u0007${'x'.repeat(300)}","action":"review"} tail`,
      now,
    )
    expect(parsed?.headline).toHaveLength(160)
    expect(parsed?.headline).not.toContain('\u0007')

    const failed = deterministicCompletionTriage(
      buildCompletionEvidence(REPORT, 'npm run typecheck — failed'),
      now,
    )
    expect(failed.headline).toContain('typecheck')
    expect(failed.action).toContain('rerun typecheck')
    const passed = deterministicCompletionTriage(
      buildCompletionEvidence(REPORT, '24 tests passed'),
      now,
    )
    expect(passed.action).toContain('acceptance criteria')
    const unknown = deterministicCompletionTriage(buildCompletionEvidence(REPORT, ''), now)
    expect(unknown.action).toContain('not confirmed')
  })
})

function stagedSignal(input: {
  projectId: string
  severity: 'notice'
  source: 'swarm-completion'
  title: string
  summary: string
  context?: string | null
  dedupKey?: string
}): SentinelSignal {
  return buildSignal({
    id: 'sig_completion_1',
    createdAt: REPORT.finishedAt,
    ...input,
  })
}

describe('SwarmCompletionSteward', () => {
  it('persists evidence before Pro runs, ignores other sessions, then publishes once', async () => {
    const events = new CockpitEvents()
    const order: string[] = []
    let persisted = false
    const sentinel = {
      stage: vi.fn((input: Parameters<typeof stagedSignal>[0]) => {
        persisted = true
        order.push('stage')
        return stagedSignal(input)
      }),
      publishStaged: vi.fn((_projectId: string, _id: string, verdict: SentinelTriage) => {
        order.push('publish')
        return { ...stagedSignal({
          projectId: 'p1',
          severity: 'notice',
          source: 'swarm-completion',
          title: 'Ready',
          summary: 'ready',
        }), triage: verdict }
      }),
      pendingStaged: vi.fn(() => []),
    }
    const summarizer = {
      summarize: vi.fn(async (_evidence: CompletionEvidence) => {
        expect(persisted).toBe(true)
        order.push('model')
        return MANAGER
      }),
    }
    const steward = new SwarmCompletionSteward(events, sentinel, summarizer)
    steward.track('term-c1')
    events.emitTyped('terminal:data', { sessionId: 'other', data: 'Error: foreign secret', at: 't' })
    events.emitTyped('terminal:data', { sessionId: 'term-c1', data: '24 tests passed', at: 't' })

    await steward.complete({ projectId: 'p1', sessionId: 'term-c1', report: REPORT })

    expect(order).toEqual(['stage', 'model', 'publish'])
    expect(sentinel.stage).toHaveBeenCalledTimes(1)
    const input = sentinel.stage.mock.calls[0][0]
    expect(input).toMatchObject({
      source: 'swarm-completion',
      severity: 'notice',
      dedupKey: `card:${REPORT.cardId}:${REPORT.finishedAt}`,
    })
    expect(input.context).toContain('24 tests passed')
    expect(input.context).not.toContain('foreign secret')
    expect(sentinel.publishStaged).toHaveBeenCalledWith('p1', 'sig_completion_1', MANAGER)
  })

  it('skips Pro when the persisted signal is a duplicate replay', async () => {
    const events = new CockpitEvents()
    const sentinel = {
      stage: vi.fn(() => null),
      publishStaged: vi.fn(),
      pendingStaged: vi.fn(() => []),
    }
    const summarizer = { summarize: vi.fn(async () => MANAGER) }
    const steward = new SwarmCompletionSteward(events, sentinel, summarizer)

    await steward.complete({ projectId: 'p1', sessionId: 'term-c1', report: REPORT })

    expect(summarizer.summarize).not.toHaveBeenCalled()
    expect(sentinel.publishStaged).not.toHaveBeenCalled()
  })

  it('publishes a deterministic fallback and can resume a crash-staged row', async () => {
    const events = new CockpitEvents()
    const evidence = buildCompletionEvidence(REPORT, 'typecheck not observed')
    const pending = stagedSignal({
      projectId: 'p1',
      severity: 'notice',
      source: 'swarm-completion',
      title: 'Ready for review · Add the widget',
      summary: 'deterministic summary',
      context: evidence.context,
      dedupKey: `card:${REPORT.cardId}:${REPORT.finishedAt}`,
    })
    const sentinel = {
      stage: vi.fn(() => pending),
      publishStaged: vi.fn(
        (_projectId: string, _id: string, _triage: SentinelTriage) => pending,
      ),
      pendingStaged: vi.fn(() => [pending]),
    }
    const summarizer = { summarize: vi.fn(async () => null) }
    const steward = new SwarmCompletionSteward(events, sentinel, summarizer)

    await steward.resumePending()

    expect(sentinel.publishStaged).toHaveBeenCalledTimes(1)
    const fallback = sentinel.publishStaged.mock.calls[0][2]
    expect(fallback).toMatchObject({ reportWorthy: true, gotchaCandidate: false })
    expect(fallback.headline).toContain('Add the widget')
    expect(fallback.action).toMatch(/review/i)
  })

  it('bounds long tracked output, tolerates null sessions, and isolates collaborator failures', async () => {
    const events = new CockpitEvents()
    const staged = stagedSignal({
      projectId: 'p1',
      severity: 'notice',
      source: 'swarm-completion',
      title: 'Ready',
      summary: 'ready',
    })
    const sentinel = {
      stage: vi
        .fn()
        .mockReturnValueOnce(staged)
        .mockReturnValueOnce(staged)
        .mockImplementationOnce(() => {
          throw new Error('disk unavailable')
        }),
      publishStaged: vi.fn(() => staged),
      pendingStaged: vi
        .fn()
        .mockReturnValueOnce([
          { ...staged, context: '{broken' },
          { ...staged, id: 'sig_valid', context: buildCompletionEvidence(REPORT, '').context },
        ])
        .mockImplementationOnce(() => {
          throw new Error('db unavailable')
        }),
    }
    const summarizer = {
      summarize: vi
        .fn()
        .mockResolvedValueOnce(MANAGER)
        .mockRejectedValueOnce(new Error('model unavailable'))
        .mockResolvedValue(MANAGER),
    }
    const steward = new SwarmCompletionSteward(events, sentinel, summarizer)
    steward.track('large')
    steward.track('large') // idempotent branch
    events.emitTyped('terminal:data', {
      sessionId: 'large',
      data: `${'noise'.repeat(20_000)}\n24 tests passed`,
      at: 't',
    })
    await steward.complete({ projectId: 'p1', sessionId: 'large', report: REPORT })
    await steward.complete({ projectId: 'p1', sessionId: null, report: REPORT })
    await expect(
      steward.complete({ projectId: 'p1', sessionId: 'missing', report: REPORT }),
    ).resolves.toBeUndefined()
    steward.discard('missing')
    steward.clear()

    await steward.resumePending()
    await expect(steward.resumePending()).resolves.toBeUndefined()
    expect(sentinel.publishStaged).toHaveBeenCalled()
  })
})
