import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SentinelService,
  type SentinelMemorySink,
  type SentinelReviewSink,
  type SentinelTriager,
} from '../electron/main/services/SentinelService'
import { CockpitEvents } from '../electron/main/events'
import {
  signalFingerprint,
  type SentinelSignal,
  type SentinelSource,
  type SentinelTriage,
} from '../shared/sentinel'
import type { Db } from '../electron/main/db/Database'
import type { CreateReviewInput } from '../electron/main/services/MemoryReviewService'
import type { ReviewItem } from '../shared/memory-review'
import type { MemoryHubSnapshot, MemoryNote } from '../shared/memory-hub'

const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString()

/** Seed a persisted row straight into the fake store (bypassing the cooldown), so
 *  a test can set up prior same-fingerprint history at chosen timestamps. */
function seedRow(
  rows: Row[],
  over: {
    projectId: string
    source: SentinelSource
    title: string
    createdAt: string
    severity?: string
    summary?: string
    triage?: string | null
    status?: string
  },
): string {
  const fingerprint = signalFingerprint({
    projectId: over.projectId,
    source: over.source,
    title: over.title,
  })
  rows.push({
    id: `sig_seed_${rows.length}`,
    project_id: over.projectId,
    severity: over.severity ?? 'notice',
    source: over.source,
    title: over.title,
    summary: over.summary ?? 'a recurring problem',
    context: null,
    fingerprint,
    status: over.status ?? 'new',
    created_at: over.createdAt,
    triage: over.triage ?? null,
    outcome: null,
    outcome_at: null,
  })
  return fingerprint
}

/** A hub write sink whose `list` reports the given existing note slugs (twin check). */
function makeMemory(existing: string[] = []) {
  const write = vi.fn((_p: string, _n: string, _c: string) => ({}) as MemoryNote)
  const list = vi.fn(
    (_p: string) => ({ notes: existing.map((name) => ({ name })) }) as unknown as MemoryHubSnapshot,
  )
  return { memory: { write, list } as unknown as SentinelMemorySink, write, list }
}

