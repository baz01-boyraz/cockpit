import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CodexSessionsService } from '../electron/main/services/CodexSessionsService'
import {
  AgentSessionsService,
  mergeResumableSessions,
} from '../electron/main/services/AgentSessionsService'
import type { ClaudeSessionsService } from '../electron/main/services/ClaudeSessionsService'
import type { ResumableSessionSummary } from '@shared/domain'

const PROJECT = '/work/cockpit'
const roots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'cockpit-codex-sessions-'))
  roots.push(root)
  return root
}

function writeSession(
  root: string,
  input: {
    id: string
    cwd?: string
    title?: string
    timestamp?: string
    mtime?: string
    malformed?: boolean
  },
): void {
  const dir = join(root, '2026', '07', '09')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `rollout-${input.id}.jsonl`)
  const timestamp = input.timestamp ?? '2026-07-09T20:00:00.000Z'
  const lines = input.malformed
    ? ['not-json']
    : [
        JSON.stringify({
          timestamp,
          type: 'session_meta',
          payload: { id: input.id, cwd: input.cwd ?? PROJECT, source: 'cli' },
        }),
        JSON.stringify({
          timestamp,
          type: 'event_msg',
          payload: { type: 'user_message', message: input.title ?? 'Resume Codex work' },
        }),
      ]
  writeFileSync(path, `${lines.join('\n')}\n`)
  const mtime = new Date(input.mtime ?? timestamp)
  utimesSync(path, mtime, mtime)
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('CodexSessionsService', () => {
  it('lists only the open project sessions with provider, title, and timestamps', () => {
    const root = tempRoot()
    const id = '123e4567-e89b-12d3-a456-426614174000'
    writeSession(root, {
      id,
      title: '  Continue   the unified Resume picker  ',
      timestamp: '2026-07-09T20:15:00.000Z',
      mtime: '2026-07-09T21:41:00.000Z',
    })
    writeSession(root, {
      id: '223e4567-e89b-12d3-a456-426614174000',
      cwd: '/work/somewhere-else',
      title: 'Wrong project',
    })

    expect(new CodexSessionsService(root).list(PROJECT)).toEqual([
      {
        id,
        provider: 'codex',
        title: 'Continue the unified Resume picker',
        createdAt: '2026-07-09T20:15:00.000Z',
        lastActiveAt: '2026-07-09T21:41:00.000Z',
        sizeBytes: expect.any(Number),
      },
    ])
  })

  it('ignores malformed or title-less transcript files instead of failing the picker', () => {
    const root = tempRoot()
    writeSession(root, {
      id: '323e4567-e89b-12d3-a456-426614174000',
      malformed: true,
    })

    expect(new CodexSessionsService(root).list(PROJECT)).toEqual([])
  })

  it('exposes the exact transcript path only through the internal capture model', () => {
    const root = tempRoot()
    const id = '423e4567-e89b-12d3-a456-426614174000'
    writeSession(root, { id, title: 'Capture this Codex session' })

    const service = new CodexSessionsService(root)
    const [capture] = service.captureList(PROJECT)

    expect(capture).toMatchObject({ id, provider: 'codex' })
    expect(capture.transcriptPath).toMatch(new RegExp(`rollout-${id}\\.jsonl$`))
    expect(service.list(PROJECT)[0]).not.toHaveProperty('transcriptPath')
  })
})

describe('mergeResumableSessions', () => {
  it('sorts Claude and Codex together by most recent activity', () => {
    const sessions: ResumableSessionSummary[] = [
      {
        id: 'claude-id',
        provider: 'claude',
        title: 'Claude task',
        createdAt: '2026-07-09T18:00:00.000Z',
        lastActiveAt: '2026-07-09T20:00:00.000Z',
        sizeBytes: 10,
      },
      {
        id: 'codex-id',
        provider: 'codex',
        title: 'Codex task',
        createdAt: '2026-07-09T19:00:00.000Z',
        lastActiveAt: '2026-07-09T21:00:00.000Z',
        sizeBytes: 20,
      },
    ]

    expect(mergeResumableSessions(sessions).map((session) => session.provider)).toEqual([
      'codex',
      'claude',
    ])
  })

  it('combines both provider services through the unified project read model', () => {
    const claude = {
      list: vi.fn(() => [
        {
          id: 'claude-id',
          title: 'Claude task',
          createdAt: '2026-07-09T18:00:00.000Z',
          lastActiveAt: '2026-07-09T20:00:00.000Z',
          sizeBytes: 10,
        },
      ]),
    } as unknown as ClaudeSessionsService
    const codex = {
      list: vi.fn((): ResumableSessionSummary[] => [
        {
          id: 'codex-id',
          provider: 'codex',
          title: 'Codex task',
          createdAt: '2026-07-09T19:00:00.000Z',
          lastActiveAt: '2026-07-09T21:00:00.000Z',
          sizeBytes: 20,
        },
      ]),
    } as unknown as CodexSessionsService

    const sessions = new AgentSessionsService(claude, codex).list(PROJECT)

    expect(claude.list).toHaveBeenCalledWith(PROJECT)
    expect(codex.list).toHaveBeenCalledWith(PROJECT)
    expect(sessions.map(({ provider }) => provider)).toEqual(['codex', 'claude'])
  })

  it('combines provider-native transcript paths for memory capture', () => {
    const claude = {
      list: vi.fn(() => [
        {
          id: 'claude-id',
          title: 'Claude task',
          createdAt: '2026-07-09T18:00:00.000Z',
          lastActiveAt: '2026-07-09T20:00:00.000Z',
          sizeBytes: 10,
        },
      ]),
      transcriptPath: vi.fn((_project: string, id: string) => `/claude/${id}.jsonl`),
    } as unknown as ClaudeSessionsService
    const codex = {
      list: vi.fn(() => []),
      captureList: vi.fn(() => [
        {
          id: 'codex-id',
          provider: 'codex' as const,
          title: 'Codex task',
          createdAt: '2026-07-09T19:00:00.000Z',
          lastActiveAt: '2026-07-09T21:00:00.000Z',
          sizeBytes: 20,
          transcriptPath: '/codex/rollout-codex-id.jsonl',
        },
      ]),
    } as unknown as CodexSessionsService

    const sessions = new AgentSessionsService(claude, codex).captureList(PROJECT)

    expect(sessions.map(({ provider }) => provider)).toEqual(['codex', 'claude'])
    expect(sessions.map(({ transcriptPath }) => transcriptPath)).toEqual([
      '/codex/rollout-codex-id.jsonl',
      '/claude/claude-id.jsonl',
    ])
  })
})
