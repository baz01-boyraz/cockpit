/**
 * Presentation helpers for the sentinel signal layer, shared by the toast host
 * and bell popover. Pure and dependency-free.
 */
import type {
  SentinelOutcome,
  SentinelSeverity,
  SentinelSource,
} from '@shared/sentinel'

/** Human-facing eyebrow label for a signal's source sensor. */
const SOURCE_LABELS: Record<SentinelSource, string> = {
  'log-intelligence': 'log intelligence',
  'worker-exit': 'worker exit',
  approval: 'approval',
  council: 'council',
  'swarm-completion': 'swarm completion',
  'memory-lifecycle': 'memory health',
  'operational-health': 'operational health',
  automation: 'legacy schedule',
}

export function sourceLabel(source: SentinelSource): string {
  return SOURCE_LABELS[source] ?? source
}

export type ImportanceTone = 'low' | 'medium' | 'high' | 'critical'

/** Plain-language companion to the deterministic importance percentage. */
export function importanceMeta(score: number): { label: string; tone: ImportanceTone } {
  if (score >= 90) return { label: 'Critical', tone: 'critical' }
  if (score >= 75) return { label: 'High', tone: 'high' }
  if (score >= 50) return { label: 'Medium', tone: 'medium' }
  return { label: 'Low', tone: 'low' }
}

/** Short, human label for a severity (feed filter chips + row meta). */
export const SEVERITY_LABELS: Record<SentinelSeverity, string> = {
  info: 'Info',
  notice: 'Notice',
  alert: 'Alert',
}

/**
 * Display metadata for a recorded outcome (Track G3). `tone` maps to a scoped
 * badge modifier: `card_created` earns ember (it mattered), `acted` the signal
 * lime (a fix shipped), `dismissed` stays neutral (noise, no attention owed).
 */
export const OUTCOME_META: Record<
  SentinelOutcome,
  { label: string; tone: 'accent' | 'signal' | 'muted' }
> = {
  card_created: { label: 'Card created', tone: 'accent' },
  acted: { label: 'Acted', tone: 'signal' },
  dismissed: { label: 'Dismissed', tone: 'muted' },
}
