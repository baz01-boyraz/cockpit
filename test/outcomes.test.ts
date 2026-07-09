import { describe, expect, it } from 'vitest'
import {
  computeCardOutcomeStats,
  computeMemoryEarnedKeep,
  computeTriageAccuracy,
  type CardOutcome,
  type TriageSignalOutcome,
} from '../shared/outcomes'

/** Terse fixture builder — every field defaulted so a case names only what matters. */
const outcome = (over: Partial<CardOutcome> & Pick<CardOutcome, 'fate'>): CardOutcome => ({
  cardId: `card_${Math.random().toString(36).slice(2, 8)}`,
  gated: false,
  verdictKind: null,
  ...over,
})

describe('computeCardOutcomeStats', () => {
  it('returns null rates and zero counts for an empty set (empty-set floor)', () => {
    const stats = computeCardOutcomeStats([])
    expect(stats.total).toBe(0)
    expect(stats.fateMix).toEqual({ shipped: 0, reworked: 0, abandoned: 0 })
    expect(stats.shipRate).toEqual({ gated: null, ungated: null, delta: null })
    expect(stats.gateCalibration).toEqual({
      approvedShipRate: null,
      needsClarificationShipRate: null,
    })
  })

  it('counts the fate mix across shipped / reworked / abandoned', () => {
    const stats = computeCardOutcomeStats([
      outcome({ fate: 'shipped' }),
      outcome({ fate: 'shipped' }),
      outcome({ fate: 'reworked' }),
      outcome({ fate: 'abandoned' }),
    ])
    expect(stats.total).toBe(4)
    expect(stats.fateMix).toEqual({ shipped: 2, reworked: 1, abandoned: 1 })
  })

  it('splits ship-rate by gated vs ungated and reports the delta', () => {
    const stats = computeCardOutcomeStats([
      // gated: 2 of 3 shipped → 0.666…
      outcome({ fate: 'shipped', gated: true }),
      outcome({ fate: 'shipped', gated: true }),
      outcome({ fate: 'abandoned', gated: true }),
      // ungated: 1 of 4 shipped → 0.25
      outcome({ fate: 'shipped', gated: false }),
      outcome({ fate: 'reworked', gated: false }),
      outcome({ fate: 'abandoned', gated: false }),
      outcome({ fate: 'reworked', gated: false }),
    ])
    expect(stats.shipRate.gated).toBeCloseTo(2 / 3)
    expect(stats.shipRate.ungated).toBeCloseTo(0.25)
    expect(stats.shipRate.delta).toBeCloseTo(2 / 3 - 0.25)
  })

  it('leaves the delta null when one side of the split is empty', () => {
    const stats = computeCardOutcomeStats([
      outcome({ fate: 'shipped', gated: true }),
      outcome({ fate: 'abandoned', gated: true }),
    ])
    expect(stats.shipRate.gated).toBeCloseTo(0.5)
    expect(stats.shipRate.ungated).toBeNull()
    expect(stats.shipRate.delta).toBeNull()
  })

  it('calibrates the gate by verdict kind (approved vs needs_clarification ship-rate)', () => {
    const stats = computeCardOutcomeStats([
      // approved: 2 of 2 shipped → 1.0
      outcome({ fate: 'shipped', gated: true, verdictKind: 'approved' }),
      outcome({ fate: 'shipped', gated: true, verdictKind: 'approved' }),
      // needs_clarification: 1 of 3 shipped → 0.333…
      outcome({ fate: 'shipped', gated: true, verdictKind: 'needs_clarification' }),
      outcome({ fate: 'reworked', gated: true, verdictKind: 'needs_clarification' }),
      outcome({ fate: 'abandoned', gated: true, verdictKind: 'needs_clarification' }),
    ])
    expect(stats.gateCalibration.approvedShipRate).toBeCloseTo(1)
    expect(stats.gateCalibration.needsClarificationShipRate).toBeCloseTo(1 / 3)
  })

  it('excludes null-verdict (ungated) cards from gate calibration but not from fate mix', () => {
    const stats = computeCardOutcomeStats([
      outcome({ fate: 'shipped', gated: false, verdictKind: null }),
      outcome({ fate: 'shipped', gated: true, verdictKind: 'approved' }),
    ])
    expect(stats.fateMix.shipped).toBe(2)
    // Only the one approved card is in the calibration denominator.
    expect(stats.gateCalibration.approvedShipRate).toBeCloseTo(1)
    expect(stats.gateCalibration.needsClarificationShipRate).toBeNull()
  })
})

