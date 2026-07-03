import type { ErrorInsight, LogEvent, LogLevel, LogSourceType } from '@shared/domain'
import type { InsightOccurrence } from '@shared/insight-aggregation'
import { aggregateInsights, insightFromMatch } from '@shared/insight-aggregation'
import { inferLogLevel, matchLogLine } from '@shared/log-patterns'
import { sanitizeStoredLine, stripAnsi } from '@shared/log-sanitize'
import { redactText } from '@shared/redaction'
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

/** Map a raw SQLite row to the shared per-occurrence shape. */
function toOccurrence(r: InsightRow): InsightOccurrence {
  return {
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
  }
}

/**
 * Error intelligence v1. Ingests terminal/log output, persists it as log events,
 * and runs the rule-based pattern matchers to surface actionable insights
 * (likely cause, suggested fix, suggested agent). Returns the newest insight so
 * callers can route it straight into the AI chat context.
 */
export class LogIntelligenceService {
  /**
   * Hot-path statements prepared once — ingest() runs for every interesting
   * terminal chunk, so re-preparing per call was pure overhead.
   */
  private readonly insertLogStmt: ReturnType<Db['prepare']>
  private readonly insertInsightStmt: ReturnType<Db['prepare']>

  constructor(
    private readonly db: Db,
    private readonly events: CockpitEvents,
  ) {
    this.insertLogStmt = this.db.prepare(
      `INSERT INTO log_events (id, project_id, source_type, source_id, level, message, metadata_json, created_at)
       VALUES (@id, @projectId, @sourceType, @sourceId, @level, @message, '{}', @createdAt)`,
    )
    this.insertInsightStmt = this.db.prepare(
      `INSERT INTO error_insights
       (id, project_id, log_event_id, title, likely_cause, suggested_action, suggested_agent, severity, matched_pattern, created_at)
       VALUES (@id, @projectId, @logEventId, @title, @likelyCause, @suggestedAction, @suggestedAgent, @severity, @pattern, @createdAt)`,
    )
  }

  ingest(input: {
    projectId: string
    sourceType: LogSourceType
    sourceId?: string | null
    message: string
  }): ErrorInsight | null {
    // Defence in depth: strip ANSI/control debris even if the caller did not.
    // Terminal output is already sanitized upstream; the probe/system paths are
    // user-pasted text that may still carry escape codes. Secret-shaped content
    // (an echoed .env, a Bearer header in a failing curl) is scrubbed BEFORE
    // anything is persisted — log_events must never store raw secrets.
    const lines = input.message
      .split(/\r?\n/)
      .map((l) => redactText(stripAnsi(l).trim()))
      .filter((l) => l.length > 0)
    if (lines.length === 0) return null

    let latestInsight: ErrorInsight | null = null
    const tx = this.db.transaction(() => {
      for (const line of lines) {
        const level: LogLevel = inferLogLevel(line)
        const logId = newId('log')
        const createdAt = nowIso()
        this.insertLogStmt.run({
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
          // Describes the single line just ingested; the aggregated history
          // (true count / first-seen) is computed in listInsights.
          const insight = insightFromMatch(match, {
            id: newId('ins'),
            projectId: input.projectId,
            logEventId: logId,
            createdAt,
          })
          this.insertInsightStmt.run({
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
      // Redact on the way out too: rows ingested before redaction existed may
      // still hold secret-shaped content on disk.
      const sanitized = sanitizeStoredLine(r.message)
      if (sanitized === null) continue
      const message = redactText(sanitized)
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
    // Fetch the raw per-occurrence rows and delegate the aggregation RULE
    // (group by pattern, dismissal watermarks, newest-representative, sort,
    // limit) to shared/insight-aggregation — the exact same function the
    // browser mock runs, so the two bridges can never drift. Tables are small
    // (bounded per project), so aggregating in-process is cheap.
    const rows = this.db
      .prepare('SELECT * FROM error_insights WHERE project_id = ? ORDER BY created_at DESC')
      .all(projectId) as InsightRow[]

    // A dismissal hides a pattern only up to the occurrence the user had seen.
    // If a newer occurrence exists (last_seen > dismissed_up_to) the failure has
    // recurred and we surface it again — dismiss never buries a live error.
    const dismissals = new Map<string, string>()
    const drows = this.db
      .prepare('SELECT matched_pattern AS pattern, dismissed_up_to FROM insight_dismissals WHERE project_id = ?')
      .all(projectId) as { pattern: string; dismissed_up_to: string }[]
    for (const d of drows) dismissals.set(d.pattern, d.dismissed_up_to)

    return aggregateInsights(rows.map(toOccurrence), dismissals, limit)
  }

  /**
   * Dismiss a pattern up to its newest occurrence. The insight disappears from
   * the panel, but a genuinely new occurrence afterwards makes it return — so a
   * recurring, still-live failure is never silently hidden.
   */
  dismissInsight(projectId: string, matchedPattern: string): void {
    const row = this.db
      .prepare('SELECT MAX(created_at) AS last_seen FROM error_insights WHERE project_id = ? AND matched_pattern = ?')
      .get(projectId, matchedPattern) as { last_seen: string | null } | undefined
    const upTo = row?.last_seen ?? nowIso()
    this.db
      .prepare(
        `INSERT INTO insight_dismissals (project_id, matched_pattern, dismissed_up_to, dismissed_at)
         VALUES (@projectId, @pattern, @upTo, @at)
         ON CONFLICT(project_id, matched_pattern)
         DO UPDATE SET dismissed_up_to = excluded.dismissed_up_to, dismissed_at = excluded.dismissed_at`,
      )
      .run({ projectId, pattern: matchedPattern, upTo, at: nowIso() })
    this.events.emitTyped('logs:changed', { projectId })
  }

  /** Dismiss every currently-visible pattern (each resurfaces if it recurs). */
  clearInsights(projectId: string): void {
    const patterns = this.db
      .prepare(
        `SELECT matched_pattern AS pattern, MAX(created_at) AS last_seen
         FROM error_insights WHERE project_id = ? GROUP BY matched_pattern`,
      )
      .all(projectId) as { pattern: string; last_seen: string }[]
    const stmt = this.db.prepare(
      `INSERT INTO insight_dismissals (project_id, matched_pattern, dismissed_up_to, dismissed_at)
       VALUES (@projectId, @pattern, @upTo, @at)
       ON CONFLICT(project_id, matched_pattern)
       DO UPDATE SET dismissed_up_to = excluded.dismissed_up_to, dismissed_at = excluded.dismissed_at`,
    )
    const at = nowIso()
    const tx = this.db.transaction(() => {
      for (const p of patterns) stmt.run({ projectId, pattern: p.pattern, upTo: p.last_seen, at })
    })
    tx()
    this.events.emitTyped('logs:changed', { projectId })
  }
}
