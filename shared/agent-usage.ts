/**
 * Agent usage summarization (pure, testable).
 *
 * Collapses a provider's quota windows into the compact pill view-model the
 * TopBar renders. The probing/credential handling lives in the main process
 * (AgentUsageService); this module is the deterministic math it relies on,
 * kept runtime-dependency-free so it works in the browser mock and tests.
 */
import type { AgentUsageProvider, AgentUsageSnapshot, AgentUsageWindow } from './domain'

const SESSION_LABELS = ['session', 'current session', '5h'] as const
const WEEKLY_LABELS = ['weekly', 'current week', 'week', 'w'] as const

/** Healthy → lime, warning → amber, critical → ember/red. Drives pill color. */
export type UsageTone = 'healthy' | 'warning' | 'critical'

export interface AgentUsagePill {
  provider: AgentUsageProvider
  label: string
  /** Compact remaining summary, e.g. '5h 89% · W 77%'. Null when unavailable. */
  detail: string | null
  /** Remaining headroom in the 5h session window (0–100). Null when unreported. */
  sessionPercent: number | null
  /** Remaining headroom in the weekly window (0–100). Null when unreported. */
  weeklyPercent: number | null
  /** Lowest remaining percent across windows — drives the tone. */
  minRemainingPercent: number | null
  tone: UsageTone
  available: boolean
  plan: string | null
  reason: string | null
}

function remainingPercent(window: AgentUsageWindow): number | null {
  if (!Number.isFinite(window.usedPercent)) return null
  return Math.max(0, Math.min(100, Math.round(100 - window.usedPercent)))
}

function findWindow(
  windows: readonly AgentUsageWindow[],
  labels: readonly string[],
): AgentUsageWindow | null {
  const wanted = labels.map((l) => l.toLowerCase())
  return windows.find((w) => wanted.includes(w.label.toLowerCase())) ?? null
}

export function toneFor(minRemaining: number | null): UsageTone {
  if (minRemaining === null) return 'healthy'
  if (minRemaining <= 10) return 'critical'
  if (minRemaining <= 25) return 'warning'
  return 'healthy'
}

/** Collapse a provider snapshot into the compact pill the TopBar shows. */
export function summarizeAgentUsage(snapshot: AgentUsageSnapshot): AgentUsagePill {
  const base = {
    provider: snapshot.provider,
    label: snapshot.label,
    plan: snapshot.plan,
  }

  if (!snapshot.available) {
    return {
      ...base,
      detail: null,
      sessionPercent: null,
      weeklyPercent: null,
      minRemainingPercent: null,
      tone: 'healthy',
      available: false,
      reason: snapshot.reason,
    }
  }

  const session = findWindow(snapshot.windows, SESSION_LABELS)
  const weekly = findWindow(snapshot.windows, WEEKLY_LABELS)
  const sessionRemaining = session ? remainingPercent(session) : null
  const weeklyRemaining = weekly ? remainingPercent(weekly) : null

  const parts: string[] = []
  const remainingValues: number[] = []
  if (sessionRemaining !== null) {
    parts.push(`5h ${sessionRemaining}%`)
    remainingValues.push(sessionRemaining)
  }
  if (weeklyRemaining !== null) {
    parts.push(`W ${weeklyRemaining}%`)
    remainingValues.push(weeklyRemaining)
  }

  if (!parts.length) {
    return {
      ...base,
      detail: null,
      sessionPercent: null,
      weeklyPercent: null,
      minRemainingPercent: null,
      tone: 'healthy',
      available: false,
      reason: 'No quota windows reported.',
    }
  }

  const min = Math.min(...remainingValues)
  return {
    ...base,
    detail: parts.join(' · '),
    sessionPercent: sessionRemaining,
    weeklyPercent: weeklyRemaining,
    minRemainingPercent: min,
    tone: toneFor(min),
    available: true,
    reason: null,
  }
}
