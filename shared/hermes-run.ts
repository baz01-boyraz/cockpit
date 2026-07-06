/**
 * Builds the argv for a one-shot, non-interactive Hermes run. Two callers:
 *   - the memory distiller (docs/plans/hermes.md Faz 5), a narrow mechanical
 *     transcript-distillation call that does NOT want the orchestrator persona;
 *   - the Hermes chat widget backend (Faz 7), a genuine conversation that DOES
 *     want `AGENTS.md` and the `cockpit` MCP tools loaded — that is the whole
 *     point of the feature.
 *
 * `--oneshot <prompt>` (`-z`) makes Hermes print ONLY the final response and
 * exit — no banner, no spinner, already clean for capturing stdout. The prompt
 * is the value of the flag, so it must directly follow `--oneshot`.
 *
 * `--ignore-rules` skips auto-injection of the project's `AGENTS.md`/rules/
 * skills. The distiller passes it (persona/context would only pollute a
 * mechanical distill); chat omits it (`ignoreRules: false`) so Hermes runs as
 * its full orchestrator self.
 *
 * Kept pure and dependency-free (it runs in the browser mock too). The cockpit
 * spawns `hermes` with `execFile`, never a shell, so the prompt is a single
 * discrete argv entry and needs no escaping.
 */

export interface HermesRunOptions {
  /** Model override for `hermes -m`, e.g. `deepseek/deepseek-v4-flash`. */
  model?: string
  /**
   * Pass `--ignore-rules` to skip `AGENTS.md`/rules/skills injection.
   * Defaults to `true` (the distiller's mechanical use). The chat backend sets
   * this to `false` so the orchestrator persona and MCP tools stay loaded.
   */
  ignoreRules?: boolean
}

/**
 * Returns the oneshot argv, prepending `--ignore-rules` when requested and
 * inserting `-m <model>` before `--oneshot` when a model override is supplied.
 * The prompt always sits immediately after `--oneshot` so argparse reads it as
 * that flag's value.
 */
export function buildHermesArgs(prompt: string, opts: HermesRunOptions = {}): string[] {
  const ignoreRules = opts.ignoreRules ?? true
  const args = ignoreRules ? ['--ignore-rules'] : []
  const model = opts.model?.trim()
  if (model) args.push('-m', model)
  args.push('--oneshot', prompt)
  return args
}
