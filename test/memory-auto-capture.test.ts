import { describe, expect, it, vi } from 'vitest'
import { MemoryAutoCapture } from '../electron/main/services/MemoryAutoCapture'
import type { MemoryCaptureQueue } from '../electron/main/services/MemoryCaptureQueue'
import type { MemoryPipeline } from '../electron/main/services/MemoryPipeline'
import type { ProjectService } from '../electron/main/services/ProjectService'
import type { AgentSessionsService } from '../electron/main/services/AgentSessionsService'
import type { CaptureJob } from '@shared/memory-capture'
import type { ResumableSessionProvider } from '@shared/domain'

const T = Date.parse('2026-07-04T12:00:00.000Z')
const MIN = 60_000

/** Minimal in-memory queue implementing what the watcher calls. */
function fakeQueue() {
  const jobs = new Map<string, CaptureJob>()
  const claimable: string[] = []
  const svc = {
    peek: (provider: ResumableSessionProvider, sid: string) => jobs.get(`${provider}:${sid}`) ?? null,
    enqueue: (i: { projectId: string; provider: ResumableSessionProvider; sessionId: string; sourcePath: string }) => {
      const key = `${i.provider}:${i.sessionId}`
      const job: CaptureJob = {
        id: key, projectId: i.projectId, provider: i.provider, sessionId: i.sessionId, sourcePath: i.sourcePath,
        status: 'queued', lastOffset: jobs.get(key)?.lastOffset ?? 0, attempts: 0, error: null,
        nextRetryAt: null, guidance: null,
        enqueuedAt: 't', updatedAt: 't',
      }
      jobs.set(key, job)
      if (!claimable.includes(key)) claimable.push(key)
      return job
    },
    claimNext: () => {
      const id = claimable.shift()
      if (!id) return null
      const job = { ...jobs.get(id)!, status: 'reading' as const }
      jobs.set(id, job)
      return job
    },
    updateStage: (id: string, status: CaptureJob['status']) => {
      const job = jobs.get(id)
      if (job) jobs.set(id, { ...job, status })
    },
    complete: (id: string, off: number) => { const j = jobs.get(id); if (j) jobs.set(id, { ...j, status: 'done', lastOffset: off }) },
    fail: (id: string, msg: string) => { const j = jobs.get(id); if (j) jobs.set(id, { ...j, status: 'error', error: msg }) },
    recoverStuck: () => 0,
  }
  return { svc: svc as unknown as MemoryCaptureQueue, jobs }
}

const session = (id: string, ageMs: number, sizeBytes = 1000, provider: ResumableSessionProvider = 'claude') => ({
  id, provider, title: id, createdAt: 't', lastActiveAt: new Date(T - ageMs).toISOString(), sizeBytes,
  transcriptPath: `/${provider}/${id}.jsonl`,
})

const stubs = (sessions: ReturnType<typeof session>[]) => ({
  projects: { list: () => [{ id: 'p1', path: '/proj' }] } as unknown as ProjectService,
  sessions: {
    captureList: () => sessions,
  } as unknown as AgentSessionsService,
})

const okPipeline = () =>
  ({ capture: vi.fn(async () => ({ proposals: [], committed: 1, queued: 0, skipped: 0, nextOffset: 500, dryRun: false })) }) as unknown as MemoryPipeline