const sig = (over: Partial<TriageSignalOutcome>): TriageSignalOutcome => ({
  reportWorthy: null,
  outcome: null,
  ...over,
})

describe('computeTriageAccuracy', () => {
  it('returns a null precision floor when nothing has been answered yet', () => {
    const acc = computeTriageAccuracy([
      sig({ reportWorthy: true }),
      sig({ reportWorthy: false }),
      sig({ reportWorthy: null }),
    ])
    expect(acc).toEqual({ precision: null, resolved: 0, misses: 0 })
  })

  it('scores precision as (card_created+acted) over the answered reportWorthy set', () => {
    const acc = computeTriageAccuracy([
      sig({ reportWorthy: true, outcome: 'card_created' }),
      sig({ reportWorthy: true, outcome: 'acted' }),
      sig({ reportWorthy: true, outcome: 'dismissed' }),
      // Un-triaged / unanswered rows never touch the denominator.
      sig({ reportWorthy: true, outcome: null }),
      sig({ reportWorthy: null, outcome: 'card_created' }),
    ])
    expect(acc.resolved).toBe(3)
    expect(acc.precision).toBeCloseTo(2 / 3)
  })

  it('counts not-reportWorthy signals that became cards as misses only', () => {
    const acc = computeTriageAccuracy([
      sig({ reportWorthy: false, outcome: 'card_created' }),
      sig({ reportWorthy: false, outcome: 'card_created' }),
      sig({ reportWorthy: false, outcome: 'dismissed' }),
    ])
    expect(acc.misses).toBe(2)
    // No reportWorthy signal has a response, so precision stays a null floor.
    expect(acc.precision).toBeNull()
    expect(acc.resolved).toBe(0)
  })
})

describe('computeMemoryEarnedKeep', () => {
  it('reports a null rate and zero counts for an empty hub (empty-set floor)', () => {
    const keep = computeMemoryEarnedKeep([], new Map())
    expect(keep).toEqual({
      totalNotes: 0,
      recalledNotes: 0,
      earnedKeepRate: null,
      neverRecalled: 0,
      topRecalled: [],
    })
  })

  it('splits recalled vs never-recalled and ranks the busiest three', () => {
    const keep = computeMemoryEarnedKeep(
      ['a', 'b', 'c', 'd', 'e'],
      new Map([
        ['a', 5],
        ['b', 9],
        ['c', 2],
        // d, e never recalled; a phantom slug not in the hub is ignored.
        ['ghost', 40],
      ]),
    )
    expect(keep.totalNotes).toBe(5)
    expect(keep.recalledNotes).toBe(3)
    expect(keep.neverRecalled).toBe(2)
    expect(keep.earnedKeepRate).toBeCloseTo(3 / 5)
    expect(keep.topRecalled).toEqual([
      { note: 'b', count: 9 },
      { note: 'a', count: 5 },
      { note: 'c', count: 2 },
    ])
  })

  it('collapses duplicate note names and treats a zero-count recall as never-recalled', () => {
    const keep = computeMemoryEarnedKeep(['x', 'x', 'y'], new Map([['y', 0]]))
    expect(keep.totalNotes).toBe(2)
    expect(keep.recalledNotes).toBe(0)
    expect(keep.earnedKeepRate).toBe(0)
    expect(keep.topRecalled).toEqual([])
  })
})
