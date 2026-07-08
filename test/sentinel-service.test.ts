import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SentinelService,
  type SentinelReviewSink,
  type SentinelTriager,
} from '../electron/main/services/SentinelService'
import { CockpitEvents } from '../electron/main/events'
import { type SentinelSignal, type SentinelTriage } from '../shared/sentinel'
import type { Db } from '../electron/main/db/Database'
import type { CreateReviewInput } from '../electron/main/services/MemoryReviewService'
import type { ReviewItem } from '../shared/memory-review'

/** Drain the microtask + macrotask queue so a fire-and-forget `void enrich()` settles. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

const triageVerdict = (over: Partial<SentinelTriage> = {}): SentinelTriage => ({
  reportWorthy: true,
  headline: 'Build broke on a missing alias',
  action: 'Run the build step, then retry',
  gotchaCandidate: false,
  at: '2026-07-08T00:00:00.000Z',
  ...over,
})

interface Row {
  id: string
  project_id: string
  severity: string
  source: string
  title: string
  summary: string
  context: string | null
  fingerprint: string
  status: string
  created_at: string
  triage: string | null
}

/**
 * Stateful in-memory stand-in for the sentinel_signals statements. Never imports
 * better-sqlite3 (its native build targets Electron's ABI) — see the approval
 * and swarm suites for the same pattern.
 */
function makeDb() {
  const rows: Row[] = []
  const fake = {
    transaction(fn: (...a: unknown[]) => unknown) {
      return (...a: unknown[]) => fn(...a)
    },
    prepare(sql: string) {
      return {
        run: (arg: unknown, ...rest: unknown[]) => {
          if (sql.startsWith('INSERT INTO sentinel_signals')) {
            const p = arg as Record<string, string | null>
            rows.push({
              id: String(p.id),
              project_id: String(p.projectId),
              severity: String(p.severity),
              source: String(p.source),
              title: String(p.title),
              summary: String(p.summary),
              context: p.context === null || p.context === undefined ? null : String(p.context),
              fingerprint: String(p.fingerprint),
              status: String(p.status),
              created_at: String(p.createdAt),
              triage: null,
            })
            return { changes: 1 }
          }
          if (sql.startsWith('UPDATE sentinel_signals SET triage')) {
            const p = arg as { triage: string | null; id: string }
            const r = rows.find((x) => x.id === p.id)
            if (r) {
              r.triage = p.triage
              return { changes: 1 }
            }
            return { changes: 0 }
          }
          if (sql.includes("SET status = 'seen'")) {
            const [projectId, id] = [arg as string, rest[0] as string]
            const r = rows.find((x) => x.id === id && x.project_id === projectId && x.status === 'new')
            if (r) {
              r.status = 'seen'
              return { changes: 1 }
            }
            return { changes: 0 }
          }
          return { changes: 0 }
        },
        get: (...args: unknown[]) => {
          if (sql.includes('COUNT(*)')) {
            const projectId = args[0] as string
            return { n: rows.filter((r) => r.project_id === projectId && r.status === 'new').length }
          }
          return undefined
        },
        all: (...args: unknown[]) => {
          if (sql.includes('AND fingerprint = ?')) {
            const [projectId, fingerprint] = args as [string, string]
            return rows
              .filter((r) => r.project_id === projectId && r.fingerprint === fingerprint)
              .map((r) => ({ fingerprint: r.fingerprint, createdAt: r.created_at }))
          }
          // list: SELECT * WHERE project_id = ? ORDER BY created_at DESC LIMIT ?
          const projectId = args[0] as string
          return rows
            .filter((r) => r.project_id === projectId)
            .slice()
            .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
            .map((r) => ({ ...r }))
        },
      }
    },
  }
  return { db: fake as unknown as Db, rows }
}

function captureAlerts(events: CockpitEvents): SentinelSignal[] {
  const seen: SentinelSignal[] = []
  events.onTyped('sentinel:alert', (s) => seen.push(s))
  return seen
}

