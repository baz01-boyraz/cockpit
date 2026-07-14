import { describe, expect, it, vi } from 'vitest'
import type { AuditEntry } from '../shared/domain'
import { projectBrain } from '../shared/memory-ledger'
import {
  MEMORY_LIFECYCLE_POLICY,
  classifyMemoryFailure,
} from '../shared/memory-lifecycle'
import type { CaptureJob } from '../shared/memory-capture'
import type { ReviewItem } from '../shared/memory-review'
import { MemoryLifecycleSentinel } from '../electron/main/services/MemoryLifecycleSentinel'
import type { SentinelReportInput } from '../electron/main/services/SentinelService'

const NOW = Date.parse('2026-07-12T06:00:00.000Z')

const capture = (over: Partial<CaptureJob> = {}): CaptureJob => ({
  id: 'cap-1',
  projectId: 'p1',
  provider: 'claude',
  sessionId: 'session-1',
  sourcePath: '/private/session.jsonl',
  status: 'queued',
  lastOffset: 0,
  attempts: 1,
  error: null,
  nextRetryAt: null,
  guidance: null,
  enqueuedAt: new Date(NOW - 60_000).toISOString(),
  updatedAt: new Date(NOW).toISOString(),
  ...over,
})

const review = (i: number, over: Partial<ReviewItem> = {}): ReviewItem => ({
  id: `r${i}`,
  brain: projectBrain('p1'),
  kind: 'new',
  slug: `note-${i}`,
  title: `Note ${i}`,
  proposedContent: 'content never reaches a lifecycle signal',
  reason: 'fixture',
  existingContent: null,
  sourceId: null,
  alsoTrash: null,
  operation: null,
  alsoTrashContent: null,
  status: 'pending',
  createdAt: new Date(NOW - 60_000).toISOString(),
  resolvedAt: null,
  ...over,
})

function harness() {
  const reports: Record<string, unknown>[] = []
  const sentinel = {
    report: vi.fn((input: SentinelReportInput) => {
      reports.push(input as unknown as Record<string, unknown>)
      return {} as never
    }),
  }
  const entries: AuditEntry[] = []
  let auditListener: ((entry: AuditEntry) => void) | null = null
  const audit = {
    subscribe: vi.fn((listener: (entry: AuditEntry) => void) => {
      auditListener = listener
      return () => {
        auditListener = null
      }
    }),
    recent: vi.fn((projectId: string, actionType: string, since: string) =>
      entries.filter(
        (entry) =>
          entry.projectId === projectId &&
          entry.actionType === actionType &&
          entry.createdAt >= since,
      ),
    ),
    lastAt: vi.fn((projectId: string, actionType: string) =>
      entries
        .filter((entry) => entry.projectId === projectId && entry.actionType === actionType)
        .map((entry) => entry.createdAt)
        .sort()
        .at(-1) ?? null,
    ),
  }
  const pending = new Map<string, ReviewItem[]>()
  let reviewListener:
    | ((event: { brain: string; originProjectId: string | null }) => void)
    | null = null
  const reviews = {
    subscribe: vi.fn(
      (listener: (event: { brain: string; originProjectId: string | null }) => void) => {
        reviewListener = listener
        return () => {
          reviewListener = null
        }
      },
    ),
    listPending: vi.fn((brain: string) => pending.get(brain) ?? []),
  }
  const sensor = new MemoryLifecycleSentinel(sentinel, audit, reviews, () => NOW)
  sensor.registerProject('p1', new Date(NOW - 2 * 24 * 60 * 60_000).toISOString())
  const emitAudit = (
    actionType: string,
    payloadRedacted: Record<string, unknown> = {},
    at = new Date(NOW).toISOString(),
  ) => {
    const entry: AuditEntry = {
      id: `a${entries.length}`,
      projectId: 'p1',
      actor: 'system',
      actionType,
      summary: actionType,
      payloadRedacted,
      createdAt: at,
    }
    entries.push(entry)
    auditListener?.(entry)
  }
  const emitReviews = (items: ReviewItem[]) => {
    pending.set(projectBrain('p1'), items)
    reviewListener?.({ brain: projectBrain('p1'), originProjectId: null })
  }
  return { sensor, reports, sentinel, audit, reviews, emitAudit, emitReviews, entries, pending }
}

