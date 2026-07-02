/**
 * Dashboard snapshot assembly (pure, testable).
 *
 * `Services.dashboard()` in the main process and `dashboardFor()` in the
 * browser mock both build the same `DashboardSnapshot` shape. The shape-building
 * rule lives here so the two bridges can never drift: callers gather their
 * inputs (however they source them) and delegate the assembly.
 */
import type {
  DashboardSnapshot,
  ErrorInsight,
  GitSnapshot,
  Project,
  TerminalSession,
  UsageSummary,
} from './domain'

/** How many recent error insights the dashboard surfaces. */
export const DASHBOARD_RECENT_ERRORS_LIMIT = 5

/**
 * Live AI-agent panes (Claude Code / Codex) currently running. Exited or
 * killed panes are history, not active agents.
 */
export function countActiveAgents(terminals: readonly TerminalSession[]): number {
  return terminals.filter(
    (t) => (t.role === 'claude' || t.role === 'codex') && t.status === 'running',
  ).length
}

export interface DashboardInputs {
  project: Project
  /** `null` when the project has no repository (or git status failed). */
  git: Pick<GitSnapshot, 'branch' | 'changedFilesCount'> | null
  terminals: readonly TerminalSession[]
  agentCount: number
  railwayConnected: boolean
  railwayServiceCount: number
  recentErrors: readonly ErrorInsight[]
  pendingApprovals: number
  usage: readonly UsageSummary[]
}

/** Assemble the dashboard aggregate. Pure shape-building; returns fresh arrays. */
export function assembleDashboard(inputs: DashboardInputs): DashboardSnapshot {
  return {
    project: inputs.project,
    branch: inputs.git?.branch ?? null,
    changedFiles: inputs.git?.changedFilesCount ?? 0,
    terminalCount: inputs.terminals.length,
    runningTerminals: inputs.terminals.filter((t) => t.status === 'running').length,
    agentCount: inputs.agentCount,
    railwayConnected: inputs.railwayConnected,
    railwayServices: inputs.railwayServiceCount,
    recentErrors: inputs.recentErrors.slice(0, DASHBOARD_RECENT_ERRORS_LIMIT),
    pendingApprovals: inputs.pendingApprovals,
    usage: [...inputs.usage],
  }
}
