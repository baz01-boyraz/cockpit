import { describe, expect, it, vi } from 'vitest'
import type {
  AutomationCreateInput,
  AutomationInterpretation,
  AutomationJob,
} from '../shared/automation'
import type { OperationalHealthSnapshot } from '../shared/operational-health'
import { AutomationService } from '../electron/main/services/AutomationService'
import type { SentinelReportInput } from '../electron/main/services/SentinelService'

const AT = Date.parse('2026-07-12T14:00:00.000Z')
const iso = () => new Date(AT).toISOString()

const job = (over: Partial<AutomationJob> = {}): AutomationJob => ({
  id: 'auto-1', projectId: 'p1', name: 'Daily briefing', instruction: 'Summarize project health.',
  kind: 'digest', schedule: { kind: 'daily', time: '09:00' }, system: true, enabled: true,
  state: 'scheduled', nextRunAt: iso(), lastRunAt: null, lastStatus: 'never', lastResult: null,
  lastError: null, createdAt: iso(), updatedAt: iso(), ...over,
})

const snapshot = (): OperationalHealthSnapshot => ({
  schema: 1, projectId: 'p1', checkedAt: iso(),
  git: { available: true, ahead: 0, behind: 0, changedFiles: 0, conflicts: 0, detached: false },
  quota: { availableProviders: 2, unavailableProviders: [], lowProviders: [], exhaustedProviders: [] },
  swarm: { inProgress: 0, missingWorkers: 0, stuckWorkers: 0, parked: 0, staleParked: 0, inReview: 0, liveReviewTerminals: 0 },
  processes: { reapedRecent: 0, unverifiedRecent: 0 }, logs: { recentHigh: 0, recentCritical: 0, recurringHigh: 0 },
  approvals: { pending: 0, stale: 0 },
  memory: { queued: 0, processing: 0, stuckProcessing: 0, errors: 0, pendingReviews: 0, conflicts: 0, oldReviews: 0 },
  unavailableSensors: [], anomalies: [], fingerprint: 'healthy',
})

class FakeStore {
  jobs = [job()]
  running = new Set<string>()
  ensureDailyDigest = vi.fn(() => this.jobs[0])
  list = vi.fn(() => this.jobs)
  due = vi.fn(() => this.jobs.filter((item) => item.enabled && item.nextRunAt <= iso()))
  create = vi.fn((input: AutomationCreateInput) => {
    const created = job({ id: 'auto-created', ...input, kind: 'watch', system: false })
    this.jobs.push(created)
    return created
  })
  claim = vi.fn((_projectId: string, id: string, _at: string, _force: boolean) => {
    if (this.running.has(id)) return null
    const found = this.jobs.find((item) => item.id === id)
    if (!found || !found.enabled) return null
    this.running.add(id)
    return { ...found, state: 'running' as const, lastStatus: 'running' as const }
  })
  complete = vi.fn((_projectId: string, id: string, input: { at: string; nextRunAt: string; result: string }) => {
    this.running.delete(id)
    const found = this.jobs.find((item) => item.id === id)!
    Object.assign(found, { state: 'scheduled', lastStatus: 'ok', lastRunAt: input.at, lastResult: input.result, nextRunAt: input.nextRunAt })
    return found
  })
  fail = vi.fn((_projectId: string, id: string, input: { at: string; nextRunAt: string; error: string }) => {
    this.running.delete(id)
    const found = this.jobs.find((item) => item.id === id)!
    Object.assign(found, { state: 'scheduled', lastStatus: 'error', lastRunAt: input.at, lastError: input.error, nextRunAt: input.nextRunAt })
    return found
  })
  setEnabled = vi.fn((_projectId: string, id: string, enabled: boolean, _at: string) => {
    const found = this.jobs.find((item) => item.id === id)!
    Object.assign(found, { enabled, state: enabled ? 'scheduled' : 'paused' })
    return found
  })
  remove = vi.fn((_projectId: string, id: string) => {
    const found = this.jobs.find((item) => item.id === id)
    if (found?.system) return false
    this.jobs = this.jobs.filter((item) => item.id !== id)
    return true
  })
}

