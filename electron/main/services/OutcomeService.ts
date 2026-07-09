import {
  computeCardOutcomeStats,
  computeMemoryEarnedKeep,
  computeTriageAccuracy,
  type CardFate,
  type CardOutcome,
  type CardOutcomeStats,
  type OutcomeScorecard,
  type SpecVerdictKind,
  type TriageSignalOutcome,
} from '@shared/outcomes'
import type { ScorecardEntry } from '@shared/council'
import type { SentinelOutcome } from '@shared/sentinel'
import { projectBrain } from '@shared/memory-ledger'
import type { Db } from '../db/Database'

/**
 * The audit action types that mark a card's terminal fate (Track G1). Emitted by
 * `SwarmService.moveCard`/`removeCard` onto the append-only `audit_log`, which
 * outlives card-row deletion (no card FK) — so an abandoned card's fate survives.
 */
const FATE_BY_ACTION: Readonly<Record<string, CardFate>> = {
  'swarm.card_shipped': 'shipped',
  'swarm.card_reworked': 'reworked',
  'swarm.card_abandoned': 'abandoned',
}

/**
 * The narrow slice of `CouncilSessionStore` the read model needs — structural so
 * tests can fake it. `listRecent` is newest-first, so the first row seen per
 * `cardId` is that card's latest gate.
 */
export interface CouncilVerdictSource {
  listRecent(
    projectId: string,
    limit?: number,
  ): ReadonlyArray<{ cardId: string | null; verdictKind: string | null }>
}

interface TerminalEventRow {
  action_type: string
  payload_redacted_json: string
  created_at: string
}

/** How far back the council-session join scans (bounded read, plan §Risks). */
const COUNCIL_SCAN_LIMIT = 500

/** Recall telemetry read side — `MemoryRecallService.recalledSince`. Structural
 *  so a test can fake it; a read failure inside it already degrades to an empty
 *  map, never a throw. */
export interface RecallSource {
  recalledSince(brain: string, sinceIso: string): Map<string, number>
}

/** The project hub's current note inventory — `MemoryHubService.listHooks`.
 *  Only the note `name` (slug) is read; it's matched against recall slugs. */
export interface HubNoteSource {
  listHooks(projectId: string): ReadonlyArray<{ name: string }>
}

/** One signal reduced to what triage accuracy needs. `SentinelService.list`
 *  rows are assignable to this (they carry a richer `triage` blob + `outcome`). */
export interface TriageSignalRow {
  triage: { reportWorthy: boolean } | null
  outcome: SentinelOutcome | null
  createdAt: string
}

/** The sentinel feed read side — `SentinelService.list`, newest first. */
export interface SentinelSignalSource {
  list(projectId: string, limit?: number): ReadonlyArray<TriageSignalRow>
}

/** Cross-session council seat standings — `CouncilService.scorecard`, best first. */
export interface CouncilScorecardSource {
  scorecard(projectId: string, limit?: number): ScorecardEntry[]
}

/**
 * The G4-only collaborators, grouped so the two-arg G1 constructor
 * (`OutcomeService(db, verdicts)`) that older read paths use stays intact while
 * the scorecard read model gets everything it composes from.
 */
export interface ScorecardSources {
  recalls: RecallSource
  hub: HubNoteSource
  signals: SentinelSignalSource
  councilScore: CouncilScorecardSource
}

/** Card + triage lookback (30 days) — plan §G4 "last 30 days unless noted". */
const CARD_WINDOW_DAYS = 30
/** Memory earned-keep lookback (7 days) — the charter's 7-day test. */
const MEMORY_WINDOW_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000
/** Bounded scan of the signal feed for the triage-precision read. */
const SIGNAL_SCAN_LIMIT = 200

/**
 * Read model for Track G outcome tracking (plan §G1). Derives — never stores —
 * card fates from the audit trail joined to `council_sessions`; the pure roll-up
 * math lives in `shared/outcomes.ts`. No schema of its own (G1 is schema-free).
 *
 * The top risk this class defends against: a card can be re-opened after it
 * shipped and reshipped later. Counting every terminal event would double-count
 * it, so `cardOutcomes` folds by `cardId`, last event wins.
 */
export class OutcomeService {
  constructor(
    private readonly db: Db,
    private readonly council: CouncilVerdictSource,
    /** G4 scorecard collaborators. Optional so the G1 read paths (`cardOutcomes`)
     *  construct with just `(db, council)`; `scorecard()` requires them. */
    private readonly sources?: ScorecardSources,
  ) {}

  /**
   * The read-only judgment scorecard (plan §G4): card-outcome roll-up, gate
   * calibration, triage precision, memory earned-keep, and the best council
   * seat — composed from the pure `shared/outcomes` helpers over the append-only
   * audit trail plus the recall/signal/council read models. Every sub-metric
   * carries its own empty-set floor, so a project with no history reads as honest
   * "not enough data yet", never a misleading zero. Correlational, not causal.
   *
   * Each collaborator read is individually guarded: a failure in one read model
   * (a closed DB, a vanished hub) degrades that section to its empty floor rather
   * than sinking the whole scorecard the user is waiting on.
   */
  scorecard(projectId: string): OutcomeScorecard {
    if (!this.sources) {
      throw new Error('OutcomeService.scorecard requires its G4 collaborators.')
    }
    const now = Date.now()
    const cardSinceIso = new Date(now - CARD_WINDOW_DAYS * DAY_MS).toISOString()
    const memorySinceIso = new Date(now - MEMORY_WINDOW_DAYS * DAY_MS).toISOString()

    return {
      generatedAt: new Date(now).toISOString(),
      cardWindowDays: CARD_WINDOW_DAYS,
      memoryWindowDays: MEMORY_WINDOW_DAYS,
      cards: computeCardOutcomeStats(this.cardOutcomes(projectId, cardSinceIso)),
      triage: computeTriageAccuracy(this.triageSignals(projectId, cardSinceIso)),
      memory: this.memoryEarnedKeep(projectId, memorySinceIso),
      bestSeat: this.bestSeat(projectId),
    }
  }