function makeReviewSink() {
  const create = vi.fn((_input: CreateReviewInput): ReviewItem => ({}) as ReviewItem)
  return { reviews: { create } as SentinelReviewSink, create }
}

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
  outcome: string | null
  outcome_at: string | null
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
              outcome: null,
              outcome_at: null,
            })
            return { changes: 1 }
          }
          if (sql.startsWith('UPDATE sentinel_signals SET outcome')) {
            const p = arg as { outcome: string; outcomeAt: string; projectId: string; id: string }
            const r = rows.find((x) => x.id === p.id && x.project_id === p.projectId)
            if (r) {
              r.outcome = p.outcome
              r.outcome_at = p.outcomeAt
              return { changes: 1 }
            }
            return { changes: 0 }
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
          // get(projectId, id): SELECT * WHERE id = ? AND project_id = ?
          if (sql.includes('WHERE id = ? AND project_id = ?')) {
            const [id, projectId] = args as [string, string]
            const r = rows.find((x) => x.id === id && x.project_id === projectId)
            return r ? { ...r } : undefined
          }
          return undefined
        },
        all: (...args: unknown[]) => {
          // H4 retriage sweep: untriaged recent notice/alert rows.
          if (sql.includes('triage IS NULL')) {
            const [cutoff, limit] = args as [string, number]
            return rows
              .filter(
                (r) =>
                  r.triage === null &&
                  (r.severity === 'notice' || r.severity === 'alert') &&
                  r.created_at >= cutoff,
              )
              .slice()
              .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
              .slice(0, limit)
              .map((r) => ({ ...r }))
          }
          if (sql.includes('AND fingerprint = ?')) {
            const [projectId, fingerprint] = args as [string, string]
            return rows
              .filter((r) => r.project_id === projectId && r.fingerprint === fingerprint)
              .slice()
              .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
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
    // A fresh signal carries no user response yet (Track G3).
    expect(svc.list('p1')[0].outcome).toBeNull()
    expect(svc.list('p1')[0].outcomeAt).toBeNull()
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

  it('a secret in sensor input is redacted before anything can reach the review queue', async () => {
    const verdict = triageVerdict({ gotchaCandidate: true })
    const triager: SentinelTriager = { triage: vi.fn(async () => verdict) }
    const { reviews, create } = makeReviews()
    const svc = new SentinelService(store.db, events, undefined, triager, reviews)

    // An AWS-key-shaped token in the summary. report() now redacts centrally
    // (argos L1): the secret never persists, never reaches OpenRouter via
    // triage, and the gotcha proposal that lands in the queue carries the
    // [REDACTED] mask — the memory gate stays as defense in depth behind it.
    svc.report({ projectId: 'p1', severity: 'alert', source: 'log-intelligence', title: 'Leaked key', summary: 'key AKIAIOSFODNN7EXAMPLE spotted' })
    await flush()

    expect(create).toHaveBeenCalledTimes(1)
    const proposal = create.mock.calls[0][0] as { proposedContent: string }
    expect(proposal.proposedContent).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(proposal.proposedContent).toContain('[REDACTED]')
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

describe('SentinelService.get (Track H1 read path)', () => {
  it('returns a project-scoped signal and null for an unknown/foreign id', () => {
    const store = makeDb()
    const svc = new SentinelService(store.db, new CockpitEvents())
    const sig = svc.report({ projectId: 'p1', severity: 'notice', source: 'approval', title: 'A', summary: 's' })!
    expect(svc.get('p1', sig.id)?.id).toBe(sig.id)
    // Foreign project can't read it; a missing id is null.
    expect(svc.get('p2', sig.id)).toBeNull()
    expect(svc.get('p1', 'sig_missing')).toBeNull()
  })
})

describe('SentinelService.resolveShippedSignal (Track H2)', () => {
  it('resolves quiet — outcome acted + seen — when the key stayed quiet since the card opened', () => {
    const store = makeDb()
    const svc = new SentinelService(store.db, new CockpitEvents())
    const sig = svc.report({ projectId: 'p1', severity: 'notice', source: 'worker-exit', title: 'Worker crashed', summary: 's' })!
    const cardCreatedAt = iso(1000) // after the signal
    expect(svc.resolveShippedSignal({ projectId: 'p1', signalId: sig.id, cardCreatedAt })).toBe(true)
    const row = store.rows.find((r) => r.id === sig.id)!
    expect(row.outcome).toBe('acted')
    expect(row.status).toBe('seen')
  })

  it('does NOT resolve when the dedup key re-fired after the card was created (fix did not hold)', () => {
    const store = makeDb()
    const svc = new SentinelService(store.db, new CockpitEvents())
    const sig = svc.report({ projectId: 'p1', severity: 'notice', source: 'worker-exit', title: 'Worker crashed', summary: 's' })!
    const cardCreatedAt = iso(1000)
    // A newer same-fingerprint occurrence AFTER the card — the bug came back.
    seedRow(store.rows, { projectId: 'p1', source: 'worker-exit', title: 'Worker crashed', createdAt: iso(6000) })
    expect(svc.resolveShippedSignal({ projectId: 'p1', signalId: sig.id, cardCreatedAt })).toBe(false)
    expect(store.rows.find((r) => r.id === sig.id)!.outcome).toBeNull()
  })

  it('returns false for an unknown signal id and never throws', () => {
    const store = makeDb()
    const svc = new SentinelService(store.db, new CockpitEvents())
    expect(() =>
      expect(svc.resolveShippedSignal({ projectId: 'p1', signalId: 'sig_nope', cardCreatedAt: iso(0) })).toBe(false),
    ).not.toThrow()
  })
})

describe('SentinelService recurrence gotcha (Track H3)', () => {
  it('routes a charter gotcha on the Nth occurrence — accept lands straight in the hub with verbatim symptom', () => {
    const store = makeDb()
    // Two prior persisted occurrences, both older than the cooldown window.
    seedRow(store.rows, { projectId: 'p1', source: 'log-intelligence', title: 'Build failed on alias', createdAt: '2020-01-01T00:00:00.000Z' })
    seedRow(store.rows, { projectId: 'p1', source: 'log-intelligence', title: 'Build failed on alias', createdAt: '2020-01-02T00:00:00.000Z' })
    const { memory, write } = makeMemory([])
    const { reviews, create } = makeReviewSink()
    const svc = new SentinelService(store.db, new CockpitEvents(), undefined, undefined, reviews, memory)

    // The 3rd occurrence persists (the old ones expired) → occurrences reaches the threshold.
    const sig = svc.report({ projectId: 'p1', severity: 'notice', source: 'log-intelligence', title: 'Build failed on alias', summary: 'cannot find module @shared/x' })
    expect(sig).not.toBeNull()
    // accept: justified, deduped, secret-free → written directly, not queued.
    expect(write).toHaveBeenCalledTimes(1)
    expect(create).not.toHaveBeenCalled()
    const [, slug, content] = write.mock.calls[0]
    expect(slug).toBe('signal-build-failed-on-alias')
    expect(content).toContain('cannot find module @shared/x') // verbatim symptom text
  })

  it('routes to the review queue when a twin note already exists (gate → review, not direct)', () => {
    const store = makeDb()
    seedRow(store.rows, { projectId: 'p1', source: 'approval', title: 'Approval keeps timing out', createdAt: '2020-01-01T00:00:00.000Z' })
    seedRow(store.rows, { projectId: 'p1', source: 'approval', title: 'Approval keeps timing out', createdAt: '2020-01-02T00:00:00.000Z' })
    const { memory, write } = makeMemory(['signal-approval-keeps-timing-out']) // twin in hub
    const { reviews, create } = makeReviewSink()
    const svc = new SentinelService(store.db, new CockpitEvents(), undefined, undefined, reviews, memory)

    svc.report({ projectId: 'p1', severity: 'notice', source: 'approval', title: 'Approval keeps timing out', summary: 's' })
    expect(write).not.toHaveBeenCalled()
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0][0].slug).toBe('signal-approval-keeps-timing-out')
  })

  it('does NOT route below the threshold (a second occurrence is not yet a pattern)', () => {
    const store = makeDb()
    seedRow(store.rows, { projectId: 'p1', source: 'council', title: 'Council seat fell back', createdAt: '2020-01-01T00:00:00.000Z' })
    const { memory, write } = makeMemory([])
    const { reviews, create } = makeReviewSink()
    const svc = new SentinelService(store.db, new CockpitEvents(), undefined, undefined, reviews, memory)

    svc.report({ projectId: 'p1', severity: 'notice', source: 'council', title: 'Council seat fell back', summary: 's' })
    expect(write).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it('fires at most once per key per process (a suppressed repeat routes nothing more)', () => {
    const store = makeDb()
    seedRow(store.rows, { projectId: 'p1', source: 'log-intelligence', title: 'Recurring boom', createdAt: '2020-01-01T00:00:00.000Z' })
    seedRow(store.rows, { projectId: 'p1', source: 'log-intelligence', title: 'Recurring boom', createdAt: '2020-01-02T00:00:00.000Z' })
    const { memory, write } = makeMemory([])
    const svc = new SentinelService(store.db, new CockpitEvents(), undefined, undefined, undefined, memory)

    svc.report({ projectId: 'p1', severity: 'notice', source: 'log-intelligence', title: 'Recurring boom', summary: 's' })
    // A same-fingerprint repeat inside the cooldown is suppressed and routes nothing.
    svc.report({ projectId: 'p1', severity: 'notice', source: 'log-intelligence', title: 'Recurring boom', summary: 's' })
    expect(write).toHaveBeenCalledTimes(1)
  })
})

describe('SentinelService boot re-triage sweep (Track H4)', () => {
  it('re-enqueues a recent untriaged notice row and persists the verdict', async () => {
    const store = makeDb()
    seedRow(store.rows, { projectId: 'p1', source: 'worker-exit', title: 'Stranded notice', createdAt: iso(-60_000), severity: 'notice', triage: null })
    const verdict = triageVerdict()
    const triage = vi.fn(async () => verdict)
    // Construction alone kicks off the fire-and-forget sweep.
    new SentinelService(store.db, new CockpitEvents(), undefined, { triage })
    await flush()
    expect(triage).toHaveBeenCalledTimes(1)
    expect(store.rows.find((r) => r.title === 'Stranded notice')!.triage).toBe(JSON.stringify(verdict))
  })

  it('skips rows older than the 48h window and skips info severity', async () => {
    const store = makeDb()
    seedRow(store.rows, { projectId: 'p1', source: 'worker-exit', title: 'Old notice', createdAt: iso(-72 * 3600_000), severity: 'notice' })
    seedRow(store.rows, { projectId: 'p1', source: 'council', title: 'Recent info', createdAt: iso(-60_000), severity: 'info' })
    const triage = vi.fn(async () => triageVerdict())
    new SentinelService(store.db, new CockpitEvents(), undefined, { triage })
    await flush()
    expect(triage).not.toHaveBeenCalled()
  })

  it('is an immediate no-op with no triager (spine-only build)', async () => {
    const store = makeDb()
    seedRow(store.rows, { projectId: 'p1', source: 'worker-exit', title: 'Untriaged', createdAt: iso(-60_000), severity: 'alert', triage: null })
    // No triager → the sweep returns early; the row stays untriaged.
    new SentinelService(store.db, new CockpitEvents())
    await flush()
    expect(store.rows.find((r) => r.title === 'Untriaged')!.triage).toBeNull()
  })
})
