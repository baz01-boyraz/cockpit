import { beforeEach, describe, expect, it, vi } from 'vitest'
import { simpleGit, type SimpleGit } from 'simple-git'
import { GitService } from '../electron/main/services/GitService'
import type { ProjectService } from '../electron/main/services/ProjectService'
import { makeRecordingDb, type RecordingDb } from './helpers/fakeDb'

/**
 * Task 3.5 — git_snapshots churn control. status() used to persist a row on
 * every call (2–3× per commit/push, every dashboard refresh) with no bound on
 * the table. Now: identical consecutive snapshots are deduped per project, and
 * the table is pruned opportunistically (keep newest 200 per project, prune
 * every 20th insert). status() return values are unchanged for callers.
 */

vi.mock('simple-git', () => ({
  simpleGit: vi.fn(),
}))

const simpleGitMock = vi.mocked(simpleGit)

interface FakeGitFile {
  path: string
  index: string
  working_dir: string
}

interface FakeStatus {
  current: string | null
  ahead: number
  behind: number
  tracking: string | null
  files: FakeGitFile[]
}

function makeStatus(overrides: Partial<FakeStatus> = {}): FakeStatus {
  return { current: 'main', ahead: 0, behind: 0, tracking: 'origin/main', files: [], ...overrides }
}

/**
 * Scripted git whose status() answers from a queue (last entry repeats), so a
 * test can present a changing repo across successive calls.
 */
function makeService(statuses: FakeStatus[] = [makeStatus()]): {
  service: GitService
  rec: RecordingDb
} {
  const queue = [...statuses]
  const git = {
    checkIsRepo: vi.fn(() => Promise.resolve(true)),
    status: vi.fn(() => Promise.resolve(queue.length > 1 ? queue.shift() : queue[0])),
    raw: vi.fn(() => Promise.resolve('')),
    add: vi.fn(() => Promise.resolve(undefined)),
    commit: vi.fn(() => Promise.resolve({ commit: 'abc1234' })),
    revparse: vi.fn(() => Promise.resolve('abc1234')),
    diff: vi.fn(() => Promise.resolve('')),
  }
  simpleGitMock.mockReturnValue(git as unknown as SimpleGit)
  const rec = makeRecordingDb()
  const projects = { get: vi.fn(() => ({ path: '/tmp/x' })) } as unknown as ProjectService
  const service = new GitService(rec.db, projects)
  return { service, rec }
}

const inserts = (rec: RecordingDb) => rec.callsFor('run', 'INSERT INTO git_snapshots')
const prunes = (rec: RecordingDb) => rec.callsFor('run', 'DELETE FROM git_snapshots')

beforeEach(() => {
  simpleGitMock.mockReset()
})

describe('snapshot dedupe', () => {
  it('persists identical consecutive snapshots only once', async () => {
    const { service, rec } = makeService()
    await service.status('prj_1')
    await service.status('prj_1')
    await service.status('prj_1')
    expect(inserts(rec)).toHaveLength(1)
  })

  it('still returns a full fresh snapshot when the persist is skipped', async () => {
    const { service } = makeService()
    const first = await service.status('prj_1')
    const second = await service.status('prj_1')
    expect(second).toMatchObject({ projectId: 'prj_1', branch: 'main' })
    expect(second.id).not.toBe(first.id)
  })

  it('persists again when the repo state actually changed', async () => {
    const { service, rec } = makeService([
      makeStatus({ files: [{ path: 'a.ts', index: 'M', working_dir: ' ' }] }),
      makeStatus({ files: [] }),
    ])
    await service.status('prj_1')
    await service.status('prj_1')
    expect(inserts(rec)).toHaveLength(2)
  })

  it('detects branch and ahead/behind changes, not just file changes', async () => {
    const { service, rec } = makeService([
      makeStatus({ ahead: 0 }),
      makeStatus({ ahead: 2 }),
      makeStatus({ ahead: 2, current: 'feature' }),
    ])
    await service.status('prj_1')
    await service.status('prj_1')
    await service.status('prj_1')
    expect(inserts(rec)).toHaveLength(3)
  })

  it('dedupes per project — one project cannot mask another', async () => {
    const { service, rec } = makeService()
    await service.status('prj_1')
    await service.status('prj_2')
    expect(inserts(rec)).toHaveLength(2)
  })

  it('a commit no longer writes duplicate rows for its repeated status calls', async () => {
    const staged = makeStatus({ files: [{ path: 'a.ts', index: 'M', working_dir: ' ' }] })
    const clean = makeStatus({ ahead: 1, files: [] })
    const { service, rec } = makeService([staged, clean])
    await service.commit({ projectId: 'prj_1', message: 'feat: x' })
    // before-commit state + after-commit state — exactly two distinct rows.
    expect(inserts(rec)).toHaveLength(2)
  })
})

describe('opportunistic pruning', () => {
  /** Distinct statuses so every status() call persists a new row. */
  const distinctStatuses = (n: number) => Array.from({ length: n }, (_, i) => makeStatus({ ahead: i + 1 }))

  it('does not prune on early inserts (cheap steady state)', async () => {
    const { service, rec } = makeService(distinctStatuses(5))
    for (let i = 0; i < 5; i += 1) await service.status('prj_1')
    expect(inserts(rec)).toHaveLength(5)
    expect(prunes(rec)).toHaveLength(0)
  })

  it('prunes on the 20th insert, keeping the newest 200 rows for that project', async () => {
    const { service, rec } = makeService(distinctStatuses(20))
    for (let i = 0; i < 20; i += 1) await service.status('prj_1')

    expect(inserts(rec)).toHaveLength(20)
    const pruneCalls = prunes(rec)
    expect(pruneCalls).toHaveLength(1)
    expect(pruneCalls[0].sql).toContain('project_id = @projectId')
    expect(pruneCalls[0].sql).toContain('ORDER BY created_at DESC')
    expect(pruneCalls[0].args[0]).toMatchObject({ projectId: 'prj_1', keep: 200 })
  })

  it('resets the counter after pruning — next prune after another 20 inserts', async () => {
    const { service, rec } = makeService(distinctStatuses(40))
    for (let i = 0; i < 40; i += 1) await service.status('prj_1')
    expect(prunes(rec)).toHaveLength(2)
  })

  it('counts inserts per project, so a busy project never starves another', async () => {
    const { service, rec } = makeService(distinctStatuses(40))
    // Alternate projects: each sees 20 distinct inserts → each prunes once.
    for (let i = 0; i < 40; i += 1) {
      await service.status(i % 2 === 0 ? 'prj_a' : 'prj_b')
    }
    const pruneCalls = prunes(rec)
    expect(pruneCalls).toHaveLength(2)
    const prunedProjects = pruneCalls.map((c) => (c.args[0] as { projectId: string }).projectId).sort()
    expect(prunedProjects).toEqual(['prj_a', 'prj_b'])
  })

  it('skipped (deduped) persists do not advance the prune counter', async () => {
    const { service, rec } = makeService(distinctStatuses(19))
    for (let i = 0; i < 19; i += 1) await service.status('prj_1')
    // 19 distinct inserts + a flood of identical calls: still no prune.
    for (let i = 0; i < 30; i += 1) await service.status('prj_1')
    expect(inserts(rec)).toHaveLength(19)
    expect(prunes(rec)).toHaveLength(0)
  })
})