  /** Triaged signals in the card window, reduced to the two triage-accuracy
   *  facts. A read failure degrades to an empty set (null-precision floor). */
  private triageSignals(projectId: string, sinceIso: string): TriageSignalOutcome[] {
    if (!this.sources) return []
    try {
      return this.sources.signals
        .list(projectId, SIGNAL_SCAN_LIMIT)
        .filter((s) => s.createdAt >= sinceIso)
        .map((s) => ({
          reportWorthy: s.triage ? s.triage.reportWorthy : null,
          outcome: s.outcome,
        }))
    } catch {
      return []
    }
  }

  /** Hub notes vs. window recalls → earned-keep. A hub/recall read failure
   *  degrades to the empty-hub floor rather than crashing the scorecard. */
  private memoryEarnedKeep(projectId: string, sinceIso: string) {
    if (!this.sources) return computeMemoryEarnedKeep([], new Map())
    try {
      const names = this.sources.hub.listHooks(projectId).map((n) => n.name)
      const recalls = this.sources.recalls.recalledSince(projectBrain(projectId), sinceIso)
      return computeMemoryEarnedKeep(names, recalls)
    } catch {
      return computeMemoryEarnedKeep([], new Map())
    }
  }

  /** The top-standing council seat (lowest average rank), or null when the
   *  scorecard is empty or its read failed. */
  private bestSeat(projectId: string): ScorecardEntry | null {
    if (!this.sources) return null
    try {
      return this.sources.councilScore.scorecard(projectId)[0] ?? null
    } catch {
      return null
    }
  }

  /**
   * Every card's terminal outcome for `projectId` since `sinceIso`, folded
   * last-wins by `cardId`. `gated` is true when the card's terminal event
   * carried a `councilSessionId` (durable past card deletion) OR a matching
   * council session still exists; `verdictKind` comes from that session and is
   * null when the session has vanished (dangling id by design) or was never
   * gated.
   */
  cardOutcomes(projectId: string, sinceIso: string): CardOutcome[] {
    const verdicts = this.verdictsByCard(projectId)
    const rows = this.terminalEventRows(projectId, sinceIso)
    // Rows arrive oldest-first, so a plain overwrite per cardId yields last-wins.
    const byCard = new Map<string, CardOutcome>()
    for (const row of rows) {
      const fate = FATE_BY_ACTION[row.action_type]
      if (!fate) continue
      const payload = safeParseObject(row.payload_redacted_json)
      const cardId = typeof payload.cardId === 'string' ? payload.cardId : null
      if (!cardId) continue
      const hasSessionId = payload.councilSessionId != null
      byCard.set(cardId, {
        cardId,
        fate,
        gated: hasSessionId || verdicts.has(cardId),
        verdictKind: verdicts.get(cardId) ?? null,
      })
    }
    return [...byCard.values()]
  }

  /** Card-outcome roll-up (fate mix, gated ship-rate, gate calibration). */
  cardOutcomeStats(projectId: string, sinceIso: string): CardOutcomeStats {
    return computeCardOutcomeStats(this.cardOutcomes(projectId, sinceIso))
  }

  /** The three terminal-fate events for a project since `sinceIso`, oldest-first. */
  private terminalEventRows(projectId: string, sinceIso: string): TerminalEventRow[] {
    return this.db
      .prepare(
        `SELECT action_type, payload_redacted_json, created_at
           FROM audit_log
          WHERE project_id = ?
            AND action_type IN ('swarm.card_shipped', 'swarm.card_reworked', 'swarm.card_abandoned')
            AND created_at >= ?
          ORDER BY created_at ASC, rowid ASC`,
      )
      .all(projectId, sinceIso) as TerminalEventRow[]
  }

  /**
   * Latest spec verdict per card from `council_sessions`. A `null`/unknown
   * `verdictKind` maps to null (an ungated-shaped value); a read failure degrades
   * to an empty map so outcomes still return.
   */
  private verdictsByCard(projectId: string): Map<string, SpecVerdictKind | null> {
    const map = new Map<string, SpecVerdictKind | null>()
    try {
      for (const session of this.council.listRecent(projectId, COUNCIL_SCAN_LIMIT)) {
        if (!session.cardId || map.has(session.cardId)) continue
        map.set(session.cardId, normalizeVerdict(session.verdictKind))
      }
    } catch {
      // A council-store read failure is not fatal to outcome derivation — the
      // audit trail alone still yields fates (with verdictKind null).
    }
    return map
  }
}

/** Narrow a stored verdict string to the known kinds; anything else is null. */
function normalizeVerdict(kind: string | null): SpecVerdictKind | null {
  return kind === 'approved' || kind === 'needs_clarification' ? kind : null
}

/** Parse a redacted audit payload defensively — a corrupt blob yields {}. */
function safeParseObject(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}
