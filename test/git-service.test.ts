import { beforeEach, describe, expect, it, vi } from 'vitest'
import { simpleGit, type SimpleGit } from 'simple-git'
import { GitService } from '../electron/main/services/GitService'
import type { ProjectService } from '../electron/main/services/ProjectService'
import { makeRecordingDb, type RecordingDb } from './helpers/fakeDb'

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
  detached: boolean
  ahead: number
  behind: number
  tracking: string | null
  files: FakeGitFile[]
}

function makeStatus(overrides: Partial<FakeStatus> = {}): FakeStatus {
  return {
    current: 'main',
    detached: false,
    ahead: 0,
    behind: 0,
    tracking: 'origin/main',
    files: [],
    ...overrides,
  }
}

interface FakeGitConfig {
  isRepo?: boolean
  status?: FakeStatus
  diffOutput?: string
  rawImpl?: (args: string[]) => Promise<string>
  commitHash?: string
}

/** Scripted stand-in for the subset of the simple-git API GitService uses. */
function makeFakeGit(config: FakeGitConfig = {}) {
  return {
    checkIsRepo: vi.fn(() => Promise.resolve(config.isRepo ?? true)),
    // Mirrors real git: once initialized, the folder really is a repo.
    init: vi.fn(() => {
      config.isRepo = true
      return Promise.resolve(undefined)
    }),
    status: vi.fn(() => Promise.resolve(config.status ?? makeStatus())),
    diff: vi.fn((_args: string[]) => Promise.resolve(config.diffOutput ?? '')),
    raw: vi.fn((args: string[]) => (config.rawImpl ? config.rawImpl(args) : Promise.resolve(''))),
    add: vi.fn(() => Promise.resolve(undefined)),
    commit: vi.fn(() => Promise.resolve({ commit: config.commitHash ?? '' })),
    revparse: vi.fn(() => Promise.resolve('fa11bacc')),
  }
}

function makeService(config: FakeGitConfig = {}): {
  service: GitService
  git: ReturnType<typeof makeFakeGit>
  rec: RecordingDb
} {
  const git = makeFakeGit(config)
  simpleGitMock.mockReturnValue(git as unknown as SimpleGit)
  const rec = makeRecordingDb()
  const projects = { get: vi.fn(() => ({ path: '/tmp/x' })) } as unknown as ProjectService
  const service = new GitService(rec.db, projects)
  return { service, git, rec }
}

beforeEach(() => {
  simpleGitMock.mockReset()
})

describe('GitService.status', () => {
  it('returns an empty no-git snapshot for a non-repo and persists nothing', async () => {
    const { service, rec } = makeService({ isRepo: false })
    const snapshot = await service.status('prj_1')
    expect(snapshot).toMatchObject({
      projectId: 'prj_1',
      branch: 'no-git',
      ahead: 0,
      behind: 0,
      changedFilesCount: 0,
      files: [],
    })
    expect(rec.callsFor('run', 'git_snapshots')).toHaveLength(0)
  })

  it('opens the repo at the project path', async () => {
    const { service } = makeService({ isRepo: false })
    await service.status('prj_1')
    expect(simpleGitMock).toHaveBeenCalledWith({ baseDir: '/tmp/x' })
  })

  it('maps porcelain file states and persists the snapshot', async () => {
    const status = makeStatus({
      ahead: 2,
      behind: 1,
      files: [
        { path: 'staged.ts', index: 'M', working_dir: ' ' },
        { path: 'unstaged.ts', index: ' ', working_dir: 'M' },
        { path: 'new.txt', index: '?', working_dir: '?' },
        { path: 'conflict.ts', index: 'U', working_dir: 'U' },
      ],
    })
    const { service, rec } = makeService({ status })
    const snapshot = await service.status('prj_1')

    expect(snapshot.branch).toBe('main')
    expect(snapshot.ahead).toBe(2)
    expect(snapshot.behind).toBe(1)
    expect(snapshot.changedFilesCount).toBe(4)
    expect(snapshot.stagedCount).toBe(1)
    // conflicted files count as unstaged work alongside plain unstaged edits
    expect(snapshot.unstagedCount).toBe(2)
    expect(snapshot.untrackedCount).toBe(1)
    expect(snapshot.files.map((f) => f.state)).toEqual([
      'staged',
      'unstaged',
      'untracked',
      'conflicted',
    ])

    const persisted = rec.callsFor('run', 'git_snapshots')
    expect(persisted).toHaveLength(1)
    expect(persisted[0].args[0]).toMatchObject({ projectId: 'prj_1', branch: 'main', staged: 1 })
  })

  it('labels a detached HEAD instead of failing', async () => {
    const { service } = makeService({ status: makeStatus({ current: null }) })
    const snapshot = await service.status('prj_1')
    expect(snapshot.branch).toBe('detached')
  })
})

