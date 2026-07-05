import { beforeEach, describe, expect, it, vi } from 'vitest'
import { simpleGit, type SimpleGit } from 'simple-git'

vi.mock('simple-git', () => ({ simpleGit: vi.fn() }))
vi.mock('node:child_process', () => ({ execFile: vi.fn() }))

import { execFile } from 'node:child_process'
import { GitHubService } from '../electron/main/services/GitHubService'
import type { ProjectService } from '../electron/main/services/ProjectService'

const simpleGitMock = vi.mocked(simpleGit)
const execFileMock = vi.mocked(execFile)

function makeProjects(path = '/tmp/proj'): ProjectService {
  return { get: vi.fn(() => ({ path })) } as unknown as ProjectService
}

/** Stand-in for the subset of simple-git used by status()'s post-create refresh. */
function fakeGitNoRemote() {
  return {
    getRemotes: vi.fn(() => Promise.resolve([])),
    branch: vi.fn(() => Promise.resolve({ current: 'main' })),
  }
}

/** Node-style callback shape `promisify(execFile)` expects: (...args, callback). */
function respondWith(err: unknown, result: { stdout: string; stderr: string } = { stdout: '', stderr: '' }) {
  return ((...allArgs: unknown[]) => {
    const callback = allArgs[allArgs.length - 1] as (e: unknown, r?: unknown) => void
    callback(err, err ? undefined : result)
    return {} as never
  }) as unknown as typeof execFile
}

beforeEach(() => {
  simpleGitMock.mockReset()
  execFileMock.mockReset()
})

describe('GitHubService.createRepo', () => {
  it('runs gh repo create with the requested name/visibility and returns refreshed status', async () => {
    simpleGitMock.mockReturnValue(fakeGitNoRemote() as unknown as SimpleGit)
    execFileMock.mockImplementation(respondWith(null))

    const service = new GitHubService(makeProjects('/tmp/proj'))
    const result = await service.createRepo({
      projectId: 'prj_1',
      name: 'my-repo',
      visibility: 'private',
    })

    expect(execFileMock).toHaveBeenCalledTimes(1)
    const [, args, options] = execFileMock.mock.calls[0]
    expect(args).toEqual(['repo', 'create', 'my-repo', '--private', '--source=.', '--remote=origin'])
    expect(options).toMatchObject({ cwd: '/tmp/proj' })
    // No remote/auth stub is wired for the post-create status() call, so it
    // resolves cleanly to "no remote found" rather than throwing.
    expect(result.remote).toBeNull()
  })

  it('appends --description when provided', async () => {
    simpleGitMock.mockReturnValue(fakeGitNoRemote() as unknown as SimpleGit)
    execFileMock.mockImplementation(respondWith(null))

    const service = new GitHubService(makeProjects())
    await service.createRepo({
      projectId: 'prj_1',
      name: 'my-repo',
      visibility: 'public',
      description: 'A new project',
    })

    const [, args] = execFileMock.mock.calls[0]
    expect(args).toEqual([
      'repo',
      'create',
      'my-repo',
      '--public',
      '--source=.',
      '--remote=origin',
      '--description',
      'A new project',
    ])
  })

  it('wraps a gh CLI failure with context', async () => {
    simpleGitMock.mockReturnValue(fakeGitNoRemote() as unknown as SimpleGit)
    execFileMock.mockImplementation(
      respondWith(Object.assign(new Error('exit 1'), { stderr: 'name already exists on this account' })),
    )

    const service = new GitHubService(makeProjects())
    await expect(
      service.createRepo({ projectId: 'prj_1', name: 'taken', visibility: 'public' }),
    ).rejects.toThrow(/name already exists on this account/)
  })
})
