import { describe, expect, it } from 'vitest'
import type { CouncilSessionSummary } from '../shared/council'
import { councilHistoryPresentation, visibleCouncilSessions } from '../shared/council-history'

function summary(overrides: Partial<CouncilSessionSummary> = {}): CouncilSessionSummary {
  return {
    id: 'session-1',
    cardId: null,
    mode: 'spec',
    question: null,
    verdictKind: null,
    status: 'final',
    ok: true,
    seatsRun: 5,
    createdAt: '2026-07-10T00:00:00.000Z',
    ...overrides,
  }
}

describe('council history presentation', () => {
  it('renders a pending placeholder as running even though its result is not ok yet', () => {
    expect(councilHistoryPresentation(summary({ status: 'pending', ok: false }))).toEqual({
      tone: 'pending',
      label: 'Convening',
    })
  })

  it('keeps successful diff reviews neutral instead of presenting them as failed', () => {
    expect(
      councilHistoryPresentation(summary({ mode: 'diff', status: 'final', ok: true })),
    ).toEqual({ tone: 'final', label: 'Reviewed' })
  })

  it('distinguishes approved, clarification, and genuinely failed sessions', () => {
    expect(councilHistoryPresentation(summary({ verdictKind: 'approved' })).tone).toBe('approved')
    expect(
      councilHistoryPresentation(summary({ verdictKind: 'needs_clarification' })).tone,
    ).toBe('clarify')
    expect(councilHistoryPresentation(summary({ status: 'failed', ok: false })).tone).toBe('failed')
    expect(councilHistoryPresentation(summary({ status: 'final', ok: false })).tone).toBe('failed')
  })

  it('shows only the three most recent sessions until history is expanded', () => {
    const sessions = Array.from({ length: 5 }, (_, index) => summary({ id: `session-${index}` }))
    expect(visibleCouncilSessions(sessions, false).map((session) => session.id)).toEqual([
      'session-0',
      'session-1',
      'session-2',
    ])
    expect(visibleCouncilSessions(sessions, true)).toHaveLength(5)
  })
})
