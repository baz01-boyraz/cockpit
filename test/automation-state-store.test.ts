import { describe, expect, it } from 'vitest'
import { DATABASE_SCHEMA_VERSION } from '../electron/main/db/Database'
import { SCHEMA_V21 } from '../electron/main/db/schema'
import { AutomationStateStore } from '../electron/main/services/AutomationStateStore'
import { makeRecordingDb } from './helpers/fakeDb'

const AT = '2026-07-12T14:00:00.000Z'

describe('AutomationStateStore', () => {
  it('ships V21 with one durable lifecycle row per automation', () => {
    expect(DATABASE_SCHEMA_VERSION).toBe(21)
    expect(SCHEMA_V21).toContain('CREATE TABLE IF NOT EXISTS automation_jobs')
    expect(SCHEMA_V21).toContain('next_run_at')
    expect(SCHEMA_V21).toContain('last_result')
    expect(SCHEMA_V21).toContain('last_error')
    expect(SCHEMA_V21).toContain('CREATE INDEX')
  })

  it('creates the 09:00 daily digest idempotently without re-enabling a paused row', () => {
    const rec = makeRecordingDb()
    const store = new AutomationStateStore(rec.db)
    store.ensureDailyDigest('p1', AT)
    store.ensureDailyDigest('p1', AT)

    const inserts = rec.callsFor('run', 'INSERT OR IGNORE INTO automation_jobs')
    expect(inserts).toHaveLength(2)
    expect(inserts[0].args[0]).toMatchObject({
      projectId: 'p1',
      name: 'Daily briefing',
      kind: 'digest',
      scheduleJson: JSON.stringify({ kind: 'daily', time: '09:00' }),
    })
    expect(inserts[0].sql).not.toContain('DO UPDATE')
  })

  it('claims a due job atomically and refuses an overlapping owner', () => {
    let changes = 1
    const rec = makeRecordingDb({
      run: (sql) => ({ changes: sql.includes('automation_jobs') ? changes : 1 }),
      get: () => ({
        id: 'auto-1', project_id: 'p1', name: 'Watch', instruction: 'Observe', kind: 'watch',
        schedule_json: JSON.stringify({ kind: 'interval', minutes: 360 }), system: 0, enabled: 1,
        state: 'running', next_run_at: AT, last_run_at: null, last_status: 'running',
        last_result: null, last_error: null, created_at: AT, updated_at: AT,
      }),
    })
    const store = new AutomationStateStore(rec.db)
    expect(store.claim('p1', 'auto-1', AT, false)).toMatchObject({ id: 'auto-1', state: 'running' })
    expect(rec.callsFor('run', 'UPDATE automation_jobs')[0].sql).toContain("state != 'running'")

    changes = 0
    expect(store.claim('p1', 'auto-1', AT, false)).toBeNull()
  })

  it('persists the bounded result before returning a job to scheduled state', () => {
    const rec = makeRecordingDb({
      get: () => ({
        id: 'auto-1', project_id: 'p1', name: 'Watch', instruction: 'Observe', kind: 'watch',
        schedule_json: JSON.stringify({ kind: 'interval', minutes: 360 }), system: 0, enabled: 1,
        state: 'scheduled', next_run_at: AT, last_run_at: AT, last_status: 'ok',
        last_result: 'All clear', last_error: null, created_at: AT, updated_at: AT,
      }),
    })
    const store = new AutomationStateStore(rec.db)
    store.complete('p1', 'auto-1', {
      at: AT,
      nextRunAt: '2026-07-12T20:00:00.000Z',
      result: 'All clear',
    })
    expect(rec.callsFor('run', 'UPDATE automation_jobs')[0].args[0]).toMatchObject({
      id: 'auto-1',
      result: 'All clear',
      status: 'ok',
    })
  })
})
