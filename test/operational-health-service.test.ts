import { describe, expect, it, vi } from 'vitest'
import type { AgentUsageReport, GitSnapshot } from '../shared/domain'
import type {
  OperationalHealthSnapshot,
} from '../shared/operational-health'
import { OPERATIONAL_HEALTH_POLICY } from '../shared/operational-health'
import type {
  OperationalHealthCompleteInput,
  OperationalHealthState,
  OperationalHealthStateRepository,
} from '../electron/main/services/OperationalHealthStateStore'
import { OperationalHealthService } from '../electron/main/services/OperationalHealthService'
import type { SentinelReportInput } from '../electron/main/services/SentinelService'

const BASE = Date.parse('2026-07-12T12:00:00.000Z')

const gitSnapshot = (over: Partial<GitSnapshot> = {}): GitSnapshot => ({
  id: 'git-private-id',
  projectId: 'p1',
  branch: 'private-branch',
  ahead: 0,
  behind: 0,
  changedFilesCount: 0,
  stagedCount: 0,
  unstagedCount: 0,
  untrackedCount: 0,
  files: [],
  createdAt: new Date(BASE).toISOString(),
  ...over,
})

const quota: AgentUsageReport = {
  providers: [
    {
      provider: 'claude',
      label: 'Claude',
      available: true,
      plan: 'Pro',
      windows: [{ label: 'Weekly', usedPercent: 25, resetAt: null }],
      reason: null,
      fetchedAt: new Date(BASE).toISOString(),
    },
  ],
}

class FakeState implements OperationalHealthStateRepository {
  current: OperationalHealthState | null = null
  running = false
  completions: OperationalHealthCompleteInput[] = []
  recoverStale = vi.fn(() => 0)

  claim(projectId: string, at: string): OperationalHealthState | null {
    if (this.running) return null
    this.running = true
    return {
      projectId,
      status: 'running',
      lastRunAt: this.current?.lastRunAt ?? null,
      lastResult: this.current?.lastResult ?? null,
      lastFingerprint: this.current?.lastFingerprint ?? null,
      lastNotifiedFingerprint: this.current?.lastNotifiedFingerprint ?? null,
      lastNotifiedAt: this.current?.lastNotifiedAt ?? null,
      lastDigestAt: this.current?.lastDigestAt ?? null,
      updatedAt: at,
    }
  }

  complete(input: OperationalHealthCompleteInput): OperationalHealthState {
    this.completions.push(input)
    this.running = false
    this.current = {
      projectId: input.projectId,
      status: 'idle',
      lastRunAt: input.at,
      lastResult: input.snapshot,
      lastFingerprint: input.snapshot.fingerprint,
      lastNotifiedFingerprint:
        input.notifiedFingerprint ?? this.current?.lastNotifiedFingerprint ?? null,
      lastNotifiedAt: input.notifiedAt ?? this.current?.lastNotifiedAt ?? null,
      lastDigestAt: input.digestAt ?? this.current?.lastDigestAt ?? null,
      updatedAt: input.at,
    }
    return this.current
  }

  abandon(_projectId: string, _at: string): void {
    this.running = false
  }
}

function harness() {
  let now = BASE
  const state = new FakeState()
  const order: string[] = []
  const reports: SentinelReportInput[] = []
  const sentinel = {
    report: vi.fn((input: SentinelReportInput) => {
      order.push('report')
      reports.push(input)
      return {} as never
    }),
  }
  const git = { status: vi.fn(async () => gitSnapshot()) }
  const schedule = {
    setInterval: vi.fn(() => ({ unref: vi.fn() })),
    clearInterval: vi.fn(),
  }
  const service = new OperationalHealthService({
    state,
    sentinel,
    projects: { list: () => [{ id: 'p1' }] },
    git,
    usage: { getReport: vi.fn(async () => quota) },
    swarm: { board: vi.fn(() => []) },
    terminals: { list: vi.fn(() => []) },
    logs: { listInsights: vi.fn(() => []) },
    approvals: { list: vi.fn(() => []) },
    captures: { list: vi.fn(() => []) },
    reviews: { listPending: vi.fn(() => []) },
    audit: { recent: vi.fn(() => []) },
    now: () => now,
    schedule,
    onPersist: () => order.push('persist'),
  })
  return {
    service,
    state,
    reports,
    sentinel,
    git,
    schedule,
    order,
    setNow(value: number) {
      now = value
    },
  }
}