describe('SentinelService.report', () => {
  let store: ReturnType<typeof makeDb>
  let events: CockpitEvents
  let alerts: SentinelSignal[]

  beforeEach(() => {
    store = makeDb()
    events = new CockpitEvents()
    alerts = captureAlerts(events)
  })

  it('persists the signal and emits sentinel:alert', () => {
    const svc = new SentinelService(store.db, events)
    const sig = svc.report({
      projectId: 'p1',
      severity: 'notice',
      source: 'log-intelligence',
      title: 'Build failed',
      summary: 'a · b',
    })
    expect(sig).not.toBeNull()
    expect(store.rows).toHaveLength(1)
    expect(store.rows[0].status).toBe('new')
    expect(alerts).toHaveLength(1)
    expect(alerts[0].title).toBe('Build failed')
  })

  it('fires the macOS notifier ONLY for alert severity', () => {
    const notifier = vi.fn()
    const svc = new SentinelService(store.db, events, notifier)
    svc.report({ projectId: 'p1', severity: 'info', source: 'council', title: 'i', summary: 's' })
    svc.report({ projectId: 'p1', severity: 'notice', source: 'council', title: 'n', summary: 's' })
    expect(notifier).not.toHaveBeenCalled()
    svc.report({ projectId: 'p1', severity: 'alert', source: 'approval', title: 'Approval needed', summary: 's' })
    expect(notifier).toHaveBeenCalledTimes(1)
    expect(notifier).toHaveBeenCalledWith({ title: 'Approval needed', body: 's' })
  })

  it('suppresses a same-fingerprint signal within the cooldown — no row, no emit', () => {
    const svc = new SentinelService(store.db, events)
    const first = svc.report({ projectId: 'p1', severity: 'notice', source: 'approval', title: 'dup', summary: 's' })
    const second = svc.report({ projectId: 'p1', severity: 'notice', source: 'approval', title: 'dup', summary: 's' })
    expect(first).not.toBeNull()
    expect(second).toBeNull()
    expect(store.rows).toHaveLength(1)
    expect(alerts).toHaveLength(1)
  })

  it('does NOT suppress a different project’s same title (fingerprint is project-scoped)', () => {
    const svc = new SentinelService(store.db, events)
    svc.report({ projectId: 'p1', severity: 'notice', source: 'approval', title: 'dup', summary: 's' })
    const other = svc.report({ projectId: 'p2', severity: 'notice', source: 'approval', title: 'dup', summary: 's' })
    expect(other).not.toBeNull()
    expect(store.rows).toHaveLength(2)
  })

  it('isolates a throwing notifier — the signal still persists, emits, and returns', () => {
    const notifier = vi.fn(() => {
      throw new Error('no notification host')
    })
    const svc = new SentinelService(store.db, events, notifier)
    const sig = svc.report({ projectId: 'p1', severity: 'alert', source: 'approval', title: 'x', summary: 's' })
    expect(sig).not.toBeNull()
    expect(store.rows).toHaveLength(1)
    expect(alerts).toHaveLength(1)
  })

  it('never throws to the caller — a failing db insert returns null', () => {
    const brokenDb = {
      transaction: (fn: (...a: unknown[]) => unknown) => (...a: unknown[]) => fn(...a),
      prepare: () => ({
        run: () => {
          throw new Error('disk full')
        },
        get: () => undefined,
        all: () => [],
      }),
    } as unknown as Db
    const svc = new SentinelService(brokenDb, events)
    expect(() =>
      expect(svc.report({ projectId: 'p1', severity: 'info', source: 'council', title: 't', summary: 's' })).toBeNull(),
    ).not.toThrow()
  })
})

describe('SentinelService.markSeen / list / unseenCount', () => {
  it('marks only this project’s ids seen — cross-project ids are untouched', () => {
    const store = makeDb()
    const events = new CockpitEvents()
    const svc = new SentinelService(store.db, events)
    const a = svc.report({ projectId: 'p1', severity: 'notice', source: 'approval', title: 'A', summary: 's' })!
    const b = svc.report({ projectId: 'p2', severity: 'notice', source: 'approval', title: 'B', summary: 's' })!

    // Asking p1 to mark p2's id changes nothing.
    expect(svc.markSeen('p1', [b.id])).toBe(0)
    expect(store.rows.find((r) => r.id === b.id)!.status).toBe('new')

    // p1's own id flips, and re-marking is a no-op (already seen).
    expect(svc.markSeen('p1', [a.id])).toBe(1)
    expect(store.rows.find((r) => r.id === a.id)!.status).toBe('seen')
    expect(svc.markSeen('p1', [a.id])).toBe(0)

    expect(svc.markSeen('p1', [])).toBe(0)
  })

  it('lists newest-first and counts only unseen', () => {
    const store = makeDb()
    const svc = new SentinelService(store.db, new CockpitEvents())
    const a = svc.report({ projectId: 'p1', severity: 'notice', source: 'approval', title: 'A', summary: 's' })!
    svc.report({ projectId: 'p1', severity: 'notice', source: 'council', title: 'B', summary: 's' })!
    expect(svc.unseenCount('p1')).toBe(2)
    svc.markSeen('p1', [a.id])
    expect(svc.unseenCount('p1')).toBe(1)
    expect(svc.list('p1')).toHaveLength(2)
    // p2 has nothing.
    expect(svc.unseenCount('p2')).toBe(0)
    expect(svc.list('p2')).toEqual([])
  })
})

