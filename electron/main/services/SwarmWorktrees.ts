import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { simpleGit } from 'simple-git'
import { cardBranch } from '@shared/kanban'

export const WORKTREES_DIR = '.cockpit-worktrees'

/**
 * Worktree lifecycle for parallel swarm cards (plan D4). Owned entirely by
 * the main process — the renderer only ever sees the resulting paths on the
 * card row. Rules: worktrees live under `<project>/.cockpit-worktrees/<slug>`
 * on a `swarm/<slug>` branch, are hidden from git via `.git/info/exclude`
 * (never a repo mutation), and are NEVER force-deleted: a dirty worktree
 * refuses removal and tells the human why. Branches are kept on removal —
 * committed work must survive the worktree.
 */
export class SwarmWorktrees {
  async create(
    projectPath: string,
    title: string,
    cardId: string,
  ): Promise<{ path: string; branch: string }> {
    const branch = cardBranch(title, cardId)
    const dir = join(projectPath, WORKTREES_DIR, branch.slice('swarm/'.length))
    await simpleGit({ baseDir: projectPath }).raw(['worktree', 'add', dir, '-b', branch])
    this.ensureExcluded(projectPath)
    return { path: dir, branch }
  }

  /** Refuses unless the worktree is clean; keeps the branch either way. */
  async removeIfClean(projectPath: string, worktreePath: string): Promise<void> {
    const root = resolve(projectPath, WORKTREES_DIR) + sep
    const target = resolve(worktreePath)
    if (!target.startsWith(root)) throw new Error('Not a swarm worktree path.')
    if (!existsSync(target)) return
    const status = await simpleGit({ baseDir: target }).status()
    if (status.files.length > 0) {
      throw new Error(
        'Worktree still has uncommitted changes — commit or discard them there first (never force-deleted).',
      )
    }
    await simpleGit({ baseDir: projectPath }).raw(['worktree', 'remove', target])
  }

  /** Hide the worktrees dir from git status without touching .gitignore. */
  private ensureExcluded(projectPath: string): void {
    try {
      const exclude = join(projectPath, '.git', 'info', 'exclude')
      const line = `${WORKTREES_DIR}/`
      const current = existsSync(exclude) ? readFileSync(exclude, 'utf8') : ''
      if (!current.split('\n').includes(line)) appendFileSync(exclude, `\n${line}\n`)
    } catch {
      // Best effort — a visible .cockpit-worktrees in git status is cosmetic.
    }
  }
}
