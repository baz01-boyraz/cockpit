import { appendFileSync, existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { simpleGit, type SimpleGit } from 'simple-git'
import { cardBranch } from '@shared/kanban'

export const WORKTREES_DIR = '.cockpit-worktrees'

/**
 * Grace window a worktree directory must age past before the boot prune will
 * even consider it an orphan. Race guard (argos MEDIUM): the live-set is read
 * from card rows BEFORE `readdirSync`, so a worktree `startCard` created in that
 * window is on disk (clean) but not yet in the DB — it would look orphaned and
 * get removed. mtime is the portable, test-controllable freshness signal
 * (`birthtime` cannot be backdated on macOS); anything touched within the window
 * is left for the next sweep, by which time its card row has surely persisted.
 */
export const WORKTREE_PRUNE_GRACE_MS = 120_000

/**
 * Outcome of a boot-time prune sweep (plan A1). Every enumerated worktree lands
 * in exactly one bucket, so the caller can audit precisely what happened:
 * - `pruned`     — clean orphan worktrees that were removed.
 * - `keptDirty`  — orphans left in place (uncommitted work or un-removable): the
 *                  invariant that dirty work is NEVER force-deleted holds here.
 * - `keptLive`   — worktrees a still-live card owns, excluded from the sweep.
 * - `keptYoung`  — orphan-looking dirs younger than {@link WORKTREE_PRUNE_GRACE_MS},
 *                  left untouched so a just-created-but-not-yet-persisted worktree
 *                  is never mistaken for a leak (see the const's doc).
 * - `branchesDeleted` — `swarm/<slug>` branches collected after their worktree
 *                  was clean-removed AND they had no unique/unmerged commits.
 * All paths are absolute (resolved).
 */
export interface PruneSummary {
  pruned: string[]
  keptDirty: string[]
  keptLive: string[]
  keptYoung: string[]
  branchesDeleted: string[]
}

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

  /** Whether a persisted worktree directory is still present on disk (plan A3). */
  exists(worktreePath: string): boolean {
    return existsSync(worktreePath)
  }

  /**
   * Re-attach a worktree whose directory vanished while its card row survived
   * (plan A3 — a resumed card must never spawn into a dead cwd). Stale git
   * bookkeeping for the missing dir is pruned first; the branch is reused when it
   * still exists (committed work is preserved) and freshly created otherwise.
   */
  async restore(
    projectPath: string,
    worktreePath: string,
    branch: string,
  ): Promise<{ path: string; branch: string }> {
    const root = resolve(projectPath, WORKTREES_DIR) + sep
    if (!resolve(worktreePath).startsWith(root)) throw new Error('Not a swarm worktree path.')
    const git = simpleGit({ baseDir: projectPath })
    // The dir is gone, but git may still hold an administrative entry for it —
    // clear it so `worktree add` doesn't refuse on a stale registration.
    await git.raw(['worktree', 'prune'])
    const local = await git.branchLocal()
    if (local.all.includes(branch)) {
      await git.raw(['worktree', 'add', worktreePath, branch])
    } else {
      await git.raw(['worktree', 'add', worktreePath, '-b', branch])
    }
    this.ensureExcluded(projectPath)
    return { path: worktreePath, branch }
  }

  /**
   * Boot-time sweep (plan A1): reclaim worktrees leaked by crashed/parked/
   * abandoned cards. Steps: drop stale git bookkeeping (`git worktree prune`),
   * enumerate `<project>/.cockpit-worktrees/`, and for each dir either keep it
   * (a live card owns it), clean-remove it (orphan, `removeIfClean` — dirty work
   * is reported, NEVER force-deleted), or additionally collect its
   * `swarm/<slug>` branch when the branch has no unique/unmerged commits.
   *
   * `liveWorktreePaths` is supplied by the caller (SwarmService owns the card
   * rows) so this class stays free of the DB layer.
   */
  async prune(projectPath: string, liveWorktreePaths: readonly string[]): Promise<PruneSummary> {
    const summary: PruneSummary = {
      pruned: [],
      keptDirty: [],
      keptLive: [],
      keptYoung: [],
      branchesDeleted: [],
    }
    const git = simpleGit({ baseDir: projectPath })
    // Reclaim administrative entries for worktrees whose dirs already vanished.
    await git.raw(['worktree', 'prune'])

    const root = resolve(projectPath, WORKTREES_DIR)
    if (!existsSync(root)) return summary

    const live = new Set(liveWorktreePaths.map((p) => resolve(p)))
    const branchByPath = await this.worktreeBranches(git)
    const entries = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory())

    for (const entry of entries) {
      const target = resolve(root, entry.name)
      if (live.has(target)) {
        summary.keptLive.push(target)
        continue
      }
      // Race guard: a worktree younger than the grace window may be one
      // `startCard` just created but has not yet written its card row (the live
      // set was snapshotted before this readdir). Leave it for the next sweep
      // rather than delete work that is only momentarily "orphaned".
      if (this.ageMs(target) < WORKTREE_PRUNE_GRACE_MS) {
        summary.keptYoung.push(target)
        continue
      }
      // Resolve the branch BEFORE removal — the dir (and its git bookkeeping)
      // is gone afterwards. `git worktree list` reports canonical (symlink-
      // resolved) paths, so match the map on the real path; the create()
      // invariant (dir basename === branch suffix) is the fallback.
      const branch = branchByPath.get(this.canonical(target)) ?? `swarm/${entry.name}`
      try {
        await this.removeIfClean(projectPath, target)
      } catch {
        // Dirty (uncommitted work) or otherwise un-removable — kept and reported,
        // never force-deleted. The human decides what to do with it.
        summary.keptDirty.push(target)
        continue
      }
      summary.pruned.push(target)
      if (branch.startsWith('swarm/') && (await this.tryDeleteBranch(git, branch))) {
        summary.branchesDeleted.push(branch)
      }
    }
    return summary
  }

  /**
   * Milliseconds since the directory was last written (mtime). mtime is the
   * portable freshness signal — `birthtime` is unreliable across filesystems and
   * cannot be backdated in tests — and `git worktree add` writes the dir at
   * creation, so a fresh worktree's mtime is effectively its creation time. On
   * any stat failure the dir is treated as old (Infinity) so a vanished/unreadable
   * entry falls through to the normal removal path rather than being kept forever.
   */
  private ageMs(path: string): number {
    try {
      return Date.now() - statSync(path).mtimeMs
    } catch {
      return Number.POSITIVE_INFINITY
    }
  }

  /** Symlink-resolved absolute path, falling back to a plain resolve on error. */
  private canonical(path: string): string {
    try {
      return realpathSync(path)
    } catch {
      return resolve(path)
    }
  }

  /** Map of absolute worktree path → checked-out branch from `worktree list`. */
  private async worktreeBranches(git: SimpleGit): Promise<Map<string, string>> {
    const map = new Map<string, string>()
    try {
      const out = await git.raw(['worktree', 'list', '--porcelain'])
      const REFS = 'refs/heads/'
      let current: string | null = null
      for (const line of out.split('\n')) {
        if (line.startsWith('worktree ')) {
          current = resolve(line.slice('worktree '.length).trim())
        } else if (line.startsWith('branch ') && current) {
          const ref = line.slice('branch '.length).trim()
          map.set(current, ref.startsWith(REFS) ? ref.slice(REFS.length) : ref)
        }
      }
    } catch {
      // Best effort — no branch map just means no branch cleanup this sweep.
    }
    return map
  }

  /**
   * Safe branch delete: `git branch -d` refuses a branch with commits not merged
   * into HEAD/upstream, so unique committed work is never lost. Returns whether
   * the branch was actually deleted; a refusal (or any error) keeps it — the
   * conservative default demanded by plan A1.
   */
  private async tryDeleteBranch(git: SimpleGit, branch: string): Promise<boolean> {
    try {
      await git.raw(['branch', '-d', branch])
      return true
    } catch {
      return false
    }
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
