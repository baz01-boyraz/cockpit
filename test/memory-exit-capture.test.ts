import { describe, expect, it, vi } from 'vitest'
import type { CapturableSessionSummary, ResumableSessionProvider } from '@shared/domain'
import { CockpitEvents } from '../electron/main/events'
import { MemoryAutoCapture } from '../electron/main/services/MemoryAutoCapture'
import { registerMemoryExitCapture } from '../electron/main/services/memoryExitTrigger'
import type { ProjectService } from '../electron/main/services/ProjectService'
import type { AgentSessionsService } from '../electron/main/services/AgentSessionsService'
import type { MemoryCaptureQueue, EnqueueInput } from '../electron/main/services/MemoryCaptureQueue'
import type { MemoryPipeline } from '../electron/main/services/MemoryPipeline'

interface Job {
  id: string
  projectId: string
  provider: ResumableSessionProvider
  sessionId: string
  sourcePath: string
  status: string
  lastOffset: number
}

/** Minimal in-memory queue: every session is new, and enqueued jobs drain once. */
class FakeQueue {
  readonly enqueued: EnqueueInput[] = []
  private readonly pending: Job[] = []
  peek = vi.fn((_sessionId: string): Job | null => null)
  enqueue = vi.fn((input: EnqueueInput): Job => {
    this.enqueued.push(input)
    const job: Job = {
      id: `job-${this.enqueued.length}`,
      projectId: input.projectId,
      provider: input.provider,
      sessionId: input.sessionId,
      sourcePath: input.sourcePath,
      status: 'queued',
      lastOffset: 0,
    }
    this.pending.push(job)
    return job
  })
  claimNext = vi.fn((): Job | null => this.pending.shift() ?? null)
  complete = vi.fn()
  fail = vi.fn()
}

const session = (id: string, lastActiveAt: string, provider: ResumableSessionProvider = 'claude'): CapturableSessionSummary => ({
  id,
  provider,
  title: id,
  createdAt: lastActiveAt,
  lastActiveAt,
  sizeBytes: 1000,
  transcriptPath: `/${provider}/${id}.jsonl`,
})

function makeCapture(sessions: CapturableSessionSummary[]) {
  const queue = new FakeQueue()
  const capture = vi.fn(async () => ({ nextOffset: 10 }))
  const pipeline = { capture } as unknown as MemoryPipeline
  const projects = {
    get: (id: string) => ({ id, path: `/proj/${id}` }),
    list: () => [{ id: 'p1', path: '/proj/p1' }],
  } as unknown as ProjectService
  const sessionsSvc = {
    captureList: vi.fn(() => sessions),
  } as unknown as AgentSessionsService
  // No start() → no idle-poll timer is ever scheduled.
  const auto = new MemoryAutoCapture(
    queue as unknown as MemoryCaptureQueue,
    pipeline,
    projects,
    sessionsSvc,
  )
  return { auto, queue, capture, sessionsSvc }
}

describe('MemoryAutoCapture.captureNow (terminal-close trigger)', () => {
  it('enqueues and drains the most-recent session immediately, with no idle wait', async () => {
    const older = session('s-old', '2026-07-05T10:00:00.000Z')
    const newest = session('s-new', '2026-07-05T12:00:00.000Z')
    // list() is most-recent-first, so the head is the just-closed session.
    const { auto, queue, capture } = makeCapture([newest, older])

    await auto.captureNow('p1', 'claude')

    // Enqueued exactly the newest session — never scanned the idle-age filter.
    expect(queue.enqueue).toHaveBeenCalledTimes(1)
    expect(queue.enqueued[0]).toMatchObject({ projectId: 'p1', provider: 'claude', sessionId: 's-new' })
    // Drained through the pipeline right away, not on a timer.
    expect(capture).toHaveBeenCalledTimes(1)
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p1', provider: 'claude', sessionId: 's-new' }),
    )
  })

  it('does nothing when the project has no Claude sessions', async () => {
    const { auto, queue, capture } = makeCapture([])
    await auto.captureNow('p1', 'claude')
    expect(queue.enqueue).not.toHaveBeenCalled()
    expect(capture).not.toHaveBeenCalled()
  })

  it('is disabled when the watcher is disabled', async () => {
    const older = session('s-old', '2026-07-05T10:00:00.000Z')
    const queue = new FakeQueue()
    const capture = vi.fn(async () => ({ nextOffset: 10 }))
    const projects = {
      get: (id: string) => ({ id, path: `/proj/${id}` }),
      list: () => [],
    } as unknown as ProjectService
    const sessionsSvc = {
      captureList: vi.fn(() => [older]),
    } as unknown as AgentSessionsService
    const auto = new MemoryAutoCapture(
      queue as unknown as MemoryCaptureQueue,
      { capture } as unknown as MemoryPipeline,
      projects,
      sessionsSvc,
      { enabled: false },
    )
    await auto.captureNow('p1', 'claude')
    expect(queue.enqueue).not.toHaveBeenCalled()
    expect(capture).not.toHaveBeenCalled()
  })
})

describe('registerMemoryExitCapture', () => {
  it('captures on Claude and Codex terminal exits with provider provenance', () => {
    const events = new CockpitEvents()
    const captureNow = vi.fn(async () => {})
    registerMemoryExitCapture(events, { captureNow })

    events.emitTyped('terminal:exit', {
      sessionId: 't1',
      projectId: 'p1',
      role: 'claude',
      exitCode: 0,
      signal: null,
    })
    events.emitTyped('terminal:exit', {
      sessionId: 't2',
      projectId: 'p1',
      role: 'codex',
      exitCode: 0,
      signal: null,
    })
    expect(captureNow).toHaveBeenCalledTimes(2)
    expect(captureNow).toHaveBeenNthCalledWith(1, 'p1', 'claude')
    expect(captureNow).toHaveBeenNthCalledWith(2, 'p1', 'codex')

    for (const role of ['general', 'frontend', 'backend', 'git', null] as const) {
      events.emitTyped('terminal:exit', {
        sessionId: 't2',
        projectId: 'p1',
        role,
        exitCode: 0,
        signal: null,
      })
    }
    expect(captureNow).toHaveBeenCalledTimes(2)
  })
})
