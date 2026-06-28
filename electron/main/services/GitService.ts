import { simpleGit, type SimpleGit, type StatusResult } from 'simple-git'
import type {
  GitCommitResult,
  GitDiff,
  GitFileEntry,
  GitFileState,
  GitPushResult,
  GitSnapshot,
} from '@shared/domain'
import type { Db } from '../db/Database'
import type { ProjectService } from './ProjectService'
import { newId, nowIso } from '../util/ids'

/**
 * Read/inspect git state for a project via simple-git, plus a real `push` for
 * the developer's own loop. A regular push runs directly; force-push uses
 * `--force-with-lease` and stays behind the approval gate elsewhere because it
 * can rewrite remote history.
 */
export class GitService {
  constructor(
    private readonly db: Db,
    private readonly projects: ProjectService,
  ) {}

  private gitFor(projectId: string): SimpleGit {
    const project = this.projects.get(projectId)
    return simpleGit({ baseDir: project.path })
  }

  async status(projectId: string): Promise<GitSnapshot> {
    const git = this.gitFor(projectId)
    const isRepo = await git.checkIsRepo().catch(() => false)
    if (!isRepo) {
      return this.emptySnapshot(projectId, 'no-git')
    }

    const status = await git.status()
    const files = this.mapFiles(status)
    const staged = files.filter((f) => f.state === 'staged').length
    const unstaged = files.filter((f) => f.state === 'unstaged' || f.state === 'conflicted').length
    const untracked = files.filter((f) => f.state === 'untracked').length

    const snapshot: GitSnapshot = {
      id: newId('git'),
      projectId,
      branch: status.current ?? 'detached',
      ahead: status.ahead,
      behind: status.behind,
      changedFilesCount: files.length,
      stagedCount: staged,
      unstagedCount: unstaged,
      untrackedCount: untracked,
      files,
      createdAt: nowIso(),
    }
    this.persist(snapshot)
    return snapshot
  }

  async diff(input: { projectId: string; path: string; staged?: boolean }): Promise<GitDiff> {
    const git = this.gitFor(input.projectId)
    const isRepo = await git.checkIsRepo().catch(() => false)
    if (!isRepo) return { path: input.path, hunks: '', binary: false }

    const args = input.staged ? ['--staged', '--', input.path] : ['--', input.path]
    let hunks = ''
    try {
      hunks = await git.diff(args)
      if (!hunks && !input.staged) {
        // untracked file: show its contents as an additive diff approximation
        const show = await git.raw(['status', '--porcelain', '--', input.path]).catch(() => '')
        if (show.startsWith('??')) hunks = '(untracked file — not yet staged)'
      }
    } catch {
      hunks = ''
    }
    return { path: input.path, hunks, binary: hunks.includes('Binary files') }
  }

  async stage(input: { projectId: string; paths?: string[]; all?: boolean }): Promise<GitSnapshot> {
    const git = this.gitFor(input.projectId)
    const isRepo = await git.checkIsRepo().catch(() => false)
    if (!isRepo) return this.emptySnapshot(input.projectId, 'no-git')

    if (input.all) {
      await git.add(['--all'])
    } else {
      await git.add(input.paths ?? [])
    }
    return this.status(input.projectId)
  }

  async commit(input: { projectId: string; message: string }): Promise<GitCommitResult> {
    const before = await this.status(input.projectId)
    if (before.stagedCount === 0) {
      throw new Error('No staged files to commit.')
    }

    const git = this.gitFor(input.projectId)
    const result = await git.commit(input.message)
    const commitHash = result.commit || (await git.revparse(['HEAD']).catch(() => null))
    await this.status(input.projectId)
    return {
      branch: before.branch,
      commitHash,
      summary: input.message,
      filesChanged: before.stagedCount,
    }
  }

  async push(input: { projectId: string; force?: boolean }): Promise<GitPushResult> {
    const git = this.gitFor(input.projectId)
    const isRepo = await git.checkIsRepo().catch(() => false)
    if (!isRepo) throw new Error('Not a git repository.')

    const status = await git.status()
    const branch = status.current
    if (!branch || branch === 'detached') {
      throw new Error('Cannot push from a detached HEAD. Check out a branch first.')
    }
    if (!input.force && status.ahead === 0) {
      throw new Error('Nothing to push — branch is already up to date with origin.')
    }

    const args = ['push']
    if (input.force) args.push('--force-with-lease')
    // First push of a new branch has no upstream — set it so future pushes are bare.
    if (!status.tracking) args.push('--set-upstream', 'origin', branch)

    try {
      await git.raw(args)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new Error(`git push failed: ${message.trim()}`)
    }

    const after = await this.status(input.projectId)
    return {
      branch,
      remote: 'origin',
      forced: Boolean(input.force),
      ahead: after.ahead,
      behind: after.behind,
      pushedAt: nowIso(),
    }
  }

  private mapFiles(status: StatusResult): GitFileEntry[] {
    return status.files.map((f) => {
      const index = f.index?.trim() ?? ''
      const working = f.working_dir?.trim() ?? ''
      let state: GitFileState = 'unstaged'
      if (index === '?' && working === '?') state = 'untracked'
      else if (index === 'U' || working === 'U') state = 'conflicted'
      else if (index && index !== ' ') state = 'staged'
      else state = 'unstaged'
      return { path: f.path, state, index: f.index ?? '', workingDir: f.working_dir ?? '' }
    })
  }

  private emptySnapshot(projectId: string, branch: string): GitSnapshot {
    return {
      id: newId('git'),
      projectId,
      branch,
      ahead: 0,
      behind: 0,
      changedFilesCount: 0,
      stagedCount: 0,
      unstagedCount: 0,
      untrackedCount: 0,
      files: [],
      createdAt: nowIso(),
    }
  }

  private persist(snapshot: GitSnapshot): void {
    this.db
      .prepare(
        `INSERT INTO git_snapshots
         (id, project_id, branch, changed_files_count, staged_count, unstaged_count, untracked_count, snapshot_json, created_at)
         VALUES (@id, @projectId, @branch, @changed, @staged, @unstaged, @untracked, @json, @createdAt)`,
      )
      .run({
        id: snapshot.id,
        projectId: snapshot.projectId,
        branch: snapshot.branch,
        changed: snapshot.changedFilesCount,
        staged: snapshot.stagedCount,
        unstaged: snapshot.unstagedCount,
        untracked: snapshot.untrackedCount,
        json: JSON.stringify(snapshot),
        createdAt: snapshot.createdAt,
      })
  }
}