describe('MemoryAutoCapture.sweep', () => {
  it('enqueues and captures an idle, recent session', async () => {
    const q = fakeQueue()
    const pipe = okPipeline()
    const { projects, sessions } = stubs([session('s1', 20 * MIN)])
    const auto = new MemoryAutoCapture(q.svc, pipe, projects, sessions, { now: () => T })
    await auto.sweep()
    expect(pipe.capture).toHaveBeenCalledTimes(1)
    expect((pipe.capture as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]).toMatchObject({ provider: 'claude', sessionId: 's1', fromOffset: 0 })
    expect(q.jobs.get('claude:s1')?.status).toBe('done')
    expect(q.jobs.get('claude:s1')?.lastOffset).toBe(500)
  })

  it('ignores a session that is still active (not idle yet)', async () => {
    const q = fakeQueue()
    const pipe = okPipeline()
    const { projects, sessions } = stubs([session('s1', 2 * MIN)])
    const auto = new MemoryAutoCapture(q.svc, pipe, projects, sessions, { now: () => T })
    await auto.sweep()
    expect(pipe.capture).not.toHaveBeenCalled()
    expect(q.jobs.size).toBe(0)
  })

  it('ignores ancient sessions beyond the recency window', async () => {
    const q = fakeQueue()
    const pipe = okPipeline()
    const { projects, sessions } = stubs([session('s1', 10 * 24 * 60 * MIN)])
    const auto = new MemoryAutoCapture(q.svc, pipe, projects, sessions, { now: () => T })
    await auto.sweep()
    expect(pipe.capture).not.toHaveBeenCalled()
  })

  it('does not re-capture a done session that has not grown', async () => {
    const q = fakeQueue()
    const pipe = okPipeline()
    const { projects, sessions } = stubs([session('s1', 20 * MIN, 500)])
    const auto = new MemoryAutoCapture(q.svc, pipe, projects, sessions, { now: () => T })
    await auto.sweep() // captures, completes at offset 500
    await auto.sweep() // size (500) not > lastOffset (500) → skip
    expect(pipe.capture).toHaveBeenCalledTimes(1)
  })

  it('records a pipeline error on the job instead of throwing', async () => {
    const q = fakeQueue()
    const pipe = { capture: vi.fn(async () => ({ proposals: [], committed: 0, queued: 0, skipped: 0, nextOffset: 0, dryRun: false, error: 'claude down' })) } as unknown as MemoryPipeline
    const { projects, sessions } = stubs([session('s1', 20 * MIN)])
    const auto = new MemoryAutoCapture(q.svc, pipe, projects, sessions, { now: () => T })
    await auto.sweep()
    expect(q.jobs.get('claude:s1')?.status).toBe('error')
  })

  it('respects the per-sweep cap', async () => {
    const q = fakeQueue()
    const pipe = okPipeline()
    const many = [session('s1', 20 * MIN), session('s2', 21 * MIN), session('s3', 22 * MIN)]
    const { projects, sessions } = stubs(many)
    const auto = new MemoryAutoCapture(q.svc, pipe, projects, sessions, { now: () => T, maxPerDrain: 2 })
    await auto.sweep()
    expect(pipe.capture).toHaveBeenCalledTimes(2)
  })

  it('captures Claude and Codex sessions through the same queue and pipeline', async () => {
    const q = fakeQueue()
    const pipe = okPipeline()
    const { projects, sessions } = stubs([
      session('claude-session', 20 * MIN, 1000, 'claude'),
      session('codex-session', 21 * MIN, 1000, 'codex'),
    ])
    const auto = new MemoryAutoCapture(q.svc, pipe, projects, sessions, { now: () => T })

    await auto.sweep()

    expect([...q.jobs.values()].map(({ provider }) => provider).sort()).toEqual(['claude', 'codex'])
    expect(pipe.capture).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'codex',
      transcriptPath: '/codex/codex-session.jsonl',
    }))
  })

  it('live capture enqueues every grown provider session active since the pane started', async () => {
    const q = fakeQueue()
    const pipe = okPipeline()
    const { projects, sessions } = stubs([
      session('current-claude-a', 1 * MIN, 1000, 'claude'),
      session('current-claude-b', 2 * MIN, 1000, 'claude'),
      session('old-claude', 40 * MIN, 1000, 'claude'),
      session('current-codex', 1 * MIN, 1000, 'codex'),
    ])
    const auto = new MemoryAutoCapture(q.svc, pipe, projects, sessions, { now: () => T })

    const enqueued = await auto.captureRecent(
      'p1',
      'claude',
      new Date(T - 5 * MIN).toISOString(),
    )

    expect(enqueued).toBe(2)
    expect([...q.jobs.keys()].sort()).toEqual([
      'claude:current-claude-a',
      'claude:current-claude-b',
    ])
    expect(pipe.capture).toHaveBeenCalledTimes(2)
  })
})
