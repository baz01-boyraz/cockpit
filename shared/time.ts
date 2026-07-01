/**
 * Compact relative-time formatting for dashboard feeds (pure, testable).
 *
 * Returns terse, dense labels ("now", "4m", "3h", "2d") rather than verbose
 * "3 hours ago" phrasing — the cockpit favours signal density over prose.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''

  const deltaMs = now - then
  if (deltaMs < 0) return 'now'

  const seconds = Math.floor(deltaMs / 1000)
  if (seconds < 45) return 'now'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`

  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`

  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w`

  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/**
 * Compact wall-clock duration for a command block: "820ms", "1.24s", "2m 05s".
 * Sub-second stays in ms, seconds carry two/one decimals for precision, minutes
 * switch to `Xm SSs`. Non-finite or negative input yields an empty label.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 2 : 1)}s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return `${minutes}m ${rest.toString().padStart(2, '0')}s`
}
