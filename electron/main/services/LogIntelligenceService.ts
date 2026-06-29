import type { ErrorInsight, LogEvent, LogLevel, LogSourceType } from '@shared/domain'
import { inferLogLevel, matchLogLine } from '@shared/log-patterns'
import { sanitizeStoredLine, stripAnsi } from '@shared/log-sanitize'
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
    // Defence in depth: strip ANSI/control debris even if the caller did not.
    // Terminal output is already sanitized upstream; the probe/system paths are
    // user-pasted text that may still carry escape codes.
    const lines = input.message
      .split(/\r?\n/)
      .map((l) => stripAnsi(l).trim())
      .filter((l) => l.length > 0)
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
    // Over-fetch, then drop legacy rows that are pure ANSI/TUI garbage so the
    // panel stays clean even for output captured before sanitization existed.
    const rows = this.db
      .prepare('SELECT * FROM log_events WHERE project_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(projectId, Math.min(limit * 3, 600)) as LogRow[]
    const events: LogEvent[] = []
    for (const r of rows) {
      const message = sanitizeStoredLine(r.message)
      if (message === null) continue
      events.push({
        id: r.id,
        projectId: r.project_id,
        sourceType: r.source_type as LogSourceType,
        sourceId: r.source_id,
        level: r.level as LogLevel,
        message,
        metadata: safeJson<Record<string, unknown>>(r.metadata_json, {}),
        createdAt: r.created_at,
      })
      if (events.length >= limit) break
    }
    return events
  }

  listInsights(projectId: string, limit = 50): ErrorInsight[] {
    // Over-fetch, then collapse repeats of the same matched pattern (a noisy
    // build can emit the same error hundreds of times) to the newest occurrence.
    const rows = this.db
      .prepare('SELECT * FROM error_insights WHERE project_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(projectId, Math.min(limit * 5, 500)) as InsightRow[]
    const seen = new Set<string>()
    const insights: ErrorInsight[] = []
    for (const r of rows) {
      if (seen.has(r.matched_pattern)) continue
      seen.add(r.matched_pattern)
      insights.push({
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
      })
      if (insights.length >= limit) break
    }
    return insights
  }
}
