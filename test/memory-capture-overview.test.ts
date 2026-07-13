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
      [{ provider: 'claude' }, { provider: 'claude' }, { provider: 'codex' }],
      [
        job({ id: 'c1', provider: 'claude', status: 'done' }),
        job({
          id: 'x1',
          provider: 'codex',
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
})
