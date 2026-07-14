import { describe, expect, it, vi } from 'vitest'
import type { Db } from '../electron/main/db/Database'
import { CockpitEvents } from '../electron/main/events'
import { LogIntelligenceService } from '../electron/main/services/LogIntelligenceService'

interface StoredInsight {
  id: string
  project_id: string
  log_event_id: string | null
  title: string
  likely_cause: string
  suggested_action: string
  suggested_agent: string
  severity: string
  matched_pattern: string
  created_at: string
  log_message: string | null
  terminal_role?: string | null
}

interface StoredLog {
  id: string
  project_id: string
  source_type: string
  source_id: string | null
  level: string
  message: string
  metadata_json: string
  created_at: string
  terminal_role?: string | null
}

function insight(over: Partial<StoredInsight>): StoredInsight {
  return {
    id: 'ins-1',
    project_id: 'p1',
    log_event_id: 'log-1',
    title: 'Deployment problem',
    likely_cause: 'Legacy cause',
    suggested_action: 'Check the Railway panel.',
    suggested_agent: 'railway',
    severity: 'high',
    matched_pattern: 'deploy_failed',
    created_at: '2026-07-14T12:00:00.000Z',
    log_message: 'Deployment failed: production build crashed',
    ...over,
  }
}

function fakeDb(rows: StoredInsight[], logs: StoredLog[] = []): Db {
  return {
    prepare: vi.fn((sql: string) => {
      if (sql.includes('LEFT JOIN log_events')) return { all: vi.fn(() => rows) }
      if (sql.includes('FROM log_events')) return { all: vi.fn(() => logs) }
      if (sql.includes('FROM insight_dismissals')) return { all: vi.fn(() => []) }
      return { run: vi.fn(), all: vi.fn(() => []), get: vi.fn(() => undefined) }
    }),
    transaction: vi.fn((fn: () => void) => fn),
  } as unknown as Db
}

describe('LogIntelligenceService legacy projection', () => {
  it('revalidates old insight rows and applies the current provider-neutral guidance', () => {
    const service = new LogIntelligenceService(
      fakeDb([
        insight({ id: 'valid-deploy' }),
        insight({
          id: 'stale-match',
          created_at: '2026-07-14T11:59:00.000Z',
          log_event_id: 'log-2',
          log_message: 'compiled successfully in 240ms',
        }),
        insight({
          id: 'orphaned-legacy-advice',
          created_at: '2026-07-14T11:58:00.000Z',
          log_event_id: null,
          log_message: null,
        }),
      ]),
      new CockpitEvents(),
    )

    const result = service.listInsights('p1')

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id: 'valid-deploy',
      matchedPattern: 'deploy_failed',
      suggestedAgent: 'local',
      occurrences: 1,
    })
    expect(result[0].suggestedAction).not.toMatch(/railway/i)
  })

  it('hides legacy log and insight rows captured from Claude/Codex panes', () => {
    const service = new LogIntelligenceService(
      fakeDb(
        [
          insight({ id: 'frontend-deploy', terminal_role: 'frontend' }),
          insight({
            id: 'agent-module',
            matched_pattern: 'module_not_found',
            title: 'Missing module',
            log_message: "Error: Cannot find module '@shared/insight-aggregation'",
            terminal_role: 'codex',
          }),
        ],
        [
          {
            id: 'frontend-log',
            project_id: 'p1',
            source_type: 'terminal',
            source_id: 'term-frontend',
            level: 'error',
            message: 'Deployment failed: production build crashed',
            metadata_json: '{}',
            created_at: '2026-07-14T12:00:00.000Z',
            terminal_role: 'frontend',
          },
          {
            id: 'agent-log',
            project_id: 'p1',
            source_type: 'terminal',
            source_id: 'term-codex',
            level: 'error',
            message: "Error: Cannot find module '@shared/insight-aggregation'",
            metadata_json: '{}',
            created_at: '2026-07-14T12:01:00.000Z',
            terminal_role: 'codex',
          },
        ],
      ),
      new CockpitEvents(),
    )

    expect(service.listLogs('p1').map((item) => item.id)).toEqual(['frontend-log'])
    expect(service.listInsights('p1').map((item) => item.id)).toEqual(['frontend-deploy'])
  })
})
