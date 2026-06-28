import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { simpleGit } from 'simple-git'
import type {
  GitHubAccount,
  GitHubPullRequest,
  GitHubReleaseInfo,
  GitHubRepositoryStatus,
  GitHubRunConclusion,
  GitHubWorkflowRun,
  GitRemoteInfo,
} from '@shared/domain'
import { nowIso } from '../util/ids'
import type { ProjectService } from './ProjectService'
import { resolveBin } from './resolveBin'

const execFileAsync = promisify(execFile)

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function normaliseConclusion(value: unknown): GitHubRunConclusion {
  const s = asString(value)
  if (
    s === 'success' ||
    s === 'failure' ||
    s === 'cancelled' ||
    s === 'skipped' ||
    s === 'timed_out' ||
    s === 'action_required' ||
    s === 'neutral'
  ) {
    return s
  }
  return 'unknown'
}

function stripGitSuffix(repo: string): string {
  return repo.endsWith('.git') ? repo.slice(0, -4) : repo
}

function parseGitHubRemote(name: string, url: string): GitRemoteInfo {
  const trimmed = url.trim()
  const patterns = [
    /^git@github\.com:([^/]+)\/(.+)$/,
    /^ssh:\/\/git@github\.com\/([^/]+)\/(.+)$/,
    /^https:\/\/github\.com\/([^/]+)\/(.+)$/,
  ]

  for (const pattern of patterns) {
    const match = trimmed.match(pattern)
    if (!match) continue
    const owner = match[1]
    const repo = stripGitSuffix(match[2])
    return {
      name,
      url: trimmed,
      provider: 'github',
      owner,
      repo,
      webUrl: `https://github.com/${owner}/${repo}`,
    }
  }

  return {
    name,
    url: trimmed,
    provider: 'other',
    owner: null,
    repo: null,
    webUrl: null,
  }
}

export class GitHubService {
  constructor(private readonly projects: ProjectService) {}

  async status(projectId: string): Promise<GitHubRepositoryStatus> {
    const project = this.projects.get(projectId)
    const git = simpleGit({ baseDir: project.path })
    const remote = await this.resolveRemote(git)
    const branch = await git.branch().then((b) => b.current).catch(() => null)
    const fetchedAt = nowIso()

    if (!remote || remote.provider !== 'github' || !remote.owner || !remote.repo) {
      return {
        connected: false,
        authState: 'unknown',
        account: null,
        remote,
        repository: null,
        openPullRequest: null,
        latestWorkflowRun: null,
        latestRelease: null,
        error: remote ? 'Remote is not a GitHub repository.' : 'No git remote found.',
        fetchedAt,
      }
    }

    const auth = await this.authState(project.path)
    if (auth !== 'authenticated') {
      return {
        connected: true,
        authState: auth,
        account: null,
        remote,
        repository: {
          owner: remote.owner,
          name: remote.repo,
          fullName: `${remote.owner}/${remote.repo}`,
          private: null,
          defaultBranch: null,
          htmlUrl: remote.webUrl,
          description: null,
        },
        openPullRequest: null,
        latestWorkflowRun: null,
        latestRelease: null,
        error:
          auth === 'invalid'
            ? 'GitHub CLI auth is invalid. Run gh auth login to reconnect.'
            : 'GitHub CLI is not authenticated.',
        fetchedAt,
      }
    }

    const [account, repository, pullRequest, workflowRun, release] = await Promise.all([
      this.account(project.path),
      this.repository(project.path, remote.owner, remote.repo),
      branch ? this.openPullRequest(project.path, remote.owner, remote.repo, branch) : Promise.resolve(null),
      branch ? this.latestWorkflowRun(project.path, remote.owner, remote.repo, branch) : Promise.resolve(null),
      this.latestRelease(project.path, remote.owner, remote.repo),
    ])

    return {
      connected: true,
      authState: 'authenticated',
      account,
      remote,
      repository: repository ?? {
        owner: remote.owner,
        name: remote.repo,
        fullName: `${remote.owner}/${remote.repo}`,
        private: null,
        defaultBranch: null,
        htmlUrl: remote.webUrl,
        description: null,
      },
      openPullRequest: pullRequest,
      latestWorkflowRun: workflowRun,
      latestRelease: release,
      error: null,
      fetchedAt,
    }
  }

  private async resolveRemote(git: ReturnType<typeof simpleGit>): Promise<GitRemoteInfo | null> {
    const remotes = await git.getRemotes(true).catch(() => [])
    const origin = remotes.find((r) => r.name === 'origin') ?? remotes[0]
    const url = origin?.refs.push || origin?.refs.fetch
    if (!origin || !url) return null
    return parseGitHubRemote(origin.name, url)
  }

