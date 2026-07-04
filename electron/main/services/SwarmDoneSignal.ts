import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'

/** Touched (via a Claude Code Stop hook) in the worktree root when the worker ends a turn. */
export const DONE_SENTINEL = '.cockpit-done'

/** The worktree-local Claude settings file that carries the Stop hook. */
const LOCAL_SETTINGS_REL = join('.claude', 'settings.local.json')

/**
 * The hook command. `$CLAUDE_PROJECT_DIR` is set by Claude Code when running
 * hooks; the `:-.` fallback keeps older CLIs writing into the hook's cwd
 * (the worktree) instead of the filesystem root.
 */
const HOOK_COMMAND = `touch "\${CLAUDE_PROJECT_DIR:-.}/${DONE_SENTINEL}"`

const HOOK_SETTINGS = {
  hooks: {
    Stop: [{ hooks: [{ type: 'command', command: HOOK_COMMAND }] }],
  },
}

/**
 * The deterministic "worker finished its turn" channel (the missing half of
 * the swarm lifecycle). The worker runs an INTERACTIVE `claude` session so the
 * human can keep talking to it — which means the pty never exits on its own
 * and `terminal:exit` alone leaves cards Running forever. Instead: `arm()`
 * installs a Claude Code Stop hook into the card's worktree that touches a
 * sentinel file whenever the worker ends a turn, and `consume()` (called from
 * the board read path) spends that sentinel to move the card to In review
 * while the terminal stays alive for follow-up conversation.
 *
 * This stays inside the design rule "worker status derives from exit codes +
 * git state, never from parsing model prose": a hook firing is a runtime fact,
 * not model output. Everything here is best-effort — a failure to arm simply
 * degrades to today's behavior (human moves the card).
 */
export class SwarmDoneSignal {
  /** Prepare a (re)starting worker's worktree: clear stale signals, install the hook, hide both files from git. */
  arm(projectPath: string, worktreePath: string): void {
    try {
      unlinkSync(join(worktreePath, DONE_SENTINEL))
    } catch {
      // No stale sentinel — the usual case.
    }
    this.installHook(worktreePath)
    this.ensureExcluded(projectPath)
  }

  /** True exactly once per signal: the sentinel exists and is spent (unlinked). */
  consume(worktreePath: string): boolean {
    const sentinel = join(worktreePath, DONE_SENTINEL)
    try {
      if (!existsSync(sentinel)) return false
      unlinkSync(sentinel)
      return true
    } catch {
      return false
    }
  }

  /**
   * Write the Stop hook into `<worktree>/.claude/settings.local.json`. The
   * file is conventionally machine-local (never checked in), so a fresh
   * worktree does not have one. An existing file is either ours from a
   * previous run (hook already installed) or the project's own — both cases
   * are left untouched; we never clobber configuration we did not write.
   */
  private installHook(worktreePath: string): void {
    try {
      const settingsPath = join(worktreePath, LOCAL_SETTINGS_REL)
      if (existsSync(settingsPath)) return
      mkdirSync(join(worktreePath, '.claude'), { recursive: true })
      writeFileSync(settingsPath, `${JSON.stringify(HOOK_SETTINGS, null, 2)}\n`)
    } catch {
      // Best effort — without the hook the card simply waits for a human move.
    }
  }

  /**
   * Hide the sentinel and the hook settings from git via `.git/info/exclude`
   * (shared by all worktrees, never a repo mutation — the SwarmWorktrees
   * pattern). Without this the two files would dirty the worktree, block
   * `removeIfClean`, and pollute the card's diff review.
   */
  private ensureExcluded(projectPath: string): void {
    try {
      const exclude = join(projectPath, '.git', 'info', 'exclude')
      const wanted = [DONE_SENTINEL, '.claude/settings.local.json']
      const current = existsSync(exclude) ? readFileSync(exclude, 'utf8') : ''
      const lines = current.split('\n')
      const missing = wanted.filter((w) => !lines.includes(w))
      if (missing.length > 0) appendFileSync(exclude, `\n${missing.join('\n')}\n`)
    } catch {
      // Best effort — a visible sentinel in git status is cosmetic.
    }
  }
}
