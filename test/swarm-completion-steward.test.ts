import { describe, expect, it, vi } from 'vitest'
import { CockpitEvents } from '../electron/main/events'
import {
  HERMES_COMPLETION_MODEL,
  HermesCompletionSummaryService,
  type HermesCompletionRunner,
} from '../electron/main/services/hermes/HermesCompletionSummaryService'
import { SwarmCompletionSteward } from '../electron/main/services/SwarmCompletionSteward'
import type { CompletionReport } from '../shared/completion-report'
import { HERMES_MAIN_MODEL } from '../shared/hermes-model-policy'
import {
  COMPLETION_CONTEXT_CAP,
  buildCompletionEvidence,
  completionCardId,
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
})

describe('HermesCompletionSummaryService', () => {
  it('pins nuanced completion judgment to Pro and runs tool-less over fenced evidence', async () => {
    expect(HERMES_COMPLETION_MODEL).toBe(HERMES_MAIN_MODEL)
    const runner: HermesCompletionRunner = vi.fn(async () => ({
      stdout: JSON.stringify({
        headline: MANAGER.headline,
        action: MANAGER.action,
      }),
    }))
    const service = new HermesCompletionSummaryService(
      runner,
      () => MANAGER.at,
      () => 'fixed-fence',
    )
    const evidence = buildCompletionEvidence(REPORT, '24 tests passed')

    await expect(service.summarize(evidence)).resolves.toEqual(MANAGER)

    const args = (runner as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[]
    expect(args).toContain('--ignore-rules')
    expect(args).toContain('-m')
    expect(args).toContain(HERMES_MAIN_MODEL)
    expect(args).not.toContain('-t')
    const prompt = args[args.indexOf('--oneshot') + 1]
    expect(prompt).toContain('UNTRUSTED COMPLETION EVIDENCE')
    expect(prompt).toContain('fixed-fence')
  })

  it('fails closed to null on runner or parser failure and never retries', async () => {
    const runner: HermesCompletionRunner = vi.fn(async () => ({ stdout: 'not json' }))
    const service = new HermesCompletionSummaryService(runner)
    await expect(service.summarize(buildCompletionEvidence(REPORT, ''))).resolves.toBeNull()
    expect(runner).toHaveBeenCalledTimes(1)
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
      publishStaged: vi.fn(() => pending),
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
})
