import { randomUUID } from 'node:crypto'
import type { CouncilMode, CouncilResult } from '@shared/council'
import type { Db } from './Database'

/**
 * Persistence for Council v2 sessions (schema V11). Every completed run is kept
 * as history — even a failed one — so the aggregate rankings feed a
 * cross-session scorecard. The store owns row↔object mapping only; the pure
 * scorecard math lives in `shared/council` (`computeScorecard`). Mirrors the
 * hand-rolled `db.prepare` style of MemoryLedgerService — cockpiT keeps its data
 * access in the service/store, not an ORM.
 */
export interface CouncilSessionInput {
  projectId: string
  cardId: string | null
  mode: CouncilMode
  question: string | null
  result: CouncilResult
}

export interface CouncilSession {
  id: string
  projectId: string
  cardId: string | null
  mode: CouncilMode
  question: string | null
  result: CouncilResult
  verdictKind: string | null
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
  created_at: string
}

/** Parse a stored result blob defensively — a corrupt row must not sink a read
 *  (the scorecard scans many rows). Returns null so the caller can skip it. */
function parseResult(json: string): CouncilResult | null {
  try {
    return JSON.parse(json) as CouncilResult
  } catch {
    return null
  }
}

function toSession(row: SessionRow): CouncilSession | null {
  const result = parseResult(row.result_json)
  if (!result) return null
  return {
    id: row.id,
    projectId: row.project_id,
    cardId: row.card_id,
    mode: row.mode as CouncilMode,
    question: row.question,
    result,
    verdictKind: row.verdict_kind,
    createdAt: row.created_at,
  }
}

export class CouncilSessionStore {
  constructor(private readonly db: Db) {}

  /**
   * Persist one run and return the row id. The id is stamped into the stored
   * result's `sessionId` so a later read carries its own identity; the caller
   * should reuse this id on the result it returns to the renderer.
   */
  insert(input: CouncilSessionInput): string {
    const id = randomUUID()
    const stored: CouncilResult = { ...input.result, sessionId: id }
    this.db
      .prepare(
        `INSERT INTO council_sessions
           (id, project_id, card_id, mode, question, result_json, verdict_kind, created_at)
         VALUES (@id, @projectId, @cardId, @mode, @question, @resultJson, @verdictKind, @createdAt)`,
      )
      .run({
        id,
        projectId: input.projectId,
        cardId: input.cardId,
        mode: input.mode,
        question: input.question,
        resultJson: JSON.stringify(stored),
        verdictKind: stored.specVerdict?.kind ?? null,
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
