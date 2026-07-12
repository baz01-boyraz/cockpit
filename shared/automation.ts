/** Safe, app-owned automation contracts. Native Hermes cron is deliberately not
 * used: its oneshot mode bypasses interactive approvals and may expose mutable
 * toolsets. cockpiT owns time/state; Hermes only interprets bounded snapshots. */

export const AUTOMATION_POLICY = {
  tickMs: 60_000,
  staleRunMs: 10 * 60_000,
  maxJobsPerProject: 20,
  maxInstructionChars: 1_000,
  maxResultChars: 1_200,
  minIntervalMinutes: 60,
  maxIntervalMinutes: 7 * 24 * 60,
} as const

export type AutomationKind = 'digest' | 'watch'
export type AutomationState = 'scheduled' | 'running' | 'paused'
export type AutomationLastStatus = 'never' | 'running' | 'ok' | 'error'

export type AutomationSchedule =
  | { kind: 'daily'; time: string }
  | { kind: 'interval'; minutes: number }

export interface AutomationJob {
  id: string
  projectId: string
  name: string
  instruction: string
  kind: AutomationKind
  schedule: AutomationSchedule
  system: boolean
  enabled: boolean
  state: AutomationState
  nextRunAt: string
  lastRunAt: string | null
  lastStatus: AutomationLastStatus
  lastResult: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}
export interface AutomationCreateInput {
  projectId: string
  name: string
  instruction: string
  schedule: AutomationSchedule
}

export interface AutomationProposal {
  title: string
  body: string
  reason: string
}

export interface AutomationInterpretation {
  reportWorthy: boolean
  headline: string
  summary: string
  action: string
  proposal: AutomationProposal | null
}

export const dailyDigestId = (projectId: string): string => `automation:daily-digest:${projectId}`

export function automationScheduleLabel(schedule: AutomationSchedule): string {
  if (schedule.kind === 'daily') return `Daily at ${schedule.time}`
  const hours = schedule.minutes / 60
  if (Number.isInteger(hours)) return `Every ${hours} ${hours === 1 ? 'hour' : 'hours'}`
  return `Every ${schedule.minutes} minutes`
}

/** Next run in the host's local timezone. Constructing with local Date fields
 * lets the runtime handle daylight-saving transitions for daily wall time. */
export function nextAutomationRun(schedule: AutomationSchedule, fromIso: string): string {
  const parsed = Date.parse(fromIso)
  const from = new Date(Number.isNaN(parsed) ? Date.now() : parsed)
  if (schedule.kind === 'interval') {
    return new Date(from.getTime() + schedule.minutes * 60_000).toISOString()
  }
  const match = /^(\d{2}):(\d{2})$/.exec(schedule.time)
  const hour = match ? Number(match[1]) : 9
  const minute = match ? Number(match[2]) : 0
  const candidate = new Date(
    from.getFullYear(),
    from.getMonth(),
    from.getDate(),
    hour,
    minute,
    0,
    0,
  )
  if (candidate.getTime() <= from.getTime()) candidate.setDate(candidate.getDate() + 1)
  return candidate.toISOString()
}
