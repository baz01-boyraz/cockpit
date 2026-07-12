import { describe, expect, it } from 'vitest'
import type { AgentUsageReport, ApprovalRequest, ErrorInsight, TerminalSession } from '../shared/domain'
import type { KanbanCard } from '../shared/kanban'
import type { CaptureJob } from '../shared/memory-capture'
import type { ReviewItem } from '../shared/memory-review'
import {
  OPERATIONAL_HEALTH_POLICY,
  evaluateOperationalHealth,
  type OperationalHealthInput,
} from '../shared/operational-health'
import { sourceLabel } from '../src/lib/sentinelView'

const NOW = Date.parse('2026-07-12T12:00:00.000Z')
const isoAgo = (ms: number) => new Date(NOW - ms).toISOString()

const card = (over: Partial<KanbanCard> = {}): KanbanCard => ({
  id: 'card-private-id',
  projectId: 'p1',
  title: 'PRIVATE CARD TITLE',
  body: 'PRIVATE CARD BODY',
  status: 'todo',
  position: 1,
  role: null,
  persona: null,
  agent: null,
  assignments: [],
  pipelineStep: 0,
  councilSessionId: null,
  terminalSessionId: null,
  worktreePath: '/private/worktree',
  branch: 'private-branch',
  createdAt: isoAgo(60_000),
  updatedAt: isoAgo(60_000),
  ...over,
})

const terminal = (over: Partial<TerminalSession> = {}): TerminalSession => ({
  id: 'term-1',
  projectId: 'p1',
  name: 'PRIVATE TERMINAL NAME',
  role: 'claude',
  alias: null,
  cwd: '/private/cwd',
  shell: '/bin/zsh',
  status: 'running',
  pid: 999,
  exitCode: null,
  createdAt: isoAgo(60_000),
  lastActiveAt: isoAgo(60_000),
  ...over,
})

const insight = (over: Partial<ErrorInsight> = {}): ErrorInsight => ({
  id: 'insight-private-id',
  projectId: 'p1',
  logEventId: 'log-private-id',
  title: 'PRIVATE LOG TITLE',
  likelyCause: 'PRIVATE LOG CAUSE',
  suggestedAction: 'PRIVATE LOG ACTION',
  suggestedAgent: 'backend',
  severity: 'low',
  matchedPattern: 'PRIVATE RAW ERROR PATTERN',
  createdAt: isoAgo(60_000),
  firstSeenAt: isoAgo(60_000),
  lastSeenAt: isoAgo(60_000),
  occurrences: 1,
  ...over,
})

const approval = (over: Partial<ApprovalRequest> = {}): ApprovalRequest => ({
  id: 'approval-private-id',
  projectId: 'p1',
  actionType: 'deploy',
  riskLevel: 'high',
  summary: 'PRIVATE APPROVAL SUMMARY',
  payload: { secret: 'PRIVATE APPROVAL PAYLOAD' },
  status: 'pending',
  createdAt: isoAgo(60_000),
  resolvedAt: null,
  ...over,
})

const capture = (over: Partial<CaptureJob> = {}): CaptureJob => ({
  id: 'capture-private-id',
  projectId: 'p1',
  sessionId: 'session-private-id',
  sourcePath: '/private/transcript.jsonl',
  status: 'done',
  lastOffset: 1,
  attempts: 1,
  error: 'PRIVATE CAPTURE ERROR',
  enqueuedAt: isoAgo(60_000),
  updatedAt: isoAgo(60_000),
  ...over,
})

const review = (over: Partial<ReviewItem> = {}): ReviewItem => ({
  id: 'review-private-id',
  brain: 'project:p1',
  kind: 'new',
  slug: 'private-note-slug',
  title: 'PRIVATE REVIEW TITLE',
  proposedContent: 'PRIVATE NOTE CONTENT',
  reason: 'PRIVATE REVIEW REASON',
  existingContent: null,
  sourceId: null,
  alsoTrash: null,
  operation: null,
  alsoTrashContent: null,
  status: 'pending',
  createdAt: isoAgo(60_000),
  resolvedAt: null,
  ...over,
})

const quota = (usedPercent = 20): AgentUsageReport => ({
  providers: [
    {
      provider: 'claude',
      label: 'Claude',
      available: true,
      plan: 'Pro',
      windows: [{ label: 'Weekly', usedPercent, resetAt: null }],
      reason: null,
      fetchedAt: new Date(NOW).toISOString(),
    },
    {
      provider: 'codex',
      label: 'Codex',
      available: false,
      plan: null,
      windows: [],
      reason: 'signed out',
      fetchedAt: new Date(NOW).toISOString(),
    },
  ],
})

function healthy(over: Partial<OperationalHealthInput> = {}): OperationalHealthInput {
  return {
    projectId: 'p1',
    checkedAt: new Date(NOW).toISOString(),
    git: {
      ahead: 0,
      behind: 0,
      changedFiles: 3,
      conflicts: 0,
      detached: false,
    },
    quota: quota(),
    swarm: { cards: [], terminals: [] },
    processes: { reapedRecent: 0, unverifiedRecent: 0 },
    logs: [],
    approvals: [],
    memory: { captureJobs: [], reviews: [] },
    unavailableSensors: [],
    ...over,
  }
}

