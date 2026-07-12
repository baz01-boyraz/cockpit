import type { AuditActor, AuditEntry } from '@shared/domain'
import { redactPayload } from '@shared/redaction'
import type { Db } from '../db/Database'
import { newId, nowIso, safeJson } from '../util/ids'

interface AuditRow {
  id: string
  project_id: string | null
  actor: string
  action_type: string
  summary: string
  payload_redacted_json: string
  created_at: string
}

/**
 * Append-only audit trail of every meaningful AI/tool action. Payloads are
 * redacted before persistence so secrets never land on disk in plaintext.
 */
export class AuditLogService {
  private readonly listeners = new Set<(entry: AuditEntry) => void>()

  constructor(private readonly db: Db) {}

  /** Observe entries only after their append succeeds; listener faults are isolated. */
  subscribe(listener: (entry: AuditEntry) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  record(input: {
    projectId: string | null
    actor: AuditActor
    actionType: string
    summary: string
    payload?: Record<string, unknown>
  }): AuditEntry {
    const entry: AuditEntry = {
      id: newId('aud'),
      projectId: input.projectId,
      actor: input.actor,
      actionType: input.actionType,
      summary: input.summary,
      payloadRedacted: (redactPayload(input.payload ?? {}) as Record<string, unknown>) ?? {},
      createdAt: nowIso(),
    }
    this.db
      .prepare(
        `INSERT INTO audit_log (id, project_id, actor, action_type, summary, payload_redacted_json, created_at)
         VALUES (@id, @projectId, @actor, @actionType, @summary, @payload, @createdAt)`,
      )
      .run({
        id: entry.id,
        projectId: entry.projectId,
        actor: entry.actor,
        actionType: entry.actionType,
        summary: entry.summary,
        payload: JSON.stringify(entry.payloadRedacted),
        createdAt: entry.createdAt,
      })
    for (const listener of this.listeners) {
      try {
        listener(entry)
      } catch {
        // Observability consumers never endanger the append-only audit write.
      }
    }
    return entry
  }

  /** Bounded action-specific window used by deterministic lifecycle sensors. */
  recent(
    projectId: string,
    actionType: string,
    since: string,
    limit = 100,
  ): AuditEntry[] {
    const bounded = Math.max(1, Math.min(500, Math.floor(limit)))
    const rows = this.db
      .prepare(
        `SELECT * FROM audit_log
         WHERE project_id = ? AND action_type = ? AND created_at >= ?
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(projectId, actionType, since, bounded) as AuditRow[]
    return rows.map((row) => this.toEntry(row))
  }

  /**
   * ISO timestamp of the most recent entry of a given action type for a project,
   * or null when there is none. A cheap, index-friendly cadence probe — lets a
   * time-based job (the weekly memory curation sweep) decide "due / not due"
   * without a new table, reading its own last run from the append-only trail.
   */
  lastAt(projectId: string, actionType: string): string | null {
    const row = this.db
      .prepare(
        `SELECT created_at FROM audit_log WHERE project_id = ? AND action_type = ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(projectId, actionType) as { created_at: string } | undefined
    return row?.created_at ?? null
  }

  list(projectId: string, limit = 100): AuditEntry[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM audit_log WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`,
      )
      .all(projectId, limit) as AuditRow[]
    return rows.map(this.toEntry)
  }

  private toEntry(row: AuditRow): AuditEntry {
    return {
      id: row.id,
      projectId: row.project_id,
      actor: row.actor as AuditActor,
      actionType: row.action_type,
      summary: row.summary,
      payloadRedacted: safeJson<Record<string, unknown>>(row.payload_redacted_json, {}),
      createdAt: row.created_at,
    }
  }
}
