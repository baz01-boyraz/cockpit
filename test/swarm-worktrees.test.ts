import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SwarmWorktrees, WORKTREES_DIR } from '../electron/main/services/SwarmWorktrees'

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, stdio: 'pipe' }).toString()

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
})
