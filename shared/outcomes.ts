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
import type { ScorecardEntry } from './council'
import type { SentinelOutcome } from './sentinel'

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
// Triage accuracy (Track G3/G4). Reads `sentinel_signals.triage.reportWorthy`
// against the user's recorded `outcome`, reporting precision + misses. Kept in
// this module so every judgment-system metric shares one home.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One signal reduced to just the two facts triage accuracy needs: the async
 * triage verdict's `reportWorthy` flag (null when the signal was never triaged —
 * no judgment to score) and the user's recorded response (null when unanswered).
 * A structural shape so the service can pass its own `SentinelSignal` rows
 * straight through and tests can hand-build fixtures.
 */
export interface TriageSignalOutcome {
  reportWorthy: boolean | null
  outcome: SentinelOutcome | null
}

/**
 * Triage precision: among signals the triage seat judged reportWorthy, how many
 * the user actually acted on (a card was created, or a linked card shipped)
 * versus dismissed as noise — plus the false-negatives it waved through that
 * nonetheless became cards.
 */
export interface TriageAccuracy {
  /**
   * (card_created + acted) ÷ (card_created + acted + dismissed) among
   * reportWorthy signals, or null when none has a recorded response yet — an
   * empty-set floor, never a misleading 0%.
   */
  precision: number | null
  /** reportWorthy signals carrying any recorded response (the denominator). */
  resolved: number
  /** Not-reportWorthy signals that nonetheless became a card (false negatives). */
  misses: number
}

/**
 * Fold signals into triage precision. Only a *triaged* signal (reportWorthy
 * non-null) with a *recorded* outcome counts toward precision; an un-triaged or
 * unanswered signal contributes nothing. Misses count not-reportWorthy signals
 * that became cards — the judgments triage got wrong in the other direction.
 * Pure and total: an empty or all-unanswered set yields `{ precision: null,
 * resolved: 0, misses: 0 }`.
 */
export function computeTriageAccuracy(signals: readonly TriageSignalOutcome[]): TriageAccuracy {
  let acted = 0
  let resolved = 0
  let misses = 0
  for (const s of signals) {
    if (s.reportWorthy === true) {
      if (s.outcome === 'card_created' || s.outcome === 'acted') {
        acted += 1
        resolved += 1
      } else if (s.outcome === 'dismissed') {
        resolved += 1
      }
    } else if (s.reportWorthy === false && s.outcome === 'card_created') {
      misses += 1
    }
  }
  return { precision: rate(acted, resolved), resolved, misses }
}

// ─────────────────────────────────────────────────────────────────────────────
// Memory earned-keep (Track G2/G4). The 7-day "earns its keep" query, folded:
// hub notes recalled into a prompt in the window vs. those never selected.
// ─────────────────────────────────────────────────────────────────────────────

/** One note's recall tally in the window — feeds the top-3 most-recalled list. */
export interface RecalledNote {
  note: string
  count: number
}

/**
 * How the project's hub notes fared against the recall telemetry: what fraction
 * earned their keep (were selected into at least one prompt in the window), how
 * many were never recalled (curation candidates), and the busiest few.
 */
export interface MemoryEarnedKeep {
  totalNotes: number
  recalledNotes: number
  /** recalledNotes ÷ totalNotes, or null when the hub is empty (empty-set floor). */
  earnedKeepRate: number | null
  neverRecalled: number
  /** The most-recalled notes in the window, busiest first, capped at three. */
  topRecalled: RecalledNote[]
}

/** How many notes the top-recalled list surfaces. */
const TOP_RECALLED_CAP = 3

/**
 * Fold the current hub note list against a `slug → recall count` map into the
 * earned-keep numbers. A note counts as "recalled" when its window count is > 0;
 * everything else is a never-recalled curation candidate. Duplicate note names
 * are collapsed. Pure and total — an empty hub yields zero counts and a null
 * rate, never a divide-by-zero.
 */
export function computeMemoryEarnedKeep(
  noteNames: readonly string[],
  recalls: ReadonlyMap<string, number>,
): MemoryEarnedKeep {
  const unique = [...new Set(noteNames)]
  const recalled = unique.filter((name) => (recalls.get(name) ?? 0) > 0)
  const topRecalled = recalled
    .map((note) => ({ note, count: recalls.get(note) ?? 0 }))
    .sort((a, b) => b.count - a.count || a.note.localeCompare(b.note))
    .slice(0, TOP_RECALLED_CAP)
  return {
    totalNotes: unique.length,
    recalledNotes: recalled.length,
    earnedKeepRate: rate(recalled.length, unique.length),
    neverRecalled: unique.length - recalled.length,
    topRecalled,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The judgment scorecard (Track G4). One read-only roll-up composed from the
// card-outcome, triage, and memory read models plus the council seat standings.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The full judgment scorecard for one project — everything the read-only Usage
 * section renders in a single fetch. Every sub-metric carries its own empty-set
 * floor (null rates, zero counts) so the surface can show honest "not enough
 * data yet" states rather than misleading zeros. Correlational, not causal (see
 * the module header) — the copy must not overclaim.
 */
export interface OutcomeScorecard {
  /** When the read model was assembled (ISO) — the surface's "as of" stamp. */
  generatedAt: string
  /** Lookback for card + triage metrics (days). */
  cardWindowDays: number
  /** Lookback for the memory earned-keep query (days) — the 7-day test. */
  memoryWindowDays: number
  cards: CardOutcomeStats
  triage: TriageAccuracy
  memory: MemoryEarnedKeep
  /** Best council seat (lowest average rank) across recent sessions, or null. */
  bestSeat: ScorecardEntry | null
}
