import type { ErrorInsight, LogEvent, LogLevel, LogSourceType } from '@shared/domain'
import { inferLogLevel, matchLogLine } from '@shared/log-patterns'
import type { Db } from '../db/Database'
import type { CockpitEvents } from '../events'
import { newId, nowIso, safeJson } from '../util/ids'

interface LogRow {
  id: string
  project_id: string
  source_type: string
  source_id: string | null
  level: string
  message: string
  metadata_json: string
  created_at: string
}

interface InsightRow {
  id: string
  project_id: string
  log_event_id: string | null
  title: string
  likely_cause: string
  suggested_action: string
  suggested_agent: string
  severity: string
  matched_pattern: string
  created_at: string
}

/**
 * Error intelligence v1. Ingests terminal/log output, persists it as log events,
 * and runs the rule-based pattern matchers to surface actionable insights
 * (likely cause, suggested fix, suggested agent). Returns the newest insight so
 * callers can route it straight into the AI chat context.
 */
export class LogIntelligenceService {
  constructor(
    private readonly db: Db,
    private readonly events: CockpitEvents,
  ) {}

  ingest(input: {
    projectId: string
    sourceType: LogSourceType
    sourceId?: string | null
    message: string
  }): ErrorInsight | null {
    const lines = input.message.split(/\r?\n/).filter((l) => l.trim().length > 0)
    if (lines.length === 0) return null

    let latestInsight: ErrorInsight | null = null
    const insertLog = this.db.prepare(
      `INSERT INTO log_events (id, project_id, source_type, source_id, level, message, metadata_json, created_at)
       VALUES (@id, @projectId, @sourceType, @sourceId, @level, @message, '{}', @createdAt)`,
    )
    const insertInsight = this.db.prepare(
      `INSERT INTO error_insights
       (id, project_id, log_event_id, title, likely_cause, suggested_action, suggested_agent, severity, matched_pattern, created_at)
       VALUES (@id, @projectId, @logEventId, @title, @likelyCause, @suggestedAction, @suggestedAgent, @severity, @pattern, @createdAt)`,
    )

    const tx = this.db.transaction(() => {
      for (const line of lines) {
        const level: LogLevel = inferLogLevel(line)
        const logId = newId('log')
        const createdAt = nowIso()
        insertLog.run({
          id: logId,
          projectId: input.projectId,
          sourceType: input.sourceType,
          sourceId: input.sourceId ?? null,
          level,
          message: line.slice(0, 4000),
          createdAt,
        })

        const match = matchLogLine(line)
        if (match) {
          const insight: ErrorInsight = {
            id: newId('ins'),
            projectId: input.projectId,
            logEventId: logId,
            title: match.title,
            likelyCause: match.likelyCause,
            suggestedAction: match.suggestedAction,
            suggestedAgent: match.suggestedAgent,
            severity: match.severity,
            matchedPattern: match.pattern,
            createdAt,
          }
          insertInsight.run({
            id: insight.id,
            projectId: insight.projectId,
            logEventId: insight.logEventId,
            title: insight.title,
            likelyCause: insight.likelyCause,
            suggestedAction: insight.suggestedAction,
            suggestedAgent: insight.suggestedAgent,
            severity: insight.severity,
            pattern: insight.matchedPattern,
            createdAt: insight.createdAt,
          })
          latestInsight = insight
        }
      }
    })
    tx()

    this.events.emitTyped('logs:changed', { projectId: input.projectId })
    return latestInsight
  }

  listLogs(projectId: string, limit = 200): LogEvent[] {
    const rows = this.db
      .prepare('SELECT * FROM log_events WHERE project_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(projectId, limit) as LogRow[]
    return rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      sourceType: r.source_type as LogSourceType,
      sourceId: r.source_id,
      level: r.level as LogLevel,
      message: r.message,
      metadata: safeJson<Record<string, unknown>>(r.metadata_json, {}),
      createdAt: r.created_at,
    }))
  }

  listInsights(projectId: string, limit = 50): ErrorInsight[] {
    const rows = this.db
      .prepare('SELECT * FROM error_insights WHERE project_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(projectId, limit) as InsightRow[]
    return rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      logEventId: r.log_event_id,
      title: r.title,
      likelyCause: r.likely_cause,
      suggestedAction: r.suggested_action,
      suggestedAgent: r.suggested_agent as ErrorInsight['suggestedAgent'],
      severity: r.severity as ErrorInsight['severity'],
      matchedPattern: r.matched_pattern,
      createdAt: r.created_at,
    }))
  }
}