function harness(result: Partial<AutomationInterpretation> = {}) {
  const store = new FakeStore()
  const order: string[] = []
  store.complete.mockImplementation((_projectId, id, input) => {
    order.push('persist')
    store.running.delete(id)
    const found = store.jobs.find((item) => item.id === id)!
    Object.assign(found, { state: 'scheduled', lastStatus: 'ok', lastRunAt: input.at, lastResult: input.result, nextRunAt: input.nextRunAt })
    return found
  })
  const interpretation: AutomationInterpretation = {
    reportWorthy: false,
    headline: 'All quiet',
    summary: 'No action is needed.',
    action: 'None',
    proposal: null,
    ...result,
  }
  const reports: SentinelReportInput[] = []
  const approvals: unknown[] = []
  const schedule = { setInterval: vi.fn(() => ({ unref: vi.fn() })), clearInterval: vi.fn() }
  const service = new AutomationService({
    store,
    projects: { list: () => [{ id: 'p1', path: '/project' }] },
    health: { inspect: vi.fn(async () => snapshot()) },
    runner: { interpret: vi.fn(async () => interpretation) },
    sentinel: {
      stage: vi.fn((input) => {
        order.push('stage')
        reports.push(input)
        return { id: 'signal-1' } as never
      }),
      publishStaged: vi.fn(() => {
        order.push('publish')
        return {} as never
      }),
    },
    approvals: { request: vi.fn((input) => { order.push('approval'); approvals.push(input); return {} as never }) },
    now: () => AT,
    schedule,
  })
  return { service, store, reports, approvals, order, schedule, health: service['deps'].health }
}

describe('AutomationService', () => {
  it('installs one default daily digest and one unref-ed scheduler', () => {
    const h = harness()
    h.service.start()
    h.service.start()
    expect(h.store.ensureDailyDigest).toHaveBeenCalledTimes(1)
    expect(h.schedule.setInterval).toHaveBeenCalledTimes(1)
    h.service.stop()
    h.service.stop()
    expect(h.schedule.clearInterval).toHaveBeenCalledTimes(1)
  })

  it('keeps app startup and timer ticks safe when durable state is temporarily unavailable', async () => {
    const h = harness()
    h.store.ensureDailyDigest.mockImplementationOnce(() => {
      throw new Error('disk temporarily unavailable')
    })
    expect(() => h.service.start()).not.toThrow()

    h.store.due.mockImplementationOnce(() => {
      throw new Error('read temporarily unavailable')
    })
    await expect(h.service.tick()).resolves.toBeUndefined()
    h.service.stop()
  })

  it('persists before delivering the daily digest even when the project is healthy', async () => {
    const h = harness()
    await h.service.runNow('p1', 'auto-1')
    expect(h.order).toEqual(['persist', 'stage', 'publish'])
    expect(h.reports[0]).toMatchObject({ source: 'automation', severity: 'notice' })
  })

  it('keeps an ordinary watch silent unless Hermes marks it report-worthy', async () => {
    const h = harness()
    h.store.jobs[0] = job({ kind: 'watch', system: false })
    await h.service.runNow('p1', 'auto-1')
    expect(h.reports).toHaveLength(0)
  })

  it('routes a Hermes proposal to approval after persistence and never owns a Swarm start path', async () => {
    const h = harness({
      reportWorthy: true,
      proposal: { title: 'Inspect the queue', body: 'Evidence only.', reason: 'Stable pressure.' },
    })
    await h.service.runNow('p1', 'auto-1')
    expect(h.order).toEqual(['persist', 'stage', 'publish', 'approval'])
    expect(h.approvals[0]).toMatchObject({
      actionType: 'propose_open_swarm_card',
      payload: { title: 'Inspect the queue', body: 'Evidence only.' },
    })
    expect(JSON.stringify(h.service)).not.toContain('startCard')
  })

  it('refuses overlapping execution and records a bounded failure for retry', async () => {
    const h = harness()
    h.store.running.add('auto-1')
    await expect(h.service.runNow('p1', 'auto-1')).resolves.toBeNull()
    expect(h.store.complete).not.toHaveBeenCalled()

    h.store.running.clear()
    const health = h.health as { inspect: ReturnType<typeof vi.fn> }
    health.inspect.mockRejectedValue(new Error('PRIVATE FAILURE /secret/path'))
    await h.service.runNow('p1', 'auto-1')
    expect(h.store.fail).toHaveBeenCalledWith(
      'p1',
      'auto-1',
      expect.objectContaining({ error: expect.not.stringContaining('/secret/path') }),
    )
  })

  it('supports friendly create, pause/resume, retry, and protects the system digest from deletion', async () => {
    const h = harness()
    h.service.create({
      projectId: 'p1', name: 'Queue watch', instruction: 'Watch queue pressure.',
      schedule: { kind: 'interval', minutes: 360 },
    })
    expect(h.store.create).toHaveBeenCalled()
    h.service.setEnabled('p1', 'auto-1', false)
    h.service.setEnabled('p1', 'auto-1', true)
    expect(h.store.setEnabled).toHaveBeenNthCalledWith(1, 'p1', 'auto-1', false, iso())
    expect(h.store.setEnabled).toHaveBeenNthCalledWith(2, 'p1', 'auto-1', true, iso())
    expect(h.service.remove('p1', 'auto-1')).toBe(false)
  })
})
