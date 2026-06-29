/**
 * Builds the argv for a one-shot `hermes -z` run from optional overrides.
 *
 * Kept pure and dependency-free (it runs in the browser mock too). The cockpit
 * spawns Hermes with `execFile`, never a shell, so each value below is a
 * discrete argv entry and needs no escaping.
 */

export interface HermesRunOptions {
  /** Override the inference provider for this run, e.g. `anthropic`. */
  provider?: string
  /** Override the model id for this run, e.g. `claude-opus-4-8`. */
  model?: string
  /** Scope the run to these skills; undefined/empty keeps Hermes' defaults. */
  skills?: string[]
  /** Scope the run to these toolsets; undefined/empty keeps Hermes' defaults. */
  toolsets?: string[]
}

function csv(values: string[] | undefined): string | null {
  if (!values) return null
  const cleaned = [...new Set(values.map((v) => v.trim()).filter(Boolean))]
  return cleaned.length ? cleaned.join(',') : null
}

/**
 * Flags precede the prompt so `-z <prompt>` stays unambiguous. Returns the
 * default `['-z', prompt]` when no overrides are supplied.
 */
export function buildHermesArgs(prompt: string, opts: HermesRunOptions = {}): string[] {
  const args: string[] = []
  const provider = opts.provider?.trim()
  const model = opts.model?.trim()
  if (provider) args.push('--provider', provider)
  if (model) args.push('-m', model)
  const skills = csv(opts.skills)
  if (skills) args.push('--skills', skills)
  const toolsets = csv(opts.toolsets)
  if (toolsets) args.push('-t', toolsets)
  args.push('-z', prompt)
  return args
}
