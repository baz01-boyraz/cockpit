import { beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../electron/main/db/Database'
import { MemoryPolicyService } from '../electron/main/services/MemoryPolicyService'
import { SCHEMA_V19 } from '../electron/main/db/schema'

interface SettingsRow {
  brain: string
  trust_mode: string
  policy_version: number
  updated_at: string
}

function makeSettingsDb() {
  const rows = new Map<string, SettingsRow>()
  const fake = {
    prepare(sql: string) {
      return {
        get: (brain?: string) => {
          if (sql.includes('COUNT(*)')) return { count: rows.size }
          return brain ? rows.get(brain) : undefined
        },
        run: (...args: unknown[]) => {
          if (sql.includes('INSERT INTO memory_brain_settings')) {
            const [brain, trustMode, policyVersion, updatedAt] = args as [string, string, number, string]
            rows.set(brain, {
              brain,
              trust_mode: trustMode,
              policy_version: policyVersion,
              updated_at: updatedAt,
            })
          }
          return { changes: 1 }
        },
      }
    },
  }
  return { db: fake as unknown as Db, rows }
}

describe('MemoryPolicyService', () => {
  let db: Db
  let rows: Map<string, SettingsRow>
  let policy: MemoryPolicyService

  beforeEach(() => {
    ;({ db, rows } = makeSettingsDb())
    policy = new MemoryPolicyService(db)
  })

  it('ships an additive settings-table migration', () => {
    expect(SCHEMA_V19).toContain('CREATE TABLE IF NOT EXISTS memory_brain_settings')
    expect(SCHEMA_V19).toContain('brain')
    expect(SCHEMA_V19).toContain('trust_mode')
  })

  it('uses scope-specific safe defaults without creating rows', () => {
    expect(policy.getTrustMode('proj-a', 'project')).toBe('autopilot')
    expect(policy.getTrustMode('proj-a', 'global')).toBe('assisted')
    const row = db.prepare('SELECT COUNT(*) AS count FROM memory_brain_settings').get() as { count: number }
    expect(row.count).toBe(0)
  })

  it('persists project and global modes independently in the main-process database', () => {
    policy.setTrustMode('proj-a', 'project', 'manual')
    policy.setTrustMode('proj-b', 'project', 'assisted')
    policy.setTrustMode('proj-a', 'global', 'manual')

    expect(policy.getTrustMode('proj-a', 'project')).toBe('manual')
    expect(policy.getTrustMode('proj-b', 'project')).toBe('assisted')
    expect(policy.getTrustMode('proj-c', 'project')).toBe('autopilot')
    expect(policy.getTrustMode('proj-b', 'global')).toBe('manual')
  })

  it('falls back safely when a persisted row is corrupt', () => {
    rows.set('project:proj-a', {
      brain: 'project:proj-a',
      trust_mode: 'newer-wins',
      policy_version: 1,
      updated_at: '2026-07-11T00:00:00.000Z',
    })
    expect(policy.getTrustMode('proj-a', 'project')).toBe('autopilot')
  })
})