describe('operational health evaluator', () => {
  it('pins conservative cadence/age thresholds and gives the source a plain UI label', () => {
    expect(OPERATIONAL_HEALTH_POLICY).toMatchObject({
      sweepIntervalMs: 30 * 60_000,
      digestIntervalMs: 24 * 60 * 60_000,
      stuckWorkerMs: 20 * 60_000,
      parkedCardMs: 24 * 60 * 60_000,
      staleApprovalMs: 60 * 60_000,
    })
    expect(sourceLabel('operational-health')).toBe('operational health')
  })

  it('keeps ordinary dirty work, unavailable quota, and fresh queues quiet', () => {
    const result = evaluateOperationalHealth(
      healthy({
        git: { ahead: 0, behind: 0, changedFiles: 12, conflicts: 0, detached: false },
        quota: quota(),
        swarm: { cards: [card({ status: 'parked' })], terminals: [] },
        approvals: [approval()],
        memory: {
          captureJobs: [capture({ status: 'queued' })],
          reviews: [review()],
        },
      }),
    )

    expect(result.anomalies).toEqual([])
    expect(result.fingerprint).toBe('healthy')
    expect(result.git.changedFiles).toBe(12)
    expect(result.quota.unavailableProviders).toEqual(['codex'])
  })

  it('finds actionable degradation across every deterministic sensor', () => {
    const result = evaluateOperationalHealth(
      healthy({
        git: { ahead: 2, behind: 1, changedFiles: 4, conflicts: 2, detached: false },
        quota: quota(100),
        swarm: {
          cards: [
            card({ id: 'missing', status: 'in_progress', terminalSessionId: null }),
            card({
              id: 'stuck',
              status: 'in_progress',
              terminalSessionId: 'term-stuck',
            }),
            card({ id: 'parked', status: 'parked', updatedAt: isoAgo(25 * 60 * 60_000) }),
          ],
          terminals: [
            terminal({
              id: 'term-stuck',
              lastActiveAt: isoAgo(OPERATIONAL_HEALTH_POLICY.stuckWorkerMs + 1),
            }),
          ],
        },
        processes: { reapedRecent: 1, unverifiedRecent: 2 },
        logs: [
          insight({ severity: 'critical' }),
          insight({ severity: 'high', occurrences: 3 }),
        ],
        approvals: [
          approval({ createdAt: isoAgo(OPERATIONAL_HEALTH_POLICY.staleApprovalMs + 1) }),
        ],
        memory: {
          captureJobs: [
            capture({ status: 'error' }),
            capture({
              id: 'processing',
              status: 'processing',
              updatedAt: isoAgo(OPERATIONAL_HEALTH_POLICY.stuckCaptureMs + 1),
            }),
          ],
          reviews: Array.from({ length: 3 }, (_, index) =>
            review({ id: `review-${index}`, kind: 'conflict' }),
          ),
        },
        unavailableSensors: ['git'],
      }),
    )

    expect(result.anomalies.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        'git-conflicts',
        'git-diverged',
        'quota-exhausted:claude',
        'swarm-worker-missing',
        'swarm-worker-stuck',
        'swarm-parked-stale',
        'orphan-unverified',
        'logs-critical',
        'logs-recurring-high',
        'approval-stale',
        'memory-capture-error',
        'memory-capture-stuck',
        'sensor-unavailable:git',
      ]),
    )
    expect(result.anomalies.some((item) => item.severity === 'alert')).toBe(true)
    expect(result.memory.conflicts).toBe(3)
    expect(result.processes.reapedRecent).toBe(1)
  })

  it('emits a stable, order-independent fingerprint without retaining raw content', () => {
    const cards = [
      card({ id: 'a', status: 'in_progress' }),
      card({ id: 'b', status: 'parked', updatedAt: isoAgo(25 * 60 * 60_000) }),
    ]
    const logs = [insight({ severity: 'critical' }), insight({ severity: 'high', occurrences: 4 })]
    const first = evaluateOperationalHealth(
      healthy({
        swarm: { cards, terminals: [] },
        logs,
        approvals: [approval({ createdAt: isoAgo(2 * 60 * 60_000) })],
        memory: { captureJobs: [capture({ status: 'error' })], reviews: [review()] },
      }),
    )
    const second = evaluateOperationalHealth(
      healthy({
        swarm: { cards: [...cards].reverse(), terminals: [] },
        logs: [...logs].reverse(),
        approvals: [approval({ createdAt: isoAgo(2 * 60 * 60_000) })],
        memory: { captureJobs: [capture({ status: 'error' })], reviews: [review()] },
      }),
    )

    expect(second.fingerprint).toBe(first.fingerprint)
    const serialized = JSON.stringify(first)
    for (const forbidden of [
      'PRIVATE CARD',
      '/private/worktree',
      '/private/cwd',
      'PRIVATE LOG',
      'PRIVATE RAW ERROR',
      'PRIVATE APPROVAL',
      '/private/transcript',
      'PRIVATE CAPTURE ERROR',
      'PRIVATE NOTE',
      'private-note-slug',
    ]) {
      expect(serialized).not.toContain(forbidden)
    }
  })
})
