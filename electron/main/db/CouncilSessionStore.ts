import { randomUUID } from 'node:crypto'
import {
  councilSpecVerdictKind,
  normalizeCouncilResult,
  type CouncilIntentMode,
  type CouncilResultLike,
  type NormalizedCouncilResult,
} from '@shared/council'
import type { Db } from './Database'

/**
 * Persistence for versioned Council sessions (schema V11). Every completed run
 * is kept as history — even a failed one — so the aggregate rankings feed a
 * cross-session scorecard. The store owns row↔object mapping only; the pure
 * scorecard math lives in `shared/council` (`computeScorecard`). Mirrors the
 * hand-rolled `db.prepare` style of MemoryLedgerService — cockpiT keeps its data
 * access in the service/store, not an ORM.
 */
export interface CouncilSessionInput {
  projectId: string
  cardId: string | null
  mode: CouncilIntentMode
  question: string | null
  result: CouncilResultLike
}

/** The identity a run knows up front, before any seat has answered (A6). */
export interface CouncilSessionPending {
  projectId: string
  cardId: string | null
  mode: CouncilIntentMode
  question: string | null
}

/**
 * Run lifecycle (A6). 'pending' is inserted at run start; it becomes 'final' on
 * completion, or 'failed' when a boot sweep finds it orphaned by a crash.
 */
export type CouncilSessionStatus = 'pending' | 'final' | 'failed'

export interface CouncilSession {
  id: string
  projectId: string
  cardId: string | null
  mode: CouncilIntentMode
  question: string | null
  result: NormalizedCouncilResult
  verdictKind: 'approved' | 'needs_clarification' | null
  status: CouncilSessionStatus
  createdAt: string
}

interface SessionRow {
  id: string
  project_id: string
  card_id: string | null
  mode: string
  question: string | null
  result_json: string
  verdict_kind: string | null
  status: string | null
  created_at: string
}

/**
 * A well-formed placeholder result for a `pending` row. Every read path
 * (`listRecent` → scorecard, `get` → swarm brief) dereferences result fields —
 * `computeScorecard` iterates `aggregate` — so a pending row must carry a valid,
 * empty CouncilResult, never `{}`. A run that crashes mid-flight leaves exactly
 * this shape behind, which honestly reads as "0 seats, no verdict".
 */
function pendingPlaceholder(mode: CouncilIntentMode): CouncilResultLike {
  const stats = { seatsRun: 0, seatsFailed: 0, filesReviewed: 0, durationMs: 0 }
  if (mode === 'analysis') {
    return {
      schemaVersion: 3,
      ok: false,
      mode,
      responseLanguage: 'und',
      decision: {
        kind: 'failed',
        summary: 'Council run in progress.',
        why: null,
        questions: [],
        keyFindings: [],
        dissent: [],
      },
      primaryArtifact: null,
      execution: { stats },
      evidence: {
        seats: [],
        rankings: [],
        aggregate: [],
        labelToSeat: {},
        rawChairman: null,
      },
      error: 'Council run in progress.',
      sessionId: null,
    }
  }
  return {
    ok: false,
    mode,
    seats: [],
    rankings: [],
    aggregate: [],
    labelToSeat: {},
    verdict: null,
    specVerdict: null,
    error: 'Council run in progress.',
    stats,
    sessionId: null,
  }
}

/** Coerce a stored status string into the union; unknown/NULL → 'final' (the
 *  column default, and the honest read for every pre-V18 row). */
function toStatus(raw: string | null): CouncilSessionStatus {
  return raw === 'pending' || raw === 'failed' ? raw : 'final'
}

/** Parse a stored result blob defensively — a corrupt row must not sink a read
 *  (the scorecard scans many rows). Returns null so the caller can skip it. */
function parseResult(json: string): NormalizedCouncilResult | null {
  try {
    return normalizeCouncilResult(JSON.parse(json))
  } catch {
    return null
  }
}

function withSessionId(
  result: CouncilResultLike,
  sessionId: string,
  expectedMode?: CouncilIntentMode,
): CouncilResultLike {
  const stored = { ...result, sessionId } as CouncilResultLike
  const normalized = normalizeCouncilResult(stored)
  if (!normalized || (expectedMode !== undefined && normalized.mode !== expectedMode)) {
    throw new Error('Council result does not satisfy the versioned persistence contract.')
  }
  return stored
}

