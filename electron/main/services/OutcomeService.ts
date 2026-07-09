import {
  computeCardOutcomeStats,
  type CardFate,
  type CardOutcome,
  type CardOutcomeStats,
  type SpecVerdictKind,
} from '@shared/outcomes'
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
  ) {}

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
