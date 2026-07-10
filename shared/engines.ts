/**
 * The engine adapter's shared vocabulary: which LLM back-ends a council seat can
 * be assigned to, and the argv for the one that is new here (`codex`). Kept pure
 * and dependency-free — like `claude-run.ts` it runs in the browser mock too and
 * must never reach for Node or Electron APIs.
 *
 * Three engines, one shape. `claude` and `codex` are local CLIs we spawn with
 * `execFile` (never a shell), so a prompt is a single discrete argv entry and
 * needs no escaping. Codex therefore reuses the CLI's active auth method; this
 * app neither reads nor forwards an OpenAI credential. `openrouter` is an HTTP
 * call. The `model` field means something different per engine — see
 * EngineSpec — so callers must keep the engine and model paired, never route a
 * slug to the wrong back-end.
 */

/** The back-ends a seat can run on. Adding one here forces the EngineRunner
 *  switch to handle it (exhaustive `never` check) rather than silently no-op. */
export type EngineId = 'claude' | 'codex' | 'openrouter'

/**
 * A {engine, model} pair. `model` semantics are engine-specific:
 *  - claude:     an alias for `claude --model` — `sonnet` | `opus` | `haiku`.
 *  - codex:      a model id for `codex exec -m`; an empty string means "use the
 *                CLI's configured default" (no `-m` flag emitted).
 *  - openrouter: a full provider slug, e.g. `deepseek/deepseek-chat`.
 */
export interface EngineSpec {
  engine: EngineId
  model: string
}

/**
 * Shape allowlist for any model id that reaches argv, mirroring the MODEL_RE
 * idea in `swarm-worker.ts`: a config-authored model value is validated by
 * shape before it is spawned, so a hostile string is ignored rather than run.
 * Empty is allowed (length 0) — that is how a caller asks for the engine's
 * default model. The character class deliberately covers the punctuation real
 * model ids use: `.`, `_`, `/`, `:`, `-` (e.g. `deepseek/deepseek-chat:free`).
 */
export const ENGINE_MODEL_RE = /^[a-zA-Z0-9._/:-]{0,64}$/

/**
 * A short, human-readable chip for a seat's engine — what the council UI shows
 * next to each seat ("opus", "codex", "deepseek"). For OpenRouter the vendor
 * prefix reads best (deepseek/deepseek-chat → "deepseek"); for the CLIs the
 * model alias is the useful label, falling back to the engine name when the
 * model is the CLI default (empty string).
 */
export function engineLabel(spec: EngineSpec): string {
  switch (spec.engine) {
    case 'claude':
      return spec.model || 'claude'
    case 'codex':
      return spec.model || 'codex'
    case 'openrouter': {
      const slug = spec.model
      const vendor = slug.includes('/') ? slug.split('/')[0] : slug
      return vendor || 'openrouter'
    }
    default: {
      const unreachable: never = spec.engine
      return String(unreachable)
    }
  }
}

/**
 * Builds the argv for a one-shot, non-interactive Codex run. Verified against
 * the real `codex` CLI (v0.142.5); each flag is load-bearing:
 *
 *  - `exec` writes ONLY the final agent message to stdout; its activity log goes
 *    to stderr. So a stdout-capture runner reads the reply cleanly, exactly like
 *    `claude --print` does — the two CLIs are drop-in for our purposes.
 *  - `--ephemeral` prevents Codex from writing session files to disk. Same
 *    rationale as `--no-session-persistence` in `claude-run.ts`: a persisted
 *    transcript from an automated one-shot call can land where MemoryAutoCapture
 *    scans and feed the self-ingestion loop (see the memory-distiller incident).
 *  - `-s read-only` sandboxes any shell command the model runs. We never pass an
 *    approval-bypass flag, so Codex can read the project to ground its answer but
 *    cannot mutate it without interactive approval it will not have.
 *  - `--skip-git-repo-check` lets the run start in any cwd (the council may point
 *    at a worktree subdir), and `--color never` keeps ANSI escapes out of stdout.
 *
 * CRITICAL — the arg builder cannot fix this, so it is recorded here for every
 * caller: if the spawned child's stdin is left an open pipe, `codex exec` prints
 * "Reading additional input from stdin..." and blocks forever. The RUNNER must
 * close the child's stdin (see EngineRunner's default CLI runner). No argv flag
 * substitutes for that.
 *
 * A model id that fails ENGINE_MODEL_RE is ignored (the CLI default is used) and
 * never reaches argv — the same shape gate `buildWorkerCommand` applies.
 */
export function buildCodexArgs(prompt: string, opts: { model?: string } = {}): string[] {
  const model = opts.model?.trim() ?? ''
  const useModel = model.length > 0 && ENGINE_MODEL_RE.test(model)
  return [
    'exec',
    '--skip-git-repo-check',
    '-s',
    'read-only',
    '--ephemeral',
    '--color',
    'never',
    ...(useModel ? ['-m', model] : []),
    prompt,
  ]
}
