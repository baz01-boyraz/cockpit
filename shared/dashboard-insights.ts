import type { AgentType, ErrorInsight, ErrorSeverity } from './domain'

/**
 * Dashboard presentation logic (pure, testable). Collapses repeated error
 * insights into counted groups and trims boilerplate from audit summaries so
 * the dashboard reads as signal, not a wall of duplicated text.
 */

/**
 * A de-duplicated cluster of recent errors that share the same root pattern.
 * The dashboard shows one row per group with an `×count` badge instead of
 * repeating identical title + cause lines.
 */
export interface ErrorGroup {
  key: string
  title: string
  count: number
  severity: ErrorSeverity
  suggestedAgent: AgentType
  likelyCause: string
}

const SEVERITY_RANK: Record<ErrorSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
}

/**
 * Collapse a flat list of error insights into grouped clusters keyed by the
 * matched pattern (falling back to the title). The most severe member wins the
 * group's severity, and groups are ordered by descending severity.
 */
export function groupErrors(errors: readonly ErrorInsight[]): ErrorGroup[] {
  const groups = new Map<string, ErrorGroup>()

  for (const error of errors) {
    const key = error.matchedPattern || error.title
    const existing = groups.get(key)

    if (!existing) {
      groups.set(key, {
        key,
        title: error.title,
        count: 1,
        severity: error.severity,
        suggestedAgent: error.suggestedAgent,
        likelyCause: error.likelyCause,
      })
      continue
    }

    groups.set(key, {
      ...existing,
      count: existing.count + 1,
      severity:
        SEVERITY_RANK[error.severity] > SEVERITY_RANK[existing.severity]
          ? error.severity
          : existing.severity,
    })
  }

  return [...groups.values()].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
}

const ROUTED_PREFIX = /^Routed task to /i

/**
 * Trim repetitive boilerplate from audit summaries so the activity feed reads
 * as a dense timeline rather than a wall of "Routed task to …" prefixes.
 */
export function prettyAuditSummary(summary: string): string {
  return summary.replace(ROUTED_PREFIX, '→ ')
}
