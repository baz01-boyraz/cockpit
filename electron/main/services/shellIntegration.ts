import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Non-destructive shell integration that makes terminals emit OSC 133 semantic
 * prompt marks, which the renderer turns into Warp-style command blocks
 * (see `shared/command-blocks.ts`).
 *
 * The injection **never edits the user's own dotfiles**. It writes cockpit-owned
 * startup files that source the user's real config first, then install prompt
 * hooks that emit the marks. Any failure in our snippet only affects the marks —
 * the shell keeps loading and the terminal always works. Shells we don't yet
 * support are left completely untouched (graceful no-op: plain scrollback, no
 * command blocks), which is a first-class supported mode, not an error.
 *
 * Coverage:
 * - **zsh** — via `ZDOTDIR` (env only). This is the app's default shell on macOS
 *   and is exercised live.
 * - **bash** — via `--rcfile` (a spawn arg). Uses a DEBUG-trap + `PROMPT_COMMAND`
 *   scheme so it works on the ancient bash 3.2 that ships with macOS (which has
 *   no `PS0`). Verified by unit tests; awaiting live validation.
 * - **fish / pwsh** — not yet injected (graceful no-op). Their reliable OSC 133
 *   hooks differ enough to need live-shell validation; tracked in the roadmap.
 */

// zsh: `precmd` runs before each prompt — report the *previous* command's exit
// (D), then open the next prompt (A). It is prepended to precmd_functions so it
// reads the real `$?` before any user hook can clobber it. `preexec` marks output
// start (C). B is embedded at the end of PS1.
const ZSH_ZSHENV = `# cockpiT shell integration (zsh) — do not edit; regenerated on launch.
# Source the user's real .zshenv with ZDOTDIR pointing at their own dir, then let
# zsh continue loading *our* .zshrc (ZDOTDIR stays this directory afterwards).
if [[ -f "\${USER_ZDOTDIR:-$HOME}/.zshenv" ]]; then
  ZDOTDIR="\${USER_ZDOTDIR:-$HOME}" source "\${USER_ZDOTDIR:-$HOME}/.zshenv"
fi
`

const ZSH_ZSHRC = `# cockpiT shell integration (zsh) — do not edit; regenerated on launch.
# Hand the shell back to the user's real config, then add OSC 133 command marks.
ZDOTDIR="\${USER_ZDOTDIR:-$HOME}"
if [[ -f "$ZDOTDIR/.zshrc" ]]; then
  source "$ZDOTDIR/.zshrc"
fi

if [[ -z "$__cockpit_si_installed" ]]; then
  __cockpit_precmd() {
    local __ec=$?
    printf '\\033]133;D;%s\\007' "$__ec"
    printf '\\033]133;A\\007'
  }
  __cockpit_preexec() { printf '\\033]133;C\\007'; }
  typeset -ga precmd_functions preexec_functions
  precmd_functions=(__cockpit_precmd $precmd_functions)
  preexec_functions=(__cockpit_preexec $preexec_functions)
  PS1="$PS1%{$(printf '\\033]133;B\\007')%}"
  __cockpit_si_installed=1
fi
`

// bash: macOS ships bash 3.2, which has no PS0, so output-start (C) is emitted
// from a DEBUG trap gated by an "at prompt" flag (the classic bash-preexec
// trick) — it fires exactly once per submitted command line. PROMPT_COMMAND
// emits the previous exit (D) then the next prompt (A); PS1 ends with B.
const BASH_RC = `# cockpiT shell integration (bash) — do not edit; regenerated on launch.
if [ -f "$HOME/.bashrc" ]; then
  . "$HOME/.bashrc"
fi

if [ -z "$__cockpit_si_installed" ]; then
  __cockpit_si_installed=1
  __cockpit_preexec() {
    if [ -n "$COMP_LINE" ]; then return; fi
    if [ -z "$__cockpit_at_prompt" ]; then return; fi
    __cockpit_at_prompt=
    printf '\\033]133;C\\007'
  }
  __cockpit_precmd() {
    local __ec=$?
    printf '\\033]133;D;%s\\007' "$__ec"
    printf '\\033]133;A\\007'
    __cockpit_at_prompt=1
  }
  trap '__cockpit_preexec' DEBUG
  case "$PROMPT_COMMAND" in
    *__cockpit_precmd*) ;;
    "") PROMPT_COMMAND=__cockpit_precmd ;;
    *) PROMPT_COMMAND="__cockpit_precmd;$PROMPT_COMMAND" ;;
  esac
  PS1="$PS1"'\\[\\e]133;B\\a\\]'
fi
`

export interface ShellSpawnOverrides {
  /** Environment to spawn the pty with (may add ZDOTDIR/USER_ZDOTDIR for zsh). */
  env: Record<string, string>
  /** Extra spawn arguments (e.g. bash `--rcfile <path>`); omit for none. */
  args?: string[]
}

/** Normalise a shell path to its bare, lower-cased name (`/bin/zsh` → `zsh`). */
export function shellName(shell: string): string {
  const base = shell.split(/[\\/]/).pop() ?? shell
  return base.toLowerCase().replace(/\.exe$/, '')
}

function prepareZsh(baseDir: string, baseEnv: Record<string, string>): ShellSpawnOverrides {
  const zdotdir = join(baseDir, 'zsh')
  mkdirSync(zdotdir, { recursive: true })
  writeFileSync(join(zdotdir, '.zshenv'), ZSH_ZSHENV, 'utf8')
  writeFileSync(join(zdotdir, '.zshrc'), ZSH_ZSHRC, 'utf8')
  const userZdotdir = baseEnv.ZDOTDIR ?? baseEnv.HOME ?? homedir()
  return { env: { ...baseEnv, ZDOTDIR: zdotdir, USER_ZDOTDIR: userZdotdir } }
}

function prepareBash(baseDir: string, baseEnv: Record<string, string>): ShellSpawnOverrides {
  const dir = join(baseDir, 'bash')
  mkdirSync(dir, { recursive: true })
  const rcPath = join(dir, 'bashrc')
  writeFileSync(rcPath, BASH_RC, 'utf8')
  return { env: baseEnv, args: ['--rcfile', rcPath] }
}

/**
 * Prepare shell integration for a pty spawn. Writes the cockpit-owned startup
 * files under `baseDir` (idempotent, overwritten each launch to stay current) and
 * returns the environment/args to spawn with. Never throws: any I/O failure or
 * unsupported shell degrades to the untouched base environment (plain scrollback).
 */
export function prepareShellIntegration(
  shell: string,
  baseDir: string,
  baseEnv: Record<string, string>,
): ShellSpawnOverrides {
  try {
    switch (shellName(shell)) {
      case 'zsh':
        return prepareZsh(baseDir, baseEnv)
      case 'bash':
        return prepareBash(baseDir, baseEnv)
      default:
        // fish / pwsh / unknown — command blocks are a nicety, never a blocker.
        return { env: baseEnv }
    }
  } catch {
    return { env: baseEnv }
  }
}
