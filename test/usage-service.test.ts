import { describe, expect, it } from 'vitest'
import { UsageService } from '../electron/main/services/UsageService'
import { makeRecordingDb } from './helpers/fakeDb'

interface UsageRowShape {
  id: string
  project_id: string
  provider: string
  event_type: string
  count: number
  duration_ms: number | null
  estimated_tokens: number | null
  metadata_json: string
  created_at: string
}

function usageRow(overrides: Partial<UsageRowShape> = {}): UsageRowShape {
  return {
    id: 'usg_1',
    project_id: 'prj_1',
    provider: 'claude',
    event_type: 'session_started',
    count: 1,
    duration_ms: null,
    estimated_tokens: null,
    metadata_json: '{}',
    created_at: '2026-07-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('UsageService.record', () => {
  it('inserts an event with safe defaults', () => {
    const rec = makeRecordingDb()
    const service = new UsageService(rec.db)
    service.record({ projectId: 'prj_1', provider: 'claude', eventType: 'session_started' })

    const inserts = rec.callsFor('run', 'INSERT INTO usage_events')
    expect(inserts).toHaveLength(1)
    expect(inserts[0].args[0]).toMatchObject({
      projectId: 'prj_1',
      provider: 'claude',
      eventType: 'session_started',
      count: 1,
      durationMs: null,
      estimatedTokens: null,
      metadata: '{}',
    })
  })

  it('persists explicit counts, durations, tokens, and metadata', () => {
    const rec = makeRecordingDb()
    const service = new UsageService(rec.db)
    service.record({
      projectId: 'prj_1',
      provider: 'terminal',
      eventType: 'command_run',
      count: 3,
      durationMs: 1200,
      estimatedTokens: 42,
      metadata: { source: 'block' },
    })
    expect(rec.callsFor('run', 'INSERT INTO usage_events')[0].args[0]).toMatchObject({
      count: 3,
      durationMs: 1200,
      estimatedTokens: 42,
      metadata: '{"source":"block"}',
    })
  })
})

describe('UsageService.summarize', () => {
  it('collapses rows into per-provider summaries sorted by sessions', () => {
    const rows = [
      usageRow({ id: 'u1', event_type: 'session_started' }),
      usageRow({ id: 'u2', event_type: 'agent_launch', duration_ms: 500 }),
      usageRow({ id: 'u3', event_type: 'command_run', count: 3, estimated_tokens: 100 }),
      usageRow({ id: 'u4', provider: 'codex', event_type: 'task_run' }),
    ]
    const rec = makeRecordingDb({ all: (_sql, args) => (args[0] === 'prj_1' ? rows : []) })
    const service = new UsageService(rec.db)

    const summaries = service.summarize('prj_1')
    expect(summaries).toHaveLength(2)
    expect(summaries[0]).toMatchObject({
      provider: 'claude',
      sessions: 2,
      commands: 3,
      totalDurationMs: 500,
      estimatedTokens: 100,
      warning: null,
    })
    expect(summaries[1]).toMatchObject({ provider: 'codex', tasks: 1, sessions: 0 })
  })

  it('never throws on corrupt persisted metadata', () => {
    const rows = [usageRow({ metadata_json: '{not json' })]
    const rec = makeRecordingDb({ all: () => rows })
    const service = new UsageService(rec.db)
    expect(() => service.summarize('prj_1')).not.toThrow()
    expect(service.summarize('prj_1')[0].sessions).toBe(1)
  })

  it('returns an empty summary list for a project with no events', () => {
    const rec = makeRecordingDb()
    const service = new UsageService(rec.db)
    expect(service.summarize('prj_empty')).toEqual([])
  })
})
