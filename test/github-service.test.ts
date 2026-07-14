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

function fakeGitRemote(url: string, branch = 'main', name = 'origin') {
  return {
    getRemotes: vi.fn(() => Promise.resolve([{
      name,
      refs: { fetch: url, push: url },
    }])),
    branch: vi.fn(() => Promise.resolve({ current: branch })),
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

function respondBy(
  handler: (args: string[]) => { error?: unknown; stdout?: string; stderr?: string },
) {
  return ((...allArgs: unknown[]) => {
    const args = allArgs[1] as string[]
    const callback = allArgs[allArgs.length - 1] as (e: unknown, r?: unknown) => void
    const result = handler(args)
    callback(
      result.error ?? null,
      result.error
        ? undefined
        : { stdout: result.stdout ?? '', stderr: result.stderr ?? '' },
    )
    return {} as never
  }) as unknown as typeof execFile
}

function authenticatedGh(responses: Record<string, unknown>) {
  return respondBy((args) => {
    if (args[0] === 'auth') return {}
    if (args[0] === 'api' && args[1] in responses) {
      return { stdout: JSON.stringify(responses[args[1]]) }
    }
    return { error: new Error(`unexpected gh call: ${args.join(' ')}`) }
  })
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

  it.each([
    [{ stdout: 'stdout detail' }, 'stdout detail'],
    [{ message: 'message detail' }, 'message detail'],
    ['raw failure', 'raw failure'],
  ])('preserves the best available gh failure detail from %o', async (failure, detail) => {
    execFileMock.mockImplementation(respondWith(failure))

    const service = new GitHubService(makeProjects())
    await expect(
      service.createRepo({ projectId: 'prj_1', name: 'broken', visibility: 'private' }),
    ).rejects.toThrow(detail)
  })
})

describe('GitHubService.status', () => {
  it('reports a non-GitHub remote without trying to authenticate', async () => {
    const git = fakeGitRemote('git@gitlab.com:acme/widget.git')
    git.branch.mockRejectedValueOnce(new Error('detached head'))
    simpleGitMock.mockReturnValue(git as unknown as SimpleGit)

    const result = await new GitHubService(makeProjects()).status('prj_1')

    expect(result).toMatchObject({
      connected: false,
      authState: 'unknown',
      error: 'Remote is not a GitHub repository.',
      remote: { provider: 'other', owner: null, repo: null, webUrl: null },
    })
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it.each([
    ['git@github.com:acme/widget.git', 'acme', 'widget'],
    ['ssh://git@github.com/acme/widget', 'acme', 'widget'],
    ['https://github.com/acme/widget.git', 'acme', 'widget'],
  ])('parses %s and reports missing authentication', async (url, owner, repo) => {
    simpleGitMock.mockReturnValue(fakeGitRemote(`  ${url}  `) as unknown as SimpleGit)
    execFileMock.mockImplementation(respondBy(() => ({
      error: Object.assign(new Error('not logged into github.com'), { stderr: 'no oauth token' }),
    })))

    const result = await new GitHubService(makeProjects()).status('prj_1')

    expect(result).toMatchObject({
      connected: true,
      authState: 'missing',
      remote: {
        name: 'origin',
        url,
        provider: 'github',
        owner,
        repo,
        webUrl: `https://github.com/${owner}/${repo}`,
      },
      repository: {
        owner,
        name: repo,
        fullName: `${owner}/${repo}`,
      },
      error: 'GitHub CLI is not authenticated.',
    })
  })

  it('returns a complete authenticated repository snapshot', async () => {
    simpleGitMock.mockReturnValue(
      fakeGitRemote('git@github.com:acme/widget.git', 'feature/live capture') as unknown as SimpleGit,
    )
    execFileMock.mockImplementation(authenticatedGh({
      user: {
        login: 'octocat',
        name: 'Octo Cat',
        avatar_url: 'https://images.example/octo.png',
        html_url: 'https://github.com/octocat',
      },
      'repos/acme/widget': {
        name: 'widget-app',
        full_name: 'acme/widget-app',
        private: true,
        default_branch: 'main',
        html_url: 'https://github.com/acme/widget-app',
        description: 'Useful widgets',
      },
      'repos/acme/widget/pulls?head=acme%3Afeature%2Flive%20capture&state=open&per_page=1': [{
        number: 42,
        title: 'Live Memory capture',
        html_url: 'https://github.com/acme/widget/pull/42',
        state: 'closed',
        draft: true,
      }],
      'repos/acme/widget/actions/runs?branch=feature%2Flive%20capture&per_page=1': {
        workflow_runs: [{
          id: 9001,
          name: 'release',
          status: 'completed',
          conclusion: 'success',
          html_url: 'https://github.com/acme/widget/actions/runs/9001',
          created_at: '2026-07-13T00:00:00.000Z',
        }],
      },
      'repos/acme/widget/releases/latest': {
        tag_name: 'v1.2.3',
        name: 'Stable',
        html_url: 'https://github.com/acme/widget/releases/tag/v1.2.3',
        published_at: '2026-07-12T00:00:00.000Z',
      },
    }))

    const result = await new GitHubService(makeProjects('/work/widget')).status('prj_1')

    expect(result).toMatchObject({
      connected: true,
      authState: 'authenticated',
      account: { login: 'octocat', name: 'Octo Cat' },
      repository: { name: 'widget-app', private: true, defaultBranch: 'main' },
      openPullRequest: { number: 42, state: 'closed', draft: true },
      latestWorkflowRun: { id: 9001, status: 'completed', conclusion: 'success' },
      latestRelease: { tagName: 'v1.2.3', name: 'Stable' },
      error: null,
    })
  })

  it('uses safe fallbacks for partial GitHub API payloads', async () => {
    simpleGitMock.mockReturnValue(
      fakeGitRemote('https://github.com/acme/widget', 'feature') as unknown as SimpleGit,
    )
    execFileMock.mockImplementation(authenticatedGh({
      user: { login: 'octocat', name: 123, avatar_url: false },
      'repos/acme/widget': { private: 'yes' },
      'repos/acme/widget/pulls?head=acme%3Afeature&state=open&per_page=1': [{
        number: 7,
        title: 'Ready',
        html_url: 'https://github.com/acme/widget/pull/7',
        state: 'open',
        draft: 'no',
      }],
      'repos/acme/widget/actions/runs?branch=feature&per_page=1': {
        workflow_runs: [{
          id: 8,
          name: 'checks',
          html_url: 'https://github.com/acme/widget/actions/runs/8',
          conclusion: 'surprise',
        }],
      },
      'repos/acme/widget/releases/latest': {
        tag_name: 'v0.0.1',
        html_url: 'https://github.com/acme/widget/releases/tag/v0.0.1',
      },
    }))

    const result = await new GitHubService(makeProjects()).status('prj_1')

    expect(result.account).toEqual({ login: 'octocat', name: null, avatarUrl: null, htmlUrl: null })
    expect(result.repository).toEqual({
      owner: 'acme',
      name: 'widget',
      fullName: 'acme/widget',
      private: null,
      defaultBranch: null,
      htmlUrl: null,
      description: null,
    })
    expect(result.openPullRequest).toMatchObject({ state: 'open', draft: false })
    expect(result.latestWorkflowRun).toMatchObject({
      status: 'unknown',
      conclusion: 'unknown',
      createdAt: null,
    })
    expect(result.latestRelease).toMatchObject({ name: null, publishedAt: null })
  })

  it('contains malformed or failed API responses instead of failing status', async () => {
    simpleGitMock.mockReturnValue(
      fakeGitRemote('https://github.com/acme/widget.git', 'feature') as unknown as SimpleGit,
    )
    execFileMock.mockImplementation(respondBy((args) => {
      if (args[0] === 'auth') return {}
      if (args[1] === 'user') return { stdout: '{broken json' }
      if (args[1] === 'repos/acme/widget') return { stdout: JSON.stringify(null) }
      if (args[1]?.includes('/pulls?')) return { stdout: JSON.stringify([{ number: 0 }]) }
      if (args[1]?.includes('/actions/runs?')) return { stdout: JSON.stringify({ workflow_runs: [{}] }) }
      if (args[1]?.includes('/releases/latest')) return { error: new Error('404') }
      return { error: new Error('unexpected call') }
    }))

    const result = await new GitHubService(makeProjects()).status('prj_1')

    expect(result.account).toBeNull()
    expect(result.repository).toMatchObject({ owner: 'acme', name: 'widget' })
    expect(result.openPullRequest).toBeNull()
    expect(result.latestWorkflowRun).toBeNull()
    expect(result.latestRelease).toBeNull()
  })

  it('skips branch-scoped lookups and rejects identity-less account data', async () => {
    simpleGitMock.mockReturnValue(
      fakeGitRemote('https://github.com/acme/widget.git', '') as unknown as SimpleGit,
    )
    execFileMock.mockImplementation(authenticatedGh({
      user: {},
      'repos/acme/widget': {},
      'repos/acme/widget/releases/latest': {},
    }))

    const result = await new GitHubService(makeProjects()).status('prj_1')

    expect(result.account).toBeNull()
    expect(result.repository).toMatchObject({ name: 'widget', fullName: 'acme/widget' })
    expect(result.openPullRequest).toBeNull()
    expect(result.latestWorkflowRun).toBeNull()
    expect(result.latestRelease).toBeNull()
    expect(execFileMock.mock.calls.some((call) => (call[1] as string[])[1]?.includes('/pulls?'))).toBe(false)
    expect(execFileMock.mock.calls.some((call) => (call[1] as string[])[1]?.includes('/actions/runs?'))).toBe(false)
  })

  it('handles non-array branch-scoped API payloads', async () => {
    simpleGitMock.mockReturnValue(
      fakeGitRemote('https://github.com/acme/widget.git', 'feature') as unknown as SimpleGit,
    )
    execFileMock.mockImplementation(authenticatedGh({
      user: { login: 'octocat' },
      'repos/acme/widget': {},
      'repos/acme/widget/pulls?head=acme%3Afeature&state=open&per_page=1': null,
      'repos/acme/widget/actions/runs?branch=feature&per_page=1': { workflow_runs: null },
      'repos/acme/widget/releases/latest': {
        tag_name: 'v1',
        html_url: 'https://github.com/acme/widget/releases/tag/v1',
      },
    }))

    const result = await new GitHubService(makeProjects()).status('prj_1')

    expect(result.openPullRequest).toBeNull()
    expect(result.latestWorkflowRun).toBeNull()
  })

  it.each([
    ['token is invalid', 'invalid'],
    ['failed to log in to github.com', 'invalid'],
    ['not logged into github.com', 'missing'],
    ['no oauth token found', 'missing'],
    ['spawn gh ENOENT', 'missing'],
    ['temporary network error', 'unknown'],
  ] as const)('maps auth failure %s to %s', async (message, authState) => {
    simpleGitMock.mockReturnValue(fakeGitRemote('https://github.com/acme/widget.git') as unknown as SimpleGit)
    execFileMock.mockImplementation(respondBy(() => ({ error: new Error(message) })))

    const result = await new GitHubService(makeProjects()).status('prj_1')

    expect(result.authState).toBe(authState)
    expect(result.error).toBe(
      authState === 'invalid'
        ? 'GitHub CLI auth is invalid. Run gh auth login to reconnect.'
        : 'GitHub CLI is not authenticated.',
    )
  })

  it('classifies auth diagnostics carried on stdout and stderr', async () => {
    simpleGitMock.mockReturnValue(fakeGitRemote('https://github.com/acme/widget.git') as unknown as SimpleGit)
    execFileMock.mockImplementation(respondBy(() => ({
      error: {
        stdout: 'token is invalid',
        stderr: 'not logged into github.com',
      },
    })))

    const result = await new GitHubService(makeProjects()).status('prj_1')

    expect(result.authState).toBe('invalid')
  })

  it('uses the first available fetch-only remote when origin is absent', async () => {
    simpleGitMock.mockReturnValue({
      getRemotes: vi.fn(() => Promise.resolve([
        { name: 'upstream', refs: { fetch: 'https://github.com/acme/widget.git', push: '' } },
      ])),
      branch: vi.fn(() => Promise.resolve({ current: '' })),
    } as unknown as SimpleGit)
    execFileMock.mockImplementation(respondBy(() => ({ error: new Error('not logged into github.com') })))

    const result = await new GitHubService(makeProjects()).status('prj_1')

    expect(result.remote).toMatchObject({ name: 'upstream', owner: 'acme', repo: 'widget' })
    expect(result.openPullRequest).toBeNull()
    expect(result.latestWorkflowRun).toBeNull()
  })
})
