import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SwarmWorktrees, WORKTREES_DIR } from '../electron/main/services/SwarmWorktrees'

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, stdio: 'pipe' }).toString()

/**
 * Backdate a directory's mtime past the prune grace window so it reads as a
 * genuine old orphan. Freshly-created worktrees are within the window (that is
 * the race guard); a test that wants the classic remove/keep behaviour must age
 * the dir first, exactly as the real world would after minutes have passed.
 */
const ageDir = (dir: string) => {
  const past = new Date(Date.now() - 10 * 60 * 1000)
  utimesSync(dir, past, past)
}

describe('SwarmWorktrees against a real scratch repo', () => {
  let repo: string
  const wt = new SwarmWorktrees()

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'cockpit-wt-'))
    git(repo, 'init', '-b', 'main')
    git(repo, 'config', 'user.email', 'test@cockpit.local')
    git(repo, 'config', 'user.name', 'cockpit-test')
    writeFileSync(join(repo, 'README.md'), 'scratch\n')
    git(repo, 'add', '.')
    git(repo, 'commit', '-m', 'init')
  })

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  it('creates a worktree on a swarm branch and hides the dir via info/exclude', async () => {
    const { path, branch } = await wt.create(repo, 'Fix the thing', 'card_ab12cd34')
    expect(branch).toBe('swarm/fix-the-thing-cd34')
    expect(existsSync(join(path, 'README.md'))).toBe(true)
    expect(git(path, 'rev-parse', '--abbrev-ref', 'HEAD').trim()).toBe(branch)
    expect(readFileSync(join(repo, '.git', 'info', 'exclude'), 'utf8')).toContain(
      `${WORKTREES_DIR}/`,
    )
    // The main working tree stays clean from git's point of view.
    expect(git(repo, 'status', '--porcelain').trim()).toBe('')
  })

  it('refuses to remove a dirty worktree, then removes it once clean — branch survives', async () => {
    const { path, branch } = await wt.create(repo, 'Risky work', 'card_ef56ab78')
    writeFileSync(join(path, 'wip.txt'), 'uncommitted\n')
    await expect(wt.removeIfClean(repo, path)).rejects.toThrow(/uncommitted/)
    expect(existsSync(path)).toBe(true)

    git(path, 'add', '.')
    git(path, 'commit', '-m', 'work saved')
    await wt.removeIfClean(repo, path)
    expect(existsSync(path)).toBe(false)
    expect(git(repo, 'branch', '--list', branch).trim()).toContain(branch)
  })

  it('refuses paths outside the swarm worktrees dir', async () => {
    await expect(wt.removeIfClean(repo, repo)).rejects.toThrow(/Not a swarm worktree/)
    await expect(wt.removeIfClean(repo, '/etc')).rejects.toThrow(/Not a swarm worktree/)
  })

  it('prune: removes an orphan worktree and deletes its fully-merged branch', async () => {
    const { path, branch } = await wt.create(repo, 'Orphan task', 'card_orph0001')
    // No commits → the branch sits at main's tip, so it is fully merged.
    ageDir(path) // past the grace window: a real, settled orphan
    const summary = await wt.prune(repo, [])
    expect(summary.pruned).toContain(resolve(path))
    expect(summary.branchesDeleted).toContain(branch)
    expect(summary.keptDirty).toEqual([])
    expect(existsSync(path)).toBe(false)
    expect(git(repo, 'branch', '--list', branch).trim()).toBe('')
  })

  it('prune: keeps a dirty orphan worktree and never force-deletes it', async () => {
    const { path, branch } = await wt.create(repo, 'Dirty task', 'card_dirt0001')
    writeFileSync(join(path, 'wip.txt'), 'uncommitted\n')
    ageDir(path) // age it AFTER writing, so it is an old dirty orphan, not a young one
    const summary = await wt.prune(repo, [])
    expect(summary.keptDirty).toContain(resolve(path))
    expect(summary.pruned).not.toContain(resolve(path))
    expect(existsSync(path)).toBe(true)
    // The branch survives with the worktree.
    expect(git(repo, 'branch', '--list', branch).trim()).toContain(branch)
  })

  it('prune: keeps a worktree owned by a live card out of the sweep', async () => {
    const { path } = await wt.create(repo, 'Live task', 'card_live0001')
    const summary = await wt.prune(repo, [path])
    expect(summary.keptLive).toContain(resolve(path))
    expect(summary.pruned).toEqual([])
    expect(existsSync(path)).toBe(true)
  })

  it('prune: spares a just-created (fresh mtime) orphan, then prunes it once aged', async () => {
    // Race guard: startCard may have created this worktree in the window between
    // the live-set snapshot and readdir, so it is on disk but not yet a card row.
    const { path } = await wt.create(repo, 'Fresh task', 'card_fresh001')
    const first = await wt.prune(repo, [])
    expect(first.keptYoung).toContain(resolve(path))
    expect(first.pruned).not.toContain(resolve(path))
    expect(existsSync(path)).toBe(true)

    // Once the dir ages past the grace window it is a genuine orphan and pruned.
    ageDir(path)
    const second = await wt.prune(repo, [])
    expect(second.pruned).toContain(resolve(path))
    expect(second.keptYoung).not.toContain(resolve(path))
    expect(existsSync(path)).toBe(false)
  })

  it('prune: removes a clean orphan but conservatively keeps its unmerged branch', async () => {
    const { path, branch } = await wt.create(repo, 'Unmerged task', 'card_unmg0001')
    writeFileSync(join(path, 'feature.txt'), 'shipped\n')
    git(path, 'add', '.')
    git(path, 'commit', '-m', 'feature work')
    ageDir(path) // settled orphan, past the grace window
    const summary = await wt.prune(repo, [])
    // The working tree is clean, so the worktree is removed...
    expect(summary.pruned).toContain(resolve(path))
    expect(existsSync(path)).toBe(false)
    // ...but the branch carries commits not in main, so it is kept.
    expect(summary.branchesDeleted).not.toContain(branch)
    expect(git(repo, 'branch', '--list', branch).trim()).toContain(branch)
  })

  it('prune: clears a stale registration whose directory vanished out-of-band', async () => {
    const { path, branch } = await wt.create(repo, 'Vanished task', 'card_vani0001')
    // Simulate a crash that deleted the dir but left git's administrative entry.
    rmSync(path, { recursive: true, force: true })
    const summary = await wt.prune(repo, [])
    // The dir is already gone — nothing to report as pruned/kept — but the
    // stale registration is cleared and the merged branch is collectable.
    expect(summary.keptDirty).toEqual([])
    expect(summary.keptLive).toEqual([])
    expect(git(repo, 'worktree', 'list')).not.toContain(branch)
  })
})
