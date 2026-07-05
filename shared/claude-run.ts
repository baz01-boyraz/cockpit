/**
 * Builds the argv for a one-shot, non-interactive Claude Code run.
 *
 * `--print` makes the CLI emit ONLY the final assistant message and exit. We
 * never pass a permission-bypass flag (`--dangerously-skip-permissions`) or an
 * auto-accept mode, so the chat stays read-mostly: Claude can read the project
 * to ground its answer but cannot run risky commands without a TTY to approve.
 *
 * `--no-session-persistence` is mandatory: none of these one-shot callers
 * (memory distiller, swarm review gates, council, chat) ever resume a prior
 * run, so there is no reason for the CLI to write a `.jsonl` transcript under
 * `~/.claude/projects/<project>/`. Without it, that transcript lands in the
 * exact directory MemoryAutoCapture scans for "grown" sessions to distill —
 * which re-invokes this same helper, writes another transcript, and repeats
 * forever, silently burning quota (see .cockpit-memory/ for the incident).
 *
 * Kept pure and dependency-free (it runs in the browser mock too). The cockpit
 * spawns `claude` with `execFile`, never a shell, so the prompt is a single
 * discrete argv entry and needs no escaping.
 */

export interface ClaudeRunOptions {
  /** Model alias for `claude --model`, e.g. `sonnet`, `opus`, `haiku`. */
  model?: string
}

/**
 * Flags precede the prompt so the positional prompt stays unambiguous. Returns
 * `['--print', '--no-session-persistence', prompt]` when no model override is
 * supplied.
 */
export function buildClaudeArgs(prompt: string, opts: ClaudeRunOptions = {}): string[] {
  const args = ['--print', '--no-session-persistence']
  const model = opts.model?.trim()
  if (model) args.push('--model', model)
  args.push(prompt)
  return args
}
