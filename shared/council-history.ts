import type { CouncilSessionSummary } from './council'

export type CouncilHistoryTone = 'pending' | 'approved' | 'clarify' | 'final' | 'failed'

export interface CouncilHistoryPresentation {
  tone: CouncilHistoryTone
  label: string
}

/**
 * Translate persisted lifecycle + verdict facts into one honest UI state.
 * Lifecycle wins over the placeholder result: a pending reservation has
 * `ok=false` until it is finalized, but that is not a failure.
 */
export function councilHistoryPresentation(
  summary: CouncilSessionSummary,
): CouncilHistoryPresentation {
  if (summary.status === 'pending') return { tone: 'pending', label: 'Convening' }
  if (summary.status === 'failed' || !summary.ok) return { tone: 'failed', label: 'Failed' }
  if (summary.verdictKind === 'approved') return { tone: 'approved', label: 'Approved' }
  if (summary.verdictKind === 'needs_clarification') {
    return { tone: 'clarify', label: 'Needs input' }
  }
  return { tone: 'final', label: 'Reviewed' }
}

export function visibleCouncilSessions(
  sessions: readonly CouncilSessionSummary[],
  expanded: boolean,
): readonly CouncilSessionSummary[] {
  return expanded ? sessions : sessions.slice(0, 3)
}
