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

/** A single quota window expanded for the rich popover / Usage panel view. */
export interface AgentUsageWindowView {
  /** Raw provider label ('Session' / 'Weekly'). */
  label: string
  /** Friendly title for display ('5h session' / 'Weekly limit'). */
  title: string
  /** Remaining headroom 0–100. Null when the provider doesn't report it. */
  remainingPercent: number | null
  /** Consumed share 0–100, mirrors `remainingPercent`. */
  usedPercent: number
  /** ISO timestamp this window resets, when reported. */
  resetAt: AgentUsageWindow['resetAt']
  tone: UsageTone
}

/** Pill summary plus the per-window breakdown the popover and panel render. */
export interface AgentUsageDetail extends AgentUsagePill {
  windows: AgentUsageWindowView[]
}

/** Human title for a quota window, e.g. 'Session' → '5h session'. */
export function windowTitle(label: string): string {
  const l = label.toLowerCase()
  if (l.includes('session') || l === '5h') return '5h session'
  if (l.includes('week') || l === 'w') return 'Weekly limit'
  return label
}

/**
 * Expand a snapshot into the full breakdown the rich surfaces use: the compact
 * pill fields plus one view per quota window (session, weekly) with remaining
 * headroom, reset time, and a per-window tone. Reuses {@link summarizeAgentUsage}
 * so pill and detail never disagree.
 */
export function describeAgentUsage(snapshot: AgentUsageSnapshot): AgentUsageDetail {
  const pill = summarizeAgentUsage(snapshot)
  const windows: AgentUsageWindowView[] = snapshot.available
    ? snapshot.windows.map((w) => {
        const remaining = remainingPercent(w)
        return {
          label: w.label,
          title: windowTitle(w.label),
          remainingPercent: remaining,
          usedPercent: remaining === null ? 0 : 100 - remaining,
          resetAt: w.resetAt,
          tone: toneFor(remaining),
        }
      })
    : []
  return { ...pill, windows }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Clamp any number into the 0–100 percent range. */
export function clampToPercent(value: number): number {
  return Math.max(0, Math.min(100, value))
}

/** A quota window resets on an ISO string (Claude) or unix-seconds (Codex). */
export function parseResetAt(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value * 1000).toISOString()
  }
  if (typeof value === 'string' && value.trim()) {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  return null
}

/**
 * Normalize Anthropic's OAuth-usage window. `utilization` is a **whole percent
 * used, 0–100** — it mirrors the `limits[].percent` field in the same payload
 * (e.g. `utilization: 4` → 4% used, 96% remaining). It is *not* a 0–1 fraction:
 * an earlier `util <= 1 ? util * 100` guess read a barely-used weekly window
 * (utilization 1 = 1% used) as 100% used, so a Max account with almost all its
 * quota left surfaced as 0% remaining. Treat it as a straight percent.
 */
export function windowFromUtilization(label: string, raw: unknown): AgentUsageWindow | null {
  if (!isRecord(raw)) return null
  const util = raw.utilization
  if (typeof util !== 'number' || !Number.isFinite(util)) return null
  return { label, usedPercent: clampToPercent(util), resetAt: parseResetAt(raw.resets_at ?? raw.reset_at) }
}

/** Normalize Codex's window: `used_percent` is already a 0–100 percent used. */
export function windowFromUsedPercent(label: string, raw: unknown): AgentUsageWindow | null {
  if (!isRecord(raw)) return null
  const used = raw.used_percent
  if (typeof used !== 'number' || !Number.isFinite(used)) return null
  return { label, usedPercent: clampToPercent(used), resetAt: parseResetAt(raw.reset_at) }
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