  private async authState(cwd: string): Promise<GitHubRepositoryStatus['authState']> {
    try {
      await execFileAsync(resolveBin('gh'), ['auth', 'status', '-h', 'github.com'], {
        cwd,
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env },
      })
      return 'authenticated'
    } catch (err) {
      const e = err as { stderr?: string; stdout?: string; code?: number; message?: string }
      const output = `${e.stdout ?? ''}\n${e.stderr ?? ''}\n${e.message ?? ''}`.toLowerCase()
      if (output.includes('invalid') || output.includes('failed to log in')) return 'invalid'
      if (output.includes('not logged into') || output.includes('no oauth token')) return 'missing'
      if (output.includes('enoent') || output.includes('not found')) return 'missing'
      return 'unknown'
    }
  }

  private async ghJson<T>(cwd: string, endpoint: string): Promise<T | null> {
    try {
      const { stdout } = await execFileAsync(resolveBin('gh'), ['api', endpoint], {
        cwd,
        timeout: 15_000,
        maxBuffer: 4 * 1024 * 1024,
        env: { ...process.env },
      })
      return JSON.parse(stdout) as T
    } catch {
      return null
    }
  }

  private async account(cwd: string): Promise<GitHubAccount | null> {
    const raw = await this.ghJson(cwd, 'user')
    const user = asRecord(raw)
    if (!user) return null
    const login = asString(user['login'])
    if (!login) return null
    return {
      login,
      name: asString(user['name']),
      avatarUrl: asString(user['avatar_url']),
      htmlUrl: asString(user['html_url']),
    }
  }

  private async repository(
    cwd: string,
    owner: string,
    repo: string,
  ): Promise<GitHubRepositoryStatus['repository'] | null> {
    const raw = await this.ghJson(cwd, `repos/${owner}/${repo}`)
    const r = asRecord(raw)
    if (!r) return null
    const name = asString(r['name']) ?? repo
    return {
      owner,
      name,
      fullName: asString(r['full_name']) ?? `${owner}/${name}`,
      private: asBoolean(r['private']),
      defaultBranch: asString(r['default_branch']),
      htmlUrl: asString(r['html_url']),
      description: asString(r['description']),
    }
  }

  private async openPullRequest(
    cwd: string,
    owner: string,
    repo: string,
    branch: string,
  ): Promise<GitHubPullRequest | null> {
    const head = encodeURIComponent(`${owner}:${branch}`)
    const raw = await this.ghJson(cwd, `repos/${owner}/${repo}/pulls?head=${head}&state=open&per_page=1`)
    const pr = Array.isArray(raw) ? asRecord(raw[0]) : null
    if (!pr) return null
    const number = asNumber(pr['number'])
    const title = asString(pr['title'])
    const htmlUrl = asString(pr['html_url'])
    if (!number || !title || !htmlUrl) return null
    return {
      number,
      title,
      state: pr['state'] === 'closed' ? 'closed' : 'open',
      htmlUrl,
      draft: asBoolean(pr['draft']) ?? false,
    }
  }

  private async latestWorkflowRun(
    cwd: string,
    owner: string,
    repo: string,
    branch: string,
  ): Promise<GitHubWorkflowRun | null> {
    const raw = await this.ghJson(
      cwd,
      `repos/${owner}/${repo}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=1`,
    )
    const payload = asRecord(raw)
    const run = Array.isArray(payload?.['workflow_runs']) ? asRecord(payload?.['workflow_runs'][0]) : null
    if (!run) return null
    const id = asNumber(run['id'])
    const name = asString(run['name'])
    const htmlUrl = asString(run['html_url'])
    if (!id || !name || !htmlUrl) return null
    return {
      id,
      name,
      status: asString(run['status']) ?? 'unknown',
      conclusion: normaliseConclusion(run['conclusion']),
      htmlUrl,
      createdAt: asString(run['created_at']),
    }
  }

  private async latestRelease(cwd: string, owner: string, repo: string): Promise<GitHubReleaseInfo | null> {
    const raw = await this.ghJson(cwd, `repos/${owner}/${repo}/releases/latest`)
    const release = asRecord(raw)
    if (!release) return null
    const tagName = asString(release['tag_name'])
    const htmlUrl = asString(release['html_url'])
    if (!tagName || !htmlUrl) return null
    return {
      tagName,
      name: asString(release['name']),
      htmlUrl,
      publishedAt: asString(release['published_at']),
    }
  }
}