describe('MemoryLifecycleSentinel', () => {
  it('pins conservative thresholds and classifies failures without retaining raw errors', () => {
    expect(MEMORY_LIFECYCLE_POLICY).toMatchObject({
      distillerFailures: { count: 2 },
      gateRejects: { count: 3 },
      complianceMisses: { count: 2 },
      reviewBacklog: 15,
      reviewConflicts: 3,
    })
    expect(classifyMemoryFailure('distiller retry failed: Command timed out')).toBe('timeout')
    expect(classifyMemoryFailure('invalid JSON observations')).toBe('parse')
    expect(classifyMemoryFailure('ENOENT transcript missing')).toBe('missing-input')
    expect(classifyMemoryFailure('spawn analysis-provider EACCES')).toBe('spawn')
    expect(classifyMemoryFailure('something else')).toBe('unknown')
  })

  it('stays quiet during retries, then alerts once capture reaches durable error', () => {
    const h = harness()
    h.sensor.captureFailed(capture({ attempts: 2, status: 'queued', error: 'still retrying' }))
    expect(h.reports).toHaveLength(0)

    h.sensor.captureFailed(
      capture({
        attempts: 3,
        status: 'error',
        error: 'distiller failed with key AKIAIOSFODNN7EXAMPLE',
      }),
    )
    expect(h.reports).toHaveLength(1)
    expect(h.reports[0]).toMatchObject({
      projectId: 'p1',
      source: 'memory-lifecycle',
      severity: 'alert',
      title: 'Memory capture stopped after repeated failures',
    })
    expect(JSON.stringify(h.reports[0])).not.toContain('AKIAIOSFODNN7EXAMPLE')
    expect(JSON.stringify(h.reports[0])).not.toContain('/private/session.jsonl')
  })

  it('thresholds distiller failures, gate rejects, and contract misses over bounded windows', () => {
    const h = harness()
    h.emitAudit('memory.distiller_failed', { failureKind: 'parse' })
    expect(h.reports).toHaveLength(0)
    h.emitAudit('memory.distiller_failed', { failureKind: 'parse' })
    expect(h.reports.at(-1)).toMatchObject({ title: 'Memory distiller is repeatedly failing' })

    h.emitAudit('memory_write_gate', { verdict: 'reject' })
    h.emitAudit('memory_write_gate', { verdict: 'review' })
    h.emitAudit('memory_write_gate', { verdict: 'reject' })
    expect(h.reports.filter((r) => r.title === 'Memory write gate rejection spike')).toHaveLength(0)
    h.emitAudit('memory_write_gate', { verdict: 'reject' })
    expect(h.reports.at(-1)).toMatchObject({ title: 'Memory write gate rejection spike' })

    h.emitAudit('memory.compliance_missing')
    expect(h.reports.filter((r) => r.title === 'Memory contract compliance is slipping')).toHaveLength(0)
    h.emitAudit('memory.compliance_missing')
    expect(h.reports.at(-1)).toMatchObject({ title: 'Memory contract compliance is slipping' })
  })

  it('reports only real review pressure: backlog, conflicts, or an old queue', () => {
    const h = harness()
    h.emitReviews(Array.from({ length: 14 }, (_, i) => review(i)))
    expect(h.reports).toHaveLength(0)
    h.emitReviews(Array.from({ length: 15 }, (_, i) => review(i)))
    expect(h.reports.at(-1)).toMatchObject({ title: 'Memory review queue needs attention' })
    expect(JSON.stringify(h.reports.at(-1))).not.toContain('content never reaches')

    const conflicts = Array.from({ length: 3 }, (_, i) => review(i, { kind: 'conflict' }))
    h.emitReviews(conflicts)
    expect(h.reports.at(-1)).toMatchObject({ title: 'Memory conflicts are accumulating' })

    const old = Array.from({ length: 5 }, (_, i) =>
      review(i, { createdAt: new Date(NOW - 8 * 24 * 60 * 60_000).toISOString() }),
    )
    h.emitReviews(old)
    expect(h.reports.at(-1)).toMatchObject({ title: 'Memory review queue is aging' })
  })

  it('keeps one curation miss quiet on a fresh project, but reports repeats or staleness', () => {
    const h = harness()
    h.emitAudit('memory.curation_failed', { stage: 'runner' })
    expect(h.reports).toHaveLength(0)
    h.emitAudit('memory.curation_failed', { stage: 'parse' })
    expect(h.reports.at(-1)).toMatchObject({ title: 'Memory curation keeps failing' })

    const stale = harness()
    stale.sensor.registerProject(
      'p1',
      new Date(NOW - 12 * 24 * 60 * 60_000).toISOString(),
    )
    stale.sensor.scanProject('p1')
    expect(stale.reports.at(-1)).toMatchObject({ title: 'Memory curation is stale' })
  })

  it('boot scan finds existing exhausted captures and review pressure', () => {
    const h = harness()
    h.pending.set(projectBrain('p1'), Array.from({ length: 15 }, (_, i) => review(i)))
    h.sensor.scanProject('p1', [capture({ status: 'error', attempts: 3, error: 'timeout' })])
    expect(h.reports.map((r) => r.title)).toEqual(
      expect.arrayContaining([
        'Memory capture stopped after repeated failures',
        'Memory review queue needs attention',
      ]),
    )
  })

  it('does not keep alerting on migrated legacy failures after capture has recovered', () => {
    const h = harness()
    const legacyFailures = Array.from({ length: 137 }, (_, index) =>
      capture({
        id: `legacy-${index}`,
        sessionId: `legacy-session-${index}`,
        status: 'error',
        attempts: 3,
        error: 'distiller CLI failed with legacy output',
        guidance: null,
        updatedAt: '2026-07-05T00:00:00.000Z',
      }),
    )
    const recovered = capture({
      id: 'recovered',
      sessionId: 'current-session',
      status: 'done',
      attempts: 0,
      error: null,
      guidance: null,
      updatedAt: '2026-07-12T05:59:00.000Z',
    })

    h.sensor.scanProject('p1', [...legacyFailures, recovered], false)

    expect(h.reports).toHaveLength(0)
  })

  it('does not call an empty hub stale merely because it has no sweep history', () => {
    const h = harness()
    h.sensor.registerProject(
      'p1',
      new Date(NOW - 30 * 24 * 60 * 60_000).toISOString(),
    )
    h.sensor.scanProject('p1', [], false)
    expect(h.reports).toHaveLength(0)
  })
})
