/**
 * Insight aggregation rule (pure, testable).
 *
 * Error insights are stored one row per matched log line — a noisy build can
 * emit the same failure hundreds of times. This module owns the single rule
 * that turns those raw occurrences into what the user sees: one entry per
 * pattern carrying its real history (total occurrences, first/last seen), with
 * dismissal watermarks honoured and the newest activity first.
 *
 * Both `LogIntelligenceService.listInsights` (SQLite rows) and the browser
 * mock consume this function, so the two bridges can never drift apart.
 */
import type { ErrorInsight } from './domain'
import type { PatternMatch } from './log-patterns'

/**
 * A raw per-occurrence insight row: one matched log line. The aggregate fields
 * (`firstSeenAt`/`lastSeenAt`/`occurrences`) are computed here, never trusted
 * from the input — a full `ErrorInsight` is accepted and re-derived.
 */
export type InsightOccurrence = Omit<ErrorInsight, 'firstSeenAt' | 'lastSeenAt' | 'occurrences'>

/** `matchedPattern` → newest occurrence timestamp the user has dismissed. */
export type DismissalWatermarks = ReadonlyMap<string, string> | Readonly<Record<string, string>>

function watermarkFor(dismissals: DismissalWatermarks, pattern: string): string | undefined {
  if (dismissals instanceof Map) return (dismissals as ReadonlyMap<string, string>).get(pattern)
  return (dismissals as Readonly<Record<string, string>>)[pattern]
}

/**
 * Collapse raw occurrences into one aggregated insight per pattern.
 *
 * Semantics (kept in lockstep with the historical SQL implementation):
 * - group by `matchedPattern`; `occurrences` is the group size,
 *   `firstSeenAt`/`lastSeenAt` span the group's `createdAt` range;
 * - the strictly-newest occurrence is the representative row (id, title,
 *   cause, action, severity…); on identical timestamps the earlier-encountered
 *   row wins, so the result is deterministic for any input order;
 * - a dismissed pattern stays hidden only while `lastSeenAt` is at or before
 *   its watermark — one newer occurrence resurfaces it (with full history);
 * - sorted by `lastSeenAt`, most recent first (ISO timestamps sort
 *   lexicographically); `limit` truncates after filtering and sorting.
 */
export function aggregateInsights(
  events: readonly InsightOccurrence[],
  dismissals: DismissalWatermarks = {},
  limit?: number,
): ErrorInsight[] {
  const byPattern = new Map<string, ErrorInsight>()
  for (const e of events) {
    const existing = byPattern.get(e.matchedPattern)
    if (!existing) {
      byPattern.set(e.matchedPattern, {
        ...e,
        firstSeenAt: e.createdAt,
        lastSeenAt: e.createdAt,
        occurrences: 1,
      })
      continue
    }
    const newer = e.createdAt > existing.lastSeenAt
    byPattern.set(e.matchedPattern, {
      ...(newer ? e : existing),
      firstSeenAt: e.createdAt < existing.firstSeenAt ? e.createdAt : existing.firstSeenAt,
      lastSeenAt: newer ? e.createdAt : existing.lastSeenAt,
      occurrences: existing.occurrences + 1,
    })
  }

  const visible: ErrorInsight[] = []
  for (const insight of byPattern.values()) {
    const dismissedUpTo = watermarkFor(dismissals, insight.matchedPattern)
    if (dismissedUpTo && insight.lastSeenAt <= dismissedUpTo) continue
    visible.push(insight)
  }

  visible.sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : a.lastSeenAt > b.lastSeenAt ? -1 : 0))
  return limit === undefined ? visible : visible.slice(0, limit)
}

/**
 * Build the single-occurrence insight for a freshly matched log line. Shared by
 * the real ingest path and the mock so a match always produces the same shape.
 */
export function insightFromMatch(
  match: PatternMatch,
  origin: { id: string; projectId: string; logEventId?: string | null; createdAt: string },
): ErrorInsight {
  return {
    id: origin.id,
    projectId: origin.projectId,
    logEventId: origin.logEventId ?? null,
    title: match.title,
    likelyCause: match.likelyCause,
    suggestedAction: match.suggestedAction,
    suggestedAgent: match.suggestedAgent,
    severity: match.severity,
    matchedPattern: match.pattern,
    createdAt: origin.createdAt,
    firstSeenAt: origin.createdAt,
    lastSeenAt: origin.createdAt,
    occurrences: 1,
  }
}
