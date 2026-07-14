import type { SentinelSignal } from '@shared/sentinel'

/** Project isolation for renderer push events. Main broadcasts to every window;
 * each active workspace must accept only its own signals. */
export function isSignalForProject(
  activeProjectId: string | null,
  signal: Pick<SentinelSignal, 'projectId'>,
): boolean {
  return activeProjectId !== null && signal.projectId === activeProjectId
}

/** Newest-first idempotent feed merge. Triage re-emits reuse the signal id, so
 * they replace the existing row rather than creating a second notification. */
export function upsertLiveSignal(
  current: readonly SentinelSignal[],
  incoming: SentinelSignal,
  limit: number,
): SentinelSignal[] {
  const bounded = Math.max(1, Math.floor(limit))
  const existing = current.findIndex((signal) => signal.id === incoming.id)
  if (existing >= 0) {
    const next = [...current]
    next[existing] = incoming
    return next.slice(0, bounded)
  }
  return [incoming, ...current].slice(0, bounded)
}
