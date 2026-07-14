import { describe, expect, it } from 'vitest'
import {
  assembleMemoryCaptureOverview,
  type CaptureJob,
} from '@shared/memory-capture'

const job = (over: Partial<CaptureJob>): CaptureJob => ({
  id: 'j1',
  projectId: 'p1',
  provider: 'claude',
  sessionId: 's1',
  sourcePath: '/private/transcript.jsonl',
  status: 'done',
  lastOffset: 10,
  attempts: 0,
  error: null,
  nextRetryAt: null,
  guidance: null,
  enqueuedAt: '2026-07-12T00:00:00.000Z',
  updatedAt: '2026-07-12T01:00:00.000Z',
  ...over,
})

describe('assembleMemoryCaptureOverview', () => {
  it('reports Claude/Codex coverage and strips transcript paths/errors', () => {
    const result = assembleMemoryCaptureOverview(
      [
        { id: 's1', provider: 'claude' },
        { id: 's2', provider: 'claude' },
        { id: 'x1', provider: 'codex' },
      ],
      [
        job({ id: 'c1', provider: 'claude', sessionId: 's1', status: 'done' }),
        job({
          id: 'x1',
          provider: 'codex',
          sessionId: 'x1',
          status: 'blocked',
          error: 'PRIVATE /path and provider output',
          guidance: 'Add the key in Settings, then press Retry.',
        }),
      ],
    )

    expect(result.providers).toEqual([
      expect.objectContaining({ provider: 'claude', sessions: 2, captured: 1, blocked: 0 }),
      expect.objectContaining({ provider: 'codex', sessions: 1, captured: 0, blocked: 1 }),
    ])
    expect(result.jobs[1]).toMatchObject({
      id: 'x1',
      provider: 'codex',
      status: 'blocked',
      guidance: 'Add the key in Settings, then press Retry.',
    })
    expect(JSON.stringify(result)).not.toContain('/private')
    expect(JSON.stringify(result)).not.toContain('PRIVATE')
  })

  it('projects coverage from currently available sessions instead of the historical queue', () => {
    const historicalDone = Array.from({ length: 20 }, (_, index) =>
      job({
        id: `old-done-${index}`,
        sessionId: `old-session-${index}`,
        status: 'done',
        updatedAt: '2026-07-13T00:00:00.000Z',
      }),
    )
    const recoveredLegacyErrors = Array.from({ length: 12 }, (_, index) =>
      job({
        id: `old-error-${index}`,
        sessionId: `failed-session-${index}`,
        status: 'error',
        attempts: 3,
        error: 'distiller CLI failed with legacy output',
        guidance: null,
        updatedAt: '2026-07-05T00:00:00.000Z',
      }),
    )

    const result = assembleMemoryCaptureOverview(
      [
        { id: 'current-claude', provider: 'claude' },
        { id: 'current-codex', provider: 'codex' },
      ],
      [
        ...historicalDone,
        ...recoveredLegacyErrors,
        job({
          id: 'current-claude-job',
          sessionId: 'current-claude',
          status: 'done',
          updatedAt: '2026-07-14T12:00:00.000Z',
        }),
        job({
          id: 'current-codex-job',
          provider: 'codex',
          sessionId: 'current-codex',
          status: 'queued',
          updatedAt: '2026-07-14T12:01:00.000Z',
        }),
      ],
    )

    expect(result.providers).toEqual([
      expect.objectContaining({ provider: 'claude', sessions: 1, captured: 1, pending: 0, blocked: 0 }),
      expect.objectContaining({ provider: 'codex', sessions: 1, captured: 0, pending: 1, blocked: 0 }),
    ])
    expect(result.jobs.map((item) => item.id)).toEqual([
      'current-claude-job',
      'current-codex-job',
    ])
  })

  it('shows one actionable provider block instead of every queued session behind it', () => {
    const result = assembleMemoryCaptureOverview(
      [
        { id: 'blocked-session', provider: 'claude' },
        { id: 'waiting-1', provider: 'claude' },
        { id: 'waiting-2', provider: 'claude' },
      ],
      [
        job({
          id: 'provider-block',
          sessionId: 'blocked-session',
          status: 'blocked',
          error: 'Add an OpenRouter key in Settings to continue.',
          guidance: 'Add or verify the OpenRouter key in Settings, then press Retry.',
        }),
        job({ id: 'waiting-job-1', sessionId: 'waiting-1', status: 'queued' }),
        job({ id: 'waiting-job-2', sessionId: 'waiting-2', status: 'queued' }),
      ],
    )

    expect(result.providers[0]).toMatchObject({ blocked: 1, pending: 2 })
    expect(result.jobs.map((item) => item.id)).toEqual(['provider-block'])
  })

  it('counts only capture-relevant sessions and marks grown transcripts as pending', () => {
    const now = Date.parse('2026-07-14T18:00:00.000Z')
    const result = assembleMemoryCaptureOverview(
      [
        {
          id: 'fresh-done',
          provider: 'codex',
          lastActiveAt: '2026-07-14T16:00:00.000Z',
          sizeBytes: 100,
        },
        {
          id: 'fresh-grown',
          provider: 'codex',
          lastActiveAt: '2026-07-14T17:00:00.000Z',
          sizeBytes: 120,
        },
        {
          id: 'fresh-untracked',
          provider: 'codex',
          lastActiveAt: '2026-07-14T17:30:00.000Z',
          sizeBytes: 40,
        },
        {
          id: 'old-untracked',
          provider: 'codex',
          lastActiveAt: '2026-07-09T17:30:00.000Z',
          sizeBytes: 40,
        },
      ],
      [
        job({
          id: 'fresh-done-job',
          provider: 'codex',
          sessionId: 'fresh-done',
          status: 'done',
          lastOffset: 100,
        }),
        job({
          id: 'fresh-grown-job',
          provider: 'codex',
          sessionId: 'fresh-grown',
          status: 'done',
          lastOffset: 80,
        }),
      ],
      now,
    )

    expect(result.providers[1]).toMatchObject({
      provider: 'codex',
      sessions: 3,
      captured: 1,
      pending: 2,
      blocked: 0,
    })
    expect(result.jobs.map((item) => item.id)).toEqual([
      'fresh-done-job',
      'fresh-grown-job',
    ])
  })
})
