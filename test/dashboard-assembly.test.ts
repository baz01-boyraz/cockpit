import { describe, expect, it } from 'vitest'
import type { ErrorInsight, Project, TerminalSession, UsageSummary } from '@shared/domain'
import {
  DASHBOARD_RECENT_ERRORS_LIMIT,
  assembleDashboard,
  countActiveAgents,
} from '@shared/dashboard-assembly'

const NOW = '2026-07-01T12:00:00.000Z'

const project: Project = {
  id: 'prj_test',
  name: 'Test Project',
  path: '/tmp/test-project',
  techStack: ['TypeScript'],
  createdAt: NOW,
  updatedAt: NOW,
  lastOpenedAt: NOW,
}

let seq = 0
function term(overrides: Partial<TerminalSession> = {}): TerminalSession {
  seq += 1
  return {
    id: `term_${seq}`,
    projectId: 'prj_test',
    name: `Terminal ${seq}`,
    role: null,
    alias: null,
    cwd: '.',
    shell: '/bin/zsh',
    status: 'running',
    pid: 100 + seq,
    exitCode: null,
    createdAt: NOW,
    lastActiveAt: NOW,
    ...overrides,
  }
}

function insight(n: number): ErrorInsight {
  return {
    id: `ins_${n}`,
    projectId: 'prj_test',
    logEventId: null,
    title: `Error ${n}`,
    likelyCause: 'cause',
    suggestedAction: 'action',
    suggestedAgent: 'codex',
    severity: 'high',
    matchedPattern: `pattern_${n}`,
    createdAt: NOW,
    firstSeenAt: NOW,
    lastSeenAt: NOW,
    occurrences: 1,
  }
}

const usage: UsageSummary[] = [
  { provider: 'terminal', sessions: 2, commands: 10, tasks: 0, totalDurationMs: 1000, estimatedTokens: null, warning: null },
]

const baseInputs = {
  project,
  git: { branch: 'main', changedFilesCount: 3 },
  terminals: [] as TerminalSession[],
  agentCount: 0,
  railwayConnected: true,
  railwayServiceCount: 2,
  recentErrors: [] as ErrorInsight[],
  pendingApprovals: 1,
  usage,
}

describe('assembleDashboard', () => {
  it('assembles the full snapshot shape from its inputs', () => {
    const terminals = [term(), term({ status: 'exited' })]
    const snapshot = assembleDashboard({ ...baseInputs, terminals, agentCount: 1, recentErrors: [insight(1)] })
    expect(snapshot).toEqual({
      project,
      branch: 'main',
      changedFiles: 3,
      terminalCount: 2,
      runningTerminals: 1,
      agentCount: 1,
      railwayConnected: true,
      railwayServices: 2,
      recentErrors: [insight(1)],
      pendingApprovals: 1,
      usage,
    })
  })

  it('degrades to null branch and zero changed files without git', () => {
    const snapshot = assembleDashboard({ ...baseInputs, git: null })
    expect(snapshot.branch).toBeNull()
    expect(snapshot.changedFiles).toBe(0)
  })

  it('counts only running terminals as running', () => {
    const terminals = [term(), term({ status: 'killed' }), term({ status: 'exited' }), term()]
    const snapshot = assembleDashboard({ ...baseInputs, terminals })
    expect(snapshot.terminalCount).toBe(4)
    expect(snapshot.runningTerminals).toBe(2)
  })

  it('caps recent errors at the dashboard limit', () => {
    const errors = Array.from({ length: DASHBOARD_RECENT_ERRORS_LIMIT + 2 }, (_, i) => insight(i))
    const snapshot = assembleDashboard({ ...baseInputs, recentErrors: errors })
    expect(snapshot.recentErrors).toHaveLength(DASHBOARD_RECENT_ERRORS_LIMIT)
    expect(snapshot.recentErrors[0]).toEqual(insight(0))
  })

  it('returns fresh arrays so callers cannot mutate the inputs through the snapshot', () => {
    const errors = [insight(1)]
    const snapshot = assembleDashboard({ ...baseInputs, recentErrors: errors })
    expect(snapshot.recentErrors).not.toBe(errors)
    expect(snapshot.usage).not.toBe(usage)
    expect(snapshot.usage).toEqual(usage)
  })
})

describe('countActiveAgents', () => {
  it('counts running claude and codex panes', () => {
    const terminals = [term({ role: 'claude' }), term({ role: 'codex' }), term({ role: 'claude' })]
    expect(countActiveAgents(terminals)).toBe(3)
  })

  it('ignores plain terminals and non-agent roles', () => {
    const terminals = [term(), term({ role: 'frontend' }), term({ role: 'git' })]
    expect(countActiveAgents(terminals)).toBe(0)
  })

  it('ignores agent panes that have exited or been killed', () => {
    const terminals = [
      term({ role: 'claude', status: 'exited' }),
      term({ role: 'codex', status: 'killed' }),
      term({ role: 'claude' }),
    ]
    expect(countActiveAgents(terminals)).toBe(1)
  })

  it('returns zero for no terminals', () => {
    expect(countActiveAgents([])).toBe(0)
  })
})