describe('GitService.headCommit', () => {
  it('returns the exact current HEAD hash and subject as machine-readable evidence', async () => {
    const { service, git } = makeService({
      rawImpl: async (args) =>
        args[0] === 'log'
          ? '10243f539d8055d542834ecd576e2134b4679501\u000010243f5\u0000chore(release): bump version to 0.2.2\n'
          : '',
    })

    await expect(service.headCommit('prj_1')).resolves.toEqual({
      hash: '10243f539d8055d542834ecd576e2134b4679501',
      shortHash: '10243f5',
      subject: 'chore(release): bump version to 0.2.2',
    })
    expect(git.raw).toHaveBeenCalledWith(['log', '-1', '--format=%H%x00%h%x00%s'])
  })

  it('returns null when the repository has no commit yet', async () => {
    const { service } = makeService({
      rawImpl: () => Promise.reject(new Error('fatal: your current branch has no commits yet')),
    })

    await expect(service.headCommit('prj_1')).resolves.toBeNull()
  })
})

describe('GitService.initRepo', () => {
  it('initializes a fresh folder on main and returns the resulting status', async () => {
    const { service, git } = makeService({
      isRepo: false,
      status: makeStatus({ current: 'main', tracking: null }),
    })

    const snapshot = await service.initRepo('prj_1')

    expect(git.init).toHaveBeenCalledTimes(1)
    expect(git.raw).toHaveBeenCalledWith(['symbolic-ref', 'HEAD', 'refs/heads/main'])
    expect(snapshot.branch).toBe('main')
  })

  it('is a no-op when the folder is already a repo', async () => {
    const { service, git } = makeService({ isRepo: true })
    const snapshot = await service.initRepo('prj_1')
    expect(git.init).not.toHaveBeenCalled()
    expect(snapshot.branch).toBe('main')
  })
})

describe('GitService.push', () => {
  it('throws on a non-repo', async () => {
    const { service } = makeService({ isRepo: false })
    await expect(service.push({ projectId: 'prj_1' })).rejects.toThrow(/not a git repository/i)
  })

  it('refuses to push from a detached HEAD', async () => {
    const { service, git } = makeService({
      status: makeStatus({ current: null, detached: true, ahead: 1 }),
    })
    await expect(service.push({ projectId: 'prj_1' })).rejects.toThrow(/detached HEAD/)
    expect(git.raw).not.toHaveBeenCalled()
  })

  it('pushes a branch literally named "detached" (only the real flag blocks)', async () => {
    const { service, git } = makeService({
      status: makeStatus({ current: 'detached', tracking: 'origin/detached', ahead: 1 }),
    })
    await expect(service.push({ projectId: 'prj_1' })).resolves.toMatchObject({ branch: 'detached' })
    expect(git.raw).toHaveBeenCalled()
  })

  it('refuses when there is nothing to push', async () => {
    const { service, git } = makeService({ status: makeStatus({ ahead: 0 }) })
    await expect(service.push({ projectId: 'prj_1' })).rejects.toThrow(/Nothing to push/)
    expect(git.raw).not.toHaveBeenCalled()
  })

  it('pushes with plain args when a tracking branch exists', async () => {
    const { service, git } = makeService({ status: makeStatus({ ahead: 2 }) })
    const result = await service.push({ projectId: 'prj_1' })
    expect(git.raw).toHaveBeenCalledWith(['push'])
    expect(result).toMatchObject({ branch: 'main', remote: 'origin', forced: false })
  })

  it('sets the upstream on the first push of a new branch', async () => {
    const { service, git } = makeService({
      status: makeStatus({ current: 'feature', tracking: null, ahead: 1 }),
    })
    await service.push({ projectId: 'prj_1' })
    expect(git.raw).toHaveBeenCalledWith(['push', '--set-upstream', 'origin', 'feature'])
  })

  it('force-pushes with --force-with-lease and never a bare --force', async () => {
    const { service, git } = makeService({ status: makeStatus({ ahead: 0 }) })
    const result = await service.push({ projectId: 'prj_1', force: true })
    expect(git.raw).toHaveBeenCalledWith(['push', '--force-with-lease'])
    const rawArgs = git.raw.mock.calls[0][0]
    expect(rawArgs).not.toContain('--force')
    expect(result.forced).toBe(true)
  })

  it('wraps git push failures with context', async () => {
    const { service } = makeService({
      status: makeStatus({ ahead: 1 }),
      rawImpl: () => Promise.reject(new Error('remote: permission denied\n')),
    })
    await expect(service.push({ projectId: 'prj_1' })).rejects.toThrow(
      'git push failed: remote: permission denied',
    )
  })
})

