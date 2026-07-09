/**
 * Outcome tracking read-model math (Roadmap Track G). Pure, dependency-free so it
 * runs unchanged in the renderer, the mock bridge, and Node tests. This module
 * owns the *aggregation* only — the raw `CardOutcome[]` is derived in
 * `OutcomeService` from the append-only audit trail + `council_sessions`; here we
 * fold those rows into the small set of numbers the judgment scorecard reads.
 *
 * Honesty ceiling (plan §Risks): these are *correlations* (gated cards ship
 * more), never proofs. Callers must not present them as causal.
 */

/** A card's terminal fate, derived from the last `swarm.card_*` audit event. */
export type CardFate = 'shipped' | 'reworked' | 'abandoned'

/** The spec-gate chairman's verdict on a card's opening spec, when it was gated. */
export type SpecVerdictKind = 'approved' | 'needs_clarification'

/**
 * One card's outcome, folded last-wins by `cardId` (a re-opened-then-reshipped
 * card counts once — plan's top risk). `gated` is true when the card carried a
 * council session; `verdictKind` is null when the card was ungated OR its session
 * has vanished (dangling `council_session_id` by design — V12 has no FK).
 */
export interface CardOutcome {
  cardId: string
  fate: CardFate
  gated: boolean
  verdictKind: SpecVerdictKind | null
}

/** Terminal-fate counts across a card set. */
export interface FateMix {
  shipped: number
  reworked: number
  abandoned: number
}

/**
 * Ship-rate split by whether a card was council-gated, plus the delta the
 * scorecard headlines. Each rate is a 0..1 fraction, or `null` when its
 * denominator is empty (no cards in that bucket) — an empty floor is never 0%,
 * which would falsely read as "everything failed."
 */
export interface ShipRate {
  gated: number | null
  ungated: number | null
  /** gated − ungated, or null when either side is empty. */
  delta: number | null
}

/**
 * Gate calibration: of the specs the chairman APPROVED, how many shipped; of the
 * ones it flagged NEEDS_CLARIFICATION, how many shipped anyway. A well-calibrated
 * gate ships more of its approvals than its clarifications.
 */
export interface GateCalibration {
  approvedShipRate: number | null
  needsClarificationShipRate: number | null
}

/** The full card-outcome roll-up for the scorecard. */
export interface CardOutcomeStats {
  total: number
  fateMix: FateMix
  shipRate: ShipRate
  gateCalibration: GateCalibration
}

/** Fraction, or null when the denominator is empty (empty-set floor). */
function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator
}

/**
 * Fold card outcomes into the scorecard numbers: fate mix, gated-vs-ungated
 * ship-rate (with delta), and gate calibration. Pure and total — an empty input
 * yields zero counts and null rates, never a divide-by-zero.
 */
export function computeCardOutcomeStats(rows: readonly CardOutcome[]): CardOutcomeStats {
  const fateMix: FateMix = { shipped: 0, reworked: 0, abandoned: 0 }
  let gatedTotal = 0
  let gatedShipped = 0
  let ungatedTotal = 0
  let ungatedShipped = 0
  let approvedTotal = 0
  let approvedShipped = 0
  let clarifyTotal = 0
  let clarifyShipped = 0

  for (const row of rows) {
    fateMix[row.fate] += 1
    const shipped = row.fate === 'shipped'

    if (row.gated) {
      gatedTotal += 1
      if (shipped) gatedShipped += 1
    } else {
      ungatedTotal += 1
      if (shipped) ungatedShipped += 1
    }

    if (row.verdictKind === 'approved') {
      approvedTotal += 1
      if (shipped) approvedShipped += 1
    } else if (row.verdictKind === 'needs_clarification') {
      clarifyTotal += 1
      if (shipped) clarifyShipped += 1
    }
  }

  const gated = rate(gatedShipped, gatedTotal)
  const ungated = rate(ungatedShipped, ungatedTotal)

  return {
    total: rows.length,
    fateMix,
    shipRate: {
      gated,
      ungated,
      delta: gated !== null && ungated !== null ? gated - ungated : null,
    },
    gateCalibration: {
      approvedShipRate: rate(approvedShipped, approvedTotal),
      needsClarificationShipRate: rate(clarifyShipped, clarifyTotal),
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Triage accuracy (Track G3/G4) lands here next: `computeTriageAccuracy(signals)`
// will read `sentinel_signals.outcome` and report reportWorthy precision +
// misses. Kept in this module so every judgment-system metric shares one home;
// the sentinel outcome column (schema V17) is owned by a separate card.
// ─────────────────────────────────────────────────────────────────────────────