describe('SentinelService enrich (Faz B triage)', () => {
  let store: ReturnType<typeof makeDb>
  let events: CockpitEvents
  let alerts: SentinelSignal[]

  beforeEach(() => {
    store = makeDb()
    events = new CockpitEvents()
    alerts = captureAlerts(events)
  })

  const makeReviews = () => {
    const create = vi.fn((_input: CreateReviewInput): ReviewItem => ({}) as ReviewItem)
    const reviews: SentinelReviewSink = { create }
    return { reviews, create }
  }

  it('persists the triage blob and re-emits the enriched signal under the same id', async () => {
    const verdict = triageVerdict()
    const triager: SentinelTriager = { triage: vi.fn(async () => verdict) }
    const { reviews, create } = makeReviews()
    const svc = new SentinelService(store.db, events, undefined, triager, reviews)

    const sig = svc.report({ projectId: 'p1', severity: 'notice', source: 'log-intelligence', title: 'Build failed', summary: 's' })!
    await flush()

    // The row carries the triage JSON; list() re-hydrates it.
    expect(store.rows[0].triage).toBe(JSON.stringify(verdict))
    expect(svc.list('p1')[0].triage).toEqual(verdict)
    // Two emits for the same id: the spine's original, then the enriched one.
    expect(alerts).toHaveLength(2)
    expect(alerts[0].id).toBe(sig.id)
    expect(alerts[0].triage).toBeNull()
    expect(alerts[1].id).toBe(sig.id)
    expect(alerts[1].triage).toEqual(verdict)
    // A reportWorthy signal is NOT demoted, and no gotcha is routed.
    expect(store.rows[0].status).toBe('new')
    expect(create).not.toHaveBeenCalled()
  })

  it('demotes a not-reportWorthy signal to seen but still re-emits the verdict', async () => {
    const verdict = triageVerdict({ reportWorthy: false })
    const triager: SentinelTriager = { triage: vi.fn(async () => verdict) }
    const svc = new SentinelService(store.db, events, undefined, triager)

    svc.report({ projectId: 'p1', severity: 'notice', source: 'council', title: 'noise', summary: 's' })
    await flush()

    expect(alerts).toHaveLength(2)
    expect(alerts[1].triage?.reportWorthy).toBe(false)
    // Badge pressure cleared: the row is demoted to seen.
    expect(store.rows[0].status).toBe('seen')
    expect(svc.unseenCount('p1')).toBe(0)
  })

  it('routes a gotcha candidate through the gate into the review queue', async () => {
    const verdict = triageVerdict({ gotchaCandidate: true, action: 'Rebuild @shared before running the worker' })
    const triager: SentinelTriager = { triage: vi.fn(async () => verdict) }
    const { reviews, create } = makeReviews()
    const svc = new SentinelService(store.db, events, undefined, triager, reviews)

    svc.report({ projectId: 'p1', severity: 'alert', source: 'worker-exit', title: 'Worker exited nonzero', summary: 'stale alias' })
    await flush()

    expect(create).toHaveBeenCalledTimes(1)
    const arg = create.mock.calls[0][0]
    expect(arg.brain).toBe('project:p1')
    expect(arg.kind).toBe('new')
    expect(arg.slug).toBe('signal-worker-exited-nonzero')
    expect(arg.title).toBe('Worker exited nonzero')
    expect(arg.proposedContent).toContain('captured from sentinel signal')
    expect(arg.reason).toContain('Rebuild @shared')
  })

  it('drops a gotcha whose content is secret-shaped — never reaches the review queue', async () => {
    const verdict = triageVerdict({ gotchaCandidate: true })
    const triager: SentinelTriager = { triage: vi.fn(async () => verdict) }
    const { reviews, create } = makeReviews()
    const svc = new SentinelService(store.db, events, undefined, triager, reviews)

    // An AWS-key-shaped token in the summary makes the built note look like a secret.
    svc.report({ projectId: 'p1', severity: 'alert', source: 'log-intelligence', title: 'Leaked key', summary: 'key AKIAIOSFODNN7EXAMPLE spotted' })
    await flush()

    expect(create).not.toHaveBeenCalled()
  })

  it('a null verdict (Hermes missing/slow/wrong) changes nothing after the spine', async () => {
    const triager: SentinelTriager = { triage: vi.fn(async () => null) }
    const { reviews, create } = makeReviews()
    const svc = new SentinelService(store.db, events, undefined, triager, reviews)

    svc.report({ projectId: 'p1', severity: 'notice', source: 'approval', title: 'x', summary: 's' })
    await flush()

    // Exactly the spine's one emit, no triage on the row, no demotion, no review.
    expect(alerts).toHaveLength(1)
    expect(store.rows[0].triage).toBeNull()
    expect(store.rows[0].status).toBe('new')
    expect(create).not.toHaveBeenCalled()
  })

  it('never triages an info signal (feed-only) — no triager call', async () => {
    const triage = vi.fn(async () => triageVerdict())
    const triager: SentinelTriager = { triage }
    const svc = new SentinelService(store.db, events, undefined, triager)

    svc.report({ projectId: 'p1', severity: 'info', source: 'council', title: 'fyi', summary: 's' })
    await flush()

    expect(triage).not.toHaveBeenCalled()
    expect(alerts).toHaveLength(1)
  })

  it('a throwing triager never disturbs the already-emitted spine signal', async () => {
    const triager: SentinelTriager = {
      triage: vi.fn(async () => {
        throw new Error('triage exploded')
      }),
    }
    const svc = new SentinelService(store.db, events, undefined, triager)

    const sig = svc.report({ projectId: 'p1', severity: 'alert', source: 'approval', title: 'boom', summary: 's' })
    await flush()

    expect(sig).not.toBeNull()
    expect(alerts).toHaveLength(1)
    expect(store.rows).toHaveLength(1)
    expect(store.rows[0].status).toBe('new')
  })
})