describe('GitService.commit', () => {
  it('throws when nothing is staged', async () => {
    const { service, git } = makeService({
      status: makeStatus({ files: [{ path: 'a.ts', index: ' ', working_dir: 'M' }] }),
    })
    await expect(service.commit({ projectId: 'prj_1', message: 'msg' })).rejects.toThrow(
      /No staged files/,
    )
    expect(git.commit).not.toHaveBeenCalled()
  })

  it('commits staged files and reports hash, branch, and file count', async () => {
    const { service, git } = makeService({
      status: makeStatus({
        files: [
          { path: 'a.ts', index: 'M', working_dir: ' ' },
          { path: 'b.ts', index: 'A', working_dir: ' ' },
        ],
      }),
      commitHash: 'abc1234',
    })
    const result = await service.commit({ projectId: 'prj_1', message: 'feat: two files' })
    expect(git.commit).toHaveBeenCalledWith('feat: two files')
    expect(result).toEqual({
      branch: 'main',
      commitHash: 'abc1234',
      summary: 'feat: two files',
      filesChanged: 2,
    })
  })

  it('falls back to rev-parse when simple-git omits the commit hash', async () => {
    const { service, git } = makeService({
      status: makeStatus({ files: [{ path: 'a.ts', index: 'M', working_dir: ' ' }] }),
      commitHash: '',
    })
    const result = await service.commit({ projectId: 'prj_1', message: 'msg' })
    expect(git.revparse).toHaveBeenCalledWith(['HEAD'])
    expect(result.commitHash).toBe('fa11bacc')
  })
})

describe('GitService.diff', () => {
  it('returns an empty diff outside a repo', async () => {
    const { service } = makeService({ isRepo: false })
    const diff = await service.diff({ projectId: 'prj_1', path: 'a.ts' })
    expect(diff).toEqual({ path: 'a.ts', hunks: '', binary: false })
  })

  it('returns the untracked marker for a brand-new file', async () => {
    const { service } = makeService({
      diffOutput: '',
      rawImpl: (args) => Promise.resolve(args[0] === 'status' ? '?? note.txt\n' : ''),
    })
    const diff = await service.diff({ projectId: 'prj_1', path: 'note.txt' })
    expect(diff.hunks).toContain('untracked file')
    expect(diff.binary).toBe(false)
  })

  it('requests the staged diff when asked', async () => {
    const { service, git } = makeService({ diffOutput: '+staged change' })
    const diff = await service.diff({ projectId: 'prj_1', path: 'a.ts', staged: true })
    expect(git.diff).toHaveBeenCalledWith(['--staged', '--', 'a.ts'])
    expect(diff.hunks).toBe('+staged change')
  })

  it('flags binary diffs', async () => {
    const { service } = makeService({ diffOutput: 'Binary files a/logo.png and b/logo.png differ' })
    const diff = await service.diff({ projectId: 'prj_1', path: 'logo.png' })
    expect(diff.binary).toBe(true)
  })
})
