import { describe, expect, it } from 'vitest'
import {
  OutcomeService,
  type CouncilVerdictSource,
} from '../electron/main/services/OutcomeService'
import { makeRecordingDb } from './helpers/fakeDb'

type Fate = 'swarm.card_shipped' | 'swarm.card_reworked' | 'swarm.card_abandoned'

interface AuditRow {
  seq: number
  project_id: string
  action_type: string
  payload_redacted_json: string
  created_at: string
}

interface SessionRow {
  projectId: string
  cardId: string | null
  verdictKind: string | null
}

const TERMINAL_ACTIONS = new Set<Fate>([
  'swarm.card_shipped',
  'swarm.card_reworked',
  'swarm.card_abandoned',
])

/**
 * Fake DB serving only the audit_log terminal-event scan OutcomeService runs,
 * plus a scripted CouncilVerdictSource. Enough to prove the fold + join + window.
 */
function makeService(audit: AuditRow[], sessions: SessionRow[]) {
  const { db } = makeRecordingDb({
    all: (sql, args) => {
      if (!sql.includes('audit_log')) return []
      const [projectId, sinceIso] = args as [string, string]
      return audit
        .filter(
          (r) =>
            r.project_id === projectId &&
            r.created_at >= sinceIso &&
            TERMINAL_ACTIONS.has(r.action_type as Fate),
        )
        .sort((a, b) =>
          a.created_at < b.created_at
            ? -1
            : a.created_at > b.created_at
              ? 1
              : a.seq - b.seq,
        )
        .map((r) => ({
          action_type: r.action_type,
          payload_redacted_json: r.payload_redacted_json,
          created_at: r.created_at,
        }))
    },
  })
  // Newest-first, mirroring CouncilSessionStore.listRecent (first-per-card wins).
  const council: CouncilVerdictSource = {
    listRecent: (projectId) =>
      sessions.filter((s) => s.projectId === projectId).map((s) => ({ cardId: s.cardId, verdictKind: s.verdictKind })),
  }
  return new OutcomeService(db, council)
}

let seq = 0
const event = (
  over: Partial<AuditRow> & { action_type: Fate; created_at: string } & {
    cardId: string
    councilSessionId?: string | null
  },
): AuditRow => {
  const { cardId, councilSessionId = null, action_type, created_at, project_id = 'p1' } = over
  return {
    seq: seq++,
    project_id,
    action_type,
    created_at,
    payload_redacted_json: JSON.stringify({ cardId, councilSessionId }),
  }
}

describe('OutcomeService.cardOutcomes', () => {
  it('joins a shipped card to its council verdict (gated + verdictKind)', () => {
    const svc = makeService(
      [event({ action_type: 'swarm.card_shipped', created_at: 't1', cardId: 'c1', councilSessionId: 's1' })],
      [{ projectId: 'p1', cardId: 'c1', verdictKind: 'approved' }],
    )
    expect(svc.cardOutcomes('p1', 't0')).toEqual([
      { cardId: 'c1', fate: 'shipped', gated: true, verdictKind: 'approved' },
    ])
  })

  it('folds by cardId last-wins — a re-opened, reshipped card counts once', () => {
    const svc = makeService(
      [
        event({ action_type: 'swarm.card_shipped', created_at: 't1', cardId: 'x', councilSessionId: 's1' }),
        event({ action_type: 'swarm.card_reworked', created_at: 't2', cardId: 'x', councilSessionId: 's1' }),
        event({ action_type: 'swarm.card_shipped', created_at: 't3', cardId: 'x', councilSessionId: 's1' }),
      ],
      [{ projectId: 'p1', cardId: 'x', verdictKind: 'approved' }],
    )
    const outcomes = svc.cardOutcomes('p1', 't0')
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]).toEqual({ cardId: 'x', fate: 'shipped', gated: true, verdictKind: 'approved' })
  })

  it('keeps a dangling council session gated with a null verdictKind (no join row)', () => {
    // Removed-card orphan event: the payload carries councilSessionId but the
    // council_sessions row has vanished — gated true, verdictKind null, no crash.
    const svc = makeService(
      [event({ action_type: 'swarm.card_abandoned', created_at: 't1', cardId: 'gone', councilSessionId: 's9' })],
      [],
    )
    expect(svc.cardOutcomes('p1', 't0')).toEqual([
      { cardId: 'gone', fate: 'abandoned', gated: true, verdictKind: null },
    ])
  })

  it('treats a card with no council session id as ungated', () => {
    const svc = makeService(
      [event({ action_type: 'swarm.card_shipped', created_at: 't1', cardId: 'u', councilSessionId: null })],
      [],
    )
    expect(svc.cardOutcomes('p1', 't0')).toEqual([
      { cardId: 'u', fate: 'shipped', gated: false, verdictKind: null },
    ])
  })

  it('excludes events before the sinceIso window', () => {
    const svc = makeService(
      [
        event({ action_type: 'swarm.card_shipped', created_at: 't1', cardId: 'old' }),
        event({ action_type: 'swarm.card_shipped', created_at: 't5', cardId: 'new' }),
      ],
      [],
    )
    const outcomes = svc.cardOutcomes('p1', 't3')
    expect(outcomes.map((o) => o.cardId)).toEqual(['new'])
  })

  it('rolls up folded outcomes into stats', () => {
    const svc = makeService(
      [
        event({ action_type: 'swarm.card_shipped', created_at: 't1', cardId: 'a', councilSessionId: 's1' }),
        event({ action_type: 'swarm.card_abandoned', created_at: 't2', cardId: 'b', councilSessionId: 's2' }),
        event({ action_type: 'swarm.card_shipped', created_at: 't3', cardId: 'c', councilSessionId: null }),
      ],
      [
        { projectId: 'p1', cardId: 'a', verdictKind: 'approved' },
        { projectId: 'p1', cardId: 'b', verdictKind: 'needs_clarification' },
      ],
    )
    const stats = svc.cardOutcomeStats('p1', 't0')
    expect(stats.total).toBe(3)
    expect(stats.fateMix).toEqual({ shipped: 2, reworked: 0, abandoned: 1 })
    // gated: a(shipped) + b(abandoned) → 1 of 2; ungated: c(shipped) → 1 of 1.
    expect(stats.shipRate.gated).toBeCloseTo(0.5)
    expect(stats.shipRate.ungated).toBeCloseTo(1)
    expect(stats.gateCalibration.approvedShipRate).toBeCloseTo(1)
    expect(stats.gateCalibration.needsClarificationShipRate).toBeCloseTo(0)
  })
})
