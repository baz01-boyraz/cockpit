/**
 * Council store-slice tests — the renderer half of the "council results vanish
 * when you switch views" fix. The run state was lifted out of volatile component
 * state into the store's council slice; these tests pin the guarantees that
 * close the bug: a convened verdict survives a same-project remount, the convene
 * promise resolves in the slice (not a component) so a run that finishes off-view
 * still lands, and a genuine project switch still clears everything.
 *
 * Lives under src/ (not test/) so the web tsconfig — which carries the DOM lib
 * the store transitively needs — typechecks it. Vitest picks it up via the
 * `src/**\/*.test.ts` include.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CouncilResult } from '@shared/council'

const run = vi.fn<(...args: never[]) => Promise<CouncilResult>>()
const session = vi.fn<(...args: never[]) => Promise<CouncilResult | null>>()

vi.mock('../../lib/cockpit', () => ({
  cockpit: () => ({ council: { run, session } }),
  isMockBackend: () => false,
}))

// Imported after the mock so the slice's `cockpit()` resolves to the fake above.
import { useStore } from '../useStore'

function makeResult(over: Partial<CouncilResult> = {}): CouncilResult {
  return {
    ok: true,
    mode: 'spec',
    seats: [],
    rankings: [],
    aggregate: [],
    labelToSeat: {},
    verdict: '### 🎯 Verdict\nAPPROVED',
    specVerdict: { kind: 'approved', questions: [] },
    error: null,
    stats: { seatsRun: 5, seatsFailed: 0, filesReviewed: 0, durationMs: 10 },
    sessionId: 'sess-x',
    ...over,
  }
}

beforeEach(() => {
  run.mockReset()
  session.mockReset()
  useStore.setState({
    activeProjectId: 'prj_1',
    councilProjectId: null,
    councilActive: null,
    councilConvening: false,
    councilNotice: null,
    councilConveningCardId: null,
    councilCardResult: null,
  })
})

describe('council slice — standalone run', () => {
  it('lands a convened verdict in the store (resolves in-slice, not a component)', async () => {
    run.mockResolvedValue(makeResult({ sessionId: 'sess-1' }))
    await useStore.getState().conveneCouncil('prj_1', 'Add caching to the gateway')
    const s = useStore.getState()
    expect(s.councilConvening).toBe(false)
    expect(s.councilActive?.id).toBe('sess-1')
    expect(s.councilActive?.result?.sessionId).toBe('sess-1')
    expect(s.councilNotice).toBeTruthy()
  })

  it('a convened verdict survives a same-project reset (the vanishing-verdict guard)', async () => {
    run.mockResolvedValue(makeResult({ sessionId: 'sess-1' }))
    await useStore.getState().conveneCouncil('prj_1', 'x')
    // A view switch remounts the panel, which calls resetCouncil for the SAME project.
    useStore.getState().resetCouncil('prj_1')
    expect(useStore.getState().councilActive?.result?.sessionId).toBe('sess-1')
  })

  it('a genuine project switch clears the run', async () => {
    run.mockResolvedValue(makeResult())
    await useStore.getState().conveneCouncil('prj_1', 'x')
    useStore.getState().resetCouncil('prj_2')
    const s = useStore.getState()
    expect(s.councilActive).toBeNull()
    expect(s.councilProjectId).toBe('prj_2')
  })

  it('discards a verdict when the active project switched away mid-run', async () => {
    run.mockImplementation(async () => {
      useStore.setState({ activeProjectId: 'prj_2' })
      return makeResult({ sessionId: 'stale' })
    })
    await useStore.getState().conveneCouncil('prj_1', 'x')
    // The staleness guard tripped — the prj_1 verdict was never applied.
    expect(useStore.getState().councilActive?.result).toBeNull()
  })

  it('continues a clarification in place with the author answers and preserves the original request', async () => {
    run
      .mockResolvedValueOnce(
        makeResult({
          sessionId: 'sess-clarify',
          verdict: '### 🎯 Verdict\nNEEDS_CLARIFICATION',
          specVerdict: {
            kind: 'needs_clarification',
            questions: ['Which module owns the cache?'],
          },
        }),
      )
      .mockResolvedValueOnce(makeResult({ sessionId: 'sess-approved' }))

    await useStore.getState().conveneCouncil('prj_1', 'Add caching to the gateway')
    await useStore.getState().continueCouncil('prj_1', [
      {
        id: 'question-1',
        question: 'Which module owns the cache?',
        answer: 'The shared gateway module.',
      },
    ])

    expect(run).toHaveBeenCalledTimes(2)
    const continuation = run.mock.calls[1][1] as { mode: string; spec: string }
    expect(continuation.mode).toBe('spec')
    expect(continuation.spec).toContain('Add caching to the gateway')
    expect(continuation.spec).toContain('Which module owns the cache?')
    expect(continuation.spec).toContain('The shared gateway module.')
    expect(useStore.getState().councilActive?.spec).toBe('Add caching to the gateway')
    expect(useStore.getState().councilActive?.result?.specVerdict?.kind).toBe('approved')
  })

  it('does not re-run Council until every visible clarification has an answer', async () => {
    run.mockResolvedValue(
      makeResult({
        specVerdict: {
          kind: 'needs_clarification',
          questions: ['Which module?', 'What latency target?'],
        },
      }),
    )
    await useStore.getState().conveneCouncil('prj_1', 'Add caching')

    await useStore.getState().continueCouncil('prj_1', [
      { id: 'question-1', question: 'Which module?', answer: 'Shared gateway.' },
    ])

    expect(run).toHaveBeenCalledTimes(1)
    expect(useStore.getState().councilActive?.result?.specVerdict?.kind).toBe(
      'needs_clarification',
    )
  })
})

describe('council slice — swarm spec gate', () => {
  it('lands a card verdict keyed to the card, marked as a fresh run', async () => {
    run.mockResolvedValue(makeResult({ sessionId: 'sess-card' }))
    await useStore
      .getState()
      .conveneCardCouncil({ projectId: 'prj_1', cardId: 'card_1', cardTitle: 'Cache reads', spec: 'do it' })
    const cr = useStore.getState().councilCardResult
    expect(cr?.cardId).toBe('card_1')
    expect(cr?.source).toBe('run')
    expect(cr?.result?.sessionId).toBe('sess-card')
    expect(useStore.getState().councilConveningCardId).toBeNull()
  })

  it('a card verdict survives a same-project reset', async () => {
    run.mockResolvedValue(makeResult({ sessionId: 'sess-card' }))
    await useStore
      .getState()
      .conveneCardCouncil({ projectId: 'prj_1', cardId: 'card_1', cardTitle: 't', spec: 'x' })
    useStore.getState().resetCouncil('prj_1')
    expect(useStore.getState().councilCardResult?.result?.sessionId).toBe('sess-card')
  })

  it('rehydrates a persisted verdict from the detail channel, marked as a rehydrate', async () => {
    session.mockResolvedValue(makeResult({ sessionId: 'sess-old' }))
    await useStore
      .getState()
      .loadCardCouncil({ projectId: 'prj_1', cardId: 'card_9', sessionId: 'sess-old' })
    const cr = useStore.getState().councilCardResult
    expect(session).toHaveBeenCalledWith('prj_1', 'sess-old')
    expect(cr?.cardId).toBe('card_9')
    expect(cr?.source).toBe('rehydrate')
    expect(cr?.result?.sessionId).toBe('sess-old')
  })

  it('a rehydrate never clobbers an in-flight run for the same card', async () => {
    useStore.setState({
      councilConveningCardId: 'card_1',
      councilCardResult: { cardId: 'card_1', cardTitle: 't', result: null, source: 'run' },
    })
    await useStore
      .getState()
      .loadCardCouncil({ projectId: 'prj_1', cardId: 'card_1', sessionId: 'sess-old' })
    expect(session).not.toHaveBeenCalled()
    expect(useStore.getState().councilCardResult?.source).toBe('run')
  })
})
