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
  constructor(private readonly db: Db) {}

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
    return entry
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
