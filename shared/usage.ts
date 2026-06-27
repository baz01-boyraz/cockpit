/**
 * Usage aggregation (pure, testable).
 *
 * Collapses raw usage events into per-provider summaries and raises soft
 * warnings when activity looks unusually high. The adapter model lives in the
 * main process (UsageService); this module is the deterministic math it relies
 * on, kept separate so it can be tested without a database.
 */
import type { UsageEvent, UsageProvider, UsageSummary } from './domain'

const HIGH_SESSION_THRESHOLD = 12
const HIGH_TOKEN_THRESHOLD = 500_000

export function summarizeUsage(events: UsageEvent[]): UsageSummary[] {
  const byProvider = new Map<UsageProvider, UsageSummary>()

  for (const e of events) {
    const cur =
      byProvider.get(e.provider) ??
      ({
        provider: e.provider,
        sessions: 0,
        commands: 0,
        tasks: 0,
        totalDurationMs: 0,
        estimatedTokens: null,
        warning: null,
      } satisfies UsageSummary)

    if (e.eventType === 'session_started' || e.eventType === 'agent_launch') cur.sessions += e.count
    if (e.eventType === 'command_run') cur.commands += e.count
    if (e.eventType === 'task_run') cur.tasks += e.count
    if (e.durationMs) cur.totalDurationMs += e.durationMs
    if (e.estimatedTokens) cur.estimatedTokens = (cur.estimatedTokens ?? 0) + e.estimatedTokens

    byProvider.set(e.provider, cur)
  }

  for (const summary of byProvider.values()) {
    const warnings: string[] = []
    if (summary.sessions >= HIGH_SESSION_THRESHOLD) {
      warnings.push(`${summary.sessions} sessions — consider consolidating terminals.`)
    }
    if ((summary.estimatedTokens ?? 0) >= HIGH_TOKEN_THRESHOLD) {
      warnings.push('High estimated token usage for this session window.')
    }
    summary.warning = warnings.length ? warnings.join(' ') : null
  }

  return [...byProvider.values()].sort((a, b) => b.sessions - a.sessions)
}