describe('OperationalHealthService', () => {
  it('persists a healthy first run, anchors the digest cadence, and spends no model signal', async () => {
    const h = harness()
    const result = await h.service.runProject('p1')

    expect(result?.fingerprint).toBe('healthy')
    expect(h.state.completions).toHaveLength(1)
    expect(h.state.current?.lastDigestAt).toBe(new Date(BASE).toISOString())
    expect(h.reports).toHaveLength(0)
  })

  it('persists before reporting a new anomaly and stays quiet while it is unchanged', async () => {
    const h = harness()
    h.git.status.mockResolvedValue(gitSnapshot({ ahead: 1, behind: 2 }))

    await h.service.runProject('p1')
    await h.service.runProject('p1')

    expect(h.order.slice(0, 2)).toEqual(['persist', 'report'])
    expect(h.reports).toHaveLength(1)
    expect(h.reports[0]).toMatchObject({
      projectId: 'p1',
      source: 'operational-health',
      severity: 'notice',
    })
    expect(h.reports[0].dedupKey).toContain('git-diverged')
    expect(h.state.completions).toHaveLength(2)
  })

  it('records recovery silently, then reports the same problem when it genuinely recurs', async () => {
    const h = harness()
    h.git.status.mockResolvedValue(gitSnapshot({ ahead: 1, behind: 1 }))
    await h.service.runProject('p1')

    h.git.status.mockResolvedValue(gitSnapshot())
    await h.service.runProject('p1')
    expect(h.state.current?.lastFingerprint).toBe('healthy')

    h.git.status.mockResolvedValue(gitSnapshot({ ahead: 1, behind: 1 }))
    await h.service.runProject('p1')
    expect(h.reports).toHaveLength(2)
  })

  it('runs one daily digest only after the anchored cadence becomes due', async () => {
    const h = harness()
    await h.service.runProject('p1')
    h.setNow(BASE + OPERATIONAL_HEALTH_POLICY.digestIntervalMs + 1)
    await h.service.runProject('p1')
    await h.service.runProject('p1')

    expect(h.reports).toHaveLength(1)
    expect(h.reports[0]).toMatchObject({
      title: 'Operational health digest',
      source: 'operational-health',
      severity: 'notice',
    })
  })

  it('isolates a failed sensor, persists the partial snapshot, and never leaks the raw exception', async () => {
    const h = harness()
    h.git.status.mockRejectedValue(new Error('PRIVATE GIT ERROR /secret/path'))
    const snapshot = await h.service.runProject('p1')

    expect(snapshot?.unavailableSensors).toContain('git')
    expect(snapshot?.anomalies.map((item) => item.code)).toContain('sensor-unavailable:git')
    expect(JSON.stringify(snapshot)).not.toContain('PRIVATE GIT ERROR')
    expect(JSON.stringify(snapshot)).not.toContain('/secret/path')
    expect(h.reports).toHaveLength(1)
  })

  it('skips overlapping project runs instead of duplicating probes or reports', async () => {
    const h = harness()
    let release: ((value: GitSnapshot) => void) | null = null
    h.git.status.mockImplementation(
      () => new Promise<GitSnapshot>((resolve) => {
        release = resolve
      }),
    )

    const first = h.service.runProject('p1')
    const second = await h.service.runProject('p1')
    expect(second).toBeNull()
    expect(h.git.status).toHaveBeenCalledTimes(1)
    release?.(gitSnapshot())
    await first
  })

  it('starts one unref-ed scheduler, recovers stale claims, and stops idempotently', () => {
    const h = harness()
    h.service.start()
    h.service.start()
    expect(h.state.recoverStale).toHaveBeenCalledTimes(1)
    expect(h.schedule.setInterval).toHaveBeenCalledTimes(1)
    expect(h.schedule.setInterval).toHaveBeenCalledWith(
      expect.any(Function),
      OPERATIONAL_HEALTH_POLICY.sweepIntervalMs,
    )

    h.service.stop()
    h.service.stop()
    expect(h.schedule.clearInterval).toHaveBeenCalledTimes(1)
  })
})

// Compile-time guard: persisted results are the bounded snapshot, never raw sensor input.
const _snapshotContract: OperationalHealthSnapshot | null = null
void _snapshotContract