function toSession(row: SessionRow): CouncilSession | null {
  const result = parseResult(row.result_json)
  if (!result) return null
  return {
    id: row.id,
    projectId: row.project_id,
    cardId: row.card_id,
    mode: result.mode,
    question: row.question,
    result,
    // Never trust the denormalized column as an authorization signal: legacy
    // or malformed rows may contain an old/misclassified value. The normalized
    // result is the source of truth, and analysis can never become a spec gate.
    verdictKind: councilSpecVerdictKind(result),
    status: toStatus(row.status),
    createdAt: row.created_at,
  }
}

export class CouncilSessionStore {
  constructor(private readonly db: Db) {}

  /**
   * A6: reserve a `pending` row at run start and return its id. A mid-run crash
   * now leaves this durable marker instead of nothing; the boot sweep flips any
   * survivor to `failed`. The id is stamped into the placeholder blob's
   * `sessionId` so even an un-finalized row reads back with its own identity.
   */
  insertPending(input: CouncilSessionPending): string {
    const id = randomUUID()
    const placeholder = withSessionId(pendingPlaceholder(input.mode), id, input.mode)
    this.db
      .prepare(
        `INSERT INTO council_sessions
           (id, project_id, card_id, mode, question, result_json, verdict_kind, status, created_at)
         VALUES (@id, @projectId, @cardId, @mode, @question, @resultJson, NULL, 'pending', @createdAt)`,
      )
      .run({
        id,
        projectId: input.projectId,
        cardId: input.cardId,
        mode: input.mode,
        question: input.question,
        resultJson: JSON.stringify(placeholder),
        createdAt: new Date().toISOString(),
      })
    return id
  }

  /**
   * A6: replace a `pending` row's placeholder with the completed run and flip it
   * to `final`. The stored blob carries the row's own id as `sessionId`. A no-op
   * against an unknown/already-final id (0 rows changed) is harmless.
   */
  finalize(id: string, result: CouncilResultLike): void {
    const stored = withSessionId(result, id)
    this.db
      .prepare(
        `UPDATE council_sessions
         SET result_json = @resultJson, verdict_kind = @verdictKind, status = 'final'
         WHERE id = @id`,
      )
      .run({
        id,
        resultJson: JSON.stringify(stored),
        verdictKind: councilSpecVerdictKind(stored),
      })
  }

  /**
   * A6: mark every orphaned `pending` row as `failed`, returning the count. Any
   * row still `pending` at construction is residue of a previous process that
   * crashed mid-run — this process has inserted none yet — so the sweep is
   * unconditional (same reasoning as TerminalManager's boot reconciliation).
   */
  sweepStalePending(): number {
    const info = this.db
      .prepare(`UPDATE council_sessions SET status = 'failed' WHERE status = 'pending'`)
      .run()
    return info.changes
  }

  /**
   * Persist one completed run in a single write and return the row id — the
   * fallback the council uses only when reserving a `pending` row up front failed.
   * The id is stamped into the stored result's `sessionId`.
   */
  insert(input: CouncilSessionInput): string {
    const id = randomUUID()
    const stored = withSessionId(input.result, id, input.mode)
    this.db
      .prepare(
        `INSERT INTO council_sessions
           (id, project_id, card_id, mode, question, result_json, verdict_kind, status, created_at)
         VALUES (@id, @projectId, @cardId, @mode, @question, @resultJson, @verdictKind, 'final', @createdAt)`,
      )
      .run({
        id,
        projectId: input.projectId,
        cardId: input.cardId,
        mode: input.mode,
        question: input.question,
        resultJson: JSON.stringify(stored),
        verdictKind: councilSpecVerdictKind(stored),
        createdAt: new Date().toISOString(),
      })
    return id
  }

  /** Recent sessions for a project, newest first — the scorecard's input. */
  listRecent(projectId: string, limit = 30): CouncilSession[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM council_sessions
         WHERE project_id = ?
         ORDER BY created_at DESC, rowid DESC
         LIMIT ?`,
      )
      .all(projectId, Math.max(1, Math.min(limit, 500))) as SessionRow[]
    return rows.map(toSession).filter((s): s is CouncilSession => s !== null)
  }

  get(id: string): CouncilSession | null {
    const row = this.db.prepare('SELECT * FROM council_sessions WHERE id = ?').get(id) as
      | SessionRow
      | undefined
    return row ? toSession(row) : null
  }
}
