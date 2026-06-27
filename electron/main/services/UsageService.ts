import type { UsageEvent, UsageEventType, UsageProvider, UsageSummary } from '@shared/domain'
import { summarizeUsage } from '@shared/usage'
import type { Db } from '../db/Database'
import { newId, nowIso, safeJson } from '../util/ids'

interface UsageRow {
  id: string
  project_id: string
  provider: string
  event_type: string
  count: number
  duration_ms: number | null
  estimated_tokens: number | null
  metadata_json: string
  created_at: string
}

/**
 * Local-first usage tracking. Implements the adapter contract conceptually:
 * `record` ingests events, `summarize` collapses them per provider. Token
 * estimates are nullable — we only fill them when an adapter can infer them.
 */
export class UsageService {
  constructor(private readonly db: Db) {}

  record(input: {
    projectId: string
    provider: UsageProvider
    eventType: UsageEventType
    count?: number
    durationMs?: number | null
    estimatedTokens?: number | null
    metadata?: Record<string, unknown>
  }): void {
    this.db
      .prepare(
        `INSERT INTO usage_events
         (id, project_id, provider, event_type, count, duration_ms, estimated_tokens, metadata_json, created_at)
         VALUES (@id, @projectId, @provider, @eventType, @count, @durationMs, @estimatedTokens, @metadata, @createdAt)`,
      )
      .run({
        id: newId('usg'),
        projectId: input.projectId,
        provider: input.provider,
        eventType: input.eventType,
        count: input.count ?? 1,
        durationMs: input.durationMs ?? null,
        estimatedTokens: input.estimatedTokens ?? null,
        metadata: JSON.stringify(input.metadata ?? {}),
        createdAt: nowIso(),
      })
  }

  summarize(projectId: string): UsageSummary[] {
    const rows = this.db
      .prepare('SELECT * FROM usage_events WHERE project_id = ? ORDER BY created_at DESC LIMIT 2000')
      .all(projectId) as UsageRow[]
    return summarizeUsage(rows.map(this.toEvent))
  }

  private toEvent(row: UsageRow): UsageEvent {
    return {
      id: row.id,
      projectId: row.project_id,
      provider: row.provider as UsageProvider,
      eventType: row.event_type as UsageEventType,
      count: row.count,
      durationMs: row.duration_ms,
      estimatedTokens: row.estimated_tokens,
      metadata: safeJson<Record<string, unknown>>(row.metadata_json, {}),
      createdAt: row.created_at,
    }
  }
}
